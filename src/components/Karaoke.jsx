import { useMemo, useRef, useEffect, useState } from "react";
import { motion } from "framer-motion";

// Spotify-lyrics-style word highlighting. Google TTS (plain text) gives no
// per-word timings, so we approximate: distribute the chunk's audio duration
// across words, weighted by length AND by trailing punctuation (TTS pauses at
// commas/periods), plus a small lag so the highlight doesn't run ahead of the
// voice. Auto-scroll is done with a transform (not native scroll) so it never
// traps the page's scroll.
export default function Karaoke({ text, currentTime, duration, isPlaying, height = 300 }) {
  const words = useMemo(() => (text ? text.split(/\s+/).filter(Boolean) : []), [text]);

  const cum = useMemo(() => {
    const w = words.map(word => {
      let weight = word.length + 1;
      if (/[.!?]["')\]]?$/.test(word)) weight += 6;       // sentence end — long pause
      else if (/[,;:]["')\]]?$/.test(word)) weight += 3;  // clause — short pause
      else if (/[—–-]$/.test(word)) weight += 2;
      return weight;
    });
    const total = w.reduce((a, b) => a + b, 0) || 1;
    let s = 0;
    return w.map(x => (s += x) / total);
  }, [words]);

  const LAG = 0.18; // seconds — keep highlight just behind the voice
  const t = Math.max(0, currentTime - LAG);
  const frac = duration ? Math.min(1, t / duration) : 0;
  let active = cum.findIndex(c => frac <= c);
  if (active < 0) active = words.length - 1;

  const containerRef = useRef(null);
  const innerRef = useRef(null);
  const activeRef = useRef(null);
  const [offset, setOffset] = useState(0);

  // Center the active word by translating the inner block (no native scroll).
  useEffect(() => {
    const el = activeRef.current, container = containerRef.current, inner = innerRef.current;
    if (el && container && inner) {
      const target = el.offsetTop + el.offsetHeight / 2 - container.clientHeight / 2;
      const maxOff = Math.max(0, inner.scrollHeight - container.clientHeight);
      setOffset(Math.max(0, Math.min(target, maxOff)));
    }
  }, [active, words, height]);

  if (!words.length) return null;

  return (
    <div ref={containerRef} style={{
      height, overflow: "hidden", position: "relative",
      maskImage: "linear-gradient(180deg, transparent, #000 18%, #000 82%, transparent)",
      WebkitMaskImage: "linear-gradient(180deg, transparent, #000 18%, #000 82%, transparent)",
    }}>
      <motion.div ref={innerRef} animate={{ y: -offset }} transition={{ type: "spring", stiffness: 120, damping: 24 }}
        style={{ lineHeight: 1.6, fontSize: "clamp(24px, 6vw, 33px)", fontWeight: 800, letterSpacing: "-0.02em", padding: "0 2px" }}>
        {words.map((word, i) => {
          const state = i < active ? "past" : i === active ? "active" : "future";
          return (
            <motion.span key={i} ref={i === active ? activeRef : null}
              animate={{
                color: state === "active" ? "var(--brand)" : state === "past" ? "var(--text-2)" : "var(--text-3)",
                opacity: state === "future" ? 0.35 : state === "past" ? 0.7 : 1,
              }}
              transition={{ duration: 0.18 }}
              style={{ display: "inline-block", marginRight: "0.3em", textShadow: state === "active" && isPlaying ? "0 0 24px rgba(29,185,84,0.55)" : "none" }}>
              {word}
            </motion.span>
          );
        })}
      </motion.div>
    </div>
  );
}
