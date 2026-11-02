import assert from "node:assert/strict";
import test from "node:test";
import { buildFallbackSummary, FALLBACK_SUMMARY_MAX_CHARS } from "./fallback-summary.js";

const LONG_DESCRIPTION =
  "챗GPT로 보고서 초안을 만드는 순서를 화면으로 따라갑니다. 자료 정리부터 문단 다듬기까지 한 번에 보여 줍니다.";

test("uses the cleaned first paragraph of the description", () => {
  const result = buildFallbackSummary({
    title: "보고서 초안",
    description: [
      `${LONG_DESCRIPTION} https://example.com/watch`,
      "#챗GPT #강의",
      "00:00 인트로",
      "구독과 좋아요 부탁드립니다",
      "",
      "둘째 문단은 임시 요약에 넣지 않습니다. 이 문장은 충분히 길어도 버려집니다.",
    ].join("\n"),
    html: `<meta property="og:description" content="${"오쥐 설명 ".repeat(20)}" />`,
  });

  assert.equal(result.source, "description");
  assert.match(result.summary, /보고서 초안/);
  assert.equal(result.summary.includes("example.com"), false);
  assert.equal(result.summary.includes("인트로"), false);
  assert.equal(result.summary.includes("구독"), false);
  assert.equal(result.summary.includes("둘째 문단"), false);
  assert.equal(result.summary.includes("오쥐"), false);
  assert.ok(result.hook.length > 0);
  assert.ok(result.summary_points.length > 0);
  assert.ok(result.takeaway.length > 0);
});

test("uses og:description when the description has no usable paragraph", () => {
  const og = "오쥐 설명에서 가져온 문장입니다. 길이를 넉넉히 채워서 임시 요약으로 선택됩니다.";
  const result = buildFallbackSummary({
    title: "제목",
    description: "<meta property=\"og:description\" content=\"짧은메타\" />",
    html: `<meta property="og:description" content="${og}" />`,
  });
  assert.equal(result.source, "og:description");
  assert.match(result.summary, /오쥐 설명/);
});

test("decodes entities and falls through to the transcript, then the title", () => {
  const transcript = "자막의 첫 문단입니다. 설명이 비어 있을 때 이 문단을 임시 요약으로 씁니다.";
  const fromTranscript = buildFallbackSummary({
    title: "제목만",
    description: "짧음 &amp; 링크 https://example.com",
    transcript,
  });
  assert.equal(fromTranscript.source, "transcript");
  assert.match(fromTranscript.summary, /자막의 첫 문단/);

  const fromTitle = buildFallbackSummary({ title: "제목만 있는 영상", description: "", transcript: "" });
  assert.equal(fromTitle.source, "title");
  assert.equal(fromTitle.summary, "제목만 있는 영상");
  assert.deepEqual(fromTitle.summary_points, ["제목만 있는 영상"]);
});

test("trims a long paragraph on a sentence boundary", () => {
  const sentence = "이 문장은 임시 요약의 길이를 넘길 때까지 같은 설명을 반복합니다. ";
  const result = buildFallbackSummary({
    title: "긴 영상",
    description: sentence.repeat(30),
  });
  assert.ok(result.summary.length <= FALLBACK_SUMMARY_MAX_CHARS);
  assert.match(result.summary, /반복합니다\.$/);
  assert.equal(result.summary.endsWith("…"), false);
});

test("adds an ellipsis when a long paragraph has no sentence boundary", () => {
  const result = buildFallbackSummary({
    title: "긴 영상",
    description: `시작 ${"가".repeat(500)}`,
  });
  assert.ok(result.summary.length <= FALLBACK_SUMMARY_MAX_CHARS + 1);
  assert.equal(result.summary.endsWith("…"), true);
});
