import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const FORBIDDEN = [
  ["OPENAI", "_API_KEY"].join(""),
  ["ANTHROPIC", "_API_KEY"].join(""),
  ["GEMINI", "_API_KEY"].join(""),
  ["OPENAI", "_MODEL"].join(""),
  ["from \"", "openai\""].join(""),
  ["from '", "openai'"].join(""),
  ["api.", "openai.com"].join(""),
  ["api.", "anthropic.com"].join(""),
  ["generativelanguage.", "googleapis.com"].join(""),
  ["gpt", "-4"].join(""),
];

function listFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full);
    return [full];
  });
}

test("scheduled workflows, source, and env example do not reference paid LLM APIs", () => {
  const files = [
    ...listFiles(path.join(process.cwd(), ".github", "workflows")),
    ...listFiles(path.join(process.cwd(), "src")),
    path.join(process.cwd(), ".env.example"),
    path.join(process.cwd(), "package.json"),
  ];
  const hits: string[] = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const token of FORBIDDEN) {
      if (text.includes(token)) hits.push(`${path.relative(process.cwd(), file)}: ${token}`);
    }
  }
  assert.deepEqual(hits, []);
});

test("package.json does not depend on a paid LLM SDK", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  assert.equal(deps.openai, undefined);
  assert.equal(deps["@anthropic-ai/sdk"], undefined);
  assert.equal(deps["@google/generative-ai"], undefined);
  assert.equal(pkg.scripts?.["apply-summaries"], "tsx src/apply-summaries.ts");
  assert.equal(pkg.scripts?.["check-pending"], "tsx src/check-pending.ts");
  assert.equal(pkg.scripts?.resummarize, undefined);
});
