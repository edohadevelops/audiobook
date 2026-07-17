// Shared motion language — one set of durations/easings/springs so every
// animation across the app feels like the same system, not bolted-on per screen.

export const spring = { type: "spring", stiffness: 400, damping: 32, mass: 0.8 };
export const springSoft = { type: "spring", stiffness: 260, damping: 26 };
export const springBouncy = { type: "spring", stiffness: 500, damping: 18 };

export const ease = [0.22, 1, 0.36, 1]; // expressive ease-out
export const durations = { fast: 0.15, base: 0.28, slow: 0.45 };
export const STAGGER = 0.05;

// Press/hover feedback reused on every tappable element.
export const tap = { scale: 0.95 };
export const tapSoft = { scale: 0.97 };

// Staggered list container + item variants.
export const listContainer = {
  hidden: {},
  show: { transition: { staggerChildren: STAGGER, delayChildren: 0.04 } },
};
export const listItem = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { ...springSoft } },
};

// Screen enter/exit — a gentle slide+fade used by AnimatePresence.
export const screenVariants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: durations.base, ease } },
  exit: { opacity: 0, y: -8, transition: { duration: durations.fast, ease } },
};
