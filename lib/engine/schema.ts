// 범용 의사결정 엔진의 공통 테이블 (서버 전용).
// 업무(W02 등)가 달라도 이 테이블은 그대로 쓴다 — 업무별 내용은 case_type · payload 로 구분한다.
// lib/db.ts 의 ensureSchema() 가 호출한다. 전부 IF NOT EXISTS 라 여러 번 실행해도 안전하다.
//
// 이 파일은 import 를 (타입 전용 외에는) 하지 않는다 — node 로 직접 실행해 검증할 수 있게.

/** postgres 의 tagged-template 함수 모양만 필요해서 느슨하게 받는다. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sql = (strings: TemplateStringsArray, ...values: any[]) => PromiseLike<unknown>

export async function applyCoreSchema(sql: Sql): Promise<void> {
  // ① 안건 — 결정해야 할 일 하나. 상태(status)가 다음 판단에 쓰인다.
  await sql`
    CREATE TABLE IF NOT EXISTS decision_cases (
      id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      case_type     text        NOT NULL,                 -- 업무 유형. 예: w02.contract_renewal
      title         text        NOT NULL,
      status        text        NOT NULL DEFAULT 'open',  -- open | need_info | pending_approval | approved | rejected | on_hold | closed
      deadline      date,                                 -- 되돌릴 수 없는 마감일(있으면)
      subject_refs  jsonb       NOT NULL DEFAULT '{}'::jsonb, -- 연결된 대상 번호. 예: {"influencer":"INF-001"}
      payload       jsonb       NOT NULL DEFAULT '{}'::jsonb, -- 업무별 세부 내용
      authority     text,                                 -- 규칙집이 판정한 승인권자
      data_origin   text        NOT NULL DEFAULT '원본',  -- 원본 | 가정 | 가상입력 (원본 vs 가정 구분)
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS decision_cases_type_status_idx ON decision_cases (case_type, status)`
  await sql`CREATE INDEX IF NOT EXISTS decision_cases_deadline_idx ON decision_cases (deadline)`

  // ② 이력 — 누가 언제 무엇을 했는지. 지우거나 고치지 않고 계속 추가만 한다.
  await sql`
    CREATE TABLE IF NOT EXISTS case_events (
      id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      case_id     bigint      NOT NULL REFERENCES decision_cases (id) ON DELETE CASCADE,
      event_type  text        NOT NULL,                   -- created | evaluated | approval_requested | decided | task_created | info_requested | info_received | status_changed ...
      actor_kind  text        NOT NULL,                   -- 시스템 | 사람
      actor_name  text,
      detail      jsonb       NOT NULL DEFAULT '{}'::jsonb, -- 근거 · 이전/이후 상태 등
      created_at  timestamptz NOT NULL DEFAULT now()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS case_events_case_idx ON case_events (case_id, created_at)`

  // ③ 승인 — 권한 있는 사람의 결정. 안건 하나에 여러 번(재상신) 생길 수 있다.
  await sql`
    CREATE TABLE IF NOT EXISTS approvals (
      id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      case_id       bigint      NOT NULL REFERENCES decision_cases (id) ON DELETE CASCADE,
      required_role text        NOT NULL,                 -- 규칙집이 정한 승인권자
      status        text        NOT NULL DEFAULT 'pending', -- pending | approved | rejected | on_hold
      decided_by    text,
      decided_at    timestamptz,
      comment       text,
      created_at    timestamptz NOT NULL DEFAULT now()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS approvals_case_idx ON approvals (case_id, status)`

  // ④ 작업 — 결정 뒤에 생기는 후속 일. 정보 부족 때의 '확인 요청'도 여기에 만든다.
  await sql`
    CREATE TABLE IF NOT EXISTS tasks (
      id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      case_id        bigint      NOT NULL REFERENCES decision_cases (id) ON DELETE CASCADE,
      task_type      text        NOT NULL,                -- notify | record | info_request | review ...
      title          text        NOT NULL,
      assignee_role  text,                                -- 담당 부서/역할
      status         text        NOT NULL DEFAULT 'open', -- open | done | cancelled
      due_date       date,
      detail         jsonb       NOT NULL DEFAULT '{}'::jsonb,
      response       jsonb,                               -- 확인 요청에 대한 회신 (가상 입력 포함)
      data_origin    text        NOT NULL DEFAULT '원본', -- 회신이 가상 입력이면 '가상입력'
      created_at     timestamptz NOT NULL DEFAULT now(),
      completed_at   timestamptz
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS tasks_case_idx ON tasks (case_id, status)`

  // ⑤ 가정 — 계산에 쓰는 가정값과 모의 입력. 원본과 섞이지 않게 따로 둔다.
  await sql`
    CREATE TABLE IF NOT EXISTS assumptions (
      id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      key          text        NOT NULL,                  -- 예: cost_unit_per_order
      value        jsonb       NOT NULL,
      kind         text        NOT NULL,                  -- 가정 | 합성 | 가상입력
      description  text        NOT NULL,
      effective_at date,                                  -- 적용 시점
      created_at   timestamptz NOT NULL DEFAULT now()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS assumptions_key_idx ON assumptions (key, created_at)`

  // ⑥ 원본 행 복사본 — CSV 한 줄을 그대로 담는다. 원본 파일은 읽기만 하고 절대 고치지 않는다.
  await sql`
    CREATE TABLE IF NOT EXISTS source_rows (
      id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      source_file  text        NOT NULL,                  -- 04_원본데이터 기준 상대 경로
      row_no       integer     NOT NULL,                  -- 파일 안 행 번호(헤더 제외, 1부터)
      data         jsonb       NOT NULL,
      loaded_at    timestamptz NOT NULL DEFAULT now(),
      UNIQUE (source_file, row_no)
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS source_rows_file_idx ON source_rows (source_file)`

  // ⑦ 원본 파일 대장 — 어떤 파일을 언제 몇 줄 읽었는지, 해시(sha256)로 원본이 그대로인지 증명한다.
  await sql`
    CREATE TABLE IF NOT EXISTS source_files (
      source_file  text        PRIMARY KEY,               -- 04_원본데이터 기준 상대 경로
      sha256       text        NOT NULL,                  -- 읽은 시점 파일 내용의 해시
      row_count    integer     NOT NULL,                  -- 헤더 제외 행 수
      columns      jsonb       NOT NULL,                  -- 헤더(열 이름) 순서
      loaded_at    timestamptz NOT NULL DEFAULT now()
    )
  `
}
