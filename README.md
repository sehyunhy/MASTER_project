# 선물 선택 실험 시스템

Next.js App Router + React + TypeScript + Tailwind, Supabase PostgreSQL, Zod를 사용하는 연구 시스템 초기 구현입니다. 참가자 조건은 server-side DB에서만 결정하고 Claude와 Supabase service-role key는 브라우저로 보내지 않습니다.

## Architecture

- **Frontend:** Next.js App Router. `/experiment/giver`, `/experiment/recipient` 화면을 역할별로 분리했습니다.
- **Backend:** Route Handlers에서 participant session, comprehension 결과, trial 행동 및 event를 저장합니다.
- **Database:** `supabase/migrations/0001_initial.sql`에 schema와 RLS를 정의했습니다. 익명 정책은 열지 않고 서버용 service role로만 DB를 다룹니다.
- **AI:** `EXPERIMENT_CANDIDATE_MODE=controlled`가 기본입니다. `live`는 Claude Messages API를 서버에서만 호출하는 개발 데모 모드입니다.
- **Deployment:** Vercel 배포를 위한 Next.js 프로젝트입니다.

## Assignment and counterbalancing

40개 실참가자 코드는 `P001`–`P040`입니다. P001–P020은 high, P021–P040은 low로 배정하고 각 그룹을 순서대로 5명씩 S1–S4에 배치합니다. 역할은 seed 시 `PARTICIPANT_ROLE` 환경변수로 전부 giver 또는 recipient로 지정하며 기본값은 giver입니다. 실제 혼합 역할 배정을 원하면 시작 전에 `participants.role`을 연구 프로토콜에 맞게 수정해야 합니다.

S1–S4는 요청된 Williams 순서입니다. 네 조건이 각 위치에 한 번씩 나오고, 12개 가능한 순서쌍이 각 한 번씩 나타나는지 검증합니다. Profile은 sequence order와 별도의 회전 규칙으로 배정합니다.

## Local setup

