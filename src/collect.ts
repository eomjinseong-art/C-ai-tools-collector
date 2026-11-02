import "dotenv/config";
import { shouldReplaceSummary } from "./lib/collect-decision.js";
import {
  buildFallbackSummary,
  descriptionExcerpt,
  MIN_USEFUL_CHARS,
} from "./lib/fallback-summary.js";
import {
  dropFilledYoutubeIds,
  dropPendingYoutubeIds,
  enqueuePending,
  loadFilledFile,
  loadPendingFile,
  PENDING_RELATIVE_PATH,
  pendingCount,
  pendingItemId,
  retainPendingForCategory,
  saveFilledFile,
  savePendingFile,
  youtubeWatchUrl,
  type PendingSummaryItem,
} from "./lib/pending-queue.js";
import { supabase, type Category } from "./lib/supabase.js";
import { fetchTranscript } from "./lib/transcript.js";
import { searchVideos, fetchVideoDetails, type VideoDetails } from "./lib/youtube.js";

const MIN_DURATION_SECONDS = 60; // skip Shorts / low-effort clips

type ExistingVideoRow = {
  youtube_id: string;
  title: string;
  description: string | null;
  summary: string | null;
  summary_points: string[] | null;
  hook: string | null;
  tool_features: string[] | null;
  difficulty: string | null;
  takeaway: string | null;
  transcript_lang: string | null;
};

/** Simple "hot" ranking: popular AND recent beats either alone. */
function rankScore(video: VideoDetails): number {
  const publishedMs = new Date(video.published_at).getTime();
  const daysAgo = Math.max(0, (Date.now() - publishedMs) / 86_400_000);
  return video.view_count / Math.pow(daysAgo + 2, 1.4);
}

function asStringList(value: string[] | null | undefined): string[] {
  return Array.isArray(value) ? value : [];
}

