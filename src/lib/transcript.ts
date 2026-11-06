import { YoutubeTranscript } from "youtube-transcript";
import type { SourceCue } from "./summary-quality.js";

export type TranscriptSegment = {
  text?: string;
  offset?: number;
  duration?: number;
};

/**
 * Best-effort caption fetch. Missing captions are normal.
 * Offsets are kept only when the provider returns a finite number.
 * Nothing is invented when the request fails.
 */
/**
 * youtube-transcript keeps srv3 offsets in milliseconds and classic XML offsets in seconds.
 * The unit is decided once for the whole track from the median duration.
 * A fractional duration is classic seconds. Median duration >= 100 is srv3 milliseconds.
 * Offsets are not guessed one cue at a time, and missing offsets are dropped.
 */
export function cueOffsetUnit(segments: readonly TranscriptSegment[]): "milliseconds" | "seconds" {
  let sawFraction = false;
  const durations: number[] = [];
  for (const segment of segments) {
    if (typeof segment.offset === "number" && Number.isFinite(segment.offset) && !Number.isInteger(segment.offset)) {
      sawFraction = true;
    }
    if (typeof segment.duration === "number" && Number.isFinite(segment.duration)) {
      if (!Number.isInteger(segment.duration)) sawFraction = true;
      if (segment.duration > 0) durations.push(segment.duration);
    }
  }
  if (sawFraction || durations.length === 0) return "seconds";
  durations.sort((a, b) => a - b);
  const median = durations[Math.floor(durations.length / 2)] ?? 0;
  return median >= 100 ? "milliseconds" : "seconds";
}

export function cuesFromSegments(segments: readonly TranscriptSegment[], limit = 24): SourceCue[] {
  const unit = cueOffsetUnit(segments);
  const cues: SourceCue[] = [];
  for (const segment of segments) {
    const text = (segment.text ?? "").replace(/\s+/g, " ").trim();
    const offset = segment.offset;
    if (!text || typeof offset !== "number" || !Number.isFinite(offset) || offset < 0) continue;
    const offsetSeconds = Math.round(unit === "milliseconds" ? offset / 1000 : offset);
    cues.push({ text: text.slice(0, 180), offsetSeconds });
    if (cues.length >= limit) break;
  }
  return cues;
}

async function readSegments(videoId: string, lang?: string): Promise<TranscriptSegment[] | null> {
  try {
    const segments = lang
      ? await YoutubeTranscript.fetchTranscript(videoId, { lang })
      : await YoutubeTranscript.fetchTranscript(videoId);
    return segments.length > 0 ? segments : null;
  } catch {
    return null;
  }
}

export async function fetchTranscript(
  videoId: string,
): Promise<{ text: string; lang: string; cues: SourceCue[] } | null> {
  const korean = await readSegments(videoId, "ko");
  const segments = korean ?? (await readSegments(videoId));
  if (!segments) return null;
  const cues = cuesFromSegments(segments);
  const text = segments
    .map((segment) => (segment.text ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
  if (!text) return null;
  return { text, lang: korean ? "ko" : "unknown", cues };
}
