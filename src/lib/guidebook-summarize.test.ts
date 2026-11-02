import assert from "node:assert/strict";
import test from "node:test";
import { generateGuidebookSections } from "./guidebook-summarize.js";

test("builds one section per titled video from summary points", () => {
  const sections = generateGuidebookSections("챗GPT", [
    { index: 0, title: " 썸네일 ", summary_points: ["프롬프트 작성", " "] },
    { index: 2, title: "로고", summary_points: [] },
    { index: 3, title: "   ", summary_points: ["무시"] },
  ]);

  assert.deepEqual(sections, [
    {
      title: "썸네일",
      content_markdown: "**챗GPT**\n\n- 프롬프트 작성",
      source_video_indexes: [0],
    },
    {
      title: "로고",
      content_markdown: "**챗GPT**\n\n로고 영상에서 다루는 내용을 정리합니다.",
      source_video_indexes: [2],
    },
  ]);
});

test("returns an empty list when every title is blank", () => {
  assert.deepEqual(generateGuidebookSections("챗GPT", [{ index: 0, title: " ", summary_points: ["포인트"] }]), []);
});