1. Node.js 20 이상과 npm을 설치합니다.
2. 이 폴더에서 `npm install`을 실행합니다.
3. `.env.example`을 `.env.local`로 복사하고 Supabase URL, anon key, service-role key를 입력합니다. `ANTHROPIC_API_KEY`는 live demo를 쓸 때만 입력합니다.
4. Supabase SQL Editor에서 `supabase/migrations/0001_initial.sql` 전체를 한 번 실행합니다.
5. `npm run seed:assignments`로 실참가자 슬롯 40개를 만들거나, `PARTICIPANT_ROLE=recipient npm run seed:assignments`로 40명을 관찰자 역할로 준비합니다. 다시 실행하면 같은 P코드의 배정은 upsert됩니다. 실제 참여 시작 후에는 배정을 바꾸지 마세요.
6. `npm run dev`를 실행하고 [http://localhost:3000](http://localhost:3000)을 엽니다. Admin은 `/admin`입니다.
7. 브라우저에서 `P001`–`P040` 중 배정된 코드를 입력합니다. 성공적으로 시작된 participant는 DB assignment와 trial order를 계속 사용합니다.

### Mock data and QA

- `npm run seed:mock`: mock prefix `MOCK-P`로 40명, 160 trials, 480 trial-candidate links, 160 selections, 240 guided answers, 44 training attempts, 1,120 event rows, 40 controlled candidate pool records를 생성합니다. 기록은 모두 `is_mock=true` 또는 `MOCK-P` prefix로 식별됩니다.
- `npm run clear:mock`: `MOCK-P%` 참가자와 그 하위 기록만 제거합니다.
- `npm test`: Williams design, condition/profile mapping, state-transition unit tests를 실행합니다.
- `npm run typecheck`: TypeScript 타입 검사를 실행합니다.
- `npm run validate:experiment`: 현재 DB의 mock 배정과 trial/candidate/selection 정합성을 확인하고 JSON을 출력합니다.
- `/admin`에서 비밀번호 인증 후 상태 요약과 CSV export를 확인할 수 있습니다.

Paper survey CSV는 `analysis_ready.csv`의 `participant_id`와 `trial_number`를 기준으로 결합합니다. `participants.csv`와 analysis export의 participant 식별자는 참가자가 입력한 코드입니다. 종이 설문에 같은 코드를 기록하세요.

## Environment variables

| Variable | Use |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public Supabase anon key (no browser DB policy is granted) |
| `SUPABASE_SERVICE_ROLE_KEY` | server and seed scripts only; never expose to client |
| `ANTHROPIC_API_KEY` | optional, server-only Claude live demo |
| `ANTHROPIC_MODEL` | default `claude-sonnet-5` |
| `EXPERIMENT_CANDIDATE_MODE` | `controlled` default or `live` demo |
| `ADMIN_PASSWORD` | protects `/admin` summary and CSV routes |
| `PARTICIPANT_SESSION_SECRET` | HMAC signing secret for participant session cookie (use a random secret in production) |
| `PARTICIPANT_ROLE` | seed role default `giver` or `recipient` |

Claude's current model identifier and Messages API usage are documented by [Anthropic model deprecations](https://docs.anthropic.com/en/docs/about-claude/model-deprecations) and [Messages API](https://docs.anthropic.com/en/api/messages). The configured model can be changed without editing source code.

## Vercel deployment

1. Push the `gift-experiment` folder as a GitHub repository (or make it the repository root).
2. Create a Supabase project and execute the SQL migration above.
3. Locally set `.env.local`, then run `npm run seed:assignments`. Run `npm run seed:mock` only in a development database.
4. In Vercel, import the repository and set the Root Directory to `gift-experiment` if the repository root contains the parent folder.
5. Add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and a strong `ADMIN_PASSWORD` under Vercel Project → Settings → Environment Variables. Add `ANTHROPIC_API_KEY` only if the demo mode is deliberately enabled. Keep `EXPERIMENT_CANDIDATE_MODE=controlled` for research sessions.
6. Deploy. For code changes Vercel redeploys from the connected Git branch.
7. Verify `/`, `/start`, `/admin`, database insert and CSV export using a test assignment in a staging Supabase project. Do not use the production participant list for QA.

## Validity and deployment caveats

1. **Profile-condition balance:** profiles rotate independently, but this initial deterministic rotation is not a full independently randomized profile-condition Latin square. Validate the final assignment matrix before data collection.
2. **Role mix:** assignment seeding supports a single role per run; a mixed giver/recipient allocation must be configured in the DB before any participant begins.
3. **Participant allocation:** 40 assignments are fixed by code ranges. If recruitment order differs, pre-generate and freeze the assignment sheet before opening access.
4. **Live Claude variation:** live mode is not controlled and must not be used for the production experiment. Controlled candidate records are deterministic.
5. **Controlled candidates:** the included candidate pool is prototype stimulus content. Researcher review and pretesting are required before a real study.
6. **Recipient playback:** playback duration is fixed at 90 seconds, but the current implementation uses staged text/card placeholders rather than a fully matched, authored 90-second transcript for each condition.
7. **Completion timing:** giver actions are logged; candidate display and interaction timing should be piloted on target hardware and network conditions.
8. **Admin access:** admin uses a shared password; use a long unique value, restrict who receives it, and consider institutional SSO before deployment with sensitive data.
9. **Research privacy:** participant names are not collected, but participant codes and event records remain sensitive research data. Follow the institution's retention and consent requirements.
10. **Recovery and connectivity:** DB is the source of truth and sessions survive refresh in the same browser. Expired participant session cookies require the participant to re-enter through `/start`.
11. **Integration QA:** automated tests cover core assignment/state invariants. Complete end-to-end giver and recipient checks against a staging Supabase project before recruiting participants.
12. **No paper-survey outcomes:** this system exports merge keys and process metadata only; psychological questionnaire outcomes must be entered and analyzed separately.
13. **Researcher controls:** timing, questions, profiles, pool, and versions are centralized in code/configuration, but a complete editable Admin configuration UI and CSV-based mixed-role assignment import are not implemented yet.

## Routes

`/` · `/start` · `/training` · `/experiment/giver` · `/experiment/recipient` · `/complete` · `/admin`
