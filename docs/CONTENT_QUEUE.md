# 요약 대기열

일일 수집은 외부 LLM을 호출하지 않습니다. 새 영상이나 제목·설명이 바뀐 영상, 요약이 비어 있거나 `{`로 시작하는 깨진 요약은 설명에서 만든 임시 문장을 Supabase에 저장합니다. 임시 문장 순서는 다듬은 설명, `og:description`, 자막 첫 문단, 제목입니다. 그리고 그 영상을 저장소의 대기 파일에 `needs_summary: true`로 올립니다.

이미 요약이 있는 영상은 제목과 설명이 그대로면 다시 쓰지 않습니다.

## 파일

| 파일 | 역할 |
|---|---|
| `data/pending-summaries.json` | 수집기가 갱신하는 대기 목록 |
| `data/filled-summaries.json` | 한국어 요약을 적어 두는 형제 파일 |

대기 개수는 `data/pending-summaries.json`의 `items` 길이입니다. 40개를 넘으면 워크플로가 제목 `요약 대기 많음` 이슈를 열거나, 같은 제목의 이슈 본문을 갱신합니다. 닫혀 있으면 다시 엽니다.

## 대기 항목

`needs_summary`가 `true`이면 아직 한국어 요약이 필요합니다. 수집기는 `summary`를 비워 두고 `fallback_summary`만 채웁니다. `fallback_summary`는 사이트에 이미 보이는 임시 문장이지, 적용할 최종 요약이 아닙니다.

```json
{
  "version": 1,
  "note": "needs_summary가 true인 항목은 한국어 요약이 필요합니다. 작성 방법은 docs/CONTENT_QUEUE.md",
  "items": [
    {
      "id": "youtube:ytExample01",
      "needs_summary": true,
      "kind": "video",
      "youtube_id": "ytExample01",
      "title": "챗GPT로 보고서 초안 만들기",
      "category_slug": "chatgpt",
      "source_url": "https://www.youtube.com/watch?v=ytExample01",
      "fallback_summary": "챗GPT로 보고서 초안을 만드는 순서를 따라갑니다. 자료 정리와 문단 다듬기가 핵심입니다.",
      "description_excerpt": "챗GPT로 보고서 초안을 만드는 순서를 따라갑니다. 자료 정리와 문단 다듬기가 핵심입니다.",
      "queued_at": "2026-11-02T00:00:00.000Z"
    }
  ]
}
```

| 필드 | 의미 |
|---|---|
| `version` | `1`만 지원합니다. |
| `id` | `youtube:<youtube_id>` |
| `needs_summary` | `true`면 사람이 쓴 요약이 아직 없습니다. |
| `kind` | 현재는 `video` |
| `youtube_id` | Supabase `videos.youtube_id` |
| `title` | 영상 제목 |
| `category_slug` | 카테고리 슬러그 |
| `source_url` | YouTube 주소 |
| `fallback_summary` | 사이트에 넣어 둔 임시 요약 |
| `description_excerpt` | 다듬은 설명 발췌 |
| `queued_at` | 처음 대기열에 올린 시각 (ISO 8601) |

## 한국어 요약 채우기

두 가지 중 하나를 커밋합니다.

1. `data/filled-summaries.json`에 같은 `id`로 요약을 추가합니다. 대기 파일과 형제 파일에 둘 다 있으면 형제 파일을 적용합니다.
2. 대기 항목에 아래 요약 필드를 직접 넣습니다. `summary`가 비어 있지 않으면 적용 대상입니다. `needs_summary`는 `false`로 바꿉니다.

