import "dotenv/config";
import { supabase } from "./lib/supabase.js";
import { fetchTranscript } from "./lib/transcript.js";
import { summarizeVideo } from "./lib/summarize.js";

/**
 * One-off backfill: re-summarize only videos that are missing `hook` (old-schema
 * rows never reprocessed) or that still have a corrupted raw-JSON `summary` blob.
 * Does NOT touch YouTube search/collection — avoids burning API quota for a fix
 * that's purely about re-running the OpenAI summarization step.
 */
async function main() {
  const { data: rows, error } = await supabase
    .from("videos")
    .select("id, youtube_id, title, description")
    .or("hook.is.null,hook.eq.,summary.ilike.{%")
    .eq("status", "published");
  if (error) throw error;

  const targets = rows ?? [];
  console.log(`재요약 대상: ${targets.length}개`);

  let done = 0;
  let failed = 0;
  for (const video of targets) {
    try {
      const transcript = await fetchTranscript(video.youtube_id);
      const result = await summarizeVideo({
        title: video.title,
        description: video.description ?? "",
        transcript: transcript?.text,
      });

      if (!result.hook && !result.summary) {
        console.warn(`  스킵 (요약 실패, 다음 실행에서 재시도): ${video.title}`);
        failed++;
        continue;
      }

      const { error: updateErr } = await supabase
        .from("videos")
        .update({
          summary: result.summary,
          summary_points: result.summary_points,
          hook: result.hook,
          tool_features: result.tool_features,
          difficulty: result.difficulty,
          takeaway: result.takeaway,
          transcript_lang: transcript?.lang ?? null,
        })
        .eq("id", video.id);
      if (updateErr) throw updateErr;

      done++;
      console.log(`  [${done}/${targets.length}] 완료: ${video.title}`);
    } catch (err) {
      failed++;
      console.error(`  실패: ${video.title}`, err);
    }
  }

  console.log(`\n재요약 완료: 성공 ${done}개, 실패 ${failed}개`);
}

main().catch((err) => {
  console.error("재요약 스크립트 실패:", err);
  process.exit(1);
});
