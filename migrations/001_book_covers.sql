-- Run this in the Supabase SQL editor if you set up the DB before book covers
-- existed. Safe to run more than once.
alter table public.books add column if not exists cover_path text;
