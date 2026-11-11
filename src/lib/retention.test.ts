import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ARCHIVE_RANK, planCategoryRetention, videoIdsToDelete } from "./retention.js";

test("rerunning a category keeps every existing id and never deletes", () => {
  const existing = ["keep-me", "demote-me", "blocked"];
  const first = planCategoryRetention(existing, ["keep-me", "new-one"], new Set(["blocked"]));
  assert.deepEqual(first.demoteIds, ["demote-me"]);
  assert.deepEqual(first.excludeIds, ["blocked"]);
  assert.deepEqual(videoIdsToDelete(), []);
  assert.equal(ARCHIVE_RANK, 1000);

  const after = ["keep-me", "demote-me", "blocked", "new-one"];
  const second = planCategoryRetention(after, ["keep-me", "new-one"], new Set(["blocked"]));
  assert.deepEqual(second.demoteIds, ["demote-me"]);
  assert.deepEqual(second.excludeIds, ["blocked"]);
  assert.equal(second.demoteIds.includes("keep-me"), false);
  assert.equal(second.demoteIds.includes("new-one"), false);
});

test("the collector source does not delete video rows", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src", "collect.ts"), "utf8");
  assert.equal(source.includes(".delete("), false);
  assert.match(source, /planCategoryRetention/);
  assert.match(source, /ARCHIVE_RANK/);
});
