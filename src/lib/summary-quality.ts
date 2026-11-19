import type { SummaryFields } from "./summary-fields.js";

export type SummarySource = "description" | "transcript" | "reviewed";

export type SourceCue = {
  text: string;
  offsetSeconds: number;
};

export type QualityReason =
  | "empty"
  | "too_short"
  | "title_copy"
  | "repeated_lines"
  | "promo_or_signup"
  | "link_only";

export type StoredSummaryFields = SummaryFields & {
  transcript_lang: string | null;
  summary_source: SummarySource | null;
  summary_generated_at: string | null;
  summary_verified_at: string | null;
  source_cues: SourceCue[] | null;
  useful_facts: string[];
  costs: string;
  limitations: string;
};

const PROMO =
  /신청|구독해|구독과|구독\s*부탁|알림\s*설정|라이브\s*예정|오픈\s*카톡|오픈채팅|쿠폰|선착순|회원가입|신청링크|바로가기\s*링크/u;

export function compactText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\bwww\.\S+/gi, " ")
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .toLowerCase();
}

export function assessPublicSummary(input: {
  title: string;
  summary: string;
  summaryPoints?: string[];
  hook?: string;
  takeaway?: string;
}): { ok: boolean; reasons: QualityReason[] } {
  const summary = (input.summary ?? "").trim();
  const reasons = new Set<QualityReason>();
  const compact = compactText(summary);
  const title = compactText(input.title ?? "");

  if (!summary) reasons.add("empty");
  if (compact.length < 40) reasons.add("too_short");
  if (title.length >= 8 && (compact === title || (compact.includes(title) && compact.length <= title.length + 8))) {
    reasons.add("title_copy");
  }
  if (PROMO.test(summary) || PROMO.test(input.hook ?? "") || PROMO.test(input.takeaway ?? "")) {
    reasons.add("promo_or_signup");
  }
  const withoutLinks = summary.replace(/https?:\/\/\S+/gi, " ").replace(/\bwww\.\S+/gi, " ").trim();
  if ((/https?:\/\/|www\./i.test(summary) || /링크/.test(summary)) && compactText(withoutLinks).length < 40) {
    reasons.add("link_only");
  }

  const lines = [summary, input.hook ?? "", input.takeaway ?? "", ...(input.summaryPoints ?? [])]
    .map((line) => compactText(line))
    .filter((line) => line.length > 0);
  if (lines.length >= 2 && lines.every((line) => line === lines[0])) reasons.add("repeated_lines");

  return { ok: reasons.size === 0, reasons: [...reasons] };
}

function kept(existing: StoredSummaryFields): StoredSummaryFields {
  return { ...existing, useful_facts: existing.useful_facts ?? [], source_cues: existing.source_cues };
}

export function parseSummarySource(value: unknown): SummarySource | null {
  return value === "description" || value === "transcript" || value === "reviewed" ? value : null;
}

/** Absent cues stay null. A present but unusable list is invalid and must not be rewritten into times. */
export function readSourceCues(value: unknown): { cues: SourceCue[] | null; invalid: boolean } {
  if (value == null) return { cues: null, invalid: false };
  if (!Array.isArray(value)) return { cues: null, invalid: true };
  if (value.length === 0) return { cues: null, invalid: false };
  const cues: SourceCue[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return { cues: null, invalid: true };
    const text = "text" in item && typeof item.text === "string" ? item.text.trim() : "";
    const offset = "offsetSeconds" in item ? item.offsetSeconds : undefined;
    if (!text || typeof offset !== "number" || !Number.isFinite(offset) || offset < 0) {
      return { cues: null, invalid: true };
    }
    cues.push({ text: text.slice(0, 180), offsetSeconds: Math.round(offset) });
  }
  return { cues: cues.length > 0 ? cues : null, invalid: false };
}

