import assert from "node:assert/strict";
import test from "node:test";
import { ARCHIVE_RANK, planCategoryRetention, videoIdsToDelete } from "./retention.js";
import { hotRankScore, recommendationRanks, selectRankedTop } from "./ranking.js";

const NOW = Date.parse("2026-11-06T00:00:00.000Z");

const VIDEOS = [
  {
    youtube_id: "bbbbbbbbbbb",
    view_count: 1000,
    published_at: "2026-11-01T00:00:00.000Z",
    duration_seconds: 120,
  },
  {
    youtube_id: "aaaaaaaaaaa",
    view_count: 1000,
    published_at: "2026-11-01T00:00:00.000Z",
    duration_seconds: 120,
  },
  {
    youtube_id: "shortclip01",
    view_count: 9_000_000,
    published_at: "2026-11-05T00:00:00.000Z",
    duration_seconds: 30,
  },
  {
    youtube_id: "excluded0001",
    view_count: 5000,
    published_at: "2026-10-01T00:00:00.000Z",
    duration_seconds: 200,
  },
  {
    youtube_id: "olderlower1",
    view_count: 50,
    published_at: "2024-01-01T00:00:00.000Z",
    duration_seconds: 400,
  },
];

test("repeat ranking keeps the same ids, order, and recommendation ranks", () => {
  const excluded = new Set(["excluded0001"]);
  const first = selectRankedTop(VIDEOS, 2, excluded, NOW);
  const second = selectRankedTop(VIDEOS, 2, excluded, NOW);
  assert.deepEqual(
    first.map((video) => video.youtube_id),
    second.map((video) => video.youtube_id),
  );
  assert.deepEqual(
    first.map((video) => video.youtube_id),
    ["aaaaaaaaaaa", "bbbbbbbbbbb"],
  );
  assert.equal(first.some((video) => video.youtube_id === "shortclip01"), false);
  assert.equal(first.some((video) => video.youtube_id === "excluded0001"), false);
  assert.ok(hotRankScore(VIDEOS[0]!, NOW) > hotRankScore(VIDEOS[4]!, NOW));

  const ranks = recommendationRanks(first.map((video) => video.youtube_id));
  assert.deepEqual(ranks, [
    { youtube_id: "aaaaaaaaaaa", rank: 1, status: "published" },
    { youtube_id: "bbbbbbbbbbb", rank: 2, status: "published" },
  ]);
  assert.deepEqual(recommendationRanks(first.map((video) => video.youtube_id)), ranks);
});

test("a second pass archives the same ids and still deletes nothing", () => {
  const existing = ["aaaaaaaaaaa", "bbbbbbbbbbb", "olderlower1", "excluded0001"];
  const top = ["aaaaaaaaaaa", "bbbbbbbbbbb"];
  const excluded = new Set(["excluded0001"]);
  const first = planCategoryRetention(existing, top, excluded);
  const second = planCategoryRetention([...existing], top, excluded);
  assert.deepEqual(first, second);
  assert.deepEqual(first.demoteIds, ["olderlower1"]);
  assert.deepEqual(first.excludeIds, ["excluded0001"]);
  assert.equal(first.demoteIds.includes("aaaaaaaaaaa"), false);
  assert.equal(first.excludeIds.includes("olderlower1"), false);
  assert.deepEqual(videoIdsToDelete(), []);
  assert.equal(ARCHIVE_RANK, 1000);
  assert.deepEqual(existing, ["aaaaaaaaaaa", "bbbbbbbbbbb", "olderlower1", "excluded0001"]);
});
