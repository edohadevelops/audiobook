import { motion } from "framer-motion";
import { Play, Pause, ChevronUp, BookOpen } from "lucide-react";
import { spring, tap } from "../theme";
import { coverUrl } from "../lib/db";
import { Waveform } from "./ui";

// Persistent bottom bar shown on non-player screens while a book is loaded.
// Tapping it expands into the full player; the cover shares a layoutId with the
// full player's cover so it morphs into place (Spotify/Apple-Music style).
export default function MiniPlayer({ book, isPlaying, progress, onToggle, onExpand }) {
  if (!book) return null;
  const url = coverUrl(book.cover_path);
  return (
    <motion.div
      initial={{ y: 90, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 90, opacity: 0 }}
      transition={spring}
      style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 60, display: "flex", justifyContent: "center", padding: "0 12px 14px", pointerEvents: "none" }}
    >
      <div style={{ width: "100%", maxWidth: 560, pointerEvents: "auto" }}>
        <motion.div
          whileHover={{ y: -2 }}
          transition={spring}
          onClick={onExpand}
          style={{ position: "relative", display: "flex", alignItems: "center", gap: 12, padding: 10, cursor: "pointer", background: "var(--glass)", backdropFilter: "blur(16px)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-lg)", overflow: "hidden" }}
        >
          {/* progress line */}
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "var(--surface-hi)" }}>
            <div style={{ height: "100%", width: `${progress}%`, background: "var(--brand)" }} />
          </div>

          <motion.div layoutId="np-cover" transition={spring} style={{ width: 44, height: 44, borderRadius: 10, flexShrink: 0, overflow: "hidden", background: "var(--surface-2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {url ? <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <BookOpen size={18} color="var(--text-3)" />}
          </motion.div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{book.title}</p>
            <p style={{ fontSize: 11, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{book.author || "Now playing"}</p>
          </div>

          <div style={{ width: 26 }}><Waveform playing={isPlaying} color="var(--brand)" size={16} /></div>

          <motion.button
            whileTap={tap}
            onClick={e => { e.stopPropagation(); onToggle(); }}
            style={{ width: 40, height: 40, flexShrink: 0, borderRadius: "var(--r-full)", border: "none", background: "var(--brand)", color: "var(--brand-contrast)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          >
            {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" style={{ marginLeft: 2 }} />}
          </motion.button>

          <ChevronUp size={16} color="var(--text-3)" style={{ flexShrink: 0, marginRight: 4 }} />
        </motion.div>
      </div>
    </motion.div>
  );
}
