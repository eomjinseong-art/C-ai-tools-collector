import "dotenv/config";
import { supabase, type Category } from "./lib/supabase.js";
import { generateGuidebookSections } from "./lib/guidebook-summarize.js";

const MIN_VIDEOS_PER_CATEGORY = 3; // not enough source material below this — skip rather than force sections

async function buildCategoryGuidebook(category: Category): Promise<void> {
  const { data: videos, error: videosErr } = await supabase
    .from("videos")
    .select("id, title, summary_points")
    .eq("category_id", category.id)
    .eq("status", "published")
    .order("rank", { ascending: true });
  if (videosErr) throw videosErr;

  if (!videos || videos.length < MIN_VIDEOS_PER_CATEGORY) {
    console.log(`\n=== [${category.name}] 영상 ${videos?.length ?? 0}개 — 가이드북 생성 스킵 (최소 ${MIN_VIDEOS_PER_CATEGORY}개 필요) ===`);
    return;
  }

  console.log(`\n=== [${category.name}] 가이드북 생성 시작 (영상 ${videos.length}개) ===`);

  const inputVideos = videos.map((v, index) => ({
    index,
    title: v.title,
    summary_points: (v.summary_points ?? []) as string[],
  }));

  const sections = generateGuidebookSections(category.name, inputVideos);
  if (sections.length === 0) {
    console.log("  섹션 생성 실패 또는 근거 부족, 스킵");
    return;
  }

  const rows = sections.map((section, i) => ({
    category_id: category.id,
    slug: `${category.slug}-${i + 1}`,
    title: section.title,
    content_markdown: section.content_markdown,
    source_video_ids: section.source_video_indexes
      .map((idx) => videos[idx]?.id)
      .filter((id): id is string => Boolean(id)),
    sort_order: i + 1,
    is_published: true,
  }));

  // Replace strategy: this category's guidebook is fully regenerated each run.
  const { error: deleteErr } = await supabase
    .from("guidebook_sections")
    .delete()
    .eq("category_id", category.id);
  if (deleteErr) throw deleteErr;

  const { error: insertErr } = await supabase.from("guidebook_sections").insert(rows);
  if (insertErr) throw insertErr;

  console.log(`  섹션 ${rows.length}개 생성 완료: ${rows.map((r) => r.title).join(", ")}`);
}

async function main() {
  const { data: categories, error: catErr } = await supabase
    .from("categories")
    .select("id, slug, name, search_keywords, is_trend")
    .order("sort_order");
  if (catErr) throw catErr;
  if (!categories || categories.length === 0) {
    console.log("카테고리가 없습니다.");
    return;
  }

  for (const category of categories as Category[]) {
    try {
      await buildCategoryGuidebook(category);
    } catch (err) {
      console.error(`[${category.name}] 가이드북 생성 중 오류:`, err);
    }
  }

  console.log("\n전체 가이드북 생성 완료");
}

main().catch((err) => {
  console.error("가이드북 생성 스크립트 실패:", err);
  process.exit(1);
});
