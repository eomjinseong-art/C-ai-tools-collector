import { openai, openaiModel } from "./openai.js";

export type GuidebookInputVideo = {
  index: number;
  title: string;
  summary_points: string[];
};

export type GuidebookSectionDraft = {
  title: string;
  content_markdown: string;
  source_video_indexes: number[];
};

const SYSTEM_PROMPT = `너는 한국어 AI 툴 교육 사이트의 가이드북 에디터야.
같은 카테고리(AI 툴)에 대한 여러 유튜브 영상의 핵심 포인트(key steps)를 입력받아,
사용자가 "이 툴로 무엇을 할 수 있는지" 주제별로 훑어볼 수 있는 가이드북 섹션으로 재구성해.

규칙:
- 영상 단위가 아니라 "주제/기능" 단위로 묶어라. 예: "썸네일 만들기", "로고 디자인하기", "프롬프트 작성법"
- 여러 영상에서 반복되는 내용은 하나로 합치고 중복을 제거해라
- 각 섹션은 실행 가능한 단계 위주로 정리해라 (마크다운 리스트 활용 가능)
- 섹션 개수는 내용에 따라 3~6개 사이로, 근거가 부족하면 억지로 만들지 마라
- 각 섹션이 어떤 입력 영상(들)에서 나왔는지 0부터 시작하는 인덱스로 표시해라
- 반드시 아래 JSON 형식으로만 응답해 (설명, 마크다운 코드블록 없이 순수 JSON):
{"sections": [{"title": "섹션 제목", "content_markdown": "마크다운 본문", "source_video_indexes": [0, 2]}]}`;

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

function parseSections(raw: string): GuidebookSectionDraft[] | null {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw) as { sections: GuidebookSectionDraft[] };
    if (!Array.isArray(parsed.sections)) return [];
    return parsed.sections.filter((s) => s.title && s.content_markdown);
  } catch {
    return null;
  }
}

/** Low-frequency batch (~20 calls/run, one per category). Model comes from OPENAI_MODEL (default gpt-4.1-mini). */
export async function generateGuidebookSections(
  categoryName: string,
  videos: GuidebookInputVideo[],
): Promise<GuidebookSectionDraft[]> {
  const userContent = [
    `카테고리: ${categoryName}`,
    ...videos.map(
      (v) =>
        `[영상 ${v.index}] ${v.title}\n핵심 포인트:\n${v.summary_points.map((p) => `- ${p}`).join("\n") || "(없음)"}`,
    ),
  ].join("\n\n");

  // First attempt at a generous token budget; if the model still ran out of
  // room, retry once with even more headroom rather than dropping the section.
  let { raw, truncated } = await callModel(userContent, 4000);
  if (truncated) {
    console.warn(`  [${categoryName}] 가이드북 응답이 잘림, max_tokens 늘려 재시도`);
    ({ raw, truncated } = await callModel(userContent, 7000));
  }

  const sections = parseSections(raw);
  if (sections) return sections;

  console.error(`  [${categoryName}] 가이드북 응답 파싱 실패, 이번 실행에서는 스킵:`, raw.slice(0, 200));
  return [];
}
