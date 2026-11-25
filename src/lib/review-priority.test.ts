import assert from "node:assert/strict";
import test from "node:test";
import { rankQueue } from "../export-review-batch.js";
import { pendingItemId, type PendingSummaryItem } from "./pending-queue.js";

function item(partial: Partial<PendingSummaryItem>): PendingSummaryItem {
  return {
    id: pendingItemId(partial.youtube_id ?? "abcdefghijk"),
    needs_summary: true,
    kind: "video",
    youtube_id: partial.youtube_id ?? "abcdefghijk",
    title: partial.title ?? "챗GPT로 보고서 초안을 만드는 과정",
    category_slug: partial.category_slug ?? "chatgpt",
    source_url: "https://www.youtube.com/watch?v=abcdefghijk",
    fallback_summary:
      partial.fallback_summary ??
      "자료를 붙인 뒤 문단 순서를 먼저 고칩니다. 마지막에는 날짜와 숫자를 원본 문서와 한 번씩 비교합니다.",
    description_excerpt:
      partial.description_excerpt ??
      "자료를 붙인 뒤 문단 순서를 먼저 고칩니다. 마지막에는 날짜와 숫자를 원본 문서와 한 번씩 비교합니다.",
    queued_at: partial.queued_at ?? new Date().toISOString(),
  };
}

test("tool lessons outrank trend items and promo copy", () => {
  const ranked = rankQueue([
    item({
      youtube_id: "trendvideo1",
      category_slug: "trend",
      title: "오늘 AI 뉴스",
      fallback_summary: "방송 뉴스 첫 문장을 길게 옮긴 임시 문장입니다. 도구 사용 순서는 없습니다.",
    }),
    item({
      youtube_id: "promovideo01",
      title: "챗GPT 특강",
      fallback_summary: "무료 특강 라이브 예정. 신청링크에서 바로 등록하세요. 구독도 부탁드립니다.",
    }),
    item({ youtube_id: "toolvideo001" }),
  ]);
  assert.equal(ranked[0]?.youtube_id, "toolvideo001");
  assert.equal(ranked.find((row) => row.youtube_id === "promovideo01")?.quality_ok, false);
});
