import { useState, useRef, useCallback, useEffect } from "react";
import { supabase, supabaseConfigError } from "./supabaseClient";
import {
  fetchBooks as dbFetchBooks,
  recordCompletion,
  flushListenSession,
  updateBookMeta,
  fetchRecentCompletions,
} from "./lib/db";
import Journal from "./screens/Journal";
import Goals from "./screens/Goals";
import Wrapped from "./screens/Wrapped";

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

const WaveIcon = ({ playing }) => (
  <svg width="24" height="24" viewBox="0 0 28 28" fill="none">
    {[4, 8, 12, 16, 20, 24].map((x, i) => {
      const heights = playing ? [10, 18, 14, 20, 12, 16] : [4, 4, 4, 4, 4, 4];
      const h = heights[i];
      return (
        <rect key={x} x={x} y={(28 - h) / 2} width="2.5" height={h} rx="1.25" fill="currentColor"
          style={playing ? { animation: `wave ${0.6 + i * 0.1}s ease-in-out ${i * 0.08}s infinite alternate` } : {}} />
      );
    })}
  </svg>
);

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
  const [dragOver, setDragOver] = useState(false);
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

  const fileInputRef = useRef(null);
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

  const handleEditMeta = async (e, book) => {
    e.stopPropagation();
    const author = prompt("Author", book.author || "");
    if (author === null) return;
    const category = prompt("Category (e.g. Business, Fiction, Self-help)", book.category || "");
    if (category === null) return;
    const { error } = await updateBookMeta(book.id, { author: author.trim() || null, category: category.trim() || null });
    if (error) { setError(error.message); return; }
    fetchBooks();
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

  const leavePlayer = () => {
    getActive()?.pause();
    getIdle()?.pause();
    setIsPlaying(false);
    flushListen();
    saveProgress(currentChunk, getActive()?.currentTime || 0);
    fetchBooks();
    setScreen("library");
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

  // ---- Derived library data --------------------------------------------------
  const categories = [...new Set(books.map(b => b.category).filter(Boolean))].sort();
  const isFinished = (b) => !!b.completed_at || (b.times_completed || 0) > 0;
  const bookProgressPct = (b) => b.chunk_count ? Math.round(((b.reading_progress?.[0]?.current_chunk || 0) / b.chunk_count) * 100) : 0;
  const filteredBooks = books.filter(b => {
    const q = search.trim().toLowerCase();
    const matchesQ = !q || b.title?.toLowerCase().includes(q) || b.author?.toLowerCase().includes(q);
    const matchesCat = !activeCategory || b.category === activeCategory;
    return matchesQ && matchesCat;
  });
  const shelves = [
    { key: "in", label: "In progress", items: filteredBooks.filter(b => !isFinished(b) && (b.reading_progress?.[0]?.current_chunk || 0) > 0) },
    { key: "new", label: "Not started", items: filteredBooks.filter(b => !isFinished(b) && (b.reading_progress?.[0]?.current_chunk || 0) === 0) },
    { key: "done", label: "Finished", items: filteredBooks.filter(isFinished) },
  ].filter(s => s.items.length > 0);

  const renderNav = () => (
    <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: "1.5rem" }}>
      {[{ k: "library", l: "Library" }, { k: "goals", l: "Goals" }, { k: "stats", l: "Stats" }].map(t => (
        <button key={t.k} className={`speed-btn ${screen === t.k ? "active" : ""}`} onClick={() => setScreen(t.k)} style={{ fontSize: 11, padding: "6px 16px" }}>
          {t.l}
        </button>
      ))}
    </div>
  );

  const renderBookCard = (book) => {
    const prog = book.reading_progress?.[0];
    const pct = bookProgressPct(book);
    const lastOpened = prog?.last_opened ? new Date(prog.last_opened).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
    const finished = isFinished(book);
    return (
      <div key={book.id} className="book-card fade-up" onClick={() => openBook(book)}>
        <button className="delete-btn" onClick={e => deleteBook(e, book.id, book.file_path)}>✕</button>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div style={{ flex: 1, paddingRight: 24 }}>
            <p style={{ fontSize: "1rem", fontWeight: 600, color: "#e8e0d0", lineHeight: 1.3, marginBottom: 4 }}>{book.title}</p>
            <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#555" }}>
              {book.author ? `${book.author} · ` : ""}{book.word_count?.toLocaleString()} words · ~{Math.round((book.word_count || 0) / 150)} min
              {lastOpened && ` · ${lastOpened}`}
            </p>
            {book.category && <span style={{ display: "inline-block", marginTop: 6, fontFamily: "'Space Mono', monospace", fontSize: 9, color: "#c8a96e", border: "0.5px solid rgba(200,169,110,0.3)", borderRadius: 4, padding: "2px 8px" }}>{book.category}</span>}
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, color: pct > 0 ? "#c8a96e" : "#444" }}>{finished ? "✓" : `${pct}%`}</p>
            <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: "#444", marginTop: 2 }}>{finished ? "complete" : pct === 0 ? "not started" : "in progress"}</p>
          </div>
        </div>
        <div className="progress-bar" style={{ cursor: "default" }}>
          <div className="progress-fill" style={{ width: `${finished ? 100 : pct}%`, transition: "none" }} />
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 10 }} onClick={e => e.stopPropagation()}>
          <button className="btn-ghost" onClick={() => openBook(book, null, true)} style={{ fontSize: 10 }}>↺ Repeat</button>
          <button className="btn-ghost" onClick={() => { setActiveBook(book); activeBookRef.current = book; setScreen("journal"); }} style={{ fontSize: 10 }}>✎ Journal</button>
          <button className="btn-ghost" onClick={e => handleEditMeta(e, book)} style={{ fontSize: 10 }}>Edit</button>
        </div>
      </div>
    );
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0d0d0d", fontFamily: "'Crimson Pro', Georgia, serif", position: "relative", overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0d0d0d; }
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

      <div className="orb" style={{ width: 400, height: 400, background: "rgba(200,169,110,0.05)", top: -100, right: -100 }} />
      <div className="orb" style={{ width: 300, height: 300, background: "rgba(100,60,20,0.07)", bottom: -80, left: -80 }} />
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

      {/* LIBRARY */}
      {screen === "library" && (
        <div style={{ maxWidth: 600, margin: "0 auto", padding: "2rem 1rem", position: "relative", zIndex: 1 }}>
          <div style={{ marginBottom: "1.5rem" }}>
            <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, letterSpacing: "0.25em", color: "#c8a96e", textTransform: "uppercase", marginBottom: 6 }}>PDF Audiobook</p>
            <h1 style={{ fontSize: "clamp(1.6rem, 5vw, 2.2rem)", fontWeight: 300, color: "#e8e0d0", lineHeight: 1.2 }}>Your Library</h1>
          </div>

          {renderNav()}

          {/* datalists for author/category autocomplete */}
          <datalist id="authors-list">{[...new Set(books.map(b => b.author).filter(Boolean))].map(a => <option key={a} value={a} />)}</datalist>
          <datalist id="categories-list">{categories.map(c => <option key={c} value={c} />)}</datalist>

          {/* Upload / details form */}
          {pendingUpload ? (
            <div className="card fade-up" style={{ marginBottom: "1.5rem" }}>
              <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#c8a96e", textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: 12 }}>Book details</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <input className="lib-input" placeholder="Title" value={pendingUpload.title} onChange={e => setPendingUpload(p => ({ ...p, title: e.target.value }))} />
                <input className="lib-input" list="authors-list" placeholder="Author (optional)" value={pendingUpload.author} onChange={e => setPendingUpload(p => ({ ...p, author: e.target.value }))} />
                <input className="lib-input" list="categories-list" placeholder="Category (optional)" value={pendingUpload.category} onChange={e => setPendingUpload(p => ({ ...p, category: e.target.value }))} />
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button className="btn-ghost" onClick={() => setPendingUpload(null)} disabled={uploading} style={{ flex: 1, justifyContent: "center" }}>Cancel</button>
                <button className="btn-icon" onClick={handleConfirmUpload} disabled={uploading} style={{ flex: 1, justifyContent: "center", borderColor: "#c8a96e", color: "#c8a96e" }}>
                  {uploading ? "Adding…" : "Add to library"}
                </button>
              </div>
            </div>
          ) : (
            <div className={`drop-zone ${dragOver ? "active" : ""}`} style={{ marginBottom: "1.5rem" }}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleFilePick(e.dataTransfer.files[0]); }}>
              <input ref={fileInputRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={e => handleFilePick(e.target.files[0])} />
              {uploading ? (
                <div>
                  <div style={{ width: 24, height: 24, border: "2px solid #c8a96e", borderTopColor: "transparent", borderRadius: "50%", margin: "0 auto 10px", animation: "spin 0.8s linear infinite" }} />
                  <p style={{ color: "#888", fontSize: 13, animation: "pulse 1.5s ease infinite" }}>{loadingMsg}</p>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>📚</div>
                  <p style={{ color: "#888", fontSize: 14, marginBottom: 4 }}>Add a book to your library</p>
                  <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#444" }}>drop PDF here or click to browse</p>
                </>
              )}
            </div>
          )}

          {error && <div style={{ background: "rgba(200,60,60,0.08)", border: "0.5px solid rgba(200,60,60,0.25)", borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}><p style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#e06060" }}>⚠ {error}</p></div>}
          {booksError && <div style={{ background: "rgba(200,60,60,0.08)", border: "0.5px solid rgba(200,60,60,0.25)", borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}><p style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#e06060" }}>⚠ Couldn't load your library: {booksError}</p></div>}

          {/* Recently finished strip */}
          {recentDone.length > 0 && (
            <div style={{ marginBottom: "1.25rem" }}>
              <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: 8 }}>Recently finished</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {recentDone.map(rc => (
                  <div key={rc.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", background: "#141414", border: "0.5px solid #2a2a2a", borderRadius: 8 }}>
                    <span style={{ color: "#c8a96e", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>✓ {rc.books?.title || "Untitled"}</span>
                    <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#555", flexShrink: 0, marginLeft: 10 }}>{new Date(rc.completed_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Search + category filter */}
          {books.length > 0 && (
            <div style={{ marginBottom: "1.25rem" }}>
              <input className="lib-input" placeholder="Search by title or author…" value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom: categories.length ? 10 : 0 }} />
              {categories.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button className={`chip ${!activeCategory ? "active" : ""}`} onClick={() => setActiveCategory("")}>All</button>
                  {categories.map(c => (
                    <button key={c} className={`chip ${activeCategory === c ? "active" : ""}`} onClick={() => setActiveCategory(c)}>{c}</button>
                  ))}
                </div>
              )}
            </div>
          )}

          {loadingBooks ? (
            <div style={{ textAlign: "center", padding: "2rem" }}><div style={{ width: 24, height: 24, border: "2px solid #c8a96e", borderTopColor: "transparent", borderRadius: "50%", margin: "0 auto", animation: "spin 0.8s linear infinite" }} /></div>
          ) : books.length === 0 ? (
            <div style={{ textAlign: "center", padding: "3rem 1rem" }}><p style={{ color: "#333", fontSize: 14, fontFamily: "'Space Mono', monospace" }}>No books yet — upload your first PDF above</p></div>
          ) : filteredBooks.length === 0 ? (
            <div style={{ textAlign: "center", padding: "2rem 1rem" }}><p style={{ color: "#333", fontSize: 14, fontFamily: "'Space Mono', monospace" }}>No books match your search</p></div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {shelves.map(shelf => (
                <div key={shelf.key}>
                  <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: 10 }}>{shelf.label} · {shelf.items.length}</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {shelf.items.map(renderBookCard)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* GOALS */}
      {screen === "goals" && (
        <div style={{ maxWidth: 600, margin: "0 auto", padding: "2rem 1rem 0", position: "relative", zIndex: 1 }}>
          {renderNav()}
          <Goals />
        </div>
      )}

      {/* STATS / WRAPPED */}
      {screen === "stats" && (
        <div style={{ maxWidth: 600, margin: "0 auto", padding: "2rem 1rem 0", position: "relative", zIndex: 1 }}>
          {renderNav()}
          <Wrapped />
        </div>
      )}

      {/* JOURNAL */}
      {screen === "journal" && activeBook && (
        <Journal book={activeBook} onBack={() => setScreen("library")} />
      )}

      {/* PLAYER */}
      {screen === "player" && (
        <div style={{ maxWidth: 520, margin: "0 auto", padding: "2rem 1rem", position: "relative", zIndex: 1 }}>
          <button className="btn-icon" onClick={leavePlayer} style={{ marginBottom: "1.5rem" }}>
            ← Library
          </button>

          <div style={{ marginBottom: "1.5rem" }}>
            <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, letterSpacing: "0.2em", color: "#c8a96e", textTransform: "uppercase", marginBottom: 6 }}>Now playing</p>
            <h2 style={{ fontSize: "clamp(1.2rem, 4vw, 1.6rem)", fontWeight: 300, color: "#e8e0d0", lineHeight: 1.3 }}>{activeBook?.title}</h2>
            <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#555", marginTop: 4 }}>
              {activeBook?.author ? `${activeBook.author} · ` : ""}{wordCount.toLocaleString()} words · ~{estMinutes} min · {chunks.length} parts
              {cachedCount > 0 && <span style={{ color: allCached ? "#4ab464" : "#c8a96e" }}> · {cachedCount}/{chunks.length} cached</span>}
            </p>
          </div>

          {/* Completion CTA */}
          {justFinished && (
            <div className="confirm-box">
              <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#c8a96e", marginBottom: 8 }}>
                🎉 You finished <strong>{activeBook?.title}</strong>! Capture your takeaways while they're fresh.
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn-ghost" onClick={() => setJustFinished(false)} style={{ flex: 1 }}>Later</button>
                <button className="btn-icon" onClick={() => setScreen("journal")} style={{ flex: 1, borderColor: "#c8a96e", color: "#c8a96e" }}>Write journal</button>
              </div>
            </div>
          )}

          {/* Voice selector */}
          <div style={{ marginBottom: 12, position: "relative" }} ref={dropdownRef}>
            <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: 6 }}>Voice</p>
            <button
              className="btn-icon"
              onClick={() => setShowVoiceDropdown(v => !v)}
              style={{ width: "100%", justifyContent: "space-between", padding: "10px 14px", borderColor: showVoiceDropdown ? "#c8a96e" : "#2a2a2a", color: showVoiceDropdown ? "#c8a96e" : "#888" }}
            >
              <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                <span style={{ fontSize: 13, color: "#e8e0d0", fontFamily: "'Crimson Pro', serif" }}>{selectedVoice.label}</span>
                <span style={{ fontSize: 10 }}>{selectedVoice.desc}</span>
              </span>
              <span style={{ fontSize: 10 }}>{showVoiceDropdown ? "▲" : "▼"}</span>
            </button>
            {showVoiceDropdown && (
              <div className="voice-dropdown">
                {VOICE_OPTIONS.map(v => (
                  <div key={v.id} className={`voice-option ${selectedVoice.id === v.id ? "active" : ""}`}
                    onClick={() => { setSelectedVoice(v); setShowVoiceDropdown(false); setIsPlaying(false); getActive()?.pause(); getIdle()?.pause(); }}>
                    <p style={{ fontSize: 14, color: "#e8e0d0", fontFamily: "'Crimson Pro', serif", marginBottom: 2 }}>{v.label}</p>
                    <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#666" }}>{v.desc} · {v.lang}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            {/* Overall progress */}
            <div style={{ marginBottom: "1.25rem" }}>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#555" }}>Part {currentChunk + 1} / {chunks.length}</span>
                <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#555" }}>{Math.round(progress)}%</span>
              </div>
            </div>

            {/* Time scrubber */}
            <div style={{ marginBottom: "1.25rem" }}>
              <div className="progress-bar" onClick={e => {
                const el = getActive();
                if (!el || !duration) return;
                const rect = e.currentTarget.getBoundingClientRect();
                el.currentTime = ((e.clientX - rect.left) / rect.width) * duration;
              }}>
                <div className="progress-fill" style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#444" }}>{formatTime(currentTime)}</span>
                <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#444" }}>{formatTime(duration)}</span>
              </div>
            </div>

            {/* Controls */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: "1.25rem" }}>
              <button className="btn-ghost" onClick={() => { if (currentChunk > 0) playChunk(currentChunk - 1); }} disabled={currentChunk === 0} style={{ padding: "8px 12px", fontSize: 12 }}>◀◀</button>
              <button className="btn-icon" onClick={() => handleSkip(-10)} style={{ padding: "8px 10px" }}>−10s</button>
              <button className="btn-gold" onClick={handlePlay} disabled={isLoading} style={{ width: 64, height: 64, fontSize: 20 }}>
                {isLoading
                  ? <div style={{ width: 20, height: 20, border: "2px solid #0d0d0d", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                  : isPlaying ? <WaveIcon playing={true} /> : <span style={{ marginLeft: 3 }}>▶</span>}
              </button>
              <button className="btn-icon" onClick={() => handleSkip(10)} style={{ padding: "8px 10px" }}>+10s</button>
              <button className="btn-ghost" onClick={() => { if (currentChunk < chunks.length - 1) playChunk(currentChunk + 1); }} disabled={currentChunk === chunks.length - 1} style={{ padding: "8px 12px", fontSize: 12 }}>▶▶</button>
            </div>

            {/* Speed */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#444", marginRight: 4 }}>SPEED</span>
              {[0.75, 1, 1.25, 1.5, 1.75].map(s => (
                <button key={s} className={`speed-btn ${speed === s ? "active" : ""}`} onClick={() => { setSpeed(s); if (audioRef0.current) audioRef0.current.playbackRate = s; if (audioRef1.current) audioRef1.current.playbackRate = s; }}>{s}×</button>
              ))}
            </div>

            {isLoading && loadingMsg && (
              <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#c8a96e", textAlign: "center", marginTop: "1rem", animation: "pulse 1.5s ease infinite" }}>{loadingMsg}</p>
            )}
          </div>

          {/* Regen confirm box */}
          {showRegenConfirm && (
            <div className="confirm-box">
              <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#c8a96e", marginBottom: 8 }}>
                Regenerate all audio as <strong>{selectedVoice.label}</strong>? This will overwrite cached audio for this voice.
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn-ghost" onClick={() => setShowRegenConfirm(false)} style={{ flex: 1 }}>Cancel</button>
                <button className="btn-danger" onClick={() => handlePregenerate(true)} style={{ flex: 1 }}>Yes, regenerate</button>
              </div>
            </div>
          )}

          {/* Cache & Download actions */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
            <button className="btn-icon" onClick={() => handlePregenerate(false)} disabled={!!pregenProgress || allCached} style={{ fontSize: 10 }}>
              {pregenProgress ? `Generating ${pregenProgress.done}/${pregenProgress.total}…` : allCached ? "✓ All cached" : "⚡ Pre-generate"}
            </button>
            <button className="btn-danger" onClick={() => setShowRegenConfirm(true)} disabled={!!pregenProgress} style={{ fontSize: 10 }}>
              ↺ Regenerate voice
            </button>
            <button className="btn-icon" onClick={handleMarkFinished} style={{ fontSize: 10, borderColor: "#3a5a3a", color: "#4ab464" }}>
              ✓ Mark finished
            </button>
            <button className="btn-icon" onClick={() => setScreen("journal")} style={{ fontSize: 10 }}>
              ✎ Journal
            </button>
            <button className="btn-icon" onClick={handleDownload} disabled={isLoading || cachedCount === 0} style={{ gridColumn: "1 / -1", fontSize: 10 }}>
              ↓ Download as MP3 ({selectedVoice.label})
            </button>
          </div>

          {/* Pre-generate hint for long drives */}
          {!allCached && chunks.length > 1 && (
            <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: "#c8a96e", textAlign: "center", marginBottom: 8 }}>
              Driving? Tap ⚡ Pre-generate first for uninterrupted playback.
            </p>
          )}

          {error && <div style={{ background: "rgba(200,60,60,0.08)", border: "0.5px solid rgba(200,60,60,0.25)", borderRadius: 8, padding: "10px 14px", marginBottom: 12 }}><p style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#e06060" }}>⚠ {error}</p></div>}

          <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: "#2a2a2a", textAlign: "center", marginTop: 8 }}>
            Gapless playback · Audio cached per voice · Progress auto-saved
          </p>
        </div>
      )}
    </div>
  );
}
