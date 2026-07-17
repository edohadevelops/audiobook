import { useState, useRef, useCallback, useEffect } from "react";
import { supabase, supabaseConfigError } from "./supabaseClient";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown, Play, Pause, SkipBack, SkipForward, Rewind, FastForward,
  Zap, RotateCcw, CheckCircle2, PenLine, Download, Sparkles, BookOpen,
} from "lucide-react";
import {
  fetchBooks as dbFetchBooks,
  recordCompletion,
  flushListenSession,
  updateBook,
  uploadCover,
  fetchRecentCompletions,
  coverUrl,
} from "./lib/db";
import Journal from "./screens/Journal";
import Goals from "./screens/Goals";
import Wrapped from "./screens/Wrapped";
import Library from "./screens/Library";
import Starfield from "./components/Starfield";
import MiniPlayer from "./components/MiniPlayer";
import Karaoke from "./components/Karaoke";
import Confetti from "./components/Confetti";
import { TabBar, ThemeToggle, Button, IconButton, Card, Waveform } from "./components/ui";
import { spring, tap, ease } from "./theme";

const CHUNK_SIZE = 4000;

const VOICE_OPTIONS = [
  { id: "en-US-Neural2-D", label: "Marcus", desc: "Warm American male", lang: "en-US", gender: "MALE" },
  { id: "en-US-Neural2-I", label: "DeShawn", desc: "Deep rich American male", lang: "en-US", gender: "MALE" },
  { id: "en-US-Neural2-J", label: "Jordan", desc: "Clear articulate American male", lang: "en-US", gender: "MALE" },
  { id: "en-US-Wavenet-B", label: "Franklin", desc: "Authoritative American male", lang: "en-US", gender: "MALE" },
  { id: "en-US-Wavenet-D", label: "Smooth D", desc: "Smooth mellow American male", lang: "en-US", gender: "MALE" },
  { id: "en-US-Wavenet-I", label: "Isaiah", desc: "Rich deep American male", lang: "en-US", gender: "MALE" },
  { id: "en-GB-Wavenet-B", label: "Edmund", desc: "Deep British male", lang: "en-GB", gender: "MALE" },
  { id: "en-GB-Wavenet-D", label: "Reginald", desc: "Smooth British male", lang: "en-GB", gender: "MALE" },
  { id: "en-AU-Wavenet-B", label: "Bruce", desc: "Deep Australian male", lang: "en-AU", gender: "MALE" },
  { id: "en-US-Neural2-F", label: "Naomi", desc: "Warm American female", lang: "en-US", gender: "FEMALE" },
  { id: "en-US-Neural2-H", label: "Serena", desc: "Clear American female", lang: "en-US", gender: "FEMALE" },
  { id: "en-GB-Wavenet-C", label: "Victoria", desc: "Elegant British female", lang: "en-GB", gender: "FEMALE" },
];

function chunkText(text) {
  const paragraphs = text.split(/\n+/).filter(p => p.trim().length > 0);
  const chunks = [];
  let current = "";
  for (const para of paragraphs) {
    if ((current + " " + para).trim().length > CHUNK_SIZE) {
      if (current.trim()) chunks.push(current.trim());
      current = para;
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function extractTextFromPDF(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const typedArray = new Uint8Array(e.target.result);
        const pdfjsLib = window.pdfjsLib;
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        const pdf = await pdfjsLib.getDocument({ data: typedArray }).promise;
        let fullText = "";
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          const pageText = content.items.map(item => item.str).join(" ");
          fullText += pageText + "\n\n";
        }
        resolve(fullText.trim());
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

async function generateAndCacheAudio(text, apiKey, bookId, chunkIndex, voice, forceRegenerate = false) {
  const voiceKey = voice.id;

  if (!forceRegenerate) {
    const { data: cached } = await supabase
      .from("audio_chunks")
      .select("audio_path, voice_id")
      .eq("book_id", bookId)
      .eq("chunk_index", chunkIndex)
      .eq("voice_id", voiceKey)
      .maybeSingle();
    if (cached?.audio_path) {
      const { data } = supabase.storage.from("audio").getPublicUrl(cached.audio_path);
      return data.publicUrl;
    }
  }

  const response = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: voice.lang, name: voice.id, ssmlGender: voice.gender },
        audioConfig: { audioEncoding: "MP3", speakingRate: 0.95, pitch: -1.0 },
      }),
    }
  );
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || "Google TTS API error");
  }
  const data = await response.json();
  const audioBlob = new Blob(
    [Uint8Array.from(atob(data.audioContent), c => c.charCodeAt(0))],
    { type: "audio/mp3" }
  );

  const audioPath = `${bookId}/${voiceKey}/chunk_${chunkIndex}.mp3`;
  await supabase.storage.from("audio").upload(audioPath, audioBlob, { contentType: "audio/mp3", upsert: true });
  await supabase.from("audio_chunks").upsert({ book_id: bookId, chunk_index: chunkIndex, audio_path: audioPath, voice_id: voiceKey }, { onConflict: "book_id,chunk_index,voice_id" });

  const { data: urlData } = supabase.storage.from("audio").getPublicUrl(audioPath);
  return urlData.publicUrl;
}

