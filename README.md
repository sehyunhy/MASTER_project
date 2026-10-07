# 선물 의사결정 연구 시스템 · v3

선물 주는 사람과 선물 받는 사람에게 서로 다른 화면을 제공합니다. A/B에서는 선물 주는 사람이 후보 구성과 비교를 요청하고, C/D에서는 공통 기준 입력 뒤 AI가 진행합니다. A/C에서는 선물 주는 사람이 최종 선택하며, B/D에서는 AI가 선택합니다. 화면에서는 심리척도와 주관적 평가를 수집하지 않고 종이 설문 완료만 확인합니다.

## 이 버전에서 달라진 점

- 연습과 본실험 화면을 모바일 대화형 앱 구조로 표시합니다. 단계, 조건, 선물 받는 사람 정보, 대화, 상품 카드, 입력 영역을 구분하고 새 대화가 도착하면 그 메시지로 이동합니다. 상품 후보는 모바일에서도 세 개를 세로로 보여 줍니다.
- 선물 주는 사람은 자유 대화 또는 실제 CSV에 존재하는 카테고리·특성 선택 메뉴로 하나의 검색 상태를 입력합니다. Claude는 서버의 상품 조회 도구를 사용하고, 서버가 확인한 상품 ID·가격·규격으로 카드가 구성됩니다.
- 선물 주는 사람 B/D에서 AI는 저장된 세 후보의 원본 ID 중 하나를 도구 응답으로 선택합니다. 서버가 해당 trial의 상품인지 검증합니다. 선물 받는 사람 B/D는 연구자가 승인한 동결 자극의 최종 상품을 재생합니다.
- 선물 받는 사람은 연구자가 구성한 선물 주는 사람·AI 대화를 시간순으로 관찰합니다. 연습 뒤에는 비교 시작 주체와 최종 결정 주체를 각각 확인합니다. 본실험에서 선물 받는 사람은 과업 요청이나 최종 선택을 수행할 수 없습니다.
- 선물 받는 사람 본실험은 `recipient_stimuli`의 **approved + frozen_at** 자극만 표시합니다. 같은 `scenario_id`의 A/B/C/D는 같은 후보·가격·최종 상품 스냅샷을 사용합니다. 화면에서 연구자가 구성한 시나리오임을 알립니다.
- 기준, 후보, 비교 각각 서버가 확인한 유효 노출 30초가 필요합니다. 숨김·오프라인 구간은 제외하고, 새로고침 뒤 서버의 확정 단계·누적시간을 사용합니다.
- 로그에는 실제 `participant` 행동과 화면 속 `scripted`/`recorded` 행동을 `event_origin`으로 분리합니다. 연습에는 `training: true`를 기록하고 본실험 trial과 분리합니다.

## 현재 데이터의 사용 가능 범위

첨부된 `walmart-products.csv`는 **2024년 8월의 USD 가격 기록 1,000행**입니다. 이 파일을 Walmart의 공식 배포 데이터 또는 현재 판매가격으로 간주하지 않습니다. 원본은 1,000행 모두 보존하고, 원본 상품 ID로 재가져오기 중복을 막습니다. 의류 594행이 가장 많으며 사이즈 적합성 정보가 없는 의류는 실험 후보로 자동 선정하지 않습니다.

기본 선별 목록은 `scripts/importWalmartCsv.py`의 정확한 원본 `product_id` 목록에 있습니다. 1 USD당 1,300원, 100원 반올림이라는 **검사용 예시값**에서 R4는 4개, R1은 1개, R2는 0개, R3는 1개만 예산 안에서 사용 가능한 것으로 분류됐습니다. 이 숫자는 연구용 환율 결정이 아닙니다. **R1–R3의 세 후보 시나리오를 완성하려면 연구자가 승인한 추가 상품 자료가 필요합니다.** 자료가 채워질 때까지 관련 없는 상품을 추천하거나 선물 받는 사람 자극을 승인하지 마세요.

한국어 표시명은 선별된 정확한 원본 ID에만 작성했습니다. 나머지 원본명은 그대로 보존하고 `product_name_ko`는 비워 둡니다. `specifications`, 이미지 URL 목록, 원문 설명, 원본 가격·통화·기록 시점 문자열과 원본 행을 별도 필드에 저장합니다. 원본 시각에는 시간대가 없어 시간대 값을 임의로 부여하지 않습니다.

## Supabase SQL 적용

기존 프로젝트에서 `0001`–`0004`를 이미 적용했다면 **[`0005_walmart_chat_observation.sql`](supabase/migrations/0005_walmart_chat_observation.sql)**만 SQL Editor에서 실행합니다. 새 DB라면 [`one-click-setup.sql`](supabase/one-click-setup.sql)을 실행합니다. 이 파일에는 스키마와 기존 연구자가 정한 네 프로필·P001–P080 슬롯이 들어가며, 합성 상품 300개는 더 이상 새 실험 카탈로그로 심지 않습니다. 기존 합성 상품 행이나 이미 시작한 참가자 자료는 삭제하지 않습니다.

원화 예산 50,000원을 쓰므로 **연구자가 승인한 고정 USD→KRW 환율과 원 단위 반올림 규칙**이 필요합니다. 환율을 아직 정하지 않았다면 아래 가져오기를 실행하지 마세요. 로컬에서 승인값을 입력해 SQL을 만듭니다.

