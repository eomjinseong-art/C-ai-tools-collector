import "dotenv/config";
import { shouldReplaceSummary } from "./lib/collect-decision.js";
import { buildFallbackSummary, descriptionExcerpt } from "./lib/fallback-summary.js";
import {
  VIDEO_BASE_COLUMNS,
  VIDEO_COLUMNS_WITH_PROVENANCE,
  isMissingColumnError,
  rowsForSchema,
} from "./lib/provenance.js";
import { selectRankedTop } from "./lib/ranking.js";
import { ARCHIVE_RANK, planCategoryRetention } from "./lib/retention.js";
import {
  decideStoredSummary,
  emptyStoredSummary,
  parseSummarySource,
  readSourceCues,
  type StoredSummaryFields,
} from "./lib/summary-quality.js";
import {
  dropFilledYoutubeIds,
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
import { searchVideos, fetchVideoDetails } from "./lib/youtube.js";

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
  summary_source?: string | null;
  summary_generated_at?: string | null;
  summary_verified_at?: string | null;
  source_cues?: unknown;
  useful_facts?: string[] | null;
  costs?: string | null;
  limitations?: string | null;
};

function asStringList(value: string[] | null | undefined): string[] {
  return Array.isArray(value) ? value : [];
}

function storedFromRow(row: ExistingVideoRow, provenanceKnown: boolean): StoredSummaryFields {
  const cues = provenanceKnown ? readSourceCues(row.source_cues) : { cues: null, invalid: false };
  return {
    ...emptyStoredSummary(),
    summary: row.summary ?? "",
    summary_points: asStringList(row.summary_points),
    hook: row.hook ?? "",
    tool_features: asStringList(row.tool_features),
    difficulty: row.difficulty ?? "",
    takeaway: row.takeaway ?? "",
    transcript_lang: row.transcript_lang ?? null,
    summary_source: provenanceKnown ? parseSummarySource(row.summary_source) : null,
    summary_generated_at: provenanceKnown ? row.summary_generated_at ?? null : null,
    summary_verified_at: provenanceKnown ? row.summary_verified_at ?? null : null,
    source_cues: cues.invalid ? null : cues.cues,
    useful_facts: provenanceKnown ? asStringList(row.useful_facts) : [],
    costs: provenanceKnown ? row.costs ?? "" : "",
    limitations: provenanceKnown ? row.limitations ?? "" : "",
  };
}

function provenancePayload(stored: StoredSummaryFields): Record<string, unknown> {
  const keepCues = stored.summary_source === "transcript" || stored.summary_source === "reviewed";
  return {
    summary_source: stored.summary_source,
    summary_generated_at: stored.summary_generated_at,
    summary_verified_at: stored.summary_verified_at,
    source_cues: keepCues ? stored.source_cues : null,
    useful_facts: stored.useful_facts,
    costs: stored.costs.trim() ? stored.costs.trim() : null,
    limitations: stored.limitations.trim() ? stored.limitations.trim() : null,
  };
}

async function loadExistingVideos(categoryId: string): Promise<{
  rows: ExistingVideoRow[];
  provenanceWritable: boolean;
}> {
  const withProvenance = await supabase
    .from("videos")
    .select(VIDEO_COLUMNS_WITH_PROVENANCE)
    .eq("category_id", categoryId);
  if (!withProvenance.error) {
    return { rows: (withProvenance.data ?? []) as unknown as ExistingVideoRow[], provenanceWritable: true };
  }
  if (!isMissingColumnError(withProvenance.error)) throw withProvenance.error;
  console.warn("  summary provenance 컬럼이 없습니다. 컬럼 없이 이어가고, 통과한 기존 요약은 덮어쓰지 않습니다.");
  const base = await supabase.from("videos").select(VIDEO_BASE_COLUMNS).eq("category_id", categoryId);
  if (base.error) throw base.error;
  return { rows: (base.data ?? []) as unknown as ExistingVideoRow[], provenanceWritable: false };
}

