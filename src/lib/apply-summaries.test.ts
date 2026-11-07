import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyRequested, backupQueues } from "../apply-summaries.js";

test("apply stays a dry-run unless asked", () => {
  assert.equal(applyRequested(["node", "apply-summaries.ts"], {}), false);
  assert.equal(applyRequested(["node", "apply-summaries.ts", "--apply"], {}), true);
  assert.equal(applyRequested(["node", "apply-summaries.ts"], { APPLY_SUMMARIES: "1" }), true);
  assert.equal(applyRequested(["node", "apply-summaries.ts"], { APPLY_SUMMARIES: "0" }), false);
});

test("backup copies the queue files and does not change the originals", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summary-backup-"));
  const data = path.join(root, "data");
  fs.mkdirSync(data);
  const pending = path.join(data, "pending-summaries.json");
  const filled = path.join(data, "filled-summaries.json");
  fs.writeFileSync(pending, "{\"version\":1,\"items\":[]}\n");
  fs.writeFileSync(filled, "{\"version\":1,\"items\":[]}\n");
  const dir = backupQueues(root);
  assert.equal(fs.readFileSync(path.join(dir, "pending-summaries.json"), "utf8"), fs.readFileSync(pending, "utf8"));
  assert.equal(fs.readFileSync(path.join(dir, "filled-summaries.json"), "utf8"), fs.readFileSync(filled, "utf8"));
  assert.equal(fs.readFileSync(pending, "utf8"), "{\"version\":1,\"items\":[]}\n");
});
