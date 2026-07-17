# PDF Audiobook

Turn PDFs into a personal audiobook library with Google Text-to-Speech, plus
reading journals, goals, and Spotify-style "Wrapped" listening stats. Single-user,
React + Vite, Supabase for storage/data.

## Features

- **Library / shelves** — upload PDFs, tag with author + category, search by
  title/author, filter by category, and group into *In progress / Not started /
  Finished* shelves. Repeat any finished book.
- **Gapless playback** — text is chunked and voiced on demand, but the next chunk
  is pre-buffered into a second audio element so long listens (e.g. driving) don't
  pause between parts. Tip: hit **⚡ Pre-generate** first to cache the whole book.
- **Completions** — mark a book finished (or let it finish on its own); each finish
  is logged, powering goals, the "recently finished" list, and stats.
- **Journal** — per book: what you learnt, key takeaways, actionable steps, rating.
- **Goals** — set a yearly target (default 12 books) and track progress + pace.
- **Wrapped / Stats** — week / month / quarter / year: books finished, time
  listened, most-listened authors, categories, and top books.

## Setup

### 1. Create a Supabase project
1. Create a new project at [supabase.com](https://supabase.com) (free tier is fine).
2. **SQL Editor → New query** → paste the contents of [`schema.sql`](schema.sql) → **Run**.
   This creates all tables and the permissive (single-user) RLS policies.
3. **Storage → New bucket** — create two buckets:
   - `books` — Public: **OFF**
   - `audio` — Public: **ON**
4. Re-run the `STORAGE` policy block at the bottom of `schema.sql` if you created the
   buckets after the first run (so the anon key can read/write them).

### 2. Configure environment
Copy `.env.example` to `.env` and fill in:

```
VITE_GOOGLE_TTS_KEY=<your Google Cloud TTS API key>
VITE_SUPABASE_URL=<Project Settings → API → Project URL>
VITE_SUPABASE_ANON_KEY=<Project Settings → API → anon public key>
```

> Restart `npm run dev` after editing `.env` — Vite only reads env vars at startup.

### 3. Run

```bash
npm install
npm run dev
```

## Notes

- **No login.** The app uses the Supabase anon key with permissive RLS — it's built
  for one person. If you add auth later, tighten the policies in `schema.sql` to
  `auth.uid()`-scoped rules.
- If the library ever fails to load, the app now shows the actual error instead of a
  blank screen. A common cause on the free tier is the project being **paused after
  inactivity** — restore it from the Supabase dashboard.
- Keep secrets out of git: `.env` is gitignored. Rotate the TTS key and anon key if
  they were ever committed.

## Project layout

```
schema.sql              # Supabase tables, RLS, storage policies
src/supabaseClient.js   # env-based Supabase client
src/lib/db.js           # data access (returns { data, error })
src/lib/analytics.js    # period ranges + stats aggregation
src/screens/            # Journal, Goals, Wrapped
src/App.jsx             # library + player + navigation
```
