import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { toVideoUpdate } from "./summary-fields.js";
import {
  dropFilledYoutubeIds,
  dropPendingYoutubeIds,
  emptyFilledFile,
  emptyPendingFile,
  enqueuePending,
  loadFilledFile,
  loadPendingFile,
  pendingCount,
  pendingItemId,
  planSummaryWrites,
  retainPendingForCategory,
  saveFilledFile,
  savePendingFile,
  withoutApplied,
  type FilledFile,
  type PendingFile,
  type PendingSummaryItem,
} from "./pending-queue.js";

function sampleItem(overrides: Partial<PendingSummaryItem> = {}): PendingSummaryItem {
  return {
    id: pendingItemId("yt-example-id1"),
    needs_summary: true,
    kind: "video",
    youtube_id: "yt-example-id1",
    title: "예시 영상",
    category_slug: "chatgpt",
    source_url: "https://www.youtube.com/watch?v=yt-example-id1",
    fallback_summary: "설명에서 잘라 둔 임시 요약입니다.",
    description_excerpt: "원본 설명",
    queued_at: "2026-11-02T00:00:00.000Z",
    ...overrides,
  };
}

test("enqueue keeps one row per video and preserves an editor summary", () => {
  const first = enqueuePending(emptyPendingFile(), sampleItem());
  const filled = enqueuePending(first, sampleItem({ title: "바뀐 제목" }));
  assert.equal(filled.items.length, 1);
  assert.equal(filled.items[0]?.title, "바뀐 제목");
  assert.equal(filled.items[0]?.queued_at, "2026-11-02T00:00:00.000Z");

  const withEditor = {
    ...filled,
    items: [{ ...filled.items[0]!, summary: "사람이 쓴 한국어 요약", needs_summary: false, hook: "한 줄" }],
  };
  const again = enqueuePending(withEditor, sampleItem({ fallback_summary: "새 임시 요약" }));
  assert.equal(again.items[0]?.summary, "사람이 쓴 한국어 요약");
  assert.equal(again.items[0]?.needs_summary, false);
  assert.equal(again.items[0]?.hook, "한 줄");
  assert.equal(again.items[0]?.fallback_summary, "새 임시 요약");
  assert.equal(pendingCount(again), 1);
});

test("plan applies a sibling file or an in-place summary and then clears both", () => {
  const pending = enqueuePending(emptyPendingFile(), sampleItem());
  pending.items[0]!.summary = "대기 파일 요약";
  const sibling = planSummaryWrites(pending, {
    ...emptyFilledFile(),
    items: [
      {
        id: "yt-example-id1",
        summary: "형제 파일에 쓴 요약",
        summary_points: ["포인트"],
        hook: "후킹",
        tool_features: ["기능"],
        difficulty: "초급",
        takeaway: "결론",
      },
    ],
  });
  assert.equal(sibling.writes.length, 1);
  assert.equal(sibling.writes[0]?.fields.summary, "형제 파일에 쓴 요약");
  assert.deepEqual(sibling.unmatchedFilledIds, []);
  assert.deepEqual(toVideoUpdate(sibling.writes[0]!.fields), {
    summary: "형제 파일에 쓴 요약",
    summary_points: ["포인트"],
    hook: "후킹",
    tool_features: ["기능"],
    difficulty: "초급",
    takeaway: "결론",
  });

  const cleared = withoutApplied(
    pending,
    { version: 1, items: [{ id: "youtube:yt-example-id1", summary: "형제 파일에 쓴 요약" }] },
    new Set([sibling.writes[0]!.id]),
  );
  assert.equal(cleared.pending.items.length, 0);
  assert.equal(cleared.filled.items.length, 0);

  const inPlace = enqueuePending(emptyPendingFile(), sampleItem());
  inPlace.items[0]!.summary = "대기 파일에 직접 쓴 요약";
  const direct = planSummaryWrites(inPlace, emptyFilledFile());
  assert.equal(direct.writes[0]?.fields.summary, "대기 파일에 직접 쓴 요약");
  assert.deepEqual(toVideoUpdate({ ...direct.writes[0]!.fields, hook: "", summary_points: [] }), {
    summary: "대기 파일에 직접 쓴 요약",
  });
});

