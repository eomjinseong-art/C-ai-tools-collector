# ai-tools-collector

한국 AI 툴 교육 사이트([ai-tools-site](../ai-tools-site))에 데이터를 공급하는 수집기입니다.
매일 GitHub Actions에서 실행되어, 30개 카테고리별로 YouTube에서 영상을 검색하고
OpenAI로 요약한 뒤 Supabase에 저장합니다.

## 동작 방식

1. Supabase `categories` 테이블에서 카테고리(30개)와 검색 키워드를 읽어옵니다.
2. 카테고리별 키워드로 YouTube Data API `search.list`를 호출합니다 (`regionCode=KR`, `relevanceLanguage=ko`).
3. `excluded_videos`에 등록된 영상은 제외합니다.
4. `videos.list`로 조회수·좋아요·길이를 가져와 60초 미만(쇼츠성 영상)은 제외합니다.
5. 조회수와 게시일을 함께 고려한 점수(`view_count / (daysAgo+2)^1.4`)로 정렬해 카테고리별 `target_video_count`만큼(기본 10개, 신규 소규모 카테고리는 5개) 상위 영상을 선정합니다.
6. 새로 추가되었거나 제목/설명이 바뀐 영상만 자막(가능한 경우)과 함께 OpenAI로 요약합니다. 모델은 `OPENAI_MODEL`이고, 비어 있으면 `gpt-4.1-mini`를 사용합니다. 이미 요약된 영상은 API 비용을 아끼기 위해 건너뜁니다.
7. 카테고리별로 target 개수 밖으로 밀려난 기존 영상은 삭제하고, 최신 top-N을 upsert합니다.

## 필요한 GitHub Secrets

| Secret | 설명 |
|---|---|
| `SUPABASE_URL` | Supabase 프로젝트 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role 키 (RLS 우회, 쓰기 권한) |
| `YOUTUBE_API_KEY` | Google Cloud Console에서 발급한 YouTube Data API v3 키 |
| `OPENAI_API_KEY` | platform.openai.com에서 발급한 API 키 |

요약·가이드북에 쓰는 모델은 시크릿이 아니라 환경변수 `OPENAI_MODEL`입니다. 지정하지 않으면 `gpt-4.1-mini`입니다. 일일 워크플로는 `OPENAI_API_KEY`만 넘기고, 모델은 코드 기본값을 사용합니다.

## 로컬 실행

```bash
npm install
cp .env.example .env   # 값 채우기
npm run collect
```

## 최초 1회: DB 스키마/카테고리 적용

Supabase SQL Editor에서 순서대로 실행하세요.

1. `supabase/schema.sql` — 테이블/인덱스/RLS 생성
2. `supabase/seed_categories.sql` — 최초 20개 카테고리 삽입 (재실행해도 안전, slug 기준 upsert)
3. `supabase/seed_categories_batch2.sql` — 추가 10개 카테고리 삽입 (총 30개, `target_video_count=5`로 소규모 시작)

기존에 이미 `seed_categories.sql`을 실행한 DB라면, `migration_add_target_video_count.sql`을 먼저 실행한 뒤 `seed_categories_batch2.sql`을 실행하세요.

## YouTube API 쿼터 참고

- `search.list`는 호출당 100 유닛을 소모합니다. 카테고리 30개(기존 20개 × 키워드 3~4개 + 신규 10개 × 키워드 2개) ≈ 검색 80회 ≈ **8,000 유닛/일**로, 기본 일일 쿼터(10,000 유닛)에 근접합니다.
- 카테고리당 키워드를 무분별하게 늘리면 쿼터를 초과할 수 있습니다. 늘리려면 Google Cloud Console에서 쿼터 증설을 먼저 요청하세요.
- `videos.list`는 배치 조회(최대 50개/호출)라 유닛 소모가 미미합니다.

## 자막 요약에 대해

`youtube-transcript`로 한국어 자막을 시도하지만, 자막이 없거나 비활성화된 영상이 많아
실패하는 경우가 흔합니다. 이 경우 제목/설명만으로 요약하며, 별도 오류 처리는 하지 않습니다(정상 동작).
