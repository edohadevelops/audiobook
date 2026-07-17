-- =============================================================================
-- PDF Audiobook — Supabase schema
-- =============================================================================
-- Run this in a NEW Supabase project: Dashboard → SQL Editor → New query → paste
-- → Run. Then create the two storage buckets (see the STORAGE section at the
-- bottom). Finally copy the project URL + anon key into .env.
--
-- This app is single-user with NO login, so every table uses a permissive RLS
-- policy that grants the anon role full access. If you ever add auth, tighten
-- these policies to `auth.uid()`-scoped rules.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- books
-- ---------------------------------------------------------------------------
create table if not exists public.books (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  author          text,
  category        text,
  file_path       text not null,
  word_count      integer default 0,
  chunk_count     integer default 0,
  completed_at    timestamptz,
  times_completed integer default 0,
  cover_path      text,
  created_at      timestamptz default now()
);
-- If the books table already exists, add the cover column:
alter table public.books add column if not exists cover_path text;
alter table public.books add column if not exists author text;
alter table public.books add column if not exists category text;

-- ---------------------------------------------------------------------------
-- audio_chunks — cached TTS audio, one row per (book, chunk, voice)
-- ---------------------------------------------------------------------------
create table if not exists public.audio_chunks (
  id          uuid primary key default gen_random_uuid(),
  book_id     uuid not null references public.books(id) on delete cascade,
  chunk_index integer not null,
  audio_path  text not null,
  voice_id    text not null,
  created_at  timestamptz default now(),
  unique (book_id, chunk_index, voice_id)
);

-- ---------------------------------------------------------------------------
-- reading_progress — one row per book, tracks resume position
-- ---------------------------------------------------------------------------
create table if not exists public.reading_progress (
  id               uuid primary key default gen_random_uuid(),
  book_id          uuid not null references public.books(id) on delete cascade,
  current_chunk    integer default 0,
  current_position double precision default 0,
  last_opened      timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- completions — one row every time a book is finished (supports re-reads)
-- ---------------------------------------------------------------------------
create table if not exists public.completions (
  id           uuid primary key default gen_random_uuid(),
  book_id      uuid not null references public.books(id) on delete cascade,
  completed_at timestamptz default now()
);
create index if not exists completions_completed_at_idx on public.completions (completed_at);

-- ---------------------------------------------------------------------------
-- listen_sessions — chunks of listening time, for analytics / Wrapped
-- ---------------------------------------------------------------------------
create table if not exists public.listen_sessions (
  id          uuid primary key default gen_random_uuid(),
  book_id     uuid not null references public.books(id) on delete cascade,
  seconds     integer not null default 0,
  listened_at timestamptz default now()
);
create index if not exists listen_sessions_listened_at_idx on public.listen_sessions (listened_at);

-- ---------------------------------------------------------------------------
-- book_journal — one editable journal per book
-- ---------------------------------------------------------------------------
create table if not exists public.book_journal (
  id           uuid primary key default gen_random_uuid(),
  book_id      uuid not null unique references public.books(id) on delete cascade,
  learnings    text,
  takeaways    text,
  action_steps text,
  rating       integer,
  updated_at   timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- goals — yearly reading goal (default 12 books/year)
-- ---------------------------------------------------------------------------
create table if not exists public.goals (
  id         uuid primary key default gen_random_uuid(),
  year       integer not null unique,
  target     integer not null default 12,
  created_at timestamptz default now()
);

-- =============================================================================
-- Row Level Security — permissive (single-user, anon key)
-- =============================================================================
alter table public.books           enable row level security;
alter table public.audio_chunks    enable row level security;
alter table public.reading_progress enable row level security;
alter table public.completions     enable row level security;
alter table public.listen_sessions enable row level security;
alter table public.book_journal    enable row level security;
alter table public.goals           enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'books','audio_chunks','reading_progress',
    'completions','listen_sessions','book_journal','goals'
  ]
  loop
    execute format('drop policy if exists anon_all on public.%I;', t);
    execute format(
      'create policy anon_all on public.%I for all to anon, authenticated using (true) with check (true);',
      t
    );
  end loop;
end $$;

-- =============================================================================
-- STORAGE  (run after creating the buckets in the Dashboard)
-- =============================================================================
-- 1. Dashboard → Storage → New bucket:
--      • name: books   — Public: OFF (private)
--      • name: audio   — Public: ON
--
-- 2. Then run the policies below so the anon key can read/write both buckets.
--    (Storage objects live in storage.objects and need their own policies.)

drop policy if exists anon_books_all on storage.objects;
create policy anon_books_all on storage.objects
  for all to anon, authenticated
  using (bucket_id = 'books')  with check (bucket_id = 'books');

drop policy if exists anon_audio_all on storage.objects;
create policy anon_audio_all on storage.objects
  for all to anon, authenticated
  using (bucket_id = 'audio')  with check (bucket_id = 'audio');
