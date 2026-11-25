import { type SummaryFields } from "./summary-fields.js";

export const MIN_USEFUL_CHARS = 40;
export const FALLBACK_SUMMARY_MAX_CHARS = 400;

export type FallbackSource = "description" | "og:description" | "transcript" | "title";

export type FallbackSummary = SummaryFields & {
  source: FallbackSource;
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

const CTA_LINES = new Set([
  "구독",
  "구독과좋아요",
  "구독과좋아요부탁드립니다",
  "구독해주세요",
  "구독과알림설정",
  "좋아요",
  "좋아요부탁드립니다",
  "좋아요와구독",
  "좋아요와구독부탁드립니다",
  "알림설정",
  "알림설정부탁드립니다",
  "subscribe",
  "likeandsubscribe",
]);

function safeChar(code: number): string {
  if (!Number.isFinite(code) || code < 32 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, digits: string) => safeChar(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeChar(parseInt(hex, 16)))
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

function isNoiseLine(line: string): boolean {
  if (/^(?:#[^\s#]+\s*)+$/u.test(line)) return true;
  if (/^\d{1,2}:\d{2}(?::\d{2})?(?:\s+\S.*)?$/.test(line)) return true;
  if (/^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(line)) return true;
  const compact = line.replace(/[\s.!?…,]+/g, "").toLowerCase();
  return CTA_LINES.has(compact);
}

/** First readable paragraph: tags, URLs, chapter timestamps, and subscription lines removed. */
export function cleanFirstParagraph(raw: string | undefined): string {
  if (!raw) return "";
  const normalized = decodeEntities(raw)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\bwww\.\S+/gi, " ")
    .replace(/#[\p{L}\p{N}_]+/gu, " ")
    .replace(/\r\n/g, "\n");

  const paragraphs = normalized
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph
        .split("\n")
        .map((line) => line.replace(/[ \t]+/g, " ").trim())
        .filter((line) => line && !isNoiseLine(line))
        .join(" ")
        .replace(/[ \t]{2,}/g, " ")
        .trim(),
    )
    .filter(Boolean);

  return paragraphs[0] ?? "";
}

function metaContent(html: string | undefined, attribute: "property" | "name", key: string): string {
  if (!html) return "";
  const patterns = [
    new RegExp(
      `<meta\\s+[^>]*${attribute}\\s*=\\s*["']${key}["'][^>]*content\\s*=\\s*["']([^"']*)["'][^>]*>`,
      "i",
    ),
    new RegExp(
      `<meta\\s+[^>]*content\\s*=\\s*["']([^"']*)["'][^>]*${attribute}\\s*=\\s*["']${key}["'][^>]*>`,
      "i",
    ),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) return cleanFirstParagraph(match[1]);
  }
  return "";
}

export function trimAtBoundary(value: string, maxChars: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxChars) return trimmed;
  const slice = trimmed.slice(0, maxChars);
  const boundaries = [". ", "。", "! ", "? ", "！", "？", "."];
  let cutAt = -1;
  for (const token of boundaries) {
    const index = slice.lastIndexOf(token);
    if (index > cutAt) cutAt = index;
  }
  if (cutAt >= 80) {
    const end = slice[cutAt] === "." || slice[cutAt] === "。" || slice[cutAt] === "！" || slice[cutAt] === "？"
      ? cutAt + 1
      : cutAt;
    return slice.slice(0, end).trim();
  }
  const space = slice.lastIndexOf(" ");
  const cut = (space >= 80 ? slice.slice(0, space) : slice).trim();
  return `${cut}…`;
}

function sentences(text: string): string[] {
  const parts = text
    .split(/(?<=[.!?。！？])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : text.trim() ? [text.trim()] : [];
}

function pickSource(input: {
  title: string;
  description?: string;
  transcript?: string;
  html?: string;
}): { text: string; source: FallbackSource } {
  const description = cleanFirstParagraph(input.description);
  const og =
    metaContent(input.html, "property", "og:description") ||
    metaContent(input.description, "property", "og:description") ||
    metaContent(input.html, "name", "description");
  const transcript = cleanFirstParagraph(input.transcript);
  const title = input.title.replace(/\s+/g, " ").trim();

  const ranked: Array<{ text: string; source: FallbackSource }> = [
    { text: transcript, source: "transcript" },
    { text: description, source: "description" },
    { text: og, source: "og:description" },
  ];
  const useful = ranked.find((candidate) => candidate.text.length >= MIN_USEFUL_CHARS);
  if (useful) return useful;
  const any = ranked.find((candidate) => candidate.text.length > 0);
  if (any) return any;
  return { text: title || "영상 설명이 없습니다.", source: "title" };
}

export function descriptionExcerpt(description: string | undefined, maxChars = 600): string {
  return trimAtBoundary(cleanFirstParagraph(description), maxChars);
}

/** Deterministic summary so a new video is never stored with an empty body. */
export function buildFallbackSummary(input: {
  title: string;
  description?: string;
  transcript?: string;
  html?: string;
}): FallbackSummary {
  const picked = pickSource(input);
  const summary = trimAtBoundary(picked.text, FALLBACK_SUMMARY_MAX_CHARS);
  const parts = sentences(summary);
  const hook = trimAtBoundary(parts[0] ?? summary, 90);
  const takeaway = trimAtBoundary(parts[parts.length - 1] ?? summary, 140);
  return {
    summary,
    summary_points: parts.slice(0, 3).map((part) => trimAtBoundary(part, 180)),
    hook,
    tool_features: [],
    difficulty: "",
    takeaway,
    source: picked.source,
  };
}
