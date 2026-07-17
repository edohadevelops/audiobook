import { useMemo, useRef, useEffect, useState } from "react";
import { motion } from "framer-motion";

// Spotify-lyrics-style word highlighting. Google TTS doesn't give per-word
// timings with our current (plain-text) requests, so we approximate: distribute
// the chunk's audio duration across words weighted by length. Reads as karaoke;
// upgradeable to frame-perfect sync later via TTS SSML timepoints.
export default function Karaoke({ text, currentTime, duration, isPlaying }) {
  const words = useMemo(() => (text ? text.split(/\s+/).filter(Boolean) : []), [text]);

  // Cumulative fraction of total "reading weight" at the END of each word.
  const cum = useMemo(() => {
    const w = words.map(x => x.length + 1.5); // +1.5 approximates inter-word pause
    const total = w.reduce((a, b) => a + b, 0) || 1;
    let s = 0;
    return w.map(x => (s += x) / total);
  }, [words]);

  const frac = duration ? Math.min(1, currentTime / duration) : 0;
  let active = cum.findIndex(c => frac <= c);
  if (active < 0) active = words.length - 1;

  const containerRef = useRef(null);
  const activeRef = useRef(null);
  const [auto, setAuto] = useState(true);

  // Keep the active word centered while it's actively advancing.
  useEffect(() => {
    if (auto && activeRef.current) {
      activeRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [active, auto]);

  if (!words.length) return null;

  return (
    <div
      ref={containerRef}
      onWheel={() => setAuto(false)}
      onMouseEnter={() => setAuto(false)}
      onMouseLeave={() => setAuto(true)}
      style={{
        maxHeight: 400, overflowY: "auto", padding: "20px 4px",
        maskImage: "linear-gradient(180deg, transparent, #000 16%, #000 84%, transparent)",
        WebkitMaskImage: "linear-gradient(180deg, transparent, #000 16%, #000 84%, transparent)",
        lineHeight: 1.65, fontSize: "clamp(26px, 6.5vw, 34px)", fontWeight: 800, letterSpacing: "-0.02em",
      }}
    >
      {words.map((word, i) => {
        const state = i < active ? "past" : i === active ? "active" : "future";
        return (
          <motion.span
            key={i}
            ref={i === active ? activeRef : null}
            animate={{
              color: state === "active" ? "var(--brand)" : state === "past" ? "var(--text-2)" : "var(--text-3)",
              opacity: state === "future" ? 0.38 : state === "past" ? 0.75 : 1,
            }}
            transition={{ duration: 0.18 }}
            style={{ display: "inline-block", marginRight: "0.3em", textShadow: state === "active" && isPlaying ? "0 0 24px rgba(29,185,84,0.55)" : "none" }}
          >
            {word}
          </motion.span>
        );
      })}
    </div>
  );
}
