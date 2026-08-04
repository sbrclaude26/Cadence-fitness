-- DEXA body-composition scans.
--
-- Scale weight can't distinguish fat from lean tissue, so the coach has been
-- inferring composition from rate-of-change plus lift performance. A DEXA scan
-- measures it directly; storing a series of them turns the strongest question
-- the athlete asks ("am I actually holding muscle?") from an inference into a
-- measurement.
--
-- The PDF itself is kept in Storage so a scan can be re-parsed if extraction
-- improves; the numbers live here so the plan builder never touches the file.

create table if not exists public.dexa_scans (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  -- The date of the scan itself, not the upload. Athlete-confirmed, because a
  -- misdated scan corrupts every trend drawn through it.
  scan_date             date not null,
  -- Storage object path. Null once a file is deleted but the numbers are kept.
  file_path             text,
  file_name             text,

  -- Whole-body figures. All nullable: report layouts differ by clinic and a
  -- missing field must read as "not reported", never as zero.
  body_fat_pct          numeric(5,2),
  fat_mass_lb           numeric(6,2),
  lean_mass_lb          numeric(6,2),
  total_mass_lb         numeric(6,2),
  bone_mineral_lb       numeric(6,2),
  visceral_fat_lb       numeric(6,2),
  resting_metabolic_rate integer,

  -- Per-region lean/fat where the report breaks it out (arms, legs, trunk,
  -- android/gynoid). Shape varies by provider, so it stays JSON rather than
  -- forcing every clinic's layout into columns.
  regional              jsonb not null default '{}'::jsonb,

  -- What the extractor could not read, surfaced to the athlete so a bad parse
  -- is visible instead of silently wrong.
  extraction_notes      text,
  created_at            timestamptz not null default now(),

  -- One scan per date per athlete; re-uploading the same date replaces it.
  unique (user_id, scan_date)
);

create index if not exists dexa_scans_user_date_idx
  on public.dexa_scans (user_id, scan_date desc);

alter table public.dexa_scans enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='dexa_scans' and policyname='dexa_scans_own') then
    create policy dexa_scans_own on public.dexa_scans
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;

comment on table public.dexa_scans is 'DEXA body-composition scans: the measured answer to fat-vs-lean, fed into the plan builder.';

-- ── Storage ────────────────────────────────────────────────────────────────
-- Private bucket; objects are namespaced by user id so a policy can check
-- ownership from the path's first segment.
insert into storage.buckets (id, name, public)
values ('dexa', 'dexa', false)
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='dexa_read_own') then
    create policy dexa_read_own on storage.objects
      for select using (bucket_id = 'dexa' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='dexa_insert_own') then
    create policy dexa_insert_own on storage.objects
      for insert with check (bucket_id = 'dexa' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='dexa_delete_own') then
    create policy dexa_delete_own on storage.objects
      for delete using (bucket_id = 'dexa' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
end $$;
