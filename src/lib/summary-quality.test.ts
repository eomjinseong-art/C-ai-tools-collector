import assert from "node:assert/strict";
import test from "node:test";
import { assessPublicSummary, decideStoredSummary, emptyStoredSummary } from "./summary-quality.js";

const GOOD = "챗GPT에 자료를 붙인 뒤 문단 순서를 먼저 고칩니다. 마지막에는 날짜와 숫자를 원문과 비교합니다.";

test("promo, title copy, and repeated lines are not public summaries", () => {
  const promo = assessPublicSummary({
    title: "챗GPT 강의",
    summary: "🎓 무료 3시간 AI 특강 | 12월 라이브 예정 오늘 본 편집기·프로그램·자동화, 상상하는 모든 걸 처음부터 같이 만들어 봅시다! ▶️신청링크",
  });
  assert.equal(promo.ok, false);
  assert.ok(promo.reasons.includes("promo_or_signup"));

  const title = "브루(Vrew)를 활용한 쉽고 편한 유튜브 영상편집 - 01차시 : 프로젝트 만들기";
  const copied = assessPublicSummary({
    title,
    summary: title,
    summaryPoints: [title],
    hook: title,
    takeaway: title,
  });
  assert.equal(copied.ok, false);
  assert.ok(copied.reasons.includes("title_copy") || copied.reasons.includes("repeated_lines"));
  assert.equal(assessPublicSummary({ title: "다른 제목", summary: GOOD }).ok, true);
});

test("a failed candidate does not replace a summary that already passes", () => {
  const existing = {
    ...emptyStoredSummary(),
    summary: GOOD,
    summary_points: ["자료를 붙입니다", "숫자를 원문과 비교합니다"],
    hook: "빈 페이지에서 시작하지 않아도 됩니다",
    takeaway: "날짜와 숫자는 따로 확인합니다",
    summary_source: "reviewed" as const,
    summary_verified_at: "2026-11-02T00:00:00.000Z",
  };
  const decision = decideStoredSummary({
    title: "보고서",
    existing,
    candidate: {
      summary: "신청링크에서 무료 특강 라이브 예정",
      summary_points: ["신청링크에서 무료 특강 라이브 예정"],
      hook: "신청링크",
      tool_features: [],
      difficulty: "",
      takeaway: "신청링크",
      source: "description",
    },
    cues: null,
    transcriptLang: null,
    now: "2026-11-06T00:00:00.000Z",
  });
  assert.equal(decision.wroteCandidate, false);
  assert.equal(decision.summary, GOOD);
  assert.equal(decision.queueForReview, false);
});

test("a reviewed summary stays even when a better automatic candidate arrives", () => {
  const existing = {
    ...emptyStoredSummary(),
    summary: "신청링크에서 무료 특강 라이브 예정을 안내한 뒤 자료 붙이는 순서를 따로 보여 줍니다.",
    summary_points: ["자료를 붙입니다", "문단을 고칩니다"],
    hook: "신청링크",
    takeaway: "구독과 좋아요",
    summary_source: "reviewed" as const,
    summary_verified_at: "2026-11-02T00:00:00.000Z",
    source_cues: [{ text: "자료 화면", offsetSeconds: 40 }],
  };
  const decision = decideStoredSummary({
    title: "보고서",
    existing,
    candidate: {
      summary: GOOD,
      summary_points: ["자료를 붙인 뒤 문단 순서를 고칩니다", "날짜와 숫자를 원문과 비교합니다"],
      hook: "빈 페이지에서 시작하지 않아도 됩니다",
      tool_features: [],
      difficulty: "",
      takeaway: "날짜와 숫자는 따로 확인합니다",
      source: "transcript",
    },
    cues: [{ text: "다른 자막", offsetSeconds: 3 }],
    transcriptLang: "ko",
    now: "2026-11-06T00:00:00.000Z",
  });
  assert.equal(decision.wroteCandidate, false);
  assert.equal(decision.summary, existing.summary);
  assert.equal(decision.summary_verified_at, "2026-11-02T00:00:00.000Z");
  assert.equal(decision.source_cues?.[0]?.offsetSeconds, 40);
  assert.equal(decision.queueForReview, false);
});

