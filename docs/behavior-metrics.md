# 행동자료 사전 · 7.1 텔레메트리

## 데이터 연결과 원본

`study_people.id`는 내부 UUID, 화면의 `K` 번호는 역할별 참가번호다. 같은 사람의 받는 사람은 홀수, 주는 사람은 다음 짝수다. `study_trials.id`가 분석 단위이며 사람 × 역할 × 조건에 하나씩 있다. A=C1, B=C3, C=C2, D=C4이다. `study_events`의 `participant_number`, `role`, `trial_id`, `condition`, `order_position`, `phase`, `actor`, `origin`, `server_at`, `client_at`, `idempotency_key`를 원시 분석에 사용한다. `visit_id`는 한 페이지 로드, `tab_id`는 한 브라우저 탭, `client_sequence`는 그 탭의 이벤트 순서다. `client_elapsed_ms`는 페이지 로드 후 경과시간이며 절대시각이 아니다. `phase_at_capture`는 클라이언트가 이벤트를 포착할 때의 단계다. 서버 시각이 공식 순서의 기준이다.

`study_messages`는 실제 대화와 구성된 P02 시나리오 대화를 구분한다. `study_survey_responses`는 연구자가 종이 설문을 입력한 **원본**이며, 정정 전 응답은 같은 행의 `revision_history`에 보존한다. `paper_survey_entered`/`paper_survey_corrected` 이벤트에는 답변 전체가 아니라 문항 키와 이전·새 응답의 SHA-256 해시만 남긴다. 앱의 `survey_completed_at`은 참가자가 종이 설문 완료 버튼을 누른 시각이다. 문항별 응답이 관리자 화면에 입력된 시각은 `study_survey_responses.entered_at`이다. 둘은 서로 다른 사건이다.

관리자 `study_events.csv`는 원시 로그, `study_metrics.csv`는 trial 단위 계산값이다. 상품·대화·설문·trial 원본도 별도 CSV로 받는다. 원시 행을 수정해 계산 지표를 만들어 넣지 않는다.

## 관찰되는 행동

| 과정 | 기록 | 의미 |
| --- | --- | --- |
| 접속·주의 | `page_loaded`, `page_unloaded`, `page_restored`, `screen_view`, `viewport_changed`, `tab_hidden/visible`, `window_blurred/focused`, `connection_lost/restored` | 브라우저 상태와 화면 크기. 시선 추적이나 실제 읽기의 증거는 아니다. |
| 사람의 요청 | `prompt_focused`, `prompt_started`, `prompt_input`, `prompt_pasted`, `prompt_changed`, `prompt_submitted`, `prompt_rejected`, `delegation_rejected`, `candidate_request_sent` | 매 입력 조작의 길이·입력 유형, 잠시 멈춘 뒤의 원문 스냅샷, 제출 원문과 서버 판정. 비밀번호나 조건 전환 코드 원문은 저장하지 않는다. |
| Agent | `agent_operation_started/completed/failed`, `candidate_proposed`, `candidate_batch_ready`, `final_selection`, `agent_error`, `retry` | 작업 종류, 응답시간, 상품 ID, 모델·응답 ID·프롬프트 버전. 실패도 기록한다. |
| 상품 | `candidate_card_exposure`, `candidate_opened/revisited/closed`, `candidate_dwell`, `candidate_detail_scroll_depth`, `candidate_image_failed`, `external_product_link_opened` | 카드가 화면 안에 보인 시간, 상세 열람, 재방문, 스크롤과 이미지 실패. 카드 노출은 읽을 **기회**의 추정치다. |
| 비교·대화 | `comparison_exposure`, `comparison_scroll_depth`, `message_exposure`, `chat_scroll_depth`, `scripted_message_shown` | 실제 화면에 들어온 영역과 시나리오 메시지의 표시를 구분한다. `comparison_opened`는 단계 진입 자동 표시일 수 있어 자발적 열람의 대리 지표로 쓰지 않는다. |
| 후보·최종 선택 | `candidate_confirmation_attempt/cancelled`, `candidate_confirmed`, `selection_draft/changed`, `reason_focused/input/changed/submitted`, `decision_draft_saved`, `finalize_attempt`, `action_rejected` | 후보 담기, 첫 선택, 변경, 이유 작성·초안 저장, 서버 확정과 실패를 분리한다. 선택·이유 초안은 새로고침 후 복구된다. |
| 진행·설문 | `phase_advanced`, `phase_timeout`, `condition_skipped_after_timeout`, `survey_started`, `paper_survey_completed`, `transition_opened`, `transition_code_attempt`, `paper_survey_entered/corrected` | 단계·조건·설문 입력의 순서. `transition_code_attempt.payload.accepted`로 성공·실패를 구별하며 입력 코드 원문은 저장하지 않는다. 시간초과 후 미완료는 빈 선택으로 유지한다. |

클라이언트 노출 구간은 `IntersectionObserver`로 카드·비교표·메시지가 뷰포트에 25% 이상 보이고, 탭이 보이고, 창이 포커스를 받고, 브라우저가 온라인인 경우에만 잰다. 250ms 미만은 기록하지 않는다. 이벤트는 탭별 보낼 편지함에 멱등성 키와 함께 보관하여 재시도한다. 탭 종료 직전 전송은 브라우저가 보장하지 않으므로 일부 구간이 결측일 수 있다. 여러 카드가 동시에 보이면 상품별 노출시간을 합한 값이 단계의 경과시간보다 클 수 있다. 화면 노출이나 스크롤은 인지, 이해, 선호, 신뢰의 직접 측정이 아니다.

