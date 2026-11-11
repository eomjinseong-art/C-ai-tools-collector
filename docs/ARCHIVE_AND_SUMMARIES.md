# 보관과 요약

수집기는 카테고리 상위 목록에서 빠진 영상 행을 지우지 않습니다. `rank` 1부터 `target_video_count`까지가 추천이고, `rank` 1000은 보관입니다. `excluded_videos`에 있는 영상은 `status = excluded`로 공개 목록에서만 빠지고 행은 남습니다.

홍보·신청·링크만 있는 문장, 제목 반복, 같은 줄 반복은 `summary`에 저장하지 않습니다. 통과한 설명 발췌는 `summary_source = description`, 실제 자막이 있을 때만 `transcript`를 적습니다. `source_cues`는 제공자가 준 오프셋만 담고, 없는 시각은 만들지 않습니다. `summary_generated_at`은 그 문장을 저장한 시각이고 영상 게시 시각이 아닙니다. 사람이 승인하지 않은 초안은 `reviewed`와 `summary_verified_at`을 받지 않습니다. 파일의 `editorial_meta.human_reviewed` 또는 `user_approved`가 `false`이면 적용을 거절합니다.

이미 품질을 통과한 요약은 홍보문이나 제목 복사로 바꾸지 않습니다. `summary_source = reviewed`이고 `summary_verified_at`이 있는 글은 자동 수집이 덮어쓰지 않습니다. 자막으로 저장된 통과 요약은 설명 발췌로 낮추지 않습니다.

## 배포 순서

1. `supabase/migration_add_summary_provenance.sql`을 SQL 편집기에서 실행합니다. nullable 컬럼과 체크만 추가합니다. 행을 지우거나 기존 요약을 덮어쓰지 않습니다.
2. 사이트를 배포합니다. 추천 목록은 `rank < 1000`만 보여주고, 보관 목록은 `rank = 1000`을 페이지로 나눕니다. `status = excluded`는 숨깁니다.
3. 그 다음 수집기를 배포합니다. 컬럼이 아직 없으면 수집기는 그 값을 빼고 저장하며, 통과한 기존 요약은 유지합니다. 출처 시각을 남기려면 마이그레이션이 먼저입니다. `npm run apply-summaries -- --apply`는 컬럼이 없으면 한 행도 갱신하지 않습니다.

`npm run apply-summaries`는 기본이 dry-run입니다. 데이터베이스에 넣으려면 검증을 통과한 뒤 `npm run apply-summaries -- --apply`를 실행합니다. 쓰기가 시작되기 전에 `data/backups/`에 대기 파일 원본을 복사합니다. 일일 워크플로는 `--apply`를 붙이지 않습니다.

검토 배치를 다시 만들려면 `npm run export-review-batch -- --fetch-captions --limit=12`입니다. 결과 경로는 `data/review-batch/`입니다.
