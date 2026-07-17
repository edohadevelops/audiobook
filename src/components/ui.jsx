import { motion, AnimatePresence } from "framer-motion";
import { Sun, Moon, Library, Target, BarChart3, X } from "lucide-react";
import { spring, springSoft, tap, tapSoft, durations, ease } from "../theme";
import { useTheme } from "../ThemeContext";

/* -------------------------------------------------------------------------
   Button — one component, variant-driven, with press feedback everywhere.
   ------------------------------------------------------------------------- */
const VARIANTS = {
  primary: { background: "var(--brand)", color: "var(--brand-contrast)", border: "1px solid transparent", fontWeight: 700 },
  ghost:   { background: "transparent", color: "var(--text-2)", border: "1px solid var(--border)" },
  subtle:  { background: "var(--surface-2)", color: "var(--text)", border: "1px solid var(--border)" },
  danger:  { background: "transparent", color: "var(--error)", border: "1px solid rgba(239,68,68,0.35)" },
  success: { background: "transparent", color: "var(--success)", border: "1px solid rgba(62,207,142,0.4)" },
};

export function Button({ variant = "subtle", children, style, full, size = "md", ...props }) {
  const pad = size === "sm" ? "8px 12px" : size === "lg" ? "14px 22px" : "11px 16px";
  const fs = size === "sm" ? 12 : size === "lg" ? 15 : 13.5;
  return (
    <motion.button
      whileTap={props.disabled ? undefined : tap}
      whileHover={props.disabled ? undefined : { y: -1 }}
      transition={spring}
      style={{
        ...VARIANTS[variant],
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
        borderRadius: "var(--r-full)", padding: pad, fontSize: fs, cursor: "pointer",
        width: full ? "100%" : undefined, opacity: props.disabled ? 0.45 : 1,
        pointerEvents: props.disabled ? "none" : undefined, whiteSpace: "nowrap",
        ...style,
      }}
      {...props}
    >
      {children}
    </motion.button>
  );
}

export function IconButton({ children, active, style, size = 40, ...props }) {
  return (
    <motion.button
      whileTap={tap}
      whileHover={{ scale: 1.06 }}
      transition={spring}
      style={{
        width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center",
        borderRadius: "var(--r-full)", cursor: "pointer",
        background: active ? "var(--brand)" : "var(--surface-2)",
        color: active ? "var(--brand-contrast)" : "var(--text-2)",
        border: "1px solid var(--border)",
        ...style,
      }}
      {...props}
    >
      {children}
    </motion.button>
  );
}

/* -------------------------------------------------------------------------
   Card — glassmorphic surface with hover lift + border glow.
   ------------------------------------------------------------------------- */
export function Card({ children, style, hover, onClick, ...rest }) {
  return (
    <motion.div
      onClick={onClick}
      whileHover={hover ? { y: -4, borderColor: "var(--brand)" } : undefined}
      whileTap={hover ? tapSoft : undefined}
      transition={springSoft}
      style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: "var(--r-lg)", padding: "var(--sp-6)",
        boxShadow: "var(--shadow)", cursor: hover ? "pointer" : undefined,
        ...style,
      }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/* -------------------------------------------------------------------------
   Skeleton + branded spinner.
   ------------------------------------------------------------------------- */
export function Skeleton({ h = 16, w = "100%", r = 8, style }) {
  return <div className="skeleton" style={{ height: h, width: w, borderRadius: r, ...style }} />;
}

export function Spinner({ size = 22 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", border: `2px solid var(--brand)`, borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }} />
  );
}

/* -------------------------------------------------------------------------
   Waveform equalizer — animates while playing, flat when paused.
   ------------------------------------------------------------------------- */
export function Waveform({ playing, bars = 5, size = 22, color = "currentColor" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 2, height: size }}>
      {Array.from({ length: bars }).map((_, i) => (
        <span key={i} style={{
          width: 2.5, height: size, borderRadius: 2, background: color,
          transformOrigin: "center",
          animation: playing ? `eq ${0.5 + (i % 3) * 0.18}s ease-in-out ${i * 0.07}s infinite alternate` : "none",
          transform: playing ? undefined : "scaleY(0.3)",
        }} />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------
   TabBar — sliding active indicator (layoutId) + icon bounce on select.
   ------------------------------------------------------------------------- */
const TABS = [
  { key: "library", label: "Library", Icon: Library },
  { key: "goals", label: "Goals", Icon: Target },
  { key: "stats", label: "Stats", Icon: BarChart3 },
];

export function TabBar({ screen, setScreen }) {
  return (
    <div style={{ display: "flex", gap: 4, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-full)", padding: 4, boxShadow: "var(--shadow)" }}>
      {TABS.map(({ key, label, Icon }) => {
        const active = screen === key;
        return (
          <button key={key} onClick={() => setScreen(key)}
            style={{ position: "relative", flex: 1, border: "none", background: "transparent", cursor: "pointer", padding: "9px 10px", borderRadius: "var(--r-full)" }}>
            {active && (
              <motion.div layoutId="tab-pill" transition={spring}
                style={{ position: "absolute", inset: 0, background: "var(--brand)", borderRadius: "var(--r-full)" }} />
            )}
            <motion.span animate={{ scale: active ? 1.05 : 1 }} transition={spring}
              style={{ position: "relative", zIndex: 1, display: "inline-flex", alignItems: "center", gap: 7, color: active ? "var(--brand-contrast)" : "var(--text-2)", fontWeight: active ? 700 : 500, fontSize: 13 }}>
              <Icon size={16} strokeWidth={2.4} />
              {label}
            </motion.span>
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------
   ThemeToggle — animated sun ↔ moon morph.
   ------------------------------------------------------------------------- */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  return (
    <motion.button onClick={toggle} whileTap={tap} whileHover={{ scale: 1.06 }} transition={spring}
      aria-label="Toggle theme"
      style={{ width: 40, height: 40, borderRadius: "var(--r-full)", border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={theme}
          initial={{ y: 16, rotate: -90, opacity: 0 }}
          animate={{ y: 0, rotate: 0, opacity: 1 }}
          exit={{ y: -16, rotate: 90, opacity: 0 }}
          transition={{ duration: durations.base, ease }}
          style={{ display: "inline-flex" }}>
          {dark ? <Moon size={18} /> : <Sun size={18} />}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}

/* -------------------------------------------------------------------------
   Modal / bottom-sheet with backdrop — spring entrance.
   ------------------------------------------------------------------------- */
export function Modal({ open, onClose, children, title }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
          style={{ position: "fixed", inset: 0, zIndex: 100, background: "var(--scrim)", backdropFilter: "blur(6px)", display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 16 }}>
          <motion.div
            initial={{ y: 40, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 40, opacity: 0, scale: 0.98 }}
            transition={spring}
            onClick={e => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 460, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-xl)", padding: "var(--sp-6)", boxShadow: "var(--shadow-lg)", marginBottom: "6vh" }}>
            {title && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--sp-4)" }}>
                <h3 style={{ fontSize: 18 }}>{title}</h3>
                <IconButton size={32} onClick={onClose}><X size={16} /></IconButton>
              </div>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
