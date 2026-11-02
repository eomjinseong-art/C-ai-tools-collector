import assert from "node:assert/strict";
import test from "node:test";
import { PENDING_ALERT_TITLE, pendingAlertBody, syncPendingAlert } from "./pending-alert.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("does nothing at the threshold of 40", async () => {
  const result = await syncPendingAlert({
    count: 40,
    token: "token",
    repository: "example/repo",
    fetchImpl: async () => {
      throw new Error("fetch should not run");
    },
  });
  assert.equal(result, "skipped");
});

test("opens, updates, and reopens the backlog issue", async () => {
  const calls: Array<{ url: string; method: string; body?: { title?: string; body?: string; state?: string } }> = [];
  let openIssues: Array<Record<string, unknown>> = [];
  let closedIssues: Array<Record<string, unknown>> = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as { title?: string; body?: string; state?: string }) : undefined;
    calls.push({ url, method, body });
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer token");
    if (method === "GET" && url.includes("state=open")) return jsonResponse(openIssues);
    if (method === "GET" && url.includes("state=closed")) return jsonResponse(closedIssues);
    if (method === "POST") {
      assert.equal(body?.title, PENDING_ALERT_TITLE);
      return jsonResponse({ number: 9 }, 201);
    }
    return jsonResponse({ number: 4 });
  };

  const created = await syncPendingAlert({ count: 41, token: "token", repository: "example/repo", fetchImpl });
  assert.equal(created, "created");
  assert.match(calls.at(-1)?.body?.body ?? "", /41개/);

  calls.length = 0;
  openIssues = [{ number: 9, title: PENDING_ALERT_TITLE, body: "오래된 본문" }];
  const updated = await syncPendingAlert({ count: 42, token: "token", repository: "example/repo", fetchImpl });
  assert.equal(updated, "updated");
  assert.equal(calls.at(-1)?.method, "PATCH");
  assert.match(calls.at(-1)?.body?.body ?? "", /42개/);

  calls.length = 0;
  openIssues = [{ number: 9, title: PENDING_ALERT_TITLE, body: pendingAlertBody(42), pull_request: undefined }];
  const unchanged = await syncPendingAlert({ count: 42, token: "token", repository: "example/repo", fetchImpl });
  assert.equal(unchanged, "unchanged");
  assert.equal(calls.some((call) => call.method === "PATCH"), false);

  calls.length = 0;
  openIssues = [{ number: 3, title: PENDING_ALERT_TITLE, body: "pr", pull_request: { url: "x" } }];
  closedIssues = [{ number: 2, title: PENDING_ALERT_TITLE, body: "닫힘" }];
  const reopened = await syncPendingAlert({ count: 50, token: "token", repository: "example/repo", fetchImpl });
  assert.equal(reopened, "reopened");
  assert.equal(calls.at(-1)?.body?.state, "open");
  assert.match(calls.at(-1)?.url ?? "", /\/issues\/2$/);
});

test("reports a missing token without calling GitHub", async () => {
  const result = await syncPendingAlert({
    count: 41,
    fetchImpl: async () => {
      throw new Error("fetch should not run");
    },
  });
  assert.equal(result, "missing-token");
});