```bash
cd "/Users/sehyun/Desktop/학위/gift-experiment-git"
read -r "FX_RATE_KRW_PER_USD?승인한 1 USD당 원화 금액: "
read -r "ROUND_KRW?승인한 반올림 단위(원): "
python3 scripts/importWalmartCsv.py --csv walmart-products.csv --fx-rate "$FX_RATE_KRW_PER_USD" --round-krw "$ROUND_KRW"
```

명령은 DB에 연결하지 않고 `supabase/seed-walmart-products-import.csv`, `supabase/seed-walmart-products.sql`, `supabase/seed-walmart-products-batches/batch-01.sql`부터의 SQL 파일, `supabase/seed-walmart-stimuli.sql`, `supabase/seed-walmart-products.report.json`을 만듭니다. **상품을 넣는 방법은 하나만 선택합니다.** 새 빈 테이블이라면 Supabase Table Editor에서 `product_catalog` → Insert → Import Data from CSV로 `seed-walmart-products-import.csv`를 업로드합니다. 이미 일부 상품을 넣었다면 CSV 가져오기는 SKU 중복이 날 수 있으므로, `batch-*.sql`을 번호순으로 SQL Editor에서 실행합니다. 분할 SQL은 `on conflict (sku) do update`라 재실행할 수 있습니다. 100행 파일이 너무 크면 생성 명령 끝에 `--batch-size 20`을 붙여 20행씩 다시 만듭니다. 보고서에서 원본·처리·제외·파싱 오류·프로필별 부족 수량을 확인합니다.

`seed-walmart-stimuli.sql`은 후보 3개를 채운 시나리오만 **pending**으로 만듭니다. 연구자가 후보의 원본명·가격·이미지·추천 근거·대화·출처를 검토하고, `recipient_stimuli.review_status='approved'` 및 `frozen_at`을 기록한 자극만 선물 받는 사람에게 보입니다. R1–R3에 상품이 모자란 현재 데이터만으로는 전체 선물 받는 사람 실험을 시작할 수 없습니다.

검토를 마친 자극은 SQL Editor에서 해당 ID를 정확히 지정해 승인합니다. 승인된 행은 트리거로 수정·삭제가 막히므로 대화나 상품을 바꿀 때는 새 버전 행을 만드세요.

```sql
update public.recipient_stimuli
set review_status = 'approved', frozen_at = now()
where id = 'gift-scenario-R4-v1' and review_status = 'pending';
```

생성된 원본 CSV와 SQL은 `.gitignore`로 GitHub 업로드에서 제외합니다. SQL을 Supabase에 적용하면 Vercel은 DB에서 상품을 읽으므로 원본 CSV를 배포할 필요가 없습니다.

## 환경변수와 실행

`npm ci` 후 `.env.example`을 참고해 `.env.local`에 같은 Supabase 프로젝트의 `SUPABASE_URL`과 `SUPABASE_SECRET_KEY`(또는 구형 `SUPABASE_SERVICE_ROLE_KEY`)를 넣습니다. Vercel Marketplace가 프로젝트 ref를 앞에 붙인 서버 변수도 코드가 찾습니다. `NEXT_PUBLIC_SUPABASE_ANON_KEY`는 서버 비밀 키 대신 쓸 수 없습니다. `ANTHROPIC_API_KEY`, 현재 계정에서 사용 가능한 **정확한** `ANTHROPIC_MODEL` ID, `PARTICIPANT_SESSION_SECRET`, `ADMIN_PASSWORD`도 필요합니다. 어떤 비밀값도 GitHub나 채팅에 붙여 넣지 마세요.

```bash
cd "/Users/sehyun/Desktop/학위/gift-experiment-git"
npm ci
npm run typecheck
npm test
npm run build
npm run dev
```

[http://localhost:3000](http://localhost:3000)에서 열 수 있습니다. Vercel은 Root Directory에 이 저장소의 `package.json`이 있어야 하고 Framework Preset은 **Next.js**, Output Directory는 **Next.js default(빈 값)**이어야 합니다. 환경변수는 Production에 추가한 뒤 새 배포를 만들어야 적용됩니다.

## 검증 범위와 파일럿

이 저장소에서 `npm test`, `npm run typecheck`, `npm run build`로 로컬 코드·CSV 파서·조건 순서·서버 노출 계산을 검사합니다. 실제 Claude 호출, Supabase SQL/RPC, Vercel 환경, 이미지 로딩, 숨김/복귀, 실제 브라우저의 역할별 4조건은 비밀 키와 완성된 카탈로그가 있어야 검증할 수 있습니다. 참가자 모집 전에 staging DB에서 각 조건의 역할별 전체 흐름, 30초×3, 새로고침, 중복 클릭, 종이 설문 진입, CSV export를 파일럿하십시오.

종이 설문은 `participant_code + trial_number`로 결합합니다. 선물 받는 사람의 실제 행동은 `event_origin='participant'`, 스크립트 속 선물 주는 사람·AI는 `event_origin='scripted'`로 분석에서 분리합니다. `behavior_analysis_ready` export의 선물 받는 사람 인간 선택 횟수는 0으로 처리합니다.

## GitHub와 Vercel

코드 검토 후 저장소 소유자가 직접 `git add`, `commit`, `push`합니다. `.env.local`, 원본 CSV, 생성된 대형 SQL은 `.gitignore`로 제외됩니다. Vercel이 `main`의 새 커밋을 배포하면 **새 배포의 commit SHA**와 현재 GitHub SHA가 같은지 확인하세요. 이전 실패 배포를 Redeploy하면 옛 SHA가 다시 배포될 수 있습니다.
