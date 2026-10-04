-- PA Insight: 사용자 데이터 테이블 (본인 행만 읽기·쓰기)
-- Supabase 대시보드 → SQL Editor에 이 파일 내용을 붙여 넣고 Run 한다.
-- 공시 데이터는 DB에 넣지 않고 public/data의 JSON으로 제공한다.

create table if not exists public.profiles (
  user_id      uuid primary key default auth.uid() references auth.users on delete cascade,
  display_name text,
  team         text,
  memo_sign    text,
  updated_at   timestamptz not null default now()
);

create table if not exists public.user_filters (
  user_id    uuid primary key default auth.uid() references auth.users on delete cascade,
  filters    jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.shortlist (
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  corp_code  text not null,
  status     text not null default '검토 전'
             check (status in ('검토 전', '검토 중', '제안 대상', '제외')),
  saved_at   timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, corp_code)
);

create table if not exists public.memos (
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  corp_code  text not null,
  body       text not null check (char_length(body) <= 200),
  updated_at timestamptz not null default now(),
  primary key (user_id, corp_code)
);

alter table public.profiles     enable row level security;
alter table public.user_filters enable row level security;
alter table public.shortlist    enable row level security;
alter table public.memos        enable row level security;

drop policy if exists own_rows on public.profiles;
drop policy if exists own_rows on public.user_filters;
drop policy if exists own_rows on public.shortlist;
drop policy if exists own_rows on public.memos;

create policy own_rows on public.profiles     for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_rows on public.user_filters for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_rows on public.shortlist    for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_rows on public.memos        for all using (user_id = auth.uid()) with check (user_id = auth.uid());
