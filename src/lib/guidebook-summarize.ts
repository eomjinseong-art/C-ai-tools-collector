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

/**
 * Build guidebook sections from titles and summary points already on the videos.
 * This stays local: scheduled workflows do not call an external model.
 */
export function generateGuidebookSections(
  categoryName: string,
  videos: GuidebookInputVideo[],
): GuidebookSectionDraft[] {
  const name = categoryName.trim() || "가이드";
  return videos
    .filter((video) => video.title.trim())
    .map((video) => {
      const title = video.title.trim();
      const points = video.summary_points.map((point) => point.trim()).filter(Boolean);
      const body = points.length
        ? points.map((point) => `- ${point}`).join("\n")
        : `${title} 영상에서 다루는 내용을 정리합니다.`;
      return {
        title,
        content_markdown: `**${name}**\n\n${body}`,
        source_video_indexes: [video.index],
      };
    });
}