function publicSummaryOk(input: {
  title: string;
  summary: string;
  summaryPoints?: string[];
  hook?: string;
  takeaway?: string;
}): boolean {
  const summary = input.summary.trim();
  if (!summary || summary.startsWith("{")) return false;
  return assessPublicSummary({
    title: input.title,
    summary,
    summaryPoints: input.summaryPoints,
    hook: input.hook,
    takeaway: input.takeaway,
  }).ok;
}

export function emptyStoredSummary(): StoredSummaryFields {
  return {
    summary: "",
    summary_points: [],
    hook: "",
    tool_features: [],
    difficulty: "",
    takeaway: "",
    transcript_lang: null,
    summary_source: null,
    summary_generated_at: null,
    summary_verified_at: null,
    source_cues: null,
    useful_facts: [],
    costs: "",
    limitations: "",
  };
}

function keepExisting(
  existing: StoredSummaryFields,
): StoredSummaryFields & { queueForReview: false; wroteCandidate: false } {
  return { ...kept(existing), queueForReview: false, wroteCandidate: false };
}

export function decideStoredSummary(input: {
  title: string;
  existing: StoredSummaryFields | null;
  candidate: SummaryFields & { source: "description" | "og:description" | "transcript" | "title" };
  cues: SourceCue[] | null;
  transcriptLang: string | null;
  now: string;
  /** False when provenance columns could not be read. Passing text is then left untouched. */
  provenanceKnown?: boolean;
}): StoredSummaryFields & { queueForReview: boolean; wroteCandidate: boolean } {
  const existing = input.existing;
  const provenanceKnown = input.provenanceKnown !== false;
  const existingOk = Boolean(
    existing &&
      publicSummaryOk({
        title: input.title,
        summary: existing.summary,
        summaryPoints: existing.summary_points,
        hook: existing.hook,
        takeaway: existing.takeaway,
      }),
  );
  const reviewed =
    provenanceKnown &&
    existing?.summary_source === "reviewed" &&
    Boolean(existing.summary_verified_at) &&
    Boolean(existing.summary.trim()) &&
    !existing.summary.trim().startsWith("{");
  if (existing && reviewed) return keepExisting(existing);
  if (existing && existingOk && !provenanceKnown) return keepExisting(existing);

  const source: SummarySource | null =
    input.candidate.source === "transcript"
      ? "transcript"
      : input.candidate.source === "description" || input.candidate.source === "og:description"
        ? "description"
        : null;
  const candidateOk =
    source !== null &&
    publicSummaryOk({
      title: input.title,
      summary: input.candidate.summary,
      summaryPoints: input.candidate.summary_points,
      hook: input.candidate.hook,
      takeaway: input.candidate.takeaway,
    });

  if (!candidateOk) {
    if (existing && existingOk) return keepExisting(existing);
    const base = existing ? kept(existing) : emptyStoredSummary();
    return {
      ...base,
      summary: "",
      summary_points: [],
      hook: "",
      takeaway: "",
      summary_source: null,
      summary_generated_at: null,
      summary_verified_at: null,
      source_cues: null,
      transcript_lang: existing?.transcript_lang ?? null,
      queueForReview: true,
      wroteCandidate: false,
    };
  }

  if (existing && existingOk && existing.summary_source === "transcript" && source === "description") {
    return keepExisting(existing);
  }

  const cues = source === "transcript" && input.cues && input.cues.length > 0 ? input.cues : null;
  return {
    summary: input.candidate.summary,
    summary_points: input.candidate.summary_points,
    hook: input.candidate.hook,
    tool_features: input.candidate.tool_features,
    difficulty: input.candidate.difficulty,
    takeaway: input.candidate.takeaway,
    transcript_lang: source === "transcript" ? input.transcriptLang : null,
    summary_source: source,
    summary_generated_at: input.now,
    summary_verified_at: null,
    source_cues: cues,
    useful_facts: [],
    costs: "",
    limitations: "",
    queueForReview: true,
    wroteCandidate: true,
  };
}
