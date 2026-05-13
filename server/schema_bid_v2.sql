-- 입찰 V2: 학력 / 경력 / 자격증 / 유사사업 스키마 확장
-- migrate_bid_v2.js 가 ER_DUP_FIELDNAME / ER_TABLE_EXISTS_ERROR 를 skip 처리 → idempotent

-- 1. bid_employees 컬럼 추가 (이미 있으면 skip)
ALTER TABLE bid_employees ADD COLUMN name_en VARCHAR(100) NULL AFTER name;
ALTER TABLE bid_employees ADD COLUMN phone   VARCHAR(30)  NULL;
ALTER TABLE bid_employees ADD COLUMN email   VARCHAR(120) NULL;

-- 2. 학력
CREATE TABLE IF NOT EXISTS bid_employee_educations (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  employee_id  INT NOT NULL,
  degree       ENUM('고졸','전문학사','학사','석사','박사','기타') NOT NULL,
  school       VARCHAR(100) NOT NULL,
  major        VARCHAR(100),
  graduated_at DATE,                                   -- 월까지만 알면 day=01 권장
  thesis       VARCHAR(255),                           -- 학위논문
  sort_order   INT DEFAULT 0,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES bid_employees(id) ON DELETE CASCADE,
  INDEX idx_emp (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. 경력
CREATE TABLE IF NOT EXISTS bid_employee_careers (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  employee_id  INT NOT NULL,
  org_name     VARCHAR(200) NOT NULL,
  start_date   DATE NOT NULL,
  end_date     DATE NULL,                              -- NULL = 현재 재직중
  position     VARCHAR(80),
  duty         TEXT,
  sort_order   INT DEFAULT 0,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES bid_employees(id) ON DELETE CASCADE,
  INDEX idx_emp (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. 자격증
CREATE TABLE IF NOT EXISTS bid_employee_certifications (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  employee_id  INT NOT NULL,
  name         VARCHAR(150) NOT NULL,
  acquired_at  DATE,
  issuer       VARCHAR(150),
  cert_number  VARCHAR(100),
  sort_order   INT DEFAULT 0,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES bid_employees(id) ON DELETE CASCADE,
  INDEX idx_emp (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. 유사사업 마스터
CREATE TABLE IF NOT EXISTS bid_projects (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(255) NOT NULL,              -- 프로젝트명
  agency          VARCHAR(200),                       -- 발주기관
  start_date      DATE,
  end_date        DATE,
  contract_amount BIGINT,                             -- 계약금액 (원)
  description     TEXT,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_name_agency (name, agency),
  INDEX idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. 유사사업 ↔ 직원 join (참여 메타데이터)
CREATE TABLE IF NOT EXISTS bid_employee_projects (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  employee_id        INT NOT NULL,
  project_id         INT NOT NULL,
  role               VARCHAR(150),                    -- 담당업무
  company_at_time    VARCHAR(100),                    -- 참여 당시 소속회사
  participation_rate DECIMAL(5,2),                    -- 투입률 (%)
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES bid_employees(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id)  REFERENCES bid_projects(id)  ON DELETE CASCADE,
  UNIQUE KEY uq_emp_proj (employee_id, project_id),
  INDEX idx_emp  (employee_id),
  INDEX idx_proj (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
