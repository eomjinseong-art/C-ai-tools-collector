import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import { generateGuidebookSections } from "./guidebook-summarize.js";
import { configureOpenAIClient, DEFAULT_OPENAI_MODEL } from "./openai.js";

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

function installFetch(handler: (body: ChatBody, url: string) => unknown): { calls: ChatBody[] } {
  const calls: ChatBody[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const raw = init?.body;
    if (typeof raw !== "string") throw new Error(`expected string request body, got ${typeof raw}`);
    const body = JSON.parse(raw) as ChatBody;
    calls.push(body);
    return new Response(JSON.stringify(handler(body, url)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
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

test("generateGuidebookSections parses a mocked OpenAI chat completion", async () => {
  delete process.env.OPENAI_MODEL;
  const { calls } = installFetch((body, url) => {
    assert.match(url, /\/chat\/completions$/);
    assert.equal(body.model, DEFAULT_OPENAI_MODEL);
    assert.equal(body.max_completion_tokens, 4000);
    assert.match(body.messages[0]?.content ?? "", /가이드북 섹션/);
    assert.match(body.messages[1]?.content ?? "", /카테고리: ChatGPT/);
    assert.match(body.messages[1]?.content ?? "", /\[영상 0\] 영상 A/);
    return chatCompletion(
      JSON.stringify({
        sections: [
          {
            title: "썸네일 만들기",
            content_markdown: "- 프롬프트를 작성한다",
            source_video_indexes: [0, 1],
          },
          { title: "", content_markdown: "제목 없음", source_video_indexes: [0] },
          { title: "로고", content_markdown: "", source_video_indexes: [1] },
        ],
      }),
      "stop",
    );
  });

  const sections = await generateGuidebookSections("ChatGPT", [
    { index: 0, title: "영상 A", summary_points: ["포인트"] },
    { index: 1, title: "영상 B", summary_points: [] },
  ]);

  assert.equal(calls.length, 1);
  assert.deepEqual(sections, [
    {
      title: "썸네일 만들기",
      content_markdown: "- 프롬프트를 작성한다",
      source_video_indexes: [0, 1],
    },
  ]);
});

test("generateGuidebookSections returns an empty list when parsing fails", async () => {
  delete process.env.OPENAI_MODEL;
  const { calls } = installFetch(() => chatCompletion("not json", "stop"));
  const sections = await generateGuidebookSections("ChatGPT", [
    { index: 0, title: "영상 A", summary_points: ["포인트"] },
  ]);
  assert.deepEqual(sections, []);
  assert.equal(calls.length, 2);
});
