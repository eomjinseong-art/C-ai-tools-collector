-- AI Tools Korea - Supabase schema
-- Run this in the Supabase SQL editor (or via `supabase db push`).

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────
-- categories: the 20 AI tool categories (19 tools + 1 trend)
-- ─────────────────────────────────────────────
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,               -- e.g. 'chatgpt', 'claude', 'trend'
  name text not null,                      -- e.g. '챗GPT'
  description text,                        -- short blurb for category page
  search_keywords text[] not null default '{}', -- YouTube search queries used by the collector
  is_trend boolean not null default false, -- true only for the trend category
  sort_order int not null default 0,
  click_count bigint not null default 0, -- drives left-menu ordering in the 3-panel app
  target_video_count int not null default 10, -- collector's per-category top-N cutoff
  icon_url text,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- videos: collected YouTube videos + AI summary
-- ─────────────────────────────────────────────
create table if not exists videos (
  id uuid primary key default gen_random_uuid(),
  youtube_id text not null unique,
  category_id uuid not null references categories(id) on delete cascade,
  title text not null,
  description text,
  channel_title text,
  channel_id text,
  thumbnail_url text,
  published_at timestamptz,
  view_count bigint default 0,
  like_count bigint default 0,
  duration_seconds int,
  summary text,                 -- AI-generated summary (OpenAI)
  summary_points text[],        -- bullet-point takeaways (aka "key steps")
  hook text,                    -- one-line attention-grabbing teaser
  tool_features text[],         -- AI tool features/capabilities mentioned in the video
  difficulty text,              -- 입문 | 초급 | 중급 | 고급
  takeaway text,                -- one-line closing takeaway
  transcript_lang text,         -- language of transcript used for summary, if any
  rank int,                     -- 1..10 position within its category
  status text not null default 'published' check (status in ('published','pending','excluded')),
  collected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_videos_category on videos(category_id);
create index if not exists idx_videos_rank on videos(category_id, rank);
create index if not exists idx_videos_status on videos(status);

-- ─────────────────────────────────────────────
-- excluded_videos: manual blocklist so the collector never re-adds them
-- ─────────────────────────────────────────────
create table if not exists excluded_videos (
  id uuid primary key default gen_random_uuid(),
  youtube_id text not null unique,
  reason text,
  excluded_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- guidebook_sections: editorial / how-to content shown alongside videos
-- ─────────────────────────────────────────────
create table if not exists guidebook_sections (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references categories(id) on delete cascade,
  slug text not null unique,
  title text not null,
  content_markdown text not null,
  source_video_ids uuid[] not null default '{}', -- videos.id this section was synthesized from
  sort_order int not null default 0,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_guidebook_category on guidebook_sections(category_id);

-- ─────────────────────────────────────────────
-- ads: self-served banner ads (image + link) shown on the site
-- ─────────────────────────────────────────────
create table if not exists ads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  placement text not null check (placement in (
    'home_top','home_bottom',
    'category_sidebar','category_sidebar_1','category_sidebar_2','category_sidebar_3','category_sidebar_4',
    'video_inline','video_list_bottom','guidebook_footer'
  )),
  image_url text not null,
  link_url text not null,
  alt_text text,
  is_active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_ads_placement on ads(placement, is_active);

-- ─────────────────────────────────────────────
-- updated_at trigger helper
-- ─────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_videos_updated_at on videos;
create trigger trg_videos_updated_at before update on videos
  for each row execute function set_updated_at();

drop trigger if exists trg_guidebook_updated_at on guidebook_sections;
create trigger trg_guidebook_updated_at before update on guidebook_sections
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────
-- Row Level Security: public read, writes only via service_role
-- ─────────────────────────────────────────────
alter table categories enable row level security;
alter table videos enable row level security;
alter table excluded_videos enable row level security;
alter table guidebook_sections enable row level security;
alter table ads enable row level security;

create policy "public read categories" on categories for select using (true);
create policy "public read published videos" on videos for select using (status = 'published');
create policy "public read published guidebook" on guidebook_sections for select using (is_published = true);
create policy "public read active ads" on ads for select using (is_active = true);
-- excluded_videos has no public policy: only service_role (which bypasses RLS) can read/write it.

-- ─────────────────────────────────────────────
-- site_visits: single-row visit counter, incremented via RPC from the (anon-key) site
-- ─────────────────────────────────────────────
create table if not exists site_visits (
  id smallint primary key default 1,
  count bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint site_visits_singleton check (id = 1)
);

insert into site_visits (id, count) values (1, 0) on conflict (id) do nothing;

alter table site_visits enable row level security;
create policy "public read site_visits" on site_visits for select using (true);
-- No insert/update policy: writes only happen via the SECURITY DEFINER function below.

create or replace function increment_site_visits()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count bigint;
begin
  update site_visits set count = count + 1, updated_at = now() where id = 1
  returning count into new_count;
  return new_count;
end;
$$;

grant execute on function increment_site_visits() to anon, authenticated;

-- ─────────────────────────────────────────────
-- increment_category_clicks: bumps categories.click_count, used to reorder
-- the left-hand category menu in the 3-panel app
-- ─────────────────────────────────────────────
create or replace function increment_category_clicks(p_slug text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count bigint;
begin
  update categories set click_count = click_count + 1 where slug = p_slug
  returning click_count into new_count;
  return new_count;
end;
$$;

grant execute on function increment_category_clicks(text) to anon, authenticated;
