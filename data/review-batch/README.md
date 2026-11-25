# 요약 검토 배치

이 폴더는 공개 대기열 `data/pending-summaries.json`에서 만들었습니다. 비공개 데이터베이스나 비밀 값은 넣지 않습니다.

- `queue-index.json`: 현재 대기 92건. 품질 실패 49건.
- `top-batch.json`: 트렌드 카테고리를 뺀 우선 12건.
- 자막을 받은 항목: 0. 자막이 없으면 `caption_status` 가 `unavailable` 이고 항목은 계속 대기입니다.
- 사람 검토 글을 데이터베이스에 넣으려면 `data/filled-summaries.json`에 적은 뒤 `npm run apply-summaries` 로 검증만 하고, 통과한 뒤에만 `npm run apply-summaries -- --apply` 를 실행합니다.
- `--apply` 는 `data/backups/` 에 원본 대기 파일을 복사한 다음 반영합니다. 검증에 실패한 항목은 대기에서 빠지지 않습니다.

공개 사이트: https://ai-tools-site-liart-one.vercel.app
