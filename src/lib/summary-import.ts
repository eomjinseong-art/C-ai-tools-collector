import type { FilledFile, PendingFile } from "./pending-queue.js";
import { planSummaryWrites } from "./pending-queue.js";
import { assessPublicSummary, readSourceCues, type SourceCue, type SummarySource } from "./summary-quality.js";
import { stringList, toVideoUpdate, type SummaryFields } from "./summary-fields.js";

export type ReviewedImport = SummaryFields & {
  summary_source: Extract<SummarySource, "reviewed">;
  useful_facts: string[];
  costs: string;
  limitations: string;
  source_cues: SourceCue[] | null;
};

export type ImportableFields = SummaryFields & {
  useful_facts?: string[];
  costs?: string;
  limitations?: string;
  source_cues?: SourceCue[] | null;
  source_cues_invalid?: boolean;
  human_reviewed?: boolean;
  user_approved?: boolean;
};

export type ImportDecision = {
  blockers: string[];
  publishBlocked: boolean;
  accepted: Array<{ id: string; youtube_id: string; value: ReviewedImport }>;
  rejected: Array<{ id: string; youtube_id: string; reasons: string[] }>;
  unmatchedFilledIds: string[];
  items: Array<{
    id: string;
    youtube_id: string;
    title: string;
    importer_ok: boolean;
    reasons: string[];
    would_mark_reviewed: boolean;
    summary_source: "reviewed" | null;
  }>;
};

export function cuesFromUnknown(value: unknown): SourceCue[] | null {
  return readSourceCues(value).cues;
}

/** A file that says it is not human-reviewed or not user-approved cannot be published. */
export function filePublishBlockers(file: Pick<FilledFile, "editorial_meta">): string[] {
  const meta = file.editorial_meta;
  if (!meta) return [];
  const reasons: string[] = [];
  if (meta.human_reviewed === false) reasons.push("human_reviewed_false");
  if (meta.user_approved === false) reasons.push("user_approved_false");
  return reasons;
}

export function validateReviewedImport(
  fields: ImportableFields,
  title: string,
): { ok: true; value: ReviewedImport } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];
  if (fields.human_reviewed === false) reasons.push("human_reviewed_false");
  if (fields.user_approved === false) reasons.push("user_approved_false");
  if (fields.source_cues_invalid) reasons.push("invalid_source_cues");
  const quality = assessPublicSummary({
    title,
    summary: fields.summary,
    summaryPoints: fields.summary_points,
    hook: fields.hook,
    takeaway: fields.takeaway,
  });
  if (!quality.ok) reasons.push(...quality.reasons);
  const sentences = fields.summary
    .split(/[.!?。！？]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 8);
  if (sentences.length < 2) reasons.push("needs_two_sentences");

  const points = stringList(fields.summary_points)
    .map((point) => point.trim())
    .filter(Boolean);
  const distinct = new Set(points.map((point) => point.replace(/\s+/g, "")));
  if (points.length < 2 || distinct.size < 2) reasons.push("needs_two_distinct_steps");
  if (points.some((point) => point.length < 10)) reasons.push("step_too_short");
  if (points.some((point) => point === fields.summary.trim())) reasons.push("step_copies_summary");

  const costs = fields.costs?.trim() || "";
  const limitations = fields.limitations?.trim() || "";
  if (costs && assessPublicSummary({ title, summary: costs }).reasons.includes("promo_or_signup")) {
    reasons.push("costs_look_like_promo");
  }
  if (limitations && assessPublicSummary({ title, summary: limitations }).reasons.includes("promo_or_signup")) {
    reasons.push("limitations_look_like_promo");
  }

  if (reasons.length > 0) return { ok: false, reasons: [...new Set(reasons)] };
  return {
    ok: true,
    value: {
      summary: fields.summary.trim(),
      summary_points: points,
      hook: fields.hook.trim(),
      tool_features: stringList(fields.tool_features),
      difficulty: fields.difficulty.trim(),
      takeaway: fields.takeaway.trim(),
      useful_facts: stringList(fields.useful_facts),
      costs,
      limitations,
      source_cues: fields.source_cues ?? null,
      summary_source: "reviewed",
    },
  };
}

export function buildReviewedUpdate(value: ReviewedImport, verifiedAt: string): Record<string, string | string[] | SourceCue[] | null> {
  const update: Record<string, string | string[] | SourceCue[] | null> = {
    ...toVideoUpdate(value),
    summary_source: "reviewed",
    summary_verified_at: verifiedAt,
  };
  if (value.source_cues && value.source_cues.length > 0) update.source_cues = value.source_cues;
  if (value.useful_facts.length > 0) update.useful_facts = value.useful_facts;
  if (value.costs) update.costs = value.costs;
  if (value.limitations) update.limitations = value.limitations;
  return update;
}

/**
 * The importer decision. Draft files with human_reviewed or user_approved set false
 * produce no accepted rows and are never marked reviewed.
 */
export function evaluateSummaryPlan(pending: PendingFile, filled: FilledFile): ImportDecision {
  const blockers = filePublishBlockers(filled);
  const plan = planSummaryWrites(pending, filled);
  const accepted: ImportDecision["accepted"] = [];
  const rejected: ImportDecision["rejected"] = [];
  const items: ImportDecision["items"] = [];

  for (const write of plan.writes) {
    const sourceItem = pending.items.find((item) => item.id === write.id || item.youtube_id === write.youtube_id);
    const checked = validateReviewedImport(write.fields, sourceItem?.title ?? "");
    const qualityReasons = checked.ok ? [] : checked.reasons;
    const reasons =
      blockers.length > 0 ? [...new Set([...blockers, ...qualityReasons, "not_approved_for_publish"])] : qualityReasons;
    const wouldMarkReviewed = blockers.length === 0 && checked.ok;
    items.push({
      id: write.id,
      youtube_id: write.youtube_id,
      title: sourceItem?.title ?? "",
      importer_ok: checked.ok,
      reasons,
      would_mark_reviewed: wouldMarkReviewed,
      summary_source: wouldMarkReviewed ? "reviewed" : null,
    });
    if (!wouldMarkReviewed) {
      rejected.push({ id: write.id, youtube_id: write.youtube_id, reasons });
      continue;
    }
    accepted.push({ id: write.id, youtube_id: write.youtube_id, value: checked.value });
  }

  return {
    blockers,
    publishBlocked: blockers.length > 0,
    accepted,
    rejected,
    unmatchedFilledIds: plan.unmatchedFilledIds,
    items,
  };
}