test("a fallback alone is not treated as a filled summary", () => {
  const pending = enqueuePending(emptyPendingFile(), sampleItem());
  const plan = planSummaryWrites(pending, {
    ...emptyFilledFile(),
    items: [{ id: "other-video-id", summary: "   " }, { id: "missing-video-id", summary: "매칭 안 됨" }],
  });
  assert.equal(plan.writes.length, 0);
  assert.deepEqual(plan.unmatchedFilledIds, ["other-video-id", "missing-video-id"]);
});

test("category retain and id drops leave other videos in place", () => {
  const pending = {
    ...emptyPendingFile(),
    items: [sampleItem(), sampleItem({ id: "youtube:yt-example-id2", youtube_id: "yt-example-id2", category_slug: "claude" })],
  };
  const retained = retainPendingForCategory(pending, "chatgpt", new Set(["yt-example-id1"]));
  assert.equal(retained.items.length, 2);
  const removed = dropPendingYoutubeIds(retained, ["yt-example-id1"]);
  assert.deepEqual(removed.items.map((item) => item.youtube_id), ["yt-example-id2"]);
  const filled = dropFilledYoutubeIds(
    { version: 1, items: [{ id: "youtube:yt-example-id1", summary: "지움" }, { id: "yt-example-id2", summary: "남김" }] },
    ["yt-example-id1"],
  );
  assert.deepEqual(filled.items.map((item) => item.id), ["yt-example-id2"]);
});

test("the documented examples apply into a video row", () => {
  const doc = fs.readFileSync(path.join(process.cwd(), "docs", "CONTENT_QUEUE.md"), "utf8");
  const blocks = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]) as unknown);
  assert.equal(blocks.length, 3);

  const pending = blocks[0] as PendingFile;
  const filled = blocks[1] as FilledFile;
  const fromFile = planSummaryWrites(pending, filled);
  assert.equal(fromFile.writes.length, 1);
  assert.equal(fromFile.writes[0]?.youtube_id, "ytExample01");
  assert.equal(fromFile.writes[0]?.fields.difficulty, "초급");
  assert.match(fromFile.writes[0]?.fields.summary ?? "", /보고서 초안/);
  assert.deepEqual(fromFile.unmatchedFilledIds, []);

  const inPlace = blocks[2] as PendingSummaryItem;
  assert.equal(inPlace.needs_summary, false);
  const direct = planSummaryWrites({ version: 1, items: [inPlace] }, emptyFilledFile());
  assert.equal(direct.writes[0]?.fields.summary, fromFile.writes[0]?.fields.summary);
  assert.equal(direct.writes[0]?.fields.hook, fromFile.writes[0]?.fields.hook);
});

test("the committed queue file parses and does not have to be empty", () => {
  const pending = loadPendingFile();
  assert.equal(pending.version, 1);
  assert.ok(pendingCount(pending) >= 0);
  for (const item of pending.items) {
    assert.equal(item.needs_summary, true);
    assert.ok(item.youtube_id.length >= 6);
  }
  assert.equal(loadFilledFile().version, 1);
});

test("round-trips the pending file and derives youtube_id from the id", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summary-queue-"));
  const pending = enqueuePending(emptyPendingFile(), sampleItem({ summary: "저장된 요약" }));
  savePendingFile(pending, root);
  saveFilledFile(emptyFilledFile(), root);
  const loaded = loadPendingFile(root);
  assert.equal(loaded.items[0]?.summary, "저장된 요약");
  assert.equal(loaded.items[0]?.youtube_id, "yt-example-id1");

  const loose = {
    version: 1,
    items: [{ id: "youtube:yt-example-id3", title: "아이디만", needs_summary: true }],
  };
  fs.writeFileSync(path.join(root, "data", "pending-summaries.json"), `${JSON.stringify(loose)}\n`);
  const derived = loadPendingFile(root);
  assert.equal(derived.items[0]?.youtube_id, "yt-example-id3");
  assert.equal(derived.version, 1);
});
