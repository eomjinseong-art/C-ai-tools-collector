import "dotenv/config";
import { toVideoUpdate } from "./lib/summary-fields.js";
import {
  loadFilledFile,
  loadPendingFile,
  planSummaryWrites,
  saveFilledFile,
  savePendingFile,
  withoutApplied,
} from "./lib/pending-queue.js";

/**
 * Copy filled Korean summaries into Supabase, then remove those items from the queue.
 * Looks at data/filled-summaries.json and at summary fields written into data/pending-summaries.json.
 */
async function main() {
  const pending = loadPendingFile();
  const filled = loadFilledFile();
  const plan = planSummaryWrites(pending, filled);

  for (const id of plan.unmatchedFilledIds) {
    console.warn(`대기 목록에 없는 작성 항목이라 건너뜀: ${id}`);
  }

  if (plan.writes.length === 0) {
    console.log("적용할 요약이 없습니다.");
    return;
  }

  const { supabase } = await import("./lib/supabase.js");
  const appliedIds = new Set<string>();

  for (const write of plan.writes) {
    const update = toVideoUpdate(write.fields);
    const { data, error } = await supabase
      .from("videos")
      .update(update)
      .eq("youtube_id", write.youtube_id)
      .select("youtube_id");
    if (error) throw error;
    if (!data || data.length === 0) {
      console.warn(`DB에 없는 영상이라 대기 목록에 유지: ${write.youtube_id}`);
      continue;
    }
    appliedIds.add(write.id);
    console.log(`적용: ${write.youtube_id}`);
  }

  const next = withoutApplied(pending, filled, appliedIds);
  savePendingFile(next.pending);
  saveFilledFile(next.filled);
  console.log(`요약 ${appliedIds.size}개 반영, 대기 ${next.pending.items.length}개 남음`);
}

main().catch((err) => {
  console.error("요약 적용 실패:", err);
  process.exit(1);
});
