import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import { configureOpenAIClient, DEFAULT_OPENAI_MODEL } from "./openai.js";
import { summarizeVideo, type Summary } from "./summarize.js";

const originalKey = process.env.OPENAI_API_KEY;
const originalModel = process.env.OPENAI_MODEL;

type ChatBody = {
  model: string;
  max_completion_tokens: number;
  messages: Array<{ role: string; content: string }>;
};

function chatCompletion(content: string, finishReason: string) {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 1_700_000_000,
    model: DEFAULT_OPENAI_MODEL,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content, refusal: null },
        finish_reason: finishReason,
        logprobs: null,
      },
    ],
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function installFetch(handler: (body: ChatBody, url: string) => unknown): { calls: ChatBody[] } {
  const calls: ChatBody[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const raw = init?.body;
    if (typeof raw !== "string") throw new Error(`expected string request body, got ${typeof raw}`);
    const body = JSON.parse(raw) as ChatBody;
    calls.push(body);
    return jsonResponse(handler(body, url));
  };
  configureOpenAIClient(new OpenAI({ apiKey: "test-key", fetch: fetchImpl, maxRetries: 0 }));
  return { calls };
}

test.afterEach(() => {
  configureOpenAIClient(undefined);
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
  if (originalModel === undefined) delete process.env.OPENAI_MODEL;
  else process.env.OPENAI_MODEL = originalModel;
});

test("summarizeVideo parses a mocked OpenAI chat completion into the Summary shape", async () => {
  delete process.env.OPENAI_MODEL;

  const payload: Summary = {
    hook: "한 줄로 끝나는 후킹",
    summary: "핵심만 두 문장으로 정리했습니다. 실습 순서가 분명합니다.",
    summary_points: ["포인트1", "포인트2", "포인트3"],
    tool_features: ["이미지 생성", "프롬프트 수정"],
    difficulty: "초급",
    takeaway: "오늘 바로 써먹을 한 줄 결론",
  };

  const { calls } = installFetch((body, url) => {
    assert.match(url, /\/chat\/completions$/);
    assert.equal(body.model, DEFAULT_OPENAI_MODEL);
    assert.equal(body.max_completion_tokens, 2000);
    assert.equal(body.messages[0]?.role, "system");
    assert.match(body.messages[0]?.content ?? "", /순수 JSON/);
    assert.match(body.messages[1]?.content ?? "", /제목: 썸네일 만들기/);
    assert.match(body.messages[1]?.content ?? "", /자막 일부: 오늘 배울 내용/);
    return chatCompletion(JSON.stringify(payload), "stop");
  });

  const result = await summarizeVideo({
    title: "썸네일 만들기",
    description: "설명입니다",
    transcript: "오늘 배울 내용",
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(result, payload);
});

test("summarizeVideo defaults missing fields when the JSON is only partial", async () => {
  delete process.env.OPENAI_MODEL;
  installFetch(() =>
    chatCompletion(JSON.stringify({ hook: "부분 필드", summary_points: "not-an-array" }), "stop"),
  );

  const result = await summarizeVideo({ title: "제목", description: "설명" });
  assert.deepEqual(result, {
    summary: "",
    summary_points: [],
    hook: "부분 필드",
    tool_features: [],
    difficulty: "",
    takeaway: "",
  });
});

test("summarizeVideo retries a length-truncated completion, then parses the retry", async () => {
  process.env.OPENAI_MODEL = "gpt-4.1";
  const payload: Summary = {
    hook: "재시도 후 후킹",
    summary: "두 번째 응답에서 파싱됩니다.",
    summary_points: ["한 가지"],
    tool_features: ["기능"],
    difficulty: "중급",
    takeaway: "결론",
  };
  const contents = ['{"hook": "잘린', JSON.stringify(payload)];
  let i = 0;
  const { calls } = installFetch(() => {
    const finish = i === 0 ? "length" : "stop";
    const content = contents[i] ?? "";
    i += 1;
    return chatCompletion(content, finish);
  });

  const result = await summarizeVideo({ title: "재시도", description: "설명" });
  assert.deepEqual(result, payload);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.model, "gpt-4.1");
  assert.equal(calls[0]?.max_completion_tokens, 2000);
  assert.equal(calls[1]?.max_completion_tokens, 4000);
});

test("summarizeVideo returns an empty summary when the model output cannot be parsed", async () => {
  delete process.env.OPENAI_MODEL;
  const { calls } = installFetch(() => chatCompletion("이것은 JSON이 아닙니다", "stop"));

  const result = await summarizeVideo({ title: "실패", description: "설명" });
  assert.deepEqual(result, {
    summary: "",
    summary_points: [],
    hook: "",
    tool_features: [],
    difficulty: "",
    takeaway: "",
  });
  // Text that is not a JSON object is treated as truncated, so the caller retries once.
  assert.equal(calls.length, 2);
});

test("summarizeVideo throws when OPENAI_API_KEY is missing", async () => {
  configureOpenAIClient(undefined);
  delete process.env.OPENAI_API_KEY;
  await assert.rejects(
    () => summarizeVideo({ title: "키 없음", description: "설명" }),
    /Missing OPENAI_API_KEY env var/,
  );
});
