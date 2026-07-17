import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload, Search, Trash2, RotateCcw, PenLine, Pencil, Check,
  ImagePlus, BookOpen, CheckCircle2, Clock, Circle,
} from "lucide-react";
import { Button, IconButton, Card, Skeleton, Spinner } from "../components/ui";
import { coverUrl } from "../lib/db";
import { listContainer, listItem, spring, ease, durations } from "../theme";

const isFinished = (b) => !!b.completed_at || (b.times_completed || 0) > 0;
const progressPct = (b) => b.chunk_count ? Math.round(((b.reading_progress?.[0]?.current_chunk || 0) / b.chunk_count) * 100) : 0;

function Cover({ book, size = 56 }) {
  const url = coverUrl(book.cover_path);
  if (url) {
    return <img src={url} alt="" style={{ width: size, height: size, borderRadius: 12, objectFit: "cover", flexShrink: 0, boxShadow: "var(--shadow)" }} />;
  }
  const initial = (book.title || "?").trim().charAt(0).toUpperCase();
  return (
    <div style={{ width: size, height: size, borderRadius: 12, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, var(--surface-hi), var(--surface-2))", border: "1px solid var(--border)", position: "relative", overflow: "hidden" }}>
      <BookOpen size={size * 0.34} color="var(--text-3)" style={{ position: "absolute", opacity: 0.35 }} />
      <span style={{ fontSize: size * 0.4, fontWeight: 800, color: "var(--brand)" }}>{initial}</span>
    </div>
  );
}

function ShelfIcon({ kind }) {
  if (kind === "done") return <CheckCircle2 size={13} color="var(--success)" />;
  if (kind === "in") return <Clock size={13} color="var(--brand)" />;
  return <Circle size={13} color="var(--text-3)" />;
}

export default function Library({
  books, loadingBooks, booksError, recentDone, error,
  search, setSearch, activeCategory, setActiveCategory,
  onOpen, onRepeat, onJournal, onDelete,
  onFilePick, pendingUpload, setPendingUpload, onConfirmUpload, uploading,
  onSaveEdit,
}) {
  const [dragOver, setDragOver] = useState(false);
  const [editing, setEditing] = useState(null); // book being edited
  const [editForm, setEditForm] = useState({ title: "", author: "", category: "" });
  const [coverFile, setCoverFile] = useState(null);
  const [coverPreview, setCoverPreview] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const categories = [...new Set(books.map(b => b.category).filter(Boolean))].sort();
  const authors = [...new Set(books.map(b => b.author).filter(Boolean))];

  const filtered = books.filter(b => {
    const q = search.trim().toLowerCase();
    const mq = !q || b.title?.toLowerCase().includes(q) || b.author?.toLowerCase().includes(q);
    const mc = !activeCategory || b.category === activeCategory;
    return mq && mc;
  });
  const shelves = [
    { key: "in", label: "Continue listening", items: filtered.filter(b => !isFinished(b) && (b.reading_progress?.[0]?.current_chunk || 0) > 0) },
    { key: "new", label: "Up next", items: filtered.filter(b => !isFinished(b) && (b.reading_progress?.[0]?.current_chunk || 0) === 0) },
    { key: "done", label: "Finished", items: filtered.filter(isFinished) },
  ].filter(s => s.items.length > 0);

  const openEdit = (e, book) => {
    e.stopPropagation();
    setEditing(book);
    setEditForm({ title: book.title || "", author: book.author || "", category: book.category || "" });
    setCoverFile(null);
    setCoverPreview(coverUrl(book.cover_path));
  };
  const pickCover = (file) => {
    if (!file) return;
    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
  };
  const saveEdit = async () => {
    setSavingEdit(true);
    await onSaveEdit(editing, editForm, coverFile);
    setSavingEdit(false);
    setEditing(null);
  };

  return (
    <div style={{ maxWidth: 620, margin: "0 auto", padding: "0 16px 120px", position: "relative", zIndex: 1 }}>
      <datalist id="authors-list">{authors.map(a => <option key={a} value={a} />)}</datalist>
      <datalist id="categories-list">{categories.map(c => <option key={c} value={c} />)}</datalist>

      <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: durations.slow, ease }}
        className="grad-text" style={{ fontSize: "clamp(2rem, 7vw, 2.8rem)", marginBottom: 4 }}>
        Your Library
      </motion.h1>
      <p style={{ color: "var(--text-3)", fontSize: 13, marginBottom: 24 }}>
        {books.length} book{books.length === 1 ? "" : "s"}
      </p>

      {/* Upload */}
      <AnimatePresence mode="wait">
        {pendingUpload ? (
          <motion.div key="form" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={spring}>
            <Card style={{ marginBottom: 24 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: "var(--brand)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>Book details</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <input className="field" placeholder="Display title" value={pendingUpload.title} onChange={e => setPendingUpload(p => ({ ...p, title: e.target.value }))} />
                <input className="field" list="authors-list" placeholder="Author (optional)" value={pendingUpload.author} onChange={e => setPendingUpload(p => ({ ...p, author: e.target.value }))} />
                <input className="field" list="categories-list" placeholder="Category (optional)" value={pendingUpload.category} onChange={e => setPendingUpload(p => ({ ...p, category: e.target.value }))} />
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <Button variant="ghost" full onClick={() => setPendingUpload(null)} disabled={uploading}>Cancel</Button>
                <Button variant="primary" full onClick={onConfirmUpload} disabled={uploading}>
                  {uploading ? <Spinner size={16} /> : <><Check size={16} /> Add to library</>}
                </Button>
              </div>
            </Card>
          </motion.div>
        ) : (
          <motion.label key="drop" htmlFor="pdf-input"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); onFilePick(e.dataTransfer.files[0]); }}
            animate={{ borderColor: dragOver ? "var(--brand)" : "var(--border)", scale: dragOver ? 1.01 : 1 }}
            transition={spring}
            style={{ display: "block", border: "1.5px dashed var(--border)", borderRadius: "var(--r-lg)", padding: "30px 20px", textAlign: "center", cursor: "pointer", marginBottom: 24, background: dragOver ? "rgba(29,185,84,0.05)" : "var(--surface)" }}>
            <input id="pdf-input" type="file" accept=".pdf" style={{ display: "none" }} onChange={e => onFilePick(e.target.files[0])} />
            {uploading ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                <Spinner /><span style={{ color: "var(--text-2)", fontSize: 13 }}>Reading PDF…</span>
              </div>
            ) : (
              <>
                <motion.div animate={{ y: dragOver ? -4 : 0 }} transition={spring} style={{ display: "inline-flex", padding: 14, borderRadius: "var(--r-full)", background: "rgba(29,185,84,0.12)", marginBottom: 10 }}>
                  <Upload size={22} color="var(--brand)" />
                </motion.div>
                <p style={{ color: "var(--text)", fontSize: 15, fontWeight: 600 }}>Add a book</p>
                <p style={{ color: "var(--text-3)", fontSize: 12, marginTop: 2 }}>Drop a PDF or click to browse</p>
              </>
            )}
          </motion.label>
        )}
      </AnimatePresence>

      {(error || booksError) && (
        <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "var(--r-md)", padding: "12px 14px", marginBottom: 20 }}>
          <p style={{ fontSize: 12.5, color: "var(--error)" }}>{error || `Couldn't load your library: ${booksError}`}</p>
        </div>
      )}

      {/* Recently finished */}
      {recentDone.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Recently finished</p>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
            {recentDone.map(rc => (
              <div key={rc.id} style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-full)", padding: "7px 14px" }}>
                <CheckCircle2 size={14} color="var(--success)" />
                <span style={{ fontSize: 13, color: "var(--text)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rc.books?.title || "Untitled"}</span>
                <span style={{ fontSize: 11, color: "var(--text-3)" }}>{new Date(rc.completed_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search + categories */}
      {books.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ position: "relative", marginBottom: categories.length ? 12 : 0 }}>
            <Search size={16} color="var(--text-3)" style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)" }} />
            <input className="field" placeholder="Search title or author…" value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 40 }} />
          </div>
          {categories.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {["", ...categories].map(c => {
                const active = activeCategory === c;
                return (
                  <motion.button key={c || "all"} whileTap={{ scale: 0.94 }} onClick={() => setActiveCategory(c)}
                    style={{ border: "1px solid " + (active ? "var(--brand)" : "var(--border)"), background: active ? "var(--brand)" : "transparent", color: active ? "var(--brand-contrast)" : "var(--text-2)", borderRadius: "var(--r-full)", padding: "6px 14px", fontSize: 12, fontWeight: active ? 700 : 500, cursor: "pointer" }}>
                    {c || "All"}
                  </motion.button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Book list */}
      {loadingBooks ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[0, 1, 2].map(i => (
            <Card key={i} style={{ display: "flex", gap: 14, alignItems: "center" }}>
              <Skeleton h={56} w={56} r={12} />
              <div style={{ flex: 1 }}>
                <Skeleton h={16} w="70%" style={{ marginBottom: 8 }} />
                <Skeleton h={12} w="45%" />
              </div>
            </Card>
          ))}
        </div>
      ) : books.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 16px", color: "var(--text-3)" }}>
          <BookOpen size={28} style={{ marginBottom: 10, opacity: 0.5 }} />
          <p style={{ fontSize: 14 }}>No books yet — upload your first PDF above</p>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "30px 16px", color: "var(--text-3)" }}><p style={{ fontSize: 14 }}>No books match your search</p></div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          {shelves.map(shelf => (
            <div key={shelf.key}>
              <p style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
                <ShelfIcon kind={shelf.key} /> {shelf.label} <span style={{ color: "var(--text-3)" }}>· {shelf.items.length}</span>
              </p>
              <motion.div variants={listContainer} initial="hidden" animate="show" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {shelf.items.map(book => {
                  const pct = progressPct(book);
                  const finished = isFinished(book);
                  return (
                    <motion.div key={book.id} variants={listItem} layout>
                      <Card hover onClick={() => onOpen(book)} style={{ padding: 14 }}>
                        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                          <motion.div whileHover={{ rotate: -3, scale: 1.05 }} transition={spring}><Cover book={book} /></motion.div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontSize: 15.5, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{book.title}</p>
                            <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {book.author ? `${book.author} · ` : ""}~{Math.round((book.word_count || 0) / 150)} min
                            </p>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                              {book.category && <span style={{ fontSize: 10, fontWeight: 600, color: "var(--brand)", background: "rgba(29,185,84,0.12)", borderRadius: "var(--r-full)", padding: "2px 9px" }}>{book.category}</span>}
                              <div style={{ flex: 1, height: 4, background: "var(--surface-hi)", borderRadius: 4, overflow: "hidden" }}>
                                <motion.div initial={{ width: 0 }} animate={{ width: `${finished ? 100 : pct}%` }} transition={{ ...spring, delay: 0.1 }}
                                  style={{ height: "100%", background: finished ? "var(--success)" : "var(--brand)", borderRadius: 4 }} />
                              </div>
                              <span style={{ fontSize: 11, fontWeight: 600, color: finished ? "var(--success)" : pct > 0 ? "var(--brand)" : "var(--text-3)", minWidth: 30, textAlign: "right" }}>
                                {finished ? "Done" : `${pct}%`}
                              </span>
                            </div>
                          </div>
                        </div>
                        {/* actions */}
                        <div style={{ display: "flex", gap: 6, marginTop: 12 }} onClick={e => e.stopPropagation()}>
                          <Button size="sm" variant="ghost" onClick={() => onRepeat(book)}><RotateCcw size={13} /> Repeat</Button>
                          <Button size="sm" variant="ghost" onClick={() => onJournal(book)}><PenLine size={13} /> Journal</Button>
                          <Button size="sm" variant="ghost" onClick={e => openEdit(e, book)}><Pencil size={13} /> Edit</Button>
                          <div style={{ flex: 1 }} />
                          <IconButton size={34} onClick={e => onDelete(e, book)} style={{ color: "var(--text-3)" }}><Trash2 size={15} /></IconButton>
                        </div>
                      </Card>
                    </motion.div>
                  );
                })}
              </motion.div>
            </div>
          ))}
        </div>
      )}

      {/* Edit modal */}
      <AnimatePresence>
        {editing && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setEditing(null)}
            style={{ position: "fixed", inset: 0, zIndex: 100, background: "var(--scrim)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <motion.div initial={{ y: 30, opacity: 0, scale: 0.97 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 30, opacity: 0, scale: 0.97 }} transition={spring}
              onClick={e => e.stopPropagation()}
              style={{ width: "100%", maxWidth: 440, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-xl)", padding: 24, boxShadow: "var(--shadow-lg)" }}>
              <h3 style={{ fontSize: 18, marginBottom: 18 }}>Edit book</h3>
              <div style={{ display: "flex", gap: 16, alignItems: "flex-start", marginBottom: 16 }}>
                <label style={{ cursor: "pointer", position: "relative" }}>
                  <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => pickCover(e.target.files[0])} />
                  {coverPreview ? (
                    <img src={coverPreview} alt="" style={{ width: 88, height: 88, borderRadius: 14, objectFit: "cover" }} />
                  ) : (
                    <div style={{ width: 88, height: 88, borderRadius: 14, background: "var(--surface-2)", border: "1px dashed var(--border-hi)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, color: "var(--text-3)" }}>
                      <ImagePlus size={20} /><span style={{ fontSize: 10 }}>Cover</span>
                    </div>
                  )}
                  <span style={{ position: "absolute", bottom: -6, right: -6, background: "var(--brand)", color: "var(--brand-contrast)", borderRadius: "var(--r-full)", width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center" }}><Pencil size={13} /></span>
                </label>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
                  <input className="field" placeholder="Title" value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} />
                  <input className="field" list="authors-list" placeholder="Author" value={editForm.author} onChange={e => setEditForm(f => ({ ...f, author: e.target.value }))} />
                </div>
              </div>
              <input className="field" list="categories-list" placeholder="Category" value={editForm.category} onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))} style={{ marginBottom: 18 }} />
              <div style={{ display: "flex", gap: 8 }}>
                <Button variant="ghost" full onClick={() => setEditing(null)} disabled={savingEdit}>Cancel</Button>
                <Button variant="primary" full onClick={saveEdit} disabled={savingEdit}>{savingEdit ? <Spinner size={16} /> : <><Check size={16} /> Save</>}</Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