async function collectCategory(category: Category, excludedIds: Set<string>): Promise<void> {
  console.log(`\n=== [${category.name}] 수집 시작 (키워드: ${category.search_keywords.join(", ")}) ===`);

  const foundIds = new Set<string>();
  for (const keyword of category.search_keywords) {
    try {
      const results = await searchVideos(keyword);
      for (const result of results) foundIds.add(result.videoId);
    } catch (err) {
      console.error(`  검색 실패 "${keyword}":`, err);
    }
  }

  const candidateIds = [...foundIds].filter((id) => !excludedIds.has(id));
  if (candidateIds.length === 0) {
    console.log("  후보 영상 없음, 스킵");
    return;
  }

  const details = (await fetchVideoDetails(candidateIds)).filter(
    (video) => video.duration_seconds >= MIN_DURATION_SECONDS,
  );

  const top = [...details].sort((a, b) => rankScore(b) - rankScore(a)).slice(0, category.target_video_count);
  console.log(`  후보 ${details.length}개 중 상위 ${top.length}개 선정`);

  const { data: existingRows, error: existingErr } = await supabase
    .from("videos")
    .select(
      "youtube_id, title, description, summary, summary_points, hook, tool_features, difficulty, takeaway, transcript_lang",
    )
    .eq("category_id", category.id);
  if (existingErr) throw existingErr;

  const existingByYoutubeId = new Map(
    ((existingRows ?? []) as ExistingVideoRow[]).map((row) => [row.youtube_id, row]),
  );
  const freshIds = new Set(top.map((video) => video.youtube_id));
  const existingIds = new Set((existingRows ?? []).map((row) => row.youtube_id as string));

  let queue = loadPendingFile();
  let filled = loadFilledFile();
  const keepIds = new Set([...existingIds, ...freshIds]);
  const beforeRetain = new Set(queue.items.map((item) => item.youtube_id));
  queue = retainPendingForCategory(queue, category.slug, keepIds);
  const ghostIds = [...beforeRetain].filter(
    (id) => !queue.items.some((item) => item.youtube_id === id),
  );
  filled = dropFilledYoutubeIds(filled, ghostIds);

  const upsertRows = [];
  let replaced = 0;
  for (const [index, video] of top.entries()) {
    const existing = existingByYoutubeId.get(video.youtube_id);
    const replace = shouldReplaceSummary(existing, video);
    const descriptionFallback = buildFallbackSummary({
      title: video.title,
      description: video.description,
    });

    let summary = existing?.summary ?? "";
    let summaryPoints = asStringList(existing?.summary_points);
    let hook = existing?.hook ?? "";
    let toolFeatures = asStringList(existing?.tool_features);
    let difficulty = existing?.difficulty ?? "";
    let takeaway = existing?.takeaway ?? "";
    let transcriptLang = existing?.transcript_lang ?? null;

    if (replace) {
      let built = descriptionFallback;
      let usedTranscript = false;
      if (built.source === "title" || built.summary.length < MIN_USEFUL_CHARS) {
        const transcript = await fetchTranscript(video.youtube_id);
        if (transcript?.text) {
          const withTranscript = buildFallbackSummary({
            title: video.title,
            description: video.description,
            transcript: transcript.text,
          });
          if (withTranscript.summary.length > built.summary.length) {
            built = withTranscript;
            transcriptLang = transcript.lang;
            usedTranscript = true;
          }
        }
      }
      if (!usedTranscript) transcriptLang = null;
      summary = built.summary;
      summaryPoints = built.summary_points;
      hook = built.hook;
      toolFeatures = built.tool_features;
      difficulty = built.difficulty;
      takeaway = built.takeaway;
      replaced += 1;
    }

    const storedSummary = existing?.summary ?? "";
    const queueThis = replace || storedSummary === descriptionFallback.summary;
    if (queueThis) {
      const item: PendingSummaryItem = {
        id: pendingItemId(video.youtube_id),
        needs_summary: true,
        kind: "video",
        youtube_id: video.youtube_id,
        title: video.title,
        category_slug: category.slug,
        source_url: youtubeWatchUrl(video.youtube_id),
        fallback_summary: summary,
        description_excerpt: descriptionExcerpt(video.description),
        queued_at: new Date().toISOString(),
      };
      queue = enqueuePending(queue, item);
    }

    upsertRows.push({
      youtube_id: video.youtube_id,
      category_id: category.id,
      title: video.title,
      description: video.description,
      channel_title: video.channel_title,
      channel_id: video.channel_id,
      thumbnail_url: video.thumbnail_url,
      published_at: video.published_at,
      view_count: video.view_count,
      like_count: video.like_count,
      duration_seconds: video.duration_seconds,
      summary,
      summary_points: summaryPoints,
      hook,
      tool_features: toolFeatures,
      difficulty,
      takeaway,
      transcript_lang: transcriptLang,
      rank: index + 1,
      status: "published" as const,
    });
  }

  savePendingFile(queue);
  saveFilledFile(filled);

  const idsToRemove = (existingRows ?? [])
    .map((row) => row.youtube_id as string)
    .filter((id) => !freshIds.has(id));
  if (idsToRemove.length > 0) {
    const { error: deleteErr } = await supabase
      .from("videos")
      .delete()
      .eq("category_id", category.id)
      .in("youtube_id", idsToRemove);
    if (deleteErr) throw deleteErr;
    queue = dropPendingYoutubeIds(queue, idsToRemove);
    filled = dropFilledYoutubeIds(filled, idsToRemove);
    savePendingFile(queue);
    saveFilledFile(filled);
    console.log(`  탈락 영상 ${idsToRemove.length}개 삭제`);
  }

  if (upsertRows.length > 0) {
    const { error: upsertErr } = await supabase.from("videos").upsert(upsertRows, { onConflict: "youtube_id" });
    if (upsertErr) throw upsertErr;
    console.log(`  ${upsertRows.length}개 영상 upsert 완료 (임시 요약 ${replaced}개)`);
  }
}

async function main() {
  const { data: categories, error: catErr } = await supabase
    .from("categories")
    .select("id, slug, name, search_keywords, is_trend, target_video_count")
    .order("sort_order");
  if (catErr) throw catErr;
  if (!categories || categories.length === 0) {
    console.log("카테고리가 없습니다. supabase/seed_categories.sql을 먼저 실행하세요.");
    return;
  }

  const { data: excludedRows, error: exclErr } = await supabase.from("excluded_videos").select("youtube_id");
  if (exclErr) throw exclErr;
  const excludedIds = new Set((excludedRows ?? []).map((row) => row.youtube_id as string));

  console.log(`카테고리 ${categories.length}개, 제외 영상 ${excludedIds.size}개 로드 완료`);

  for (const category of categories as Category[]) {
    try {
      await collectCategory(category, excludedIds);
    } catch (err) {
      console.error(`[${category.name}] 수집 중 오류:`, err);
    }
  }

  const waiting = pendingCount(loadPendingFile());
  console.log(`\n전체 수집 완료. 요약 대기 ${waiting}개 (${PENDING_RELATIVE_PATH})`);
}

main().catch((err) => {
  console.error("수집 스크립트 실패:", err);
  process.exit(1);
});