test("a passing transcript summary is not downgraded to a description excerpt", () => {
  const existing = {
    ...emptyStoredSummary(),
    summary: GOOD,
    summary_points: ["자료를 붙인 뒤 문단 순서를 고칩니다", "날짜와 숫자를 원문과 비교합니다"],
    hook: "빈 페이지에서 시작하지 않아도 됩니다",
    takeaway: "날짜와 숫자는 따로 확인합니다",
    summary_source: "transcript" as const,
    summary_generated_at: "2026-11-03T00:00:00.000Z",
    source_cues: [{ text: "자료 화면", offsetSeconds: 40 }],
    transcript_lang: "ko",
  };
  const decision = decideStoredSummary({
    title: "보고서",
    existing,
    candidate: {
      summary: "설명 문단은 충분히 길어서 품질은 통과하지만 자막보다 거친 발췌입니다. 순서는 자막을 따릅니다.",
      summary_points: ["설명 문단은 충분히 길어서 품질은 통과합니다", "순서는 자막을 따릅니다"],
      hook: "설명 문단은 충분히 길어서 품질은 통과합니다",
      tool_features: [],
      difficulty: "",
      takeaway: "순서는 자막을 따릅니다",
      source: "description",
    },
    cues: [{ text: "설명에 붙이면 안 되는 시각", offsetSeconds: 8 }],
    transcriptLang: null,
    now: "2026-11-06T00:00:00.000Z",
  });
  assert.equal(decision.wroteCandidate, false);
  assert.equal(decision.summary_source, "transcript");
  assert.equal(decision.summary_generated_at, "2026-11-03T00:00:00.000Z");
  assert.equal(decision.source_cues?.[0]?.offsetSeconds, 40);
});

test("unknown provenance does not replace a passing summary", () => {
  const existing = {
    ...emptyStoredSummary(),
    summary: GOOD,
    summary_points: ["자료를 붙인 뒤 문단 순서를 고칩니다", "날짜와 숫자를 원문과 비교합니다"],
    hook: "빈 페이지에서 시작하지 않아도 됩니다",
    takeaway: "날짜와 숫자는 따로 확인합니다",
  };
  const decision = decideStoredSummary({
    title: "보고서",
    existing,
    candidate: {
      summary: "다른 설명도 길이는 충분하고 품질 검사를 통과하는 문장입니다. 컬럼이 없으면 기존 글을 유지합니다.",
      summary_points: ["다른 설명도 길이는 충분하고 품질 검사를 통과합니다", "컬럼이 없으면 기존 글을 유지합니다"],
      hook: "다른 설명도 길이는 충분합니다",
      tool_features: [],
      difficulty: "",
      takeaway: "컬럼이 없으면 기존 글을 유지합니다",
      source: "description",
    },
    cues: null,
    transcriptLang: null,
    now: "2026-11-06T00:00:00.000Z",
    provenanceKnown: false,
  });
  assert.equal(decision.wroteCandidate, false);
  assert.equal(decision.summary, GOOD);
  assert.equal(decision.summary_verified_at, null);
});

test("a description candidate does not receive transcript timestamps", () => {
  const decision = decideStoredSummary({
    title: "보고서",
    existing: null,
    candidate: {
      summary: GOOD,
      summary_points: ["자료를 붙인 뒤 문단 순서를 고칩니다", "날짜와 숫자를 원문과 비교합니다"],
      hook: "빈 페이지에서 시작하지 않아도 됩니다",
      tool_features: [],
      difficulty: "",
      takeaway: "날짜와 숫자는 따로 확인합니다",
      source: "description",
    },
    cues: [{ text: "있으면 안 되는 시각", offsetSeconds: 15 }],
    transcriptLang: "ko",
    now: "2026-11-06T01:02:03.000Z",
  });
  assert.equal(decision.wroteCandidate, true);
  assert.equal(decision.summary_source, "description");
  assert.equal(decision.source_cues, null);
  assert.equal(decision.summary_verified_at, null);
  assert.equal(decision.summary_generated_at, "2026-11-06T01:02:03.000Z");
});

test("link-only text is not a public summary", () => {
  const linked = assessPublicSummary({
    title: "다른 제목",
    summary: "자료는 이 링크 https://example.com/a",
  });
  assert.equal(linked.ok, false);
  assert.ok(linked.reasons.includes("link_only"));
});

test("a new promo candidate is not stored as the summary", () => {
  const decision = decideStoredSummary({
    title: "챗GPT 강의",
    existing: null,
    candidate: {
      summary: "무료 특강 라이브 예정. 신청링크에서 바로 등록하세요.",
      summary_points: ["무료 특강 라이브 예정. 신청링크에서 바로 등록하세요."],
      hook: "신청링크에서 바로 등록하세요",
      tool_features: [],
      difficulty: "",
      takeaway: "신청링크에서 바로 등록하세요",
      source: "description",
    },
    cues: [{ text: "없는 자막", offsetSeconds: 12 }],
    transcriptLang: "ko",
    now: "2026-11-06T00:00:00.000Z",
  });
  assert.equal(decision.summary, "");
  assert.equal(decision.source_cues, null);
  assert.equal(decision.queueForReview, true);
  assert.equal(decision.wroteCandidate, false);
});