async function collectCategory(category: Category, excludedIds: Set<string>): Promise<void> {
  console.log(`\n=== [${category.name}] 수집 시작 (키워드: ${category.search_keywords.join(", ")}) ===`);

  const foundIds = new Set<string>();
  let searchOk = false;
  for (const keyword of category.search_keywords) {
    try {
      const results = await searchVideos(keyword);
      searchOk = true;
      for (const result of results) foundIds.add(result.videoId);
    } catch (err) {
      console.error(`  검색 실패 "${keyword}":`, err);
    }
  }

  if (!searchOk) {
    console.log("  검색 결과를 받지 못해 기존 행은 그대로 둡니다");
    return;
  }

  const candidateIds = [...foundIds].filter((id) => !excludedIds.has(id));
  const details = candidateIds.length
    ? await fetchVideoDetails(candidateIds)
    : [];
  const top = selectRankedTop(details, category.target_video_count, excludedIds, Date.now());
  console.log(`  후보 ${details.length}개 중 상위 ${top.length}개 선정`);

  const { rows: existingRows, provenanceWritable } = await loadExistingVideos(category.id);

  const existingByYoutubeId = new Map(existingRows.map((row) => [row.youtube_id, row]));
  const freshIds = new Set(top.map((video) => video.youtube_id));
  const existingIds = new Set(existingRows.map((row) => row.youtube_id));

  let queue = loadPendingFile();
  let filled = loadFilledFile();
  const keepIds = new Set([...existingIds, ...freshIds]);
  const beforeRetain = new Set(queue.items.map((item) => item.youtube_id));
  queue = retainPendingForCategory(queue, category.slug, keepIds);
  const ghostIds = [...beforeRetain].filter((id) => !queue.items.some((item) => item.youtube_id === id));
  filled = dropFilledYoutubeIds(filled, ghostIds);

  const upsertRows: Record<string, unknown>[] = [];
  let replaced = 0;
  for (const [index, video] of top.entries()) {
    const existing = existingByYoutubeId.get(video.youtube_id);
    const replace = shouldReplaceSummary(existing, video);
    const descriptionFallback = buildFallbackSummary({
      title: video.title,
      description: video.description,
    });

    let stored: StoredSummaryFields = existing
      ? storedFromRow(existing, provenanceWritable)
      : emptyStoredSummary();
    let queueThis = false;
    let evidence = descriptionFallback.summary;

    if (replace) {
      let candidate = descriptionFallback;
      let cues = null;
      let transcriptLang: string | null = null;
      const transcript = await fetchTranscript(video.youtube_id);
      if (transcript?.text) {
        const fromCaption = buildFallbackSummary({
          title: video.title,
          description: video.description,
          transcript: transcript.text,
        });
        if (fromCaption.source === "transcript") {
          candidate = fromCaption;
          cues = transcript.cues;
          transcriptLang = transcript.lang;
        }
      }
      const decision = decideStoredSummary({
        title: video.title,
        existing: stored,
        candidate,
        cues,
        transcriptLang,
        now: new Date().toISOString(),
        provenanceKnown: provenanceWritable,
      });
      stored = decision;
      queueThis = decision.queueForReview;
      evidence = candidate.summary || descriptionFallback.summary;
      if (decision.wroteCandidate) replaced += 1;
    }

    if (queueThis) {
      const item: PendingSummaryItem = {
        id: pendingItemId(video.youtube_id),
        needs_summary: true,
        kind: "video",
        youtube_id: video.youtube_id,
        title: video.title,
        category_slug: category.slug,
        source_url: youtubeWatchUrl(video.youtube_id),
        fallback_summary: evidence,
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
      summary: stored.summary,
      summary_points: stored.summary_points,
      hook: stored.hook,
      tool_features: stored.tool_features,
      difficulty: stored.difficulty,
      takeaway: stored.takeaway,
      transcript_lang: replace ? stored.transcript_lang : existing?.transcript_lang ?? null,
      rank: index + 1,
      status: "published",
      ...(replace && provenanceWritable ? provenancePayload(stored) : {}),
    });
  }

  savePendingFile(queue);
  saveFilledFile(filled);

  const retention = planCategoryRetention(
    existingRows.map((row) => row.youtube_id),
    top.map((video) => video.youtube_id),
    excludedIds,
  );
  if (retention.demoteIds.length > 0) {
    const { error: demoteErr } = await supabase
      .from("videos")
      .update({ rank: ARCHIVE_RANK })
      .eq("category_id", category.id)
      .in("youtube_id", retention.demoteIds);
    if (demoteErr) throw demoteErr;
    console.log(`  추천 밖 영상 ${retention.demoteIds.length}개를 보관으로 유지`);
  }
  if (retention.excludeIds.length > 0) {
    const { error: excludeErr } = await supabase
      .from("videos")
      .update({ status: "excluded", rank: ARCHIVE_RANK })
      .eq("category_id", category.id)
      .in("youtube_id", retention.excludeIds);
    if (excludeErr) throw excludeErr;
    console.log(`  제외 목록 영상 ${retention.excludeIds.length}개를 삭제하지 않고 숨김`);
  }

  if (upsertRows.length > 0) {
    const first = await supabase
      .from("videos")
      .upsert(rowsForSchema(upsertRows, provenanceWritable), { onConflict: "youtube_id" });
    if (first.error && provenanceWritable && isMissingColumnError(first.error)) {
      console.warn("  provenance 컬럼이 없어 그 값을 빼고 다시 저장합니다.");
      const retry = await supabase.from("videos").upsert(rowsForSchema(upsertRows, false), { onConflict: "youtube_id" });
      if (retry.error) throw retry.error;
    } else if (first.error) {
      throw first.error;
    }
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
