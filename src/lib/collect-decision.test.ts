import assert from "node:assert/strict";
import test from "node:test";
import { shouldReplaceSummary } from "./collect-decision.js";

const video = { title: "제목", description: "설명" };

test("replaces a missing row, an empty summary, a broken JSON blob, and changed text", () => {
  assert.equal(shouldReplaceSummary(undefined, video), true);
  assert.equal(shouldReplaceSummary({ ...video, description: "설명", summary: "  " }, video), true);
  assert.equal(shouldReplaceSummary({ ...video, summary: "{\"hook\":" }, video), true);
  assert.equal(shouldReplaceSummary({ title: "다른 제목", description: "설명", summary: "유지할 요약" }, video), true);
  assert.equal(
    shouldReplaceSummary({ title: "제목", description: "다른 설명", summary: "유지할 요약" }, video),
    true,
  );
});

test("keeps a usable summary when the title and description are unchanged", () => {
  assert.equal(shouldReplaceSummary({ title: "제목", description: "설명", summary: "이미 있는 요약" }, video), false);
  assert.equal(shouldReplaceSummary({ title: "제목", description: null, summary: "이미 있는 요약" }, { ...video, description: "" }), false);
});
