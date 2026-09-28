import { openai, openaiModel } from "./openai.js";

export type Summary = {
  summary: string;
  summary_points: string[];
  hook: string;
  tool_features: string[];
  difficulty: string;
  takeaway: string;
};

const EMPTY_SUMMARY: Summary = {
  summary: "",
  summary_points: [],
  hook: "",
  tool_features: [],
  difficulty: "",
  takeaway: "",
};

const SYSTEM_PROMPT = `너는 한국어 AI 툴 교육 사이트의 영상 요약가야. 유튜브 영상의 제목/설명/자막을 보고
시청자가 영상을 보지 않아도 핵심 내용을 파악할 수 있도록 요약해.
반드시 아래 JSON 형식으로만 응답해 (설명, 마크다운 코드블록 없이 순수 JSON, 다른 텍스트 절대 추가 금지):
{
  "hook": "클릭을 유도할 만한 한 줄 후킹 문장",
  "summary": "2~4문장 요약",
  "summary_points": ["핵심 포인트1", "핵심 포인트2", "핵심 포인트3"],
  "tool_features": ["영상에서 다룬 AI 툴의 기능1", "기능2"],
  "difficulty": "입문|초급|중급|고급 중 하나",
  "takeaway": "시청자가 얻어갈 핵심 한 줄 결론"
}
JSON은 반드시 완전한 형태로 끝까지 작성해. 절대 문장 중간에서 끊지 마.`;

function looksTruncated(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return true;
  if (!trimmed.endsWith("}")) return true;
  try {
    JSON.parse(trimmed);
    return false;
  } catch {
    return true;
  }
}

async function callModel(userContent: string, maxTokens: number): Promise<{ raw: string; truncated: boolean }> {
  const completion = await openai().chat.completions.create({
    model: openaiModel(),
    max_completion_tokens: maxTokens,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
  });

  const choice = completion.choices[0];
  const content = choice?.message?.content;
  const raw = typeof content === "string" ? content : "";
  const truncated = choice?.finish_reason === "length" || looksTruncated(raw);
  return { raw, truncated };
}

function parseSummary(raw: string): Summary | null {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw) as Partial<Summary>;
    return {
      summary: parsed.summary ?? "",
      summary_points: Array.isArray(parsed.summary_points) ? parsed.summary_points : [],
      hook: parsed.hook ?? "",
      tool_features: Array.isArray(parsed.tool_features) ? parsed.tool_features : [],
      difficulty: parsed.difficulty ?? "",
      takeaway: parsed.takeaway ?? "",
    };
  } catch {
    return null;
  }
}

/** Bulk daily batch job — model comes from OPENAI_MODEL (default gpt-4.1-mini). */
export async function summarizeVideo(input: {
  title: string;
  description: string;
  transcript?: string;
}): Promise<Summary> {
  const userContent = [
    `제목: ${input.title}`,
    `설명: ${input.description.slice(0, 1500)}`,
    input.transcript ? `자막 일부: ${input.transcript.slice(0, 3000)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  // First attempt at a generous token budget; if the model still ran out of room,
  // retry once with even more headroom rather than saving a truncated JSON blob.
  let { raw, truncated } = await callModel(userContent, 2000);
  if (truncated) {
    console.warn("  요약 응답이 잘림, max_tokens 늘려 재시도");
    ({ raw, truncated } = await callModel(userContent, 4000));
  }

  const parsed = parseSummary(raw);
  if (parsed) return parsed;

  // Never persist a raw/truncated JSON blob as the summary — better an empty
  // summary (visibly "not yet summarized") than corrupted text on the page.
  console.error("  요약 파싱 실패, 이번 실행에서는 스킵:", raw.slice(0, 200));
  return EMPTY_SUMMARY;
}
