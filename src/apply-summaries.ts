import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { buildReviewedUpdate, evaluateSummaryPlan } from "./lib/summary-import.js";
import { isMissingColumnError } from "./lib/provenance.js";
import {
  FILLED_RELATIVE_PATH,
  PENDING_RELATIVE_PATH,
  loadFilledFile,
  loadPendingFile,
  saveFilledFile,
  savePendingFile,
  withoutApplied,
} from "./lib/pending-queue.js";

export function applyRequested(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): boolean {
  return argv.includes("--apply") || env.APPLY_SUMMARIES === "1";
}

export function backupQueues(root: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(root, "data", "backups", stamp);
  fs.mkdirSync(dir, { recursive: true });
  for (const relative of [PENDING_RELATIVE_PATH, FILLED_RELATIVE_PATH]) {
    const source = path.join(root, relative);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(dir, path.basename(relative)));
  }
  return dir;
}

/**
 * Dry-run unless --apply or APPLY_SUMMARIES=1.
 * Unapproved drafts and invalid rows stay pending and are not marked reviewed.
 * --apply refuses to write when the provenance columns are missing.
 */
async function main() {
  const pending = loadPendingFile();
  const filled = loadFilledFile();
  const decision = evaluateSummaryPlan(pending, filled);

  for (const id of decision.unmatchedFilledIds) {
    console.warn(`대기 목록에 없는 작성 항목이라 건너뜀: ${id}`);
  }
  for (const item of decision.rejected) {
    console.warn(`검증 실패, 대기 유지 ${item.youtube_id}: ${item.reasons.join(", ")}`);
  }
  if (decision.publishBlocked) {
    console.warn(`공개 반영 불가: ${decision.blockers.join(", ")}. 검토됨으로 표시하지 않습니다.`);
  }
  console.log(
    `검증 통과 ${decision.accepted.length}개, 거절 ${decision.rejected.length}개, 대기 ${pending.items.length}개`,
  );
  if (!applyRequested(process.argv.slice(2))) {
    console.log("dry-run 입니다. 데이터베이스는 바꾸지 않습니다. 반영하려면 --apply 를 붙이세요.");
    return;
  }
  if (decision.publishBlocked || decision.accepted.length === 0) {
    console.log("반영할 승인된 요약이 없습니다.");
    return;
  }

  const { supabase } = await import("./lib/supabase.js");
  const probe = await supabase.from("videos").select("summary_source").limit(1);
  if (probe.error) {
    if (isMissingColumnError(probe.error)) {
      throw new Error(
        "summary provenance 컬럼이 없습니다. supabase/migration_add_summary_provenance.sql 을 먼저 실행하세요. 행은 바꾸지 않았습니다.",
      );
    }
    throw probe.error;
  }

  const backup = backupQueues(process.cwd());
  console.log(`원본 대기 파일을 복사했습니다: ${backup}`);

  const appliedIds = new Set<string>();
  const verifiedAt = new Date().toISOString();

  for (const write of decision.accepted) {
    const update = buildReviewedUpdate(write.value, verifiedAt);
    const { data, error } = await supabase
      .from("videos")
      .update(update)
      .eq("youtube_id", write.youtube_id)
      .select("youtube_id");
    if (error) {
      if (isMissingColumnError(error)) {
        throw new Error("summary provenance 컬럼이 없습니다. 반영을 멈추고 대기 파일은 그대로 둡니다.");
      }
      throw error;
    }
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

const entry = process.argv[1]?.replaceAll("\\", "/");
if (entry && /\/apply-summaries\.ts$/.test(entry)) {
  main().catch((err) => {
    console.error("요약 적용 실패:", err);
    process.exit(1);
  });
}
