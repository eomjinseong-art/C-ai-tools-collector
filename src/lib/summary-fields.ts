export type SummaryFields = {
  summary: string;
  summary_points: string[];
  hook: string;
  tool_features: string[];
  difficulty: string;
  takeaway: string;
};

export const EMPTY_SUMMARY: SummaryFields = {
  summary: "",
  summary_points: [],
  hook: "",
  tool_features: [],
  difficulty: "",
  takeaway: "",
};

export function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

/** Fields an editor actually supplied. Empty optionals are omitted so a partial fill does not blank the row. */
export function toVideoUpdate(fields: SummaryFields): Record<string, string | string[]> {
  const update: Record<string, string | string[]> = {};
  if (fields.summary.trim()) update.summary = fields.summary.trim();
  if (fields.summary_points.length) update.summary_points = fields.summary_points;
  if (fields.hook.trim()) update.hook = fields.hook.trim();
  if (fields.tool_features.length) update.tool_features = fields.tool_features;
  if (fields.difficulty.trim()) update.difficulty = fields.difficulty.trim();
  if (fields.takeaway.trim()) update.takeaway = fields.takeaway.trim();
  return update;
}
