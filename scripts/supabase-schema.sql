-- Arena Radar — Supabase tabloları
--
-- Supabase panelinde SQL Editor'e yapıştırıp bir kez çalıştırın. Radar her
-- koşuda `radar_streamers` ve `radar_chests` tablolarına "merge-duplicates"
-- ile yazar; aynı yayıncı ya da zarf kimliği satırı çoğaltmaz.
--
-- Yayıncı defteri hiç silinmez: `first_seen` ilk görülme, `last_seen` son
-- doğrulanma zamanıdır. Sandıklar `status` ile ayrılır:
--   waiting = süre dolmadı, open = açık (hâlâ odada), closed = odadan kalktı.

create table if not exists public.radar_streamers (
  username     text primary key,
  nickname     text,
  avatar       text,
  region       text,
  room_id      text,
  first_seen   timestamptz,
  last_seen    timestamptz,
  last_live_at timestamptz,
  live_count   integer not null default 0,
  updated_at   timestamptz not null default now()
);

create index if not exists radar_streamers_last_seen_idx
  on public.radar_streamers (last_seen desc);

create index if not exists radar_streamers_region_idx
  on public.radar_streamers (region);

create table if not exists public.radar_chests (
  envelope_id   text primary key,
  room_id       text,
  username      text,
  nickname      text,
  title         text,
  kind          text not null default 'chest',
  variant       text,
  skin_id       integer,
  business_type integer,
  coins         integer not null default 0,
  slots         integer not null default 0,
  ratio         numeric(10,2) not null default 0,
  viewers       integer not null default 0,
  opens_at      timestamptz,
  detected_at   timestamptz,
  last_seen_at  timestamptz,
  status        text not null default 'waiting',
  open_url      text,
  updated_at    timestamptz not null default now()
);

create index if not exists radar_chests_opens_idx
  on public.radar_chests (opens_at desc);

create index if not exists radar_chests_username_idx
  on public.radar_chests (username);

-- Radar verisi zaten kamuya açık; anonim okuma isterseniz aşağıdaki iki bloğu
-- çalıştırın. Yazma yalnızca service role anahtarıyla yapılır.
-- alter table public.radar_streamers enable row level security;
-- alter table public.radar_chests enable row level security;
-- create policy "radar_streamers_read" on public.radar_streamers for select using (true);
-- create policy "radar_chests_read" on public.radar_chests for select using (true);
