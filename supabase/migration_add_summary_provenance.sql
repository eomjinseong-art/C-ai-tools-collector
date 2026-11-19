-- Nullable provenance for summaries. Does not delete or rewrite existing rows.
-- Run this in the Supabase SQL editor before deploying the site, and deploy the collector after the site.
-- If these columns are missing, the collector omits them and keeps a summary that already passes.
-- npm run apply-summaries -- --apply refuses to update any row until the columns exist.

alter table videos add column if not exists summary_source text;
alter table videos add column if not exists summary_generated_at timestamptz;
alter table videos add column if not exists summary_verified_at timestamptz;
alter table videos add column if not exists source_cues jsonb;
alter table videos add column if not exists useful_facts text[];
alter table videos add column if not exists costs text;
alter table videos add column if not exists limitations text;

alter table videos drop constraint if exists videos_summary_source_check;
alter table videos
  add constraint videos_summary_source_check
  check (summary_source is null or summary_source in ('description', 'transcript', 'reviewed'));

-- Rank 1..target_video_count is the current recommendation.
-- Rank 1000 means the row was kept as archive instead of being deleted.
-- status = 'excluded' remains the explicit blocklist. Rows are not removed.
