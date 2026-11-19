import fs from "node:fs";
import path from "node:path";
import { stringList, type SummaryFields } from "./summary-fields.js";
import { readSourceCues, type SourceCue } from "./summary-quality.js";

export const PENDING_RELATIVE_PATH = "data/pending-summaries.json";
export const FILLED_RELATIVE_PATH = "data/filled-summaries.json";
export const PENDING_ALERT_THRESHOLD = 40;

export const DEFAULT_PENDING_NOTE =
  "needs_summary가 true인 항목은 한국어 요약이 필요합니다. 작성 방법은 docs/CONTENT_QUEUE.md";

export const DEFAULT_FILLED_NOTE =
  "이 파일에 한국어 요약을 채우면 npm run apply-summaries 가 Supabase에 반영하고 대기 목록에서 지웁니다. 스키마는 docs/CONTENT_QUEUE.md";

export type PendingSummaryItem = {
  id: string;
  needs_summary: boolean;
  kind: "video";
  youtube_id: string;
  title: string;
  category_slug: string;
  source_url: string;
  fallback_summary: string;
  description_excerpt: string;
  queued_at: string;
  summary?: string;
  summary_points?: string[];
  hook?: string;
  tool_features?: string[];
  difficulty?: string;
  takeaway?: string;
};

export type FilledSummaryItem = {
  id: string;
  summary?: string;
  summary_points?: string[];
  hook?: string;
  tool_features?: string[];
  difficulty?: string;
  takeaway?: string;
  useful_facts?: string[];
  costs?: string;
  limitations?: string;
  source_cues?: SourceCue[] | null;
  human_reviewed?: boolean;
  user_approved?: boolean;
};

export type EditorialMeta = {
  human_reviewed?: boolean;
  user_approved?: boolean;
  deployed?: boolean;
};

export type EditorSummaryFields = SummaryFields & {
  source_cues: SourceCue[] | null;
  source_cues_invalid: boolean;
  human_reviewed?: boolean;
  user_approved?: boolean;
};

export type PendingFile = {
  version: 1;
  note?: string;
  items: PendingSummaryItem[];
};

export type FilledFile = {
  version: 1;
  note?: string;
  editorial_meta?: EditorialMeta;
  items: FilledSummaryItem[];
};

export type PlannedWrite = {
  id: string;
  youtube_id: string;
  fields: EditorSummaryFields;
};

