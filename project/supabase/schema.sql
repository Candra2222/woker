-- =====================================================
-- SCHEMA: Realtime Conversion Dashboard (multi-network)
-- Jalankan di Supabase SQL Editor
-- =====================================================

-- 1. Tabel utama: semua konversi dari semua network masuk sini
create table if not exists public.conversions (
  id            bigint generated always as identity primary key,
  network       text not null,              -- 'trafee' | 'imonetizeit' | dst
  click_id      text,                       -- ID unik klik/sub id
  offer_name    text,                       -- nama offer / smartlink
  payout        numeric(10,4) default 0,    -- nilai konversi
  currency      text default 'USD',
  country       text,                       -- kode negara 2 huruf, mis. 'ID'
  status        text default 'approved',    -- approved/pending/rejected
  device        text,                       -- mobile/desktop/tablet
  browser       text,
  ip            text,
  raw_payload   jsonb,                      -- simpan semua parameter asli (buat debug)
  created_at    timestamptz not null default now()
);

-- Index untuk query cepat (dashboard filter by network & tanggal)
create index if not exists idx_conversions_created_at on public.conversions (created_at desc);
create index if not exists idx_conversions_network on public.conversions (network);
create index if not exists idx_conversions_click_id on public.conversions (click_id);

-- 2. Aktifkan Row Level Security
alter table public.conversions enable row level security;

-- Policy: anon key (dipakai dashboard) HANYA BOLEH BACA (read-only)
-- Insert hanya boleh lewat service_role key (dipakai Cloudflare Worker), yang otomatis bypass RLS
create policy "Public read access"
  on public.conversions
  for select
  to anon
  using (true);

-- 3. Aktifkan Realtime replication untuk tabel ini
-- (Supabase butuh tabel ini masuk publication supabase_realtime)
alter publication supabase_realtime add table public.conversions;

-- 4. (Opsional) View agregat harian per click_id, untuk halaman "Reports"
create or replace view public.daily_performance as
select
  network,
  click_id,
  count(*) as leads,
  sum(payout) as total_payout,
  date_trunc('day', created_at) as day
from public.conversions
group by network, click_id, date_trunc('day', created_at);
