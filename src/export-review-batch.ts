import fs from "node:fs";
import path from "node:path";
import { loadPendingFile, type PendingSummaryItem } from "./lib/pending-queue.js";
import { assessPublicSummary } from "./lib/summary-quality.js";
import { fetchTranscript } from "./lib/transcript.js";

export type QueueRow = PendingSummaryItem & {
  priority: number;
  quality_ok: boolean;
  quality_reasons: string[];
};

const OUT_DIR = path.join("data", "review-batch");

export function scorePendingItem(item: PendingSummaryItem): QueueRow {
  const quality = assessPublicSummary({ title: item.title, summary: item.fallback_summary });
  let priority = 0;
  if (item.category_slug && item.category_slug !== "trend") priority += 40;
  if (/[가-힣]/.test(item.title)) priority += 30;
  if (quality.ok) priority += 25;
  else priority -= 15;
  if (quality.reasons.includes("promo_or_signup") || quality.reasons.includes("link_only")) priority -= 60;
  priority += Math.min(20, Math.floor((item.description_excerpt?.length ?? 0) / 80));
  const queued = Date.parse(item.queued_at);
  if (Number.isFinite(queued)) priority += Math.max(0, 10 - Math.floor((Date.now() - queued) / 86_400_000));
  return { ...item, priority, quality_ok: quality.ok, quality_reasons: quality.reasons };
}

export function rankQueue(items: readonly PendingSummaryItem[]): QueueRow[] {
  return items.map(scorePendingItem).sort((a, b) => b.priority - a.priority || a.category_slug.localeCompare(b.category_slug));
}

async function main() {
  const fetchCaptions = process.argv.includes("--fetch-captions");
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const limit = Number(limitArg?.slice("--limit=".length) ?? 12);
  const pending = loadPendingFile();
  const ranked = rankQueue(pending.items);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const index = {
    generated_at: new Date().toISOString(),
    source: "data/pending-summaries.json",
    public_site: "https://ai-tools-site-liart-one.vercel.app",
    count: ranked.length,
    needs_summary: ranked.filter((item) => item.needs_summary).length,
    quality_fail: ranked.filter((item) => !item.quality_ok).length,
    items: ranked.map((item) => ({
      id: item.id,
      youtube_id: item.youtube_id,
      title: item.title,
      category_slug: item.category_slug,
      source_url: item.source_url,
      queued_at: item.queued_at,
      priority: item.priority,
      quality_ok: item.quality_ok,
      quality_reasons: item.quality_reasons,
      public_category_url: `https://ai-tools-site-liart-one.vercel.app/category/${item.category_slug}`,
    })),
  };
  fs.writeFileSync(path.join(OUT_DIR, "queue-index.json"), `${JSON.stringify(index, null, 2)}\n`);

  const batchItems = [];
  let captionsFound = 0;
  const selected = ranked.filter((item) => item.category_slug !== "trend").slice(0, limit);
  for (const item of selected) {
    let transcript: { lang: string; cues: { text: string; offsetSeconds: number }[]; text: string } | null = null;
    let transcript_error: string | null = null;
    if (fetchCaptions) {
      try {
        transcript = await fetchTranscript(item.youtube_id);
        if (transcript) captionsFound += 1;
      } catch (error) {
        transcript_error = error instanceof Error ? error.message : "caption fetch failed";
      }
    }
    batchItems.push({
      id: item.id,
      youtube_id: item.youtube_id,
      title: item.title,
      category_slug: item.category_slug,
      source_url: item.source_url,
      queued_at: item.queued_at,
      priority: item.priority,
      fallback_is_public_summary: item.quality_ok,
      quality_reasons: item.quality_reasons,
      description_excerpt: item.description_excerpt,
      caption_status: !fetchCaptions ? "not_requested" : transcript ? "available" : "unavailable",
      transcript_lang: transcript?.lang ?? null,
      transcript_text: transcript?.text ?? null,
      cues: transcript?.cues ?? [],
      transcript_error,
      draft_status: "pending_human_review",
    });
  }

  const batch = {
    generated_at: index.generated_at,
    note: "공개 대기열과 공개 자막만 사용했습니다. 이 파일은 초안 근거이며, 검토 전에는 완료로 표시하지 않습니다.",
    selected: batchItems.length,
    captions_requested: fetchCaptions,
    captions_available: captionsFound,
    captions_unavailable: fetchCaptions ? batchItems.length - captionsFound : null,
    items: batchItems,
  };
  fs.writeFileSync(path.join(OUT_DIR, "top-batch.json"), `${JSON.stringify(batch, null, 2)}\n`);

  const readme = `# 요약 검토 배치

이 폴더는 공개 대기열 \`data/pending-summaries.json\`에서 만들었습니다. 비공개 데이터베이스나 비밀 값은 넣지 않습니다.

- \`queue-index.json\`: 현재 대기 ${index.count}건. 품질 실패 ${index.quality_fail}건.
- \`top-batch.json\`: 트렌드 카테고리를 뺀 우선 ${batchItems.length}건.
- 자막을 받은 항목: ${captionsFound}. 자막이 없으면 \`caption_status\` 가 \`unavailable\` 이고 항목은 계속 대기입니다.
- 사람 검토 글을 데이터베이스에 넣으려면 \`data/filled-summaries.json\`에 적은 뒤 \`npm run apply-summaries\` 로 검증만 하고, 통과한 뒤에만 \`npm run apply-summaries -- --apply\` 를 실행합니다.
- \`--apply\` 는 \`data/backups/\` 에 원본 대기 파일을 복사한 다음 반영합니다. 검증에 실패한 항목은 대기에서 빠지지 않습니다.

공개 사이트: https://ai-tools-site-liart-one.vercel.app
`;
  fs.writeFileSync(path.join(OUT_DIR, "README.md"), readme);
  console.log(`대기 ${index.count}건, 상위 ${batchItems.length}건, 자막 ${captionsFound}건 -> ${OUT_DIR}`);
}

if (process.argv[1]?.includes("export-review-batch")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
