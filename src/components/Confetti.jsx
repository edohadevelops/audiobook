import { useMemo } from "react";
import { motion } from "framer-motion";

const COLORS = ["#1db954", "#1ed760", "#3ecf8e", "#ffffff", "#f59e0b"];

// Self-contained celebratory burst — no external library. Plays once on mount.
export default function Confetti({ count = 80 }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        delay: Math.random() * 0.3,
        dur: 1.8 + Math.random() * 1.4,
        rot: Math.random() * 720 - 360,
        size: 6 + Math.random() * 6,
        color: COLORS[i % COLORS.length],
        drift: (Math.random() - 0.5) * 160,
      })),
    [count]
  );

  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 200, overflow: "hidden" }}>
      {pieces.map(p => (
        <motion.span
          key={p.id}
          initial={{ top: -40, left: `${p.x}vw`, opacity: 1, rotate: 0 }}
          animate={{ top: "110vh", left: `calc(${p.x}vw + ${p.drift}px)`, rotate: p.rot, opacity: [1, 1, 0.9, 0] }}
          transition={{ duration: p.dur, delay: p.delay, ease: "easeIn" }}
          style={{ position: "absolute", width: p.size, height: p.size * 0.6, background: p.color, borderRadius: 2 }}
        />
      ))}
    </div>
  );
}
