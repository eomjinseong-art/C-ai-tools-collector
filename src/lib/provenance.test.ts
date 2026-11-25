import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  PROVENANCE_COLUMNS,
  isMissingColumnError,
  omitProvenance,
  rowsForSchema,
} from "./provenance.js";

test("a missing provenance column is recognized and stripped from the write", () => {
  assert.equal(
    isMissingColumnError({
      code: "PGRST204",
      message: "Could not find the 'summary_source' column of 'videos' in the schema cache",
    }),
    true,
  );
  assert.equal(
    isMissingColumnError({ code: "42703", message: 'column "summary_verified_at" of relation "videos" does not exist' }),
    true,
  );
  assert.equal(isMissingColumnError({ code: "23514", message: "check constraint failed" }), false);
  assert.equal(isMissingColumnError(null), false);

  const row = {
    youtube_id: "ft-TxnDq3N4",
    summary: "남겨 둘 요약",
    rank: 3,
    summary_source: "description",
    summary_generated_at: "2026-11-06T00:00:00.000Z",
    summary_verified_at: null,
    source_cues: [{ text: "화면", offsetSeconds: 12 }],
    useful_facts: ["사실"],
    costs: "영상 주장",
    limitations: "시점 한정",
  };
  assert.deepEqual(omitProvenance(row), {
    youtube_id: "ft-TxnDq3N4",
    summary: "남겨 둘 요약",
    rank: 3,
  });
  assert.deepEqual(rowsForSchema([row], false), [omitProvenance(row)]);
  assert.equal(rowsForSchema([row], true)[0]?.summary_source, "description");
});

function sqlStatements(sql: string): string {
  return sql.replace(/--.*$/gm, " ").replace(/\/\*[\s\S]*?\*\//g, " ").toLowerCase();
}

test("the provenance migration only adds nullable columns", () => {
  const sql = fs.readFileSync(path.join(process.cwd(), "supabase", "migration_add_summary_provenance.sql"), "utf8");
  const lowered = sqlStatements(sql);
  for (const column of PROVENANCE_COLUMNS) {
    assert.match(lowered, new RegExp(`add column if not exists ${column}\\b`));
  }
  assert.equal(lowered.includes("delete "), false);
  assert.equal(lowered.includes("drop table"), false);
  assert.equal(lowered.includes("drop column"), false);
  assert.equal(lowered.includes("update videos"), false);
  assert.match(lowered, /summary_source is null or summary_source in \('description', 'transcript', 'reviewed'\)/);
  assert.match(lowered, /drop constraint if exists videos_summary_source_check/);

  const schema = fs.readFileSync(path.join(process.cwd(), "supabase", "schema.sql"), "utf8");
  for (const column of PROVENANCE_COLUMNS) assert.match(schema, new RegExp(`\\b${column}\\b`));
});