export function youtubeWatchUrl(youtubeId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(youtubeId)}`;
}

export function canonicalYoutubeId(id: string): string | null {
  const trimmed = id.trim();
  if (!trimmed) return null;
  const raw = trimmed.startsWith("youtube:") ? trimmed.slice("youtube:".length).trim() : trimmed;
  if (!/^[\w-]{6,64}$/.test(raw)) return null;
  return raw;
}

export function pendingItemId(youtubeId: string): string {
  return `youtube:${youtubeId}`;
}

function queuePath(root: string, relative: string): string {
  return path.join(root, relative);
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
}

function writeJson(filePath: string, value: unknown): void {
  const next = `${JSON.stringify(value, null, 2)}\n`;
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, "utf8") === next) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, next);
  fs.renameSync(tmp, filePath);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function assertVersion(record: Record<string, unknown>, label: string): void {
  if (record.version !== 1) {
    throw new Error(`${label} version must be 1`);
  }
}

function parsePendingItem(value: unknown, index: number): PendingSummaryItem {
  const record = asRecord(value, `pending item ${index}`);
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!id) throw new Error(`pending item ${index} is missing id`);
  const youtubeId =
    (typeof record.youtube_id === "string" && canonicalYoutubeId(record.youtube_id)) ||
    canonicalYoutubeId(id);
  if (!youtubeId) throw new Error(`pending item ${id} is missing youtube_id`);
  return {
    ...(record as unknown as PendingSummaryItem),
    id: id.startsWith("youtube:") ? id : pendingItemId(youtubeId),
    needs_summary: typeof record.needs_summary === "boolean" ? record.needs_summary : true,
    kind: "video",
    youtube_id: youtubeId,
    title: typeof record.title === "string" ? record.title : "",
    category_slug: typeof record.category_slug === "string" ? record.category_slug : "",
    source_url: typeof record.source_url === "string" ? record.source_url : youtubeWatchUrl(youtubeId),
    fallback_summary: typeof record.fallback_summary === "string" ? record.fallback_summary : "",
    description_excerpt: typeof record.description_excerpt === "string" ? record.description_excerpt : "",
    queued_at: typeof record.queued_at === "string" ? record.queued_at : new Date(0).toISOString(),
  };
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function parseEditorialMeta(value: unknown): EditorialMeta | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const meta: EditorialMeta = {};
  const humanReviewed = optionalBoolean(record.human_reviewed);
  const userApproved = optionalBoolean(record.user_approved);
  const deployed = optionalBoolean(record.deployed);
  if (humanReviewed !== undefined) meta.human_reviewed = humanReviewed;
  if (userApproved !== undefined) meta.user_approved = userApproved;
  if (deployed !== undefined) meta.deployed = deployed;
  return Object.keys(meta).length > 0 ? meta : undefined;
}

function parseFilledItem(value: unknown, index: number): FilledSummaryItem {
  const record = asRecord(value, `filled item ${index}`);
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!id) throw new Error(`filled item ${index} is missing id`);
  return record as unknown as FilledSummaryItem;
}

export function emptyPendingFile(): PendingFile {
  return { version: 1, note: DEFAULT_PENDING_NOTE, items: [] };
}

export function emptyFilledFile(): FilledFile {
  return { version: 1, note: DEFAULT_FILLED_NOTE, items: [] };
}

export function loadPendingFile(root = process.cwd()): PendingFile {
  const filePath = queuePath(root, PENDING_RELATIVE_PATH);
  if (!fs.existsSync(filePath)) return emptyPendingFile();
  const record = asRecord(readJson(filePath), PENDING_RELATIVE_PATH);
  assertVersion(record, PENDING_RELATIVE_PATH);
  if (!Array.isArray(record.items)) throw new Error(`${PENDING_RELATIVE_PATH} items must be an array`);
  return {
    version: 1,
    note: typeof record.note === "string" ? record.note : DEFAULT_PENDING_NOTE,
    items: record.items.map((item, index) => parsePendingItem(item, index)),
  };
}

export function loadFilledFile(root = process.cwd()): FilledFile {
  const filePath = queuePath(root, FILLED_RELATIVE_PATH);
  if (!fs.existsSync(filePath)) return emptyFilledFile();
  const record = asRecord(readJson(filePath), FILLED_RELATIVE_PATH);
  assertVersion(record, FILLED_RELATIVE_PATH);
  if (!Array.isArray(record.items)) throw new Error(`${FILLED_RELATIVE_PATH} items must be an array`);
  const editorialMeta = parseEditorialMeta(record.editorial_meta);
  return {
    version: 1,
    note: typeof record.note === "string" ? record.note : DEFAULT_FILLED_NOTE,
    ...(editorialMeta ? { editorial_meta: editorialMeta } : {}),
    items: record.items.map((item, index) => parseFilledItem(item, index)),
  };
}

export function savePendingFile(file: PendingFile, root = process.cwd()): void {
  writeJson(queuePath(root, PENDING_RELATIVE_PATH), file);
}

export function saveFilledFile(file: FilledFile, root = process.cwd()): void {
  writeJson(queuePath(root, FILLED_RELATIVE_PATH), file);
}

export function pendingCount(file: PendingFile): number {
  return file.items.length;
}

function hasEditorSummary(item: { summary?: string }): boolean {
  return typeof item.summary === "string" && item.summary.trim().length > 0;
}

export function enqueuePending(file: PendingFile, incoming: PendingSummaryItem): PendingFile {
  const index = file.items.findIndex(
    (item) => item.id === incoming.id || item.youtube_id === incoming.youtube_id,
  );
  if (index === -1) return { ...file, items: [...file.items, incoming] };

  const current = file.items[index];
  const editorFilled = hasEditorSummary(current);
  const next: PendingSummaryItem = {
    ...current,
    ...incoming,
    id: current.id,
    queued_at: current.queued_at,
    needs_summary: editorFilled ? current.needs_summary : true,
    summary: current.summary,
    summary_points: current.summary_points,
    hook: current.hook,
    tool_features: current.tool_features,
    difficulty: current.difficulty,
    takeaway: current.takeaway,
  };
  if (JSON.stringify(current) === JSON.stringify(next)) return file;
  const items = file.items.slice();
  items[index] = next;
  return { ...file, items };
}

/** Drop items in one category that are neither still stored nor in today's top N. */
export function retainPendingForCategory(
  file: PendingFile,
  categorySlug: string,
  keepYoutubeIds: ReadonlySet<string>,
): PendingFile {
  const items = file.items.filter(
    (item) => item.category_slug !== categorySlug || keepYoutubeIds.has(item.youtube_id),
  );
  if (items.length === file.items.length) return file;
  return { ...file, items };
}

export function dropPendingYoutubeIds(file: PendingFile, youtubeIds: readonly string[]): PendingFile {
  if (youtubeIds.length === 0) return file;
  const drop = new Set(youtubeIds);
  const items = file.items.filter((item) => !drop.has(item.youtube_id));
  if (items.length === file.items.length) return file;
  return { ...file, items };
}

export function dropFilledYoutubeIds(file: FilledFile, youtubeIds: readonly string[]): FilledFile {
  if (youtubeIds.length === 0) return file;
  const drop = new Set(youtubeIds);
  const items = file.items.filter((item) => {
    const youtubeId = canonicalYoutubeId(item.id);
    return !youtubeId || !drop.has(youtubeId);
  });
  if (items.length === file.items.length) return file;
  return { ...file, items };
}

function fieldsFrom(source: {
  summary?: string;
  summary_points?: unknown;
  hook?: string;
  tool_features?: unknown;
  difficulty?: string;
  takeaway?: string;
  useful_facts?: unknown;
  costs?: unknown;
  limitations?: unknown;
  source_cues?: unknown;
  human_reviewed?: unknown;
  user_approved?: unknown;
}): EditorSummaryFields | null {
  if (!hasEditorSummary(source) || source.summary === undefined) return null;
  const cues = readSourceCues(source.source_cues);
  const humanReviewed = optionalBoolean(source.human_reviewed);
  const userApproved = optionalBoolean(source.user_approved);
  return {
    summary: source.summary.trim(),
    summary_points: stringList(source.summary_points),
    hook: typeof source.hook === "string" ? source.hook.trim() : "",
    tool_features: stringList(source.tool_features),
    difficulty: typeof source.difficulty === "string" ? source.difficulty.trim() : "",
    takeaway: typeof source.takeaway === "string" ? source.takeaway.trim() : "",
    useful_facts: stringList(source.useful_facts),
    costs: typeof source.costs === "string" ? source.costs.trim() : "",
    limitations: typeof source.limitations === "string" ? source.limitations.trim() : "",
    source_cues: cues.cues,
    source_cues_invalid: cues.invalid,
    ...(humanReviewed !== undefined ? { human_reviewed: humanReviewed } : {}),
    ...(userApproved !== undefined ? { user_approved: userApproved } : {}),
  };
}

function findFilled(item: PendingSummaryItem, filled: FilledFile): FilledSummaryItem | undefined {
  return filled.items.find((candidate) => {
    const candidateId = canonicalYoutubeId(candidate.id);
    return candidate.id === item.id || candidateId === item.youtube_id;
  });
}

export function planSummaryWrites(
  pending: PendingFile,
  filled: FilledFile,
): { writes: PlannedWrite[]; unmatchedFilledIds: string[] } {
  const matchedFilled = new Set<FilledSummaryItem>();
  const writes: PlannedWrite[] = [];

  for (const item of pending.items) {
    const fromFile = findFilled(item, filled);
    const fields = (fromFile && fieldsFrom(fromFile)) || fieldsFrom(item);
    if (!fields) continue;
    if (fromFile) matchedFilled.add(fromFile);
    writes.push({ id: item.id, youtube_id: item.youtube_id, fields });
  }

  const unmatchedFilledIds = filled.items
    .filter((item) => !matchedFilled.has(item))
    .map((item) => item.id);

  return { writes, unmatchedFilledIds };
}

export function withoutApplied(
  pending: PendingFile,
  filled: FilledFile,
  appliedIds: ReadonlySet<string>,
): { pending: PendingFile; filled: FilledFile } {
  if (appliedIds.size === 0) return { pending, filled };
  const appliedYoutubeIds = new Set(
    [...appliedIds].map((id) => canonicalYoutubeId(id)).filter((id): id is string => Boolean(id)),
  );
  return {
    pending: {
      ...pending,
      items: pending.items.filter((item) => !appliedIds.has(item.id) && !appliedYoutubeIds.has(item.youtube_id)),
    },
    filled: {
      ...filled,
      items: filled.items.filter((item) => {
        if (appliedIds.has(item.id)) return false;
        const youtubeId = canonicalYoutubeId(item.id);
        return !youtubeId || !appliedYoutubeIds.has(youtubeId);
      }),
    },
  };
}
