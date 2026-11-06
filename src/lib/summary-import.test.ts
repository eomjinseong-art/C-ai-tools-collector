import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cuesFromSegments, cueOffsetUnit } from "./transcript.js";
import { buildReviewedUpdate, evaluateSummaryPlan, validateReviewedImport } from "./summary-import.js";
import { emptyFilledFile, emptyPendingFile, loadFilledFile, pendingItemId, saveFilledFile, type PendingSummaryItem } from "./pending-queue.js";

const TITLE = "챗GPT로 보고서 초안 만들기";

test("reviewed import rejects promo and accepts two real steps", () => {
  const rejected = validateReviewedImport(
    {
      summary: "신청링크에서 무료 특강 라이브 예정을 안내합니다. 구독과 좋아요도 부탁드립니다.",
      summary_points: ["신청링크를 누르세요", "구독과 좋아요를 누르세요"],
      hook: "신청링크",
      tool_features: [],
      difficulty: "",
      takeaway: "신청링크",
    },
    TITLE,
  );
  assert.equal(rejected.ok, false);

  const accepted = validateReviewedImport(
    {
      summary: "이 영상은 챗GPT로 보고서 초안을 만드는 과정을 보여 줍니다. 자료를 붙인 뒤 문단 구성과 말투를 고치는 순서로 진행합니다.",
      summary_points: ["자료를 먼저 붙이고 초안을 받는다", "문단 순서와 말투를 이어서 고친다"],
      hook: "보고서 초안, 빈 페이지에서 시작하지 않아도 됩니다",
      tool_features: ["대화로 초안 작성"],
      difficulty: "초급",
      takeaway: "자료를 붙인 뒤 문단과 사실 여부를 따로 고칩니다",
      costs: "무료 플랜과 유료 플랜이 있다고만 말합니다.",
      limitations: "영상은 최신 화면과 다를 수 있습니다.",
      source_cues: [{ text: "자료를 붙이는 화면", offsetSeconds: 95 }],
    },
    TITLE,
  );
  assert.equal(accepted.ok, true);
  if (accepted.ok) {
    assert.equal(accepted.value.summary_source, "reviewed");
    assert.equal(accepted.value.source_cues?.[0]?.offsetSeconds, 95);
  }
});

test("classic captions stay in seconds and millisecond tracks convert once", () => {
  assert.equal(
    cueOffsetUnit([
      { text: "처음 화면", offset: 12.2, duration: 2.5 },
      { text: "나중 화면", offset: 95, duration: 3 },
    ]),
    "seconds",
  );
  const classic = cuesFromSegments([
    { text: "처음 화면", offset: 12.2, duration: 2.5 },
    { text: "시간 없음" },
    { text: "나중 화면", offset: 95, duration: 3 },
  ]);
  assert.deepEqual(classic, [
    { text: "처음 화면", offsetSeconds: 12 },
    { text: "나중 화면", offsetSeconds: 95 },
  ]);

  assert.equal(
    cueOffsetUnit([
      { text: "시작", offset: 400, duration: 80 },
      { text: "중간", offset: 5000, duration: 1500 },
      { text: "끝", offset: 90000, duration: 2000 },
    ]),
    "milliseconds",
  );
  const srv3 = cuesFromSegments([
    { text: "시작", offset: 400, duration: 80 },
    { text: "중간", offset: 5000, duration: 1500 },
    { text: "끝", offset: 90000, duration: 2000 },
  ]);
  assert.deepEqual(srv3, [
    { text: "시작", offsetSeconds: 0 },
    { text: "중간", offsetSeconds: 5 },
    { text: "끝", offsetSeconds: 90 },
  ]);
});

test("an unapproved draft file is not marked reviewed", () => {
  const pendingItem: PendingSummaryItem = {
    id: pendingItemId("ytExample01"),
    needs_summary: true,
    kind: "video",
    youtube_id: "ytExample01",
    title: TITLE,
    category_slug: "chatgpt",
    source_url: "https://www.youtube.com/watch?v=ytExample01",
    fallback_summary: "임시",
    description_excerpt: "임시",
    queued_at: "2026-11-02T00:00:00.000Z",
  };
  const fields = {
    summary: "이 영상은 챗GPT로 보고서 초안을 만드는 과정을 보여 줍니다. 자료를 붙인 뒤 문단 구성과 말투를 고치는 순서로 진행합니다.",
    summary_points: ["자료를 먼저 붙이고 초안을 받는다", "문단 순서와 말투를 이어서 고친다"],
    hook: "보고서 초안, 빈 페이지에서 시작하지 않아도 됩니다",
    tool_features: ["대화로 초안 작성"],
    difficulty: "초급",
    takeaway: "자료를 붙인 뒤 문단과 사실 여부를 따로 고칩니다",
  };
  const decision = evaluateSummaryPlan(
    { ...emptyPendingFile(), items: [pendingItem] },
    {
      ...emptyFilledFile(),
      editorial_meta: { human_reviewed: false, user_approved: false, deployed: false },
      items: [{ id: "youtube:ytExample01", ...fields }],
    },
  );
  assert.equal(decision.publishBlocked, true);
  assert.deepEqual(decision.accepted, []);
  assert.equal(decision.items[0]?.importer_ok, true);
  assert.equal(decision.items[0]?.would_mark_reviewed, false);
  assert.equal(decision.items[0]?.summary_source, null);
  assert.ok(decision.items[0]?.reasons.includes("human_reviewed_false"));
  assert.ok(decision.items[0]?.reasons.includes("user_approved_false"));
  assert.ok(decision.items[0]?.reasons.includes("not_approved_for_publish"));

  const itemRejected = validateReviewedImport({ ...fields, human_reviewed: false, user_approved: false }, TITLE);
  assert.equal(itemRejected.ok, false);

  const approved = validateReviewedImport(fields, TITLE);
  assert.equal(approved.ok, true);
  if (approved.ok) {
    const update = buildReviewedUpdate(approved.value, "2026-11-06T01:00:00.000Z");
    assert.equal(update.summary_source, "reviewed");
    assert.equal(update.summary_verified_at, "2026-11-06T01:00:00.000Z");
    assert.equal("source_cues" in update, false);
  }
});

test("invalid cue lists are rejected instead of being rewritten", () => {
  const rejected = validateReviewedImport(
    {
      summary: "이 영상은 챗GPT로 보고서 초안을 만드는 과정을 보여 줍니다. 자료를 붙인 뒤 문단 구성과 말투를 고치는 순서로 진행합니다.",
      summary_points: ["자료를 먼저 붙이고 초안을 받는다", "문단 순서와 말투를 이어서 고친다"],
      hook: "후킹",
      tool_features: [],
      difficulty: "초급",
      takeaway: "자료를 확인합니다",
      source_cues: [{ text: "화면", offsetSeconds: Number.NaN }],
      source_cues_invalid: true,
    },
    TITLE,
  );
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.ok(rejected.reasons.includes("invalid_source_cues"));
});

test("a draft file on disk keeps its approval flags and is not publishable", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "draft-import-"));
  saveFilledFile(
    {
      version: 1,
      note: "DRAFT-ONLY",
      editorial_meta: { human_reviewed: false, user_approved: false, deployed: false },
      items: [],
    },
    root,
  );
  const loaded = loadFilledFile(root);
  assert.equal(loaded.editorial_meta?.human_reviewed, false);
  assert.equal(loaded.editorial_meta?.user_approved, false);
  assert.equal(loaded.editorial_meta?.deployed, false);
});
