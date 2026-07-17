import { useMemo } from "react";

// Faint twinkling starfield behind the whole app. Positions are randomized once.
export default function Starfield({ count = 70 }) {
  const stars = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        top: Math.random() * 100,
        left: Math.random() * 100,
        size: Math.random() * 2 + 1,
        delay: Math.random() * 4,
        dur: 2.5 + Math.random() * 3.5,
      })),
    [count]
  );

  return (
    <div aria-hidden style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden" }}>
      {/* soft brand glows */}
      <div style={{ position: "absolute", top: "-12%", right: "-10%", width: 460, height: 460, borderRadius: "50%", filter: "blur(90px)", background: "rgba(29,185,84,0.10)" }} />
      <div style={{ position: "absolute", bottom: "-14%", left: "-8%", width: 380, height: 380, borderRadius: "50%", filter: "blur(90px)", background: "rgba(29,185,84,0.06)" }} />
      {stars.map(s => (
        <span
          key={s.id}
          style={{
            position: "absolute",
            top: `${s.top}%`,
            left: `${s.left}%`,
            width: s.size,
            height: s.size,
            borderRadius: "50%",
            background: "var(--star)",
            animation: `twinkle ${s.dur}s ease-in-out ${s.delay}s infinite`,
          }}
        />
      ))}
    </div>
  );
}
