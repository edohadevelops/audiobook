// Pure aggregation helpers for the Wrapped / Stats screen. Volume is tiny for a
// personal library, so everything is computed client-side from rows returned by
// db.fetchStats — no SQL functions needed.

// Returns { from, to } ISO strings for the requested window, relative to `now`.
export function periodRange(kind, now = new Date()) {
  const to = new Date(now);
  const from = new Date(now);
  switch (kind) {
    case "week": {
      // Rolling 7 days.
      from.setDate(from.getDate() - 7);
      break;
    }
    case "month": {
      from.setMonth(from.getMonth() - 1);
      break;
    }
    case "quarter": {
      from.setMonth(from.getMonth() - 3);
      break;
    }
    case "year":
    default: {
      from.setFullYear(from.getFullYear() - 1);
      break;
    }
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

export const PERIODS = [
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "quarter", label: "This quarter" },
  { key: "year", label: "This year" },
];

function rankBy(rows, keyFn, secondsFn) {
  const totals = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    totals.set(key, (totals.get(key) || 0) + secondsFn(row));
  }
  return [...totals.entries()]
    .map(([name, seconds]) => ({ name, seconds }))
    .sort((a, b) => b.seconds - a.seconds);
}

// completions: [{ books: {title, author, category} }]
// sessions:    [{ seconds, books: {title, author, category} }]
export function summarize({ completions = [], sessions = [] }) {
  const totalSeconds = sessions.reduce((sum, s) => sum + (s.seconds || 0), 0);

  return {
    totalSeconds,
    booksFinished: completions.length,
    topAuthors: rankBy(
      sessions,
      (s) => s.books?.author,
      (s) => s.seconds || 0
    ),
    topCategories: rankBy(
      sessions,
      (s) => s.books?.category,
      (s) => s.seconds || 0
    ),
    topBooks: rankBy(
      sessions,
      (s) => s.books?.title,
      (s) => s.seconds || 0
    ),
  };
}

// "2h 14m", "14m", "0m"
export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}