export default function App() {
  const [screen, setScreen] = useState("library");
  const [apiKey] = useState(import.meta.env.VITE_GOOGLE_TTS_KEY || "");
  const [books, setBooks] = useState([]);
  const [loadingBooks, setLoadingBooks] = useState(true);
  const [booksError, setBooksError] = useState("");
  const [activeBook, setActiveBook] = useState(null);
  const [chunks, setChunks] = useState([]);
  const [cachedChunks, setCachedChunks] = useState({});
  const [currentChunk, setCurrentChunk] = useState(0);
  const [audioUrls, setAudioUrls] = useState({});
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [pregenProgress, setPregenProgress] = useState(null);
  const [selectedVoice, setSelectedVoice] = useState(VOICE_OPTIONS[0]);
  const [showVoiceDropdown, setShowVoiceDropdown] = useState(false);
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);
  // Library browsing
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("");
  const [recentDone, setRecentDone] = useState([]);
  // Upload details form
  const [pendingUpload, setPendingUpload] = useState(null);
  // Completion CTA
  const [justFinished, setJustFinished] = useState(false);

  // Two audio elements for gapless (double-buffered) playback.
  const audioRef0 = useRef(null);
  const audioRef1 = useRef(null);
  const audioRefs = [audioRef0, audioRef1];
  const activeIdx = useRef(0);
  const bufferedChunkRef = useRef(null); // chunk index currently buffered in the idle element
  const getActive = () => audioRefs[activeIdx.current].current;
  const getIdle = () => audioRefs[activeIdx.current === 0 ? 1 : 0].current;

  const progressSaveRef = useRef(null);
  const dropdownRef = useRef(null);

  // Refs mirroring state, so the imperative audio logic never reads stale values.
  const chunksRef = useRef([]);
  const currentChunkRef = useRef(0);
  const speedRef = useRef(1);
  const audioUrlsRef = useRef({});
  const activeBookRef = useRef(null);
  const listenAccumRef = useRef(0);
  const lastPosRef = useRef(0);

  useEffect(() => { chunksRef.current = chunks; }, [chunks]);
  useEffect(() => { currentChunkRef.current = currentChunk; }, [currentChunk]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { audioUrlsRef.current = audioUrls; }, [audioUrls]);
  useEffect(() => { activeBookRef.current = activeBook; }, [activeBook]);

  useEffect(() => { fetchBooks(); }, []);

  useEffect(() => {
    const handleClick = (e) => { if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setShowVoiceDropdown(false); };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // When voice changes, drop in-memory urls + buffered audio so the new voice is used.
  useEffect(() => {
    setAudioUrls({});
    audioUrlsRef.current = {};
    bufferedChunkRef.current = null;
    if (activeBook) refreshCachedChunks(activeBook.id, selectedVoice.id);
  }, [selectedVoice]);

  const refreshCachedChunks = async (bookId, voiceId) => {
    if (!supabase) return;
    const { data } = await supabase
      .from("audio_chunks")
      .select("chunk_index")
      .eq("book_id", bookId)
      .eq("voice_id", voiceId);
    const cached = {};
    (data || []).forEach(ac => { cached[ac.chunk_index] = true; });
    setCachedChunks(cached);
  };

  const fetchBooks = async () => {
    setLoadingBooks(true);
    setBooksError("");
    const { data, error } = await dbFetchBooks();
    if (error) setBooksError(error.message);
    setBooks(data || []);
    setLoadingBooks(false);
    const rc = await fetchRecentCompletions(5);
    setRecentDone(rc.data || []);
  };

  // ---- Upload flow: pick file -> collect details -> add to library ----------

  const handleFilePick = async (file) => {
    if (!file || file.type !== "application/pdf") { setError("Please upload a valid PDF file."); return; }
    setError("");
    setUploading(true);
    setLoadingMsg("Extracting text from PDF…");
    try {
      const text = await extractTextFromPDF(file);
      if (!text) throw new Error("No readable text found. The PDF may be scanned.");
      const c = chunkText(text);
      setPendingUpload({
        file, text, chunks: c,
        title: file.name.replace(/\.pdf$/i, ""),
        author: "",
        category: "",
      });
    } catch (e) {
      setError(e.message);
    }
    setUploading(false);
    setLoadingMsg("");
  };

  const handleConfirmUpload = async () => {
    if (!pendingUpload || !supabase) return;
    const { file, text, chunks: c, title, author, category } = pendingUpload;
    setUploading(true);
    setLoadingMsg("Uploading to library…");
    try {
      const filePath = `${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage.from("books").upload(filePath, file);
      if (uploadError) throw uploadError;
      const { data: bookData, error: bookError } = await supabase
        .from("books")
        .insert({
          title: title.trim() || file.name,
          author: author.trim() || null,
          category: category.trim() || null,
          file_path: filePath,
          word_count: text.split(/\s+/).filter(Boolean).length,
          chunk_count: c.length,
        })
        .select().single();
      if (bookError) throw bookError;
      await supabase.from("reading_progress").insert({ book_id: bookData.id, current_chunk: 0, current_position: 0 });
      setPendingUpload(null);
      await fetchBooks();
      setUploading(false);
      setLoadingMsg("");
      openBook({ ...bookData, reading_progress: [{ current_chunk: 0, current_position: 0 }] }, c);
    } catch (e) {
      setError(e.message);
      setUploading(false);
      setLoadingMsg("");
    }
  };

  // ---- Opening & playback ----------------------------------------------------

  const openBook = async (book, preloadedChunks = null, repeat = false) => {
    setError("");
    setAudioUrls({});
    audioUrlsRef.current = {};
    bufferedChunkRef.current = null;
    activeIdx.current = 0;
    listenAccumRef.current = 0;
    lastPosRef.current = 0;
    setIsPlaying(false);
    setJustFinished(false);
    setActiveBook(book);
    activeBookRef.current = book;
    setPregenProgress(null);
    setShowRegenConfirm(false);
    audioRef0.current?.pause();
    audioRef1.current?.pause();

    let c = preloadedChunks;
    if (!c) {
      setIsLoading(true);
      setLoadingMsg("Loading book…");
      try {
        const { data, error: dlError } = await supabase.storage.from("books").download(book.file_path);
        if (dlError) throw dlError;
        const file = new File([data], book.title + ".pdf", { type: "application/pdf" });
        const text = await extractTextFromPDF(file);
        c = chunkText(text);
      } catch (e) {
        setError(e.message || "Couldn't load this book from storage.");
        setIsLoading(false);
        return;
      }
      setIsLoading(false);
      setLoadingMsg("");
    }

    setChunks(c);
    chunksRef.current = c;
    await refreshCachedChunks(book.id, selectedVoice.id);

    const prog = book.reading_progress?.[0];
    const savedChunk = repeat ? 0 : (prog?.current_chunk || 0);
    setCurrentChunk(savedChunk);
    currentChunkRef.current = savedChunk;
    setProgress((savedChunk / c.length) * 100);
    setScreen("player");

    if (prog?.id) {
      await supabase.from("reading_progress").update({ last_opened: new Date().toISOString() }).eq("id", prog.id);
    }
  };

  const saveProgress = useCallback(async (chunk, position) => {
    const book = activeBookRef.current;
    if (!book) return;
    const prog = book.reading_progress?.[0];
    if (prog?.id && supabase) {
      await supabase.from("reading_progress")
        .update({ current_chunk: chunk, current_position: position, last_opened: new Date().toISOString() })
        .eq("id", prog.id);
    }
  }, []);

  const flushListen = useCallback(() => {
    const secs = Math.floor(listenAccumRef.current);
    if (secs >= 1 && activeBookRef.current) {
      flushListenSession(activeBookRef.current.id, secs);
      listenAccumRef.current -= secs;
    }
  }, []);

  // Resolve (generate + cache if needed) the audio URL for a chunk.
  const ensureUrl = async (idx, forceRegen = false) => {
    if (!forceRegen && audioUrlsRef.current[idx]) return audioUrlsRef.current[idx];
    const url = await generateAndCacheAudio(
      chunksRef.current[idx], apiKey, activeBookRef.current.id, idx, selectedVoice, forceRegen
    );
    setAudioUrls(prev => ({ ...prev, [idx]: url }));
    audioUrlsRef.current = { ...audioUrlsRef.current, [idx]: url };
    setCachedChunks(prev => ({ ...prev, [idx]: true }));
    return url;
  };

  // Buffer the NEXT chunk into the idle audio element (gapless handoff), and
  // warm the URL for the one after that so long drives never stall.
  const prepareNext = async (idx) => {
    const nx = idx + 1;
    if (!chunksRef.current[nx] || !apiKey) { bufferedChunkRef.current = null; return; }
    try {
      const url = await ensureUrl(nx);
      const idle = getIdle();
      if (idle) {
        idle.src = url;
        idle.playbackRate = speedRef.current;
        idle.load();
        bufferedChunkRef.current = nx;
      }
    } catch { /* preload is best-effort */ }
    // Warm the URL one further ahead (no element needed yet).
    if (chunksRef.current[nx + 1]) ensureUrl(nx + 1).catch(() => {});
  };

  const playChunk = async (idx, forceRegen = false) => {
    if (!chunksRef.current[idx]) return;
    setCurrentChunk(idx);
    currentChunkRef.current = idx;
    setError("");
    let url = !forceRegen && audioUrlsRef.current[idx] ? audioUrlsRef.current[idx] : null;
    if (!url) {
      setIsLoading(true);
      setLoadingMsg(cachedChunks[idx] && !forceRegen ? `Loading part ${idx + 1}…` : `Generating audio for part ${idx + 1} of ${chunksRef.current.length}…`);
      try {
        url = await ensureUrl(idx, forceRegen);
      } catch (e) {
        setError(e.message);
        setIsLoading(false);
        setIsPlaying(false);
        return;
      }
      setIsLoading(false);
      setLoadingMsg("");
    }
    const el = getActive();
    if (el) {
      el.src = url;
      el.currentTime = 0;
      el.playbackRate = speedRef.current;
      el.play();
      setIsPlaying(true);
    }
    lastPosRef.current = 0;
    prepareNext(idx);
  };

  // Called when the active element finishes: swap to the pre-buffered idle
  // element for a gapless transition, or fall back to loading if not ready.
  const advanceOrFinish = () => {
    const nx = currentChunkRef.current + 1;
    if (nx < chunksRef.current.length) {
      flushListen();
      if (bufferedChunkRef.current === nx && getIdle()?.src) {
        activeIdx.current = activeIdx.current === 0 ? 1 : 0;
        const el = getActive();
        el.currentTime = 0;
        el.playbackRate = speedRef.current;
        el.play();
        setCurrentChunk(nx);
        currentChunkRef.current = nx;
        setIsPlaying(true);
        lastPosRef.current = 0;
        prepareNext(nx);
      } else {
        playChunk(nx);
      }
    } else {
      finishBook();
    }
  };

  const finishBook = async () => {
    flushListen();
    const book = activeBookRef.current;
    setIsPlaying(false);
    setCurrentChunk(0);
    currentChunkRef.current = 0;
    setProgress(100);
    saveProgress(0, 0);
    if (book) {
      await recordCompletion(book.id, book.times_completed || 0);
      setJustFinished(true);
      fetchBooks();
    }
  };

  const handleMarkFinished = async () => {
    getActive()?.pause();
    getIdle()?.pause();
    await finishBook();
  };

  const handlePlay = async () => {
    if (!apiKey) { setError("VITE_GOOGLE_TTS_KEY not found in .env file."); return; }
    if (!chunks.length) return;
    const el = getActive();
    if (isPlaying) {
      el?.pause();
      setIsPlaying(false);
      flushListen();
      saveProgress(currentChunk, el?.currentTime || 0);
    } else {
      if (el?.src && el.paused && el.currentTime > 0) {
        el.playbackRate = speed;
        el.play();
        setIsPlaying(true);
      } else {
        playChunk(currentChunk);
      }
    }
  };

  const handlePregenerate = async (forceRegen = false) => {
    if (!apiKey || !chunks.length || !activeBook) return;
    setShowRegenConfirm(false);
    setPregenProgress({ done: 0, total: chunks.length });
    for (let i = 0; i < chunks.length; i++) {
      if (forceRegen || !cachedChunks[i]) {
        try {
          await generateAndCacheAudio(chunks[i], apiKey, activeBook.id, i, selectedVoice, forceRegen);
          setCachedChunks(prev => ({ ...prev, [i]: true }));
        } catch (e) {
          setError(`Failed on part ${i + 1}: ${e.message}`);
          setPregenProgress(null);
          return;
        }
      }
      setPregenProgress({ done: i + 1, total: chunks.length });
    }
    setPregenProgress(null);
    setAudioUrls({});
    audioUrlsRef.current = {};
  };

  const handleDownload = async () => {
    if (!activeBook || !supabase) return;
    setLoadingMsg("Preparing download…");
    setIsLoading(true);
    try {
      const { data: chunkData } = await supabase
        .from("audio_chunks")
        .select("chunk_index, audio_path")
        .eq("book_id", activeBook.id)
        .eq("voice_id", selectedVoice.id)
        .order("chunk_index");
      if (!chunkData?.length) { setError("No cached audio for this voice yet. Generate audio first."); setIsLoading(false); setLoadingMsg(""); return; }
      const blobs = [];
      for (const chunk of chunkData) {
        const { data } = await supabase.storage.from("audio").download(chunk.audio_path);
        blobs.push(data);
      }
      const merged = new Blob(blobs, { type: "audio/mp3" });
      const url = URL.createObjectURL(merged);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${activeBook.title} — ${selectedVoice.label}.mp3`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError(e.message); }
    setIsLoading(false);
    setLoadingMsg("");
  };

  const handleSkip = (seconds) => {
    const el = getActive();
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(el.duration || 0, el.currentTime + seconds));
  };

  const handleEnded = (e) => {
    if (e.currentTarget !== getActive()) return; // ignore the idle (preload) element
    advanceOrFinish();
  };

  const handleTimeUpdate = (e) => {
    const el = getActive();
    if (e.currentTarget !== el || !el) return;
    const pos = el.currentTime;
    const dur = el.duration || 0;
    setCurrentTime(pos);
    setDuration(dur);
    const chunkProgress = dur ? pos / dur : 0;
    const overall = ((currentChunk + chunkProgress) / (chunks.length || 1)) * 100;
    setProgress(overall);

    // Accumulate listening time (guard against seeks / chunk resets).
    const delta = pos - lastPosRef.current;
    if (delta > 0 && delta < 2) listenAccumRef.current += delta;
    lastPosRef.current = pos;
    if (listenAccumRef.current >= 30) flushListen();

    clearTimeout(progressSaveRef.current);
    progressSaveRef.current = setTimeout(() => saveProgress(currentChunkRef.current, pos), 10000);
  };

  const handleLoadedMeta = (e) => {
    if (e.currentTarget === getActive()) setDuration(getActive()?.duration || 0);
  };

  // Collapse to the mini-player WITHOUT stopping playback (keeps listening).
  const collapsePlayer = () => {
    flushListen();
    saveProgress(currentChunk, getActive()?.currentTime || 0);
    setScreen("library");
  };

  // Draggable/clickable scrubber seek.
  const seekFromEvent = (e) => {
    const el = getActive();
    if (!el || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    el.currentTime = frac * duration;
  };

  const deleteBook = async (e, bookId, filePath) => {
    e.stopPropagation();
    if (!confirm("Delete this book from your library?")) return;
    const { data: chunkData } = await supabase.from("audio_chunks").select("audio_path").eq("book_id", bookId);
    if (chunkData?.length) await supabase.storage.from("audio").remove(chunkData.map(c => c.audio_path));
    await supabase.storage.from("books").remove([filePath]);
    await supabase.from("books").delete().eq("id", bookId);
    fetchBooks();
  };

  const formatTime = (s) => {
    if (!s || isNaN(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const cachedCount = Object.keys(cachedChunks).length;
  const allCached = chunks.length > 0 && cachedCount >= chunks.length;
  const wordCount = activeBook?.word_count || 0;
  const estMinutes = Math.round(wordCount / 150);

  // ---- Library handlers passed to <Library> ---------------------------------
  const onDeleteBook = (e, book) => deleteBook(e, book.id, book.file_path);
  const onJournalOpen = (book) => { setActiveBook(book); activeBookRef.current = book; setScreen("journal"); };
  const onSaveEdit = async (book, fields, coverFile) => {
    let cover_path = book.cover_path || null;
    if (coverFile) {
      const up = await uploadCover(book.id, coverFile);
      if (up.error) { setError(up.error.message); return; }
      cover_path = up.data;
    }
    const { error: upErr } = await updateBook(book.id, {
      title: fields.title?.trim() || book.title,
      author: fields.author?.trim() || null,
      category: fields.category?.trim() || null,
      cover_path,
    });
    if (upErr) { setError(upErr.message); return; }
    fetchBooks();
  };

  const libraryProps = {
    books, loadingBooks, booksError, recentDone, error,
    search, setSearch, activeCategory, setActiveCategory,
    onOpen: (book) => openBook(book),
    onRepeat: (book) => openBook(book, null, true),
    onJournal: onJournalOpen,
    onDelete: onDeleteBook,
    onFilePick: handleFilePick,
    pendingUpload, setPendingUpload, onConfirmUpload: handleConfirmUpload, uploading,
    onSaveEdit,
  };

  const renderChrome = () => (
    <div style={{ maxWidth: 620, margin: "0 auto", padding: "20px 16px 8px", display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ flex: 1 }}><TabBar screen={screen} setScreen={setScreen} /></div>
      <ThemeToggle />
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font)", position: "relative", overflow: "hidden" }}>
      <Starfield />
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes wave { from { transform: scaleY(0.4); transform-origin: center; } to { transform: scaleY(1.4); transform-origin: center; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        @keyframes dropIn { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:translateY(0); } }
        .fade-up { animation: fadeUp 0.4s ease forwards; }
        .card { background: #141414; border: 0.5px solid #2a2a2a; border-radius: 16px; padding: 1.5rem; }
        .btn-gold { background: #c8a96e; border: none; border-radius: 50%; color: #0d0d0d; cursor: pointer; transition: transform 0.15s, background 0.2s; display: flex; align-items: center; justify-content: center; }
        .btn-gold:hover { background: #d4b87a; transform: scale(1.05); }
        .btn-gold:active { transform: scale(0.97); }
        .btn-gold:disabled { background: #2a2a2a; color: #555; cursor: not-allowed; transform: none; }
        .btn-ghost { background: transparent; border: 0.5px solid #2e2e2e; border-radius: 8px; color: #888; cursor: pointer; font-family: 'Space Mono', monospace; font-size: 11px; padding: 6px 14px; transition: border-color 0.2s, color 0.2s; }
        .btn-ghost:hover { border-color: #c8a96e; color: #c8a96e; }
        .btn-ghost:disabled { opacity: 0.3; cursor: not-allowed; }
        .btn-icon { background: transparent; border: 0.5px solid #2a2a2a; border-radius: 8px; color: #888; cursor: pointer; padding: 8px 14px; font-family: 'Space Mono', monospace; font-size: 11px; transition: all 0.15s; display: flex; align-items: center; justify-content: center; gap: 6px; }
        .btn-icon:hover { border-color: #c8a96e; color: #c8a96e; }
        .btn-icon:disabled { opacity: 0.3; cursor: not-allowed; }
        .btn-danger { background: transparent; border: 0.5px solid #3a1a1a; border-radius: 8px; color: #e06060; cursor: pointer; padding: 8px 14px; font-family: 'Space Mono', monospace; font-size: 11px; transition: all 0.15s; display: flex; align-items: center; justify-content: center; gap: 6px; }
        .btn-danger:hover { border-color: #e06060; background: rgba(200,60,60,0.08); }
        .btn-danger:disabled { opacity: 0.3; cursor: not-allowed; }
        .speed-btn { background: transparent; border: 0.5px solid #2e2e2e; border-radius: 6px; color: #666; cursor: pointer; font-family: 'Space Mono', monospace; font-size: 10px; padding: 4px 8px; transition: all 0.15s; }
        .speed-btn:hover { border-color: #555; color: #999; }
        .speed-btn.active { border-color: #c8a96e; color: #c8a96e; background: rgba(200,169,110,0.08); }
        .book-card { background: #141414; border: 0.5px solid #2a2a2a; border-radius: 12px; padding: 1.25rem; cursor: pointer; transition: border-color 0.2s, background 0.2s; position: relative; }
        .book-card:hover { border-color: #c8a96e; background: #181818; }
        .drop-zone { border: 1px dashed #2e2e2e; border-radius: 12px; padding: 2rem 1.5rem; text-align: center; cursor: pointer; transition: border-color 0.2s, background 0.2s; }
        .drop-zone:hover, .drop-zone.active { border-color: #c8a96e; background: rgba(200,169,110,0.04); }
        .progress-bar { height: 3px; background: #1e1e1e; border-radius: 2px; overflow: hidden; cursor: pointer; }
        .progress-fill { height: 100%; background: linear-gradient(90deg, #c8a96e, #e8c97e); border-radius: 2px; transition: width 0.3s linear; }
        .orb { position: fixed; border-radius: 50%; filter: blur(80px); pointer-events: none; z-index: 0; }
        .delete-btn { position: absolute; top: 10px; right: 10px; background: transparent; border: none; color: #444; cursor: pointer; font-size: 14px; padding: 4px; border-radius: 4px; opacity: 0; transition: opacity 0.2s, color 0.2s; }
        .book-card:hover .delete-btn { opacity: 1; }
        .delete-btn:hover { color: #e06060; }
        .voice-dropdown { position: absolute; top: calc(100% + 6px); left: 0; right: 0; background: #1a1a1a; border: 0.5px solid #333; border-radius: 10px; z-index: 50; overflow: hidden; animation: dropIn 0.15s ease forwards; max-height: 280px; overflow-y: auto; }
        .voice-option { padding: 10px 14px; cursor: pointer; transition: background 0.15s; border-bottom: 0.5px solid #222; }
        .voice-option:last-child { border-bottom: none; }
        .voice-option:hover { background: #222; }
        .voice-option.active { background: rgba(200,169,110,0.08); }
        .voice-dropdown::-webkit-scrollbar { width: 4px; }
        .voice-dropdown::-webkit-scrollbar-track { background: transparent; }
        .voice-dropdown::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
        .confirm-box { background: rgba(200,169,110,0.05); border: 0.5px solid rgba(200,169,110,0.2); border-radius: 10px; padding: 12px 14px; margin-bottom: 10px; }
        .lib-input { width: 100%; background: #141414; border: 0.5px solid #2a2a2a; border-radius: 8px; color: #e8e0d0; font-family: 'Crimson Pro', serif; font-size: 15px; padding: 10px 12px; outline: none; }
        .lib-input:focus { border-color: #c8a96e; }
        .chip { background: transparent; border: 0.5px solid #2e2e2e; border-radius: 20px; color: #888; cursor: pointer; font-family: 'Space Mono', monospace; font-size: 10px; padding: 5px 12px; transition: all 0.15s; }
        .chip:hover { border-color: #c8a96e; color: #c8a96e; }
        .chip.active { border-color: #c8a96e; color: #c8a96e; background: rgba(200,169,110,0.08); }
      `}</style>

      <audio ref={audioRef0} onEnded={handleEnded} onTimeUpdate={handleTimeUpdate} onLoadedMetadata={handleLoadedMeta} />
      <audio ref={audioRef1} onEnded={handleEnded} onTimeUpdate={handleTimeUpdate} onLoadedMetadata={handleLoadedMeta} />

      {/* Global config error banner */}
      {supabaseConfigError && (
        <div style={{ maxWidth: 600, margin: "0 auto", padding: "1rem", position: "relative", zIndex: 1 }}>
          <div style={{ background: "rgba(200,60,60,0.08)", border: "0.5px solid rgba(200,60,60,0.25)", borderRadius: 8, padding: "12px 16px" }}>
            <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, color: "#e06060" }}>⚠ {supabaseConfigError}</p>
          </div>
        </div>
      )}

      {/* TABBED SCREENS — chrome stays fixed so the tab pill morphs; content
          book-flips between tabs via AnimatePresence. */}
      {(screen === "library" || screen === "goals" || screen === "stats") && (
        <div style={{ position: "relative", zIndex: 1 }}>
          {renderChrome()}
          <div style={{ perspective: 1400 }}>
            <AnimatePresence mode="wait">
              <motion.div key={screen}
                initial={{ opacity: 0, rotateY: 10, y: 12 }}
                animate={{ opacity: 1, rotateY: 0, y: 0 }}
                exit={{ opacity: 0, rotateY: -10, y: -8 }}
                transition={{ duration: 0.3, ease }}
                style={{ transformOrigin: "left center" }}>
                {screen === "library" && <Library {...libraryProps} />}
                {screen === "goals" && <Goals />}
                {screen === "stats" && <Wrapped />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* JOURNAL */}
      {screen === "journal" && activeBook && (
        <Journal book={activeBook} onBack={() => setScreen("library")} />
      )}

      {/* PLAYER */}
      <AnimatePresence>
        {screen === "player" && (
          <motion.div key="player"
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            style={{ position: "fixed", inset: 0, zIndex: 70, background: "var(--bg)", overflowY: "auto" }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 320, background: "radial-gradient(120% 80% at 50% -10%, rgba(29,185,84,0.16), transparent 70%)", pointerEvents: "none" }} />
            <div style={{ maxWidth: 560, margin: "0 auto", padding: "16px 16px 64px", position: "relative", zIndex: 1 }}>
              {/* Top bar */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
                <IconButton onClick={collapsePlayer}><ChevronDown size={20} /></IconButton>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.16em", color: "var(--text-3)", textTransform: "uppercase" }}>Now Playing</span>
                <ThemeToggle />
              </div>

              {/* Cover */}
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 22 }}>
                <motion.div layoutId="np-cover" transition={spring} animate={{ scale: isPlaying ? 1 : 0.94 }}
                  style={{ width: 210, height: 210, borderRadius: 22, overflow: "hidden", boxShadow: "var(--shadow-lg)", background: "linear-gradient(135deg, var(--surface-hi), var(--surface-2))", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
                  {coverUrl(activeBook?.cover_path)
                    ? <img src={coverUrl(activeBook?.cover_path)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <><BookOpen size={58} color="var(--text-3)" style={{ position: "absolute", opacity: 0.25 }} /><span style={{ fontSize: 72, fontWeight: 800, color: "var(--brand)" }}>{(activeBook?.title || "?").charAt(0).toUpperCase()}</span></>}
                </motion.div>
              </div>

              {/* Title */}
              <div style={{ textAlign: "center", marginBottom: 18 }}>
                <h2 style={{ fontSize: 23, lineHeight: 1.2 }}>{activeBook?.title}</h2>
                <p style={{ color: "var(--text-3)", fontSize: 12.5, marginTop: 5 }}>
                  {activeBook?.author ? `${activeBook.author} · ` : ""}~{estMinutes} min · {chunks.length} parts
                  {cachedCount > 0 && <span style={{ color: allCached ? "var(--success)" : "var(--brand)" }}> · {cachedCount}/{chunks.length} cached</span>}
                </p>
              </div>

              {/* Completion celebration + CTA */}
              {justFinished && <Confetti />}
              <AnimatePresence>
                {justFinished && (
                  <motion.div initial={{ opacity: 0, scale: 0.9, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }} transition={spring}
                    style={{ background: "rgba(29,185,84,0.1)", border: "1px solid rgba(29,185,84,0.35)", borderRadius: "var(--r-lg)", padding: 16, marginBottom: 16 }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 10 }}>
                      <Sparkles size={15} color="var(--brand)" style={{ verticalAlign: "-2px", marginRight: 6 }} />
                      You finished <strong>{activeBook?.title}</strong>! Capture your takeaways.
                    </p>
                    <div style={{ display: "flex", gap: 8 }}>
                      <Button variant="ghost" full onClick={() => setJustFinished(false)}>Later</Button>
                      <Button variant="primary" full onClick={() => setScreen("journal")}><PenLine size={15} /> Write journal</Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Karaoke */}
              <Card style={{ marginBottom: 16, padding: 18 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <Waveform playing={isPlaying} color="var(--brand)" size={14} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Part {currentChunk + 1} / {chunks.length}</span>
                </div>
                <Karaoke text={chunks[currentChunk]} currentTime={currentTime} duration={duration} isPlaying={isPlaying} />
                {isLoading && loadingMsg && (
                  <p style={{ fontSize: 11.5, color: "var(--brand)", textAlign: "center", marginTop: 10 }}>{loadingMsg}</p>
                )}
              </Card>

              {/* Scrubber */}
              <div style={{ marginBottom: 18 }}>
                <div onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); seekFromEvent(e); }} onPointerMove={e => { if (e.buttons === 1) seekFromEvent(e); }}
                  style={{ position: "relative", height: 6, background: "var(--surface-hi)", borderRadius: 6, cursor: "pointer", touchAction: "none" }}>
                  <div style={{ height: "100%", width: `${duration ? (currentTime / duration) * 100 : 0}%`, background: "var(--brand)", borderRadius: 6 }} />
                  <div style={{ position: "absolute", top: "50%", left: `${duration ? (currentTime / duration) * 100 : 0}%`, transform: "translate(-50%,-50%)", width: 14, height: 14, borderRadius: "50%", background: "var(--brand)", boxShadow: "0 0 0 4px rgba(29,185,84,0.2)" }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                  <span style={{ fontSize: 11, color: "var(--text-3)" }}>{formatTime(currentTime)}</span>
                  <span style={{ fontSize: 11, color: "var(--text-3)" }}>{formatTime(duration)}</span>
                </div>
              </div>

              {/* Controls */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 18, marginBottom: 20 }}>
                <IconButton size={44} onClick={() => { if (currentChunk > 0) playChunk(currentChunk - 1); }} disabled={currentChunk === 0}><SkipBack size={18} fill="currentColor" /></IconButton>
                <IconButton size={44} onClick={() => handleSkip(-10)}><Rewind size={18} /></IconButton>
                <motion.button whileTap={tap} onClick={handlePlay} disabled={isLoading}
                  style={{ width: 74, height: 74, borderRadius: "50%", border: "none", background: "var(--brand)", color: "var(--brand-contrast)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "var(--shadow)", animation: isPlaying && !isLoading ? "glowPulse 2.4s ease-in-out infinite" : "none" }}>
                  {isLoading ? <span style={{ width: 22, height: 22, border: "2px solid var(--brand-contrast)", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                    : isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" style={{ marginLeft: 3 }} />}
                </motion.button>
                <IconButton size={44} onClick={() => handleSkip(10)}><FastForward size={18} /></IconButton>
                <IconButton size={44} onClick={() => { if (currentChunk < chunks.length - 1) playChunk(currentChunk + 1); }} disabled={currentChunk === chunks.length - 1}><SkipForward size={18} fill="currentColor" /></IconButton>
              </div>

              {/* Speed */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 18 }}>
                {[0.75, 1, 1.25, 1.5, 1.75].map(s => {
                  const active = speed === s;
                  return (
                    <motion.button key={s} whileTap={{ scale: 0.92 }} onClick={() => { setSpeed(s); if (audioRef0.current) audioRef0.current.playbackRate = s; if (audioRef1.current) audioRef1.current.playbackRate = s; }}
                      style={{ border: "1px solid " + (active ? "var(--brand)" : "var(--border)"), background: active ? "var(--brand)" : "transparent", color: active ? "var(--brand-contrast)" : "var(--text-3)", borderRadius: "var(--r-full)", padding: "5px 11px", fontSize: 12, fontWeight: active ? 700 : 500, cursor: "pointer" }}>
                      {s}×
                    </motion.button>
                  );
                })}
              </div>

              {/* Voice selector */}
              <div ref={dropdownRef} style={{ position: "relative", marginBottom: 16 }}>
                <button onClick={() => setShowVoiceDropdown(v => !v)}
                  style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--surface)", border: "1px solid " + (showVoiceDropdown ? "var(--brand)" : "var(--border)"), borderRadius: "var(--r-md)", padding: "12px 14px", cursor: "pointer", color: "var(--text)" }}>
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                    <span style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Voice</span>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{selectedVoice.label} <span style={{ color: "var(--text-3)", fontWeight: 400, fontSize: 12 }}>· {selectedVoice.desc}</span></span>
                  </span>
                  <ChevronDown size={16} color="var(--text-3)" style={{ transform: showVoiceDropdown ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                </button>
                <AnimatePresence>
                  {showVoiceDropdown && (
                    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.16 }}
                      style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 20, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", boxShadow: "var(--shadow-lg)", maxHeight: 260, overflowY: "auto" }}>
                      {VOICE_OPTIONS.map(v => (
                        <div key={v.id} onClick={() => { setSelectedVoice(v); setShowVoiceDropdown(false); setIsPlaying(false); getActive()?.pause(); getIdle()?.pause(); }}
                          style={{ padding: "11px 14px", cursor: "pointer", borderBottom: "1px solid var(--border)", background: selectedVoice.id === v.id ? "rgba(29,185,84,0.1)" : "transparent" }}>
                          <p style={{ fontSize: 14, fontWeight: 600, color: selectedVoice.id === v.id ? "var(--brand)" : "var(--text)" }}>{v.label}</p>
                          <p style={{ fontSize: 11, color: "var(--text-3)" }}>{v.desc} · {v.lang}</p>
                        </div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Regen confirm */}
              <AnimatePresence>
                {showRegenConfirm && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                    style={{ overflow: "hidden", marginBottom: 12 }}>
                    <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", padding: 14 }}>
                      <p style={{ fontSize: 12.5, color: "var(--text-2)", marginBottom: 10 }}>Regenerate all audio as <strong style={{ color: "var(--text)" }}>{selectedVoice.label}</strong>? Overwrites cached audio for this voice.</p>
                      <div style={{ display: "flex", gap: 8 }}>
                        <Button variant="ghost" full onClick={() => setShowRegenConfirm(false)}>Cancel</Button>
                        <Button variant="danger" full onClick={() => handlePregenerate(true)}>Yes, regenerate</Button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Actions */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                <Button variant="subtle" size="sm" onClick={() => handlePregenerate(false)} disabled={!!pregenProgress || allCached}>
                  <Zap size={14} /> {pregenProgress ? `Caching ${pregenProgress.done}/${pregenProgress.total}` : allCached ? "All cached" : "Pre-generate"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowRegenConfirm(true)} disabled={!!pregenProgress}><RotateCcw size={14} /> Regenerate</Button>
                <Button variant="success" size="sm" onClick={handleMarkFinished}><CheckCircle2 size={14} /> Mark finished</Button>
                <Button variant="ghost" size="sm" onClick={() => setScreen("journal")}><PenLine size={14} /> Journal</Button>
                <Button variant="subtle" size="sm" onClick={handleDownload} disabled={isLoading || cachedCount === 0} style={{ gridColumn: "1 / -1" }}><Download size={14} /> Download MP3 ({selectedVoice.label})</Button>
              </div>

              {!allCached && chunks.length > 1 && (
                <p style={{ fontSize: 11, color: "var(--brand)", textAlign: "center", marginBottom: 8 }}>
                  Driving? Tap <Zap size={11} style={{ verticalAlign: "-1px" }} /> Pre-generate first for zero interruptions.
                </p>
              )}

              {error && <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "var(--r-md)", padding: "10px 14px" }}><p style={{ fontSize: 12, color: "var(--error)" }}>{error}</p></div>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mini-player (morphs into full player) */}
      <AnimatePresence>
        {activeBook && (screen === "library" || screen === "goals" || screen === "stats") && (
          <MiniPlayer book={activeBook} isPlaying={isPlaying} progress={progress}
            onToggle={handlePlay} onExpand={() => setScreen("player")} />
        )}
      </AnimatePresence>
    </div>
  );
}
