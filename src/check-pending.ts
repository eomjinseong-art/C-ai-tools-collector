import "dotenv/config";
import { syncPendingAlert } from "./lib/pending-alert.js";
import { PENDING_RELATIVE_PATH, loadPendingFile, pendingCount } from "./lib/pending-queue.js";

async function main() {
  const count = pendingCount(loadPendingFile());
  console.log(`요약 대기 ${count}개 (${PENDING_RELATIVE_PATH})`);
  const result = await syncPendingAlert({
    count,
    token: process.env.GITHUB_TOKEN,
    repository: process.env.GITHUB_REPOSITORY,
  });
  console.log(`이슈 확인: ${result}`);
  if (result === "missing-token" && process.env.GITHUB_ACTIONS === "true") {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("대기 확인 실패:", err);
  process.exit(1);
});
