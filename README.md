# ai-tools-collector

한국 AI 툴 교육 사이트([ai-tools-site](../ai-tools-site))에 데이터를 공급하는 수집기입니다.
매일 GitHub Actions에서 실행되어, 30개 카테고리별로 YouTube에서 영상을 검색하고
Supabase에 저장합니다. 새 영상에는 설명에서 만든 임시 요약을 넣고, 한국어 요약은 `data/pending-summaries.json`에 올려 사람이 채웁니다. 작성 방법과 적용 명령은 [docs/CONTENT_QUEUE.md](docs/CONTENT_QUEUE.md)에 있습니다.

## 동작 방식

1. Supabase `categories` 테이블에서 카테고리(30개)와 검색 키워드를 읽어옵니다.
2. 카테고리별 키워드로 YouTube Data API `search.list`를 호출합니다 (`regionCode=KR`, `relevanceLanguage=ko`).
3. `excluded_videos`에 등록된 영상은 제외합니다.
4. `videos.list`로 조회수·좋아요·길이를 가져와 60초 미만(쇼츠성 영상)은 제외합니다.
5. 조회수와 게시일을 함께 고려한 점수(`view_count / (daysAgo+2)^1.4`)로 정렬해 카테고리별 `target_video_count`만큼(기본 10개, 신규 소규모 카테고리는 5개) 상위 영상을 선정합니다.
6. 새 영상이거나 제목·설명이 바뀌었거나 요약이 비어 있으면, 실제 자막이 있으면 자막을, 없으면 설명 첫 문단을 임시 요약 후보로 둡니다. 홍보·제목 복사·반복·링크만 있는 문장은 저장하지 않습니다. 통과한 요약과 사람이 검증한 요약은 더 나쁜 후보로 바꾸지 않습니다. 같은 영상을 `data/pending-summaries.json`에 `needs_summary: true`로 올리고, `id`는 `youtube:<id>`로 유지합니다.
7. 카테고리별 target 개수 안의 영상만 `rank` 1..N 추천으로 두고, 밖으로 밀린 기존 영상은 지우지 않고 `rank` 1000 보관으로 남깁니다. 제외 목록은 `status=excluded`로 숨기고 행은 남깁니다.
8. `npm run apply-summaries`는 검증만 합니다. 초안 파일(`editorial_meta.human_reviewed` 또는 `user_approved`가 `false`)은 반영하지 않습니다. 데이터베이스에 넣으려면 provenance 마이그레이션 뒤 `npm run apply-summaries -- --apply`입니다.
9. 대기 항목이 40개를 넘으면 제목 `요약 대기 많음` 이슈를 열거나 본문을 갱신합니다.

## 필요한 GitHub Secrets

| Secret | 설명 |
|---|---|
| `SUPABASE_URL` | Supabase 프로젝트 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role 키 (RLS 우회, 쓰기 권한) |
| `YOUTUBE_API_KEY` | Google Cloud Console에서 발급한 YouTube Data API v3 키 |

일일 수집과 요약 적용 워크플로는 위 세 값만 사용합니다. `GITHUB_TOKEN`은 Actions가 대기 이슈를 열 때 스스로 제공합니다.

수집이 끝난 뒤 일일 워크플로는 `npm run apply-summaries`를 인자 없이 실행합니다. 이 호출은 dry-run이라 Supabase에 요약을 쓰지 않습니다. `main`에서 두 JSON 파일이 푸시되어도 같은 dry-run입니다. 사람이 승인한 요약만 로컬에서 `--apply`로 반영합니다.

## 로컬 실행

```bash
npm install
cp .env.example .env   # 값 채우기
npm run collect
npm run apply-summaries   # 검증만. DB는 바꾸지 않음
npm run apply-summaries -- --apply   # provenance 마이그레이션 후에만 반영
npm run check-pending     # 대기 개수를 출력. 40개 초과이고 토큰이 있으면 이슈를 갱신
```

## 최초 1회: DB 스키마/카테고리 적용

Supabase SQL Editor에서 순서대로 실행하세요.

1. `supabase/schema.sql` — 테이블/인덱스/RLS 생성
2. `supabase/seed_categories.sql` — 최초 20개 카테고리 삽입 (재실행해도 안전, slug 기준 upsert)
3. `supabase/seed_categories_batch2.sql` — 추가 10개 카테고리 삽입 (총 30개, `target_video_count=5`로 소규모 시작)

기존에 이미 `seed_categories.sql`을 실행한 DB라면, `migration_add_target_video_count.sql`을 먼저 실행한 뒤 `seed_categories_batch2.sql`을 실행하세요.

이미 운영 중인 데이터베이스에는 `supabase/migration_add_summary_provenance.sql`을 사이트 배포 전에 실행합니다. 이 파일은 컬럼만 추가합니다.

## YouTube API 쿼터 참고

- `search.list`는 호출당 100 유닛을 소모합니다. 카테고리 30개(기존 20개 × 키워드 3~4개 + 신규 10개 × 키워드 2개) ≈ 검색 80회 ≈ **8,000 유닛/일**로, 기본 일일 쿼터(10,000 유닛)에 근접합니다.
- 카테고리당 키워드를 무분별하게 늘리면 쿼터를 초과할 수 있습니다. 늘리려면 Google Cloud Console에서 쿼터 증설을 먼저 요청하세요.
- `videos.list`는 배치 조회(최대 50개/호출)라 유닛 소모가 미미합니다.

## 자막에 대해

요약을 다시 쓸 때는 `youtube-transcript`로 한국어 자막을 시도합니다. 자막이 없거나 실패하면 설명 발췌를 후보로 두고, 그것도 품질을 통과하지 못하면 요약 본문을 비워 둡니다. 자막 시각은 제공자가 준 오프셋만 저장합니다.

보관과 요약 규칙, 배포 순서는 [docs/ARCHIVE_AND_SUMMARIES.md](docs/ARCHIVE_AND_SUMMARIES.md)에 있습니다. 순서는 provenance 마이그레이션, 사이트, 그 다음 수집기입니다.
