import { PENDING_ALERT_THRESHOLD } from "./pending-queue.js";

export const PENDING_ALERT_TITLE = "요약 대기 많음";

export type PendingAlertResult = "skipped" | "created" | "updated" | "reopened" | "unchanged" | "missing-token";

type Issue = {
  number: number;
  title: string;
  body: string | null;
  pull_request?: unknown;
};

export function pendingAlertBody(count: number): string {
  return [
    `한국어 요약이 필요한 대기 항목이 ${count}개입니다. ${PENDING_ALERT_THRESHOLD}개를 넘으면 이 이슈를 엽니다.`,
    "",
    "- 대기 파일: data/pending-summaries.json",
    "- 작성 파일: data/filled-summaries.json",
    "- 적용 명령: npm run apply-summaries",
    "- 스키마: docs/CONTENT_QUEUE.md",
  ].join("\n");
}

function repositoryPath(repository: string): string {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("GITHUB_REPOSITORY must look like owner/name");
  }
  return repository;
}

async function github(
  fetchImpl: typeof fetch,
  token: string,
  url: string,
  init: RequestInit = {},
): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/vnd.github+json");
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("User-Agent", "ai-tools-collector");
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  if (init.body) headers.set("Content-Type", "application/json");

  const response = await fetchImpl(url, { ...init, headers });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} for ${url}: ${text.slice(0, 300)}`);
  }
  if (!text) return null;
  return JSON.parse(text) as unknown;
}

function matchingIssue(payload: unknown): Issue | undefined {
  if (!Array.isArray(payload)) return undefined;
  return payload.find((item): item is Issue => {
    if (!item || typeof item !== "object") return false;
    const issue = item as Issue;
    return issue.title === PENDING_ALERT_TITLE && !issue.pull_request && typeof issue.number === "number";
  });
}

export async function syncPendingAlert(options: {
  count: number;
  token?: string;
  repository?: string;
  fetchImpl?: typeof fetch;
}): Promise<PendingAlertResult> {
  if (options.count <= PENDING_ALERT_THRESHOLD) return "skipped";
  const token = options.token?.trim();
  const repository = options.repository?.trim();
  if (!token || !repository) return "missing-token";

  const fetchImpl = options.fetchImpl ?? fetch;
  const repo = repositoryPath(repository);
  const body = pendingAlertBody(options.count);
  const base = `https://api.github.com/repos/${repo}`;

  const open = matchingIssue(
    await github(fetchImpl, token, `${base}/issues?state=open&per_page=100`),
  );
  if (open) {
    if ((open.body ?? "") === body) return "unchanged";
    await github(fetchImpl, token, `${base}/issues/${open.number}`, {
      method: "PATCH",
      body: JSON.stringify({ body }),
    });
    return "updated";
  }

  const closed = matchingIssue(
    await github(fetchImpl, token, `${base}/issues?state=closed&per_page=100`),
  );
  if (closed) {
    await github(fetchImpl, token, `${base}/issues/${closed.number}`, {
      method: "PATCH",
      body: JSON.stringify({ body, state: "open" }),
    });
    return "reopened";
  }

  await github(fetchImpl, token, `${base}/issues`, {
    method: "POST",
    body: JSON.stringify({ title: PENDING_ALERT_TITLE, body }),
  });
  return "created";
}
