-- g2b 채용 크롤러 DB 스키마

CREATE TABLE IF NOT EXISTS notices (
  bid_no         VARCHAR(40)   NOT NULL PRIMARY KEY,
  name           VARCHAR(500)  NOT NULL,
  agency         VARCHAR(200),
  demander       VARCHAR(200),
  bgt_amt        VARCHAR(50),
  prsp_prce      VARCHAR(50),
  scsbd_mthd     VARCHAR(100),
  pnpr_mtho      VARCHAR(100),
  pbanc_knd      VARCHAR(100),
  status         VARCHAR(50),
  posted_at      VARCHAR(50),
  deadline       VARCHAR(50),

  ai_is_agent    TINYINT(1),
  ai_reason      TEXT,

  detail         JSON,        -- 진행정보·담당자·첨부 메타 등 디테일 API 응답
  prev_history   JSON,        -- 이전 채용대행 기록
  summary_md     MEDIUMTEXT,  -- GPT 요약 (마크다운)
  files_meta     JSON,        -- 다운받은 파일 메타 (이름/크기/저장경로)

  email_sent_at  DATETIME,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_email_sent (email_sent_at),
  INDEX idx_created    (created_at),
  INDEX idx_ai_agent   (ai_is_agent)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- cron 실행 로그
CREATE TABLE IF NOT EXISTS cron_runs (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  started_at   DATETIME NOT NULL,
  finished_at  DATETIME,
  status       ENUM('running','success','failed') NOT NULL DEFAULT 'running',
  total_found  INT,
  new_count    INT,
  email_sent   TINYINT(1) DEFAULT 0,
  error_msg    TEXT,
  INDEX idx_started (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 리포트 수신자 (여러 명)
CREATE TABLE IF NOT EXISTS recipients (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  email       VARCHAR(255) NOT NULL UNIQUE,
  name        VARCHAR(100),
  active      TINYINT(1) NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 입찰 참여 인력
CREATE TABLE IF NOT EXISTS bid_employees (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  name                VARCHAR(50) NOT NULL,
  birth_date          DATE,
  position            VARCHAR(50),                 -- 본부장/수석파트장/파트장/연구원 등
  final_edu           VARCHAR(50),                 -- 학사/석사/박사/고등학교 등
  school              VARCHAR(100),
  major               VARCHAR(100),
  tech_grade          ENUM('상','중','하'),
  grad_year           SMALLINT,
  grad_month          TINYINT,
  external_join_date  DATE,                        -- 외부용 입사일 (입찰 제안서용)
  real_join_date      DATE,                        -- 실제 출근 시작일
  active              TINYINT(1) NOT NULL DEFAULT 1,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_active (active),
  INDEX idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