```json
{
  "version": 1,
  "note": "이 파일에 한국어 요약을 채우면 npm run apply-summaries 가 Supabase에 반영하고 대기 목록에서 지웁니다. 스키마는 docs/CONTENT_QUEUE.md",
  "items": [
    {
      "id": "youtube:ytExample01",
      "summary": "이 영상은 챗GPT로 보고서 초안을 만드는 과정을 보여 줍니다. 자료를 붙인 뒤 문단 구성과 말투를 고치는 순서로 진행합니다.",
      "summary_points": [
        "자료를 먼저 붙이고 초안을 받는다",
        "문단 순서와 말투를 이어서 고친다",
        "마지막에 사실 여부를 확인한다"
      ],
      "hook": "보고서 초안, 빈 페이지에서 시작하지 않아도 됩니다",
      "tool_features": ["대화로 초안 작성", "문단 다듬기"],
      "difficulty": "초급",
      "takeaway": "자료를 붙인 뒤 문단과 사실 여부를 따로 고칩니다"
    }
  ]
}
```

`id`는 `youtube:ytExample01` 또는 `ytExample01`입니다. 대기 목록에 없는 `id`는 적용하지 않고 파일에 남겨 둡니다.

| 필드 | 의미 |
|---|---|
| `summary` | 2~4문장 한국어 요약. 필수이며, 이 값이 있어야 적용됩니다. |
| `summary_points` | 핵심 포인트 문자열 배열 |
| `hook` | 한 줄 후킹 |
| `tool_features` | 영상에서 다룬 기능 문자열 배열 |
| `difficulty` | `입문`, `초급`, `중급`, `고급` 중 하나 |
| `takeaway` | 한 줄 결론 |

비어 있는 선택 필드는 DB의 기존 값을 지우지 않습니다. 대기 항목에 직접 쓸 때는 같은 필드를 그 객체 안에 넣습니다.

```json
{
  "id": "youtube:ytExample01",
  "needs_summary": false,
  "kind": "video",
  "youtube_id": "ytExample01",
  "title": "챗GPT로 보고서 초안 만들기",
  "category_slug": "chatgpt",
  "source_url": "https://www.youtube.com/watch?v=ytExample01",
  "fallback_summary": "챗GPT로 보고서 초안을 만드는 순서를 따라갑니다. 자료 정리와 문단 다듬기가 핵심입니다.",
  "description_excerpt": "챗GPT로 보고서 초안을 만드는 순서를 따라갑니다. 자료 정리와 문단 다듬기가 핵심입니다.",
  "queued_at": "2026-11-02T00:00:00.000Z",
  "summary": "이 영상은 챗GPT로 보고서 초안을 만드는 과정을 보여 줍니다. 자료를 붙인 뒤 문단 구성과 말투를 고치는 순서로 진행합니다.",
  "summary_points": [
    "자료를 먼저 붙이고 초안을 받는다",
    "문단 순서와 말투를 이어서 고친다",
    "마지막에 사실 여부를 확인한다"
  ],
  "hook": "보고서 초안, 빈 페이지에서 시작하지 않아도 됩니다",
  "tool_features": ["대화로 초안 작성", "문단 다듬기"],
  "difficulty": "초급",
  "takeaway": "자료를 붙인 뒤 문단과 사실 여부를 따로 고칩니다"
}
```

## 적용 명령

`SUPABASE_URL`과 `SUPABASE_SERVICE_ROLE_KEY`가 있는 환경에서 실행합니다.

```bash
npm run apply-summaries
```

적용에 성공한 항목은 대기 파일과 형제 파일에서 빠집니다. DB에 영상이 없으면 그 항목은 대기 목록에 남습니다.

매일 09:00 KST 수집 워크플로가 수집 뒤에 같은 명령을 실행하고, 바뀐 대기 파일을 커밋합니다. `main`에 두 JSON 파일이 푸시되어도 한 번 더 적용합니다. 워크플로가 만든 커밋 메시지에는 `[skip apply]`가 붙어 적용이 반복되지 않습니다.

대기 확인만 따로 실행하려면:

```bash
npm run check-pending
```

GitHub Actions에서는 `GITHUB_TOKEN`과 `GITHUB_REPOSITORY`로 이슈를 갱신합니다. 로컬에서 토큰이 없고 대기 항목이 40개 이하면 이슈를 만들지 않고 종료합니다.

가이드북 초안(`npm run guidebook`)은 영상 제목과 포인트로 섹션을 만들며 대기열을 쓰지 않습니다. 일일 워크플로는 가이드북 단계를 실행하지 않습니다.