## `study_metrics.csv` 계산 규칙

| 열 | 규칙 |
| --- | --- |
| `candidates_effective_ms`, `decision_effective_ms` | 서버 heartbeat가 누적한 유효시간. 30초 최소, 180초 최대 정책에 따름. 클라이언트 노출 이벤트를 합산한 값과 다르다. |
| `candidate_card_exposure_ms`, `candidate_card_exposure_total_ms` | 상품 ID별 `candidate_card_exposure.duration_ms` 합, 그리고 그 합계. 동시에 보인 카드가 각각 시간을 쌓는다. `_task_ms`는 후보·최종 단계에 포착된 구간만 합산하고, 기본 합계에는 완료 후 재열람도 포함한다. |
| `candidate_detail_dwell_ms`, `candidate_dwell_by_id_ms` | 상세 열기부터 닫기까지 보이는·포커스된·온라인 구간의 합. `_task_ms`는 과업 중 열람만 포함한다. 닫힘 이벤트가 누락되면 결측 또는 과소 계산이다. |
| `candidate_open_count`, `candidate_revisit_count` | 상세 열기와 재열기의 수. 각 상품의 두 번째 열람부터 재방문으로 센다. `_task_count`는 과업 중 열기만 센다. 카드가 단순히 보인 것은 열람으로 세지 않는다. |
| `comparison_exposure_ms`, `message_exposure_total_ms`, `scripted_message_exposure_ms` | 해당 영역의 관찰 구간 합. P02 시나리오 메시지는 `origin='scripted'`만 별도로 합산한다. |
| `*_scroll_max_percent` | 보고된 25% 단위 깊이의 최대값. 가로 스크롤이 없는 비교표는 결측이다. |
| `prompt_edit_count`, `reason_edit_count` | 입력 이벤트 횟수. 최초 입력도 포함한다. `*_snapshot_count`는 650ms 안정화 후 원문 스냅샷 수이며 수정 횟수로 쓰지 않는다. |
| `prompt_paste_count`, `reason_paste_count` | 붙여넣기 이벤트 수. 붙여넣은 원문은 일반 입력·스냅샷 규칙에 따라 기록된다. |
| `candidate_request_count`, `candidate_confirm_count` | 서버가 받은 후보 요청 수와 후보에 담기 성공 수. A·C에서 세 번의 담기가 확인되어야 후보가 완성된다. |
| `selection_change_count` | 최초 선택 후 다른 상품으로 바꾼 횟수. 다시 같은 상품을 누르는 것은 제외한다. |
| `first_selection_at`, `first_choice_effective_ms` | 상품 ID가 들어간 첫 서버 초안 저장의 시각과 당시 단계 유효시간. 초안 저장 실패 시 빈 값이다. |
| `first_choice_latency_ms`, `human_selection_latency_ms` | 최종 단계 시작부터 첫 서버 초안, 최종 확정까지의 **경과시간**. 비활성화 구간이 포함될 수 있으므로 유효 노출시간과 혼용하지 않는다. |
| `agent_candidate_latency_ms`, `agent_final_latency_ms` | 저장된 Agent 결과 이벤트의 요청 처리시간 합. `agent_operation_wait_ms`에는 실패한 작업 시간도 더한다. A·C에서 Agent 응답을 기다리는 동안 단계 heartbeat가 계속 누적될 수 있으므로 이를 곧바로 순수 상품 열람시간으로 해석하지 않는다. B·D의 최초 후보 준비 대기는 카드 표시 전 단계 유효시간에 넣지 않는다. |
| `phase_timeout_count`, `condition_skip_count`, `error_count`, `action_rejection_count` | 원시 이벤트 개수. 발생률을 만들 때는 조건별로 실제 진입한 trial을 분모로 사용한다. |
| `telemetry_v2_count` | 새 클라이언트 텔레메트리 건수. 0이면 해당 기능이 없던 버전일 수도 있고 전송이 모두 실패했을 수도 있다. 다른 0값을 곧바로 미사용으로 해석하지 않는다. |

노출·체류·Agent 시간은 관측 이벤트가 없으면 빈 값(`null`)으로 내보낸다. 시도·오류 건수의 0은 원시 로그상 기록된 사건이 0건이라는 뜻이다. 로그 전달 실패나 구버전 참가자를 0건 행동으로 단정하지 않으려면 `telemetry_v2_count`, `experiment_version`, 앱 배포 시점과 서버 이벤트를 함께 확인한다.

## 설문과의 연결·한계

설문의 통제감·주도감은 A/C 요청·후보 확정 횟수, A/B 최종 선택·변경·이유 작성과 **연관**시켜 분석할 수 있다. 정보 확인 정도는 후보 카드·비교표·메시지 노출, 상세 열람과 스크롤을 보조 지표로 사용할 수 있다. Agent에 대한 신뢰·만족·선물 적합성·공정성·인지 부하는 클릭만으로 알 수 없으므로 종이 설문 응답을 직접 분석한다. P02의 구성 시나리오 행동은 실제 증여자 행동으로 합산하지 않는다. A–D 조건 순서와 역할·프로필·상품 스냅샷을 공변량 또는 층화 기준으로 유지한다.

운영 중인 DB에는 `supabase/study-behavior-telemetry.sql`만 추가 적용한다. 기존 `study-fresh.sql`은 파괴적인 새 설치 스크립트이므로 운영 데이터에 실행하지 않는다.
