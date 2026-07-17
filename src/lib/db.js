import { supabase, supabaseConfigError } from "../supabaseClient";

// Normalizes every call into { data, error }. supabase-js sometimes REJECTS on
// network failures (DNS gone, project paused) rather than returning an error
// object — that rejection is why the old app showed a blank screen. We catch it
// here so callers always get a usable error message to display.
async function run(fn) {
  if (!supabase) return { data: null, error: new Error(supabaseConfigError) };
  try {
    const { data, error } = await fn(supabase);
    return { data, error };
  } catch (e) {
    return {
      data: null,
      error: new Error(
        e?.message ||
          "Can't reach your library. The Supabase backend may be paused, deleted, or offline."
      ),
    };
  }
}

// ---- Books -----------------------------------------------------------------

export function fetchBooks() {
  return run((sb) =>
    sb
      .from("books")
      .select("*, reading_progress(*)")
      .order("created_at", { ascending: false })
  );
}

export function updateBookMeta(bookId, { author, category }) {
  return run((sb) =>
    sb.from("books").update({ author, category }).eq("id", bookId)
  );
}

// Generic update for editable book fields (title, author, category, cover_path).
export function updateBook(bookId, fields) {
  return run((sb) => sb.from("books").update(fields).eq("id", bookId));
}

// Covers live in the public `audio` bucket under covers/. Returns the storage path.
export async function uploadCover(bookId, file) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `covers/${bookId}.${ext}`;
  const up = await run((sb) =>
    sb.storage.from("audio").upload(path, file, { contentType: file.type, upsert: true })
  );
  if (up.error) return up;
  return { data: path, error: null };
}

// Public URL for a stored cover path (or null).
export function coverUrl(path) {
  if (!path || !supabase) return null;
  return supabase.storage.from("audio").getPublicUrl(path).data.publicUrl;
}

// ---- Completions -----------------------------------------------------------

// Records a finished book: one completions row per finish (re-reads add rows),
// plus a denormalized completed_at / times_completed on the book itself.
export async function recordCompletion(bookId, currentTimesCompleted = 0) {
  const now = new Date().toISOString();
  const ins = await run((sb) =>
    sb.from("completions").insert({ book_id: bookId, completed_at: now })
  );
  if (ins.error) return ins;
  return run((sb) =>
    sb
      .from("books")
      .update({ completed_at: now, times_completed: currentTimesCompleted + 1 })
      .eq("id", bookId)
  );
}

// Most recent completions joined to book title — for the compact "recently
// finished" strip.
export function fetchRecentCompletions(limit = 5) {
  return run((sb) =>
    sb
      .from("completions")
      .select("id, completed_at, books(title)")
      .order("completed_at", { ascending: false })
      .limit(limit)
  );
}

// ---- Listen sessions -------------------------------------------------------

export function flushListenSession(bookId, seconds) {
  const secs = Math.round(seconds);
  if (!bookId || secs <= 0) return Promise.resolve({ data: null, error: null });
  return run((sb) =>
    sb.from("listen_sessions").insert({ book_id: bookId, seconds: secs })
  );
}

// ---- Journal ---------------------------------------------------------------

export function getJournal(bookId) {
  return run((sb) =>
    sb.from("book_journal").select("*").eq("book_id", bookId).maybeSingle()
  );
}

export function saveJournal(bookId, { learnings, takeaways, action_steps, rating }) {
  return run((sb) =>
    sb.from("book_journal").upsert(
      {
        book_id: bookId,
        learnings,
        takeaways,
        action_steps,
        rating,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "book_id" }
    )
  );
}

// ---- Goals -----------------------------------------------------------------

export function getGoal(year) {
  return run((sb) =>
    sb.from("goals").select("*").eq("year", year).maybeSingle()
  );
}

export function setGoal(year, target) {
  return run((sb) =>
    sb.from("goals").upsert({ year, target }, { onConflict: "year" }).select().single()
  );
}

// Count of books finished within a year (uses the completions log so re-reads
// count — matches how "12 books this year" is naturally understood).
export function countCompletionsInYear(year) {
  const from = new Date(Date.UTC(year, 0, 1)).toISOString();
  const to = new Date(Date.UTC(year + 1, 0, 1)).toISOString();
  return run((sb) =>
    sb
      .from("completions")
      .select("id", { count: "exact", head: true })
      .gte("completed_at", from)
      .lt("completed_at", to)
  );
}

// ---- Stats (for Wrapped) ---------------------------------------------------

// Returns completions + listen_sessions in [from, to), each joined to book
// meta (title/author/category) so analytics.js can aggregate client-side.
export async function fetchStats(from, to) {
  const [completions, sessions] = await Promise.all([
    run((sb) =>
      sb
        .from("completions")
        .select("id, completed_at, books(id, title, author, category)")
        .gte("completed_at", from)
        .lt("completed_at", to)
    ),
    run((sb) =>
      sb
        .from("listen_sessions")
        .select("id, seconds, listened_at, books(id, title, author, category)")
        .gte("listened_at", from)
        .lt("listened_at", to)
    ),
  ]);
  const error = completions.error || sessions.error;
  return {
    data: {
      completions: completions.data || [],
      sessions: sessions.data || [],
    },
    error,
  };
}
