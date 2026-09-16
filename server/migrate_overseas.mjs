#!/usr/bin/env node
// 해외 공고 크롤링 (v3) — 테이블 생성 (멱등)
//   overseas_notices        수집 공고 (크롤 방식 확정 전 — 범용 스키마)
//   overseas_recipients     수신자 (채용공고 크롤링 recipients 와 완전 별개)
//   overseas_cron_settings  스케줄 단일행 (id=1) — 크롤러 구현 전이라 enabled=0 시드
//   overseas_cron_runs      실행 로그

import 'dotenv/config';
import mysql from 'mysql2/promise';

const TABLES = [
  ['overseas_notices', `
    CREATE TABLE overseas_notices (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      source        VARCHAR(100),           -- 수집처 (사이트/API 이름)
      notice_key    VARCHAR(200) NOT NULL,  -- 출처 내 고유 식별자 (중복 방지)
      title         VARCHAR(500) NOT NULL,
      organization  VARCHAR(300),
      country       VARCHAR(100),
      url           VARCHAR(1000),
      posted_at     VARCHAR(50),
      deadline      VARCHAR(50),
      summary_md    MEDIUMTEXT,
      detail        JSON,
      email_sent_at DATETIME,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_source_key (source, notice_key),
      INDEX idx_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `],
  ['overseas_recipients', `
    CREATE TABLE overseas_recipients (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      email       VARCHAR(255) UNIQUE NOT NULL,
      name        VARCHAR(100),
      active      TINYINT(1) DEFAULT 1,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_active (active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `],
  ['overseas_cron_settings', `
    CREATE TABLE overseas_cron_settings (
      id          TINYINT PRIMARY KEY DEFAULT 1,
      hour        TINYINT NOT NULL DEFAULT 11,
      minute      TINYINT NOT NULL DEFAULT 30,
      enabled     TINYINT(1) NOT NULL DEFAULT 0,
      days_back   INT NOT NULL DEFAULT 5,
      updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `],
  ['overseas_cron_runs', `
    CREATE TABLE overseas_cron_runs (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      started_at   DATETIME NOT NULL,
      finished_at  DATETIME,
      status       ENUM('running','success','failed') DEFAULT 'running',
      total_found  INT,
      new_count    INT,
      email_sent   TINYINT(1) DEFAULT 0,
      error_msg    TEXT,
      INDEX idx_started (started_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `],
  ['overseas_sources', `
    CREATE TABLE overseas_sources (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      source_key      VARCHAR(50) UNIQUE NOT NULL,   -- 파서 선택자 (lib/overseasCrawl.js)
      name            VARCHAR(200) NOT NULL,         -- 기관명
      site_url        VARCHAR(500),
      target_url      VARCHAR(1000),
      method_note     TEXT,                          -- 엑셀 '방법' 원문
      enabled         TINYINT(1) NOT NULL DEFAULT 1,
      last_crawled_at DATETIME,
      last_status     VARCHAR(20),                   -- 'ok' / 'error'
      last_error      TEXT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `],
];

// 소스 시드 — v3 엑셀 '방법' 열 + v4(2026-09-16) g2b 추가. INSERT IGNORE 라 기존 행은 보존 (method_note 는 아래에서 UPDATE).
const SOURCES_SEED = [
  ['g2b', '나라장터 (g2b)', 'https://www.g2b.go.kr',
   'https://www.g2b.go.kr (selectBidPbacScrollTypeList.do)',
   '공고명 키워드 검색 (태국·방콕·치앙마이·푸켓·파타야·THAIFEX·동남아·아세안·ASEAN·메콩) × 최근 N일 → GPT 판별. 채용대행 크롤러와 별개 저장'],
  ['kcca', '주태국 한국문화원(KCCA)', 'https://thailand.korean-culture.org/ko',
   'https://thailand.korean-culture.org/ko/1056/board/805/list',
   '게시판 첫 페이지 전체 → GPT 판별 (태국 소재 기관이라 키워드 없음)'],
  ['kec', '태국한국교육원', 'https://kecthai.kr/',
   'https://kecthai.kr/sub/news/1-1.php',
   '공지사항 첫 페이지 전체 → GPT 판별 (태국 소재 기관이라 키워드 없음)'],
  ['koipa', '한국지식재산보호원 동남아 서부 IP센터', 'https://www.koipa.re.kr',
   'https://www.koipa.re.kr/home/board/brdList.do?menu_cd=000041, https://www.koipa.re.kr/home/board/brdList.do?menu_cd=000042',
   '사업공고·입찰공고 첫 페이지 전체 (키워드 없이) → GPT 판별'],
  ['bizinfo', '기업마당', 'https://www.bizinfo.go.kr',
   'https://www.bizinfo.go.kr/sii/siia/selectSIIA200View.do',
   '지원사업명 키워드 검색 (태국·방콕·치앙마이·푸켓·파타야·THAIFEX·동남아·아세안·ASEAN·메콩) → GPT 판별'],
  ['suhyup', '수협중앙회 방콕무역지원센터', 'https://www.suhyup.co.kr',
   'https://www.suhyup.co.kr/bbs/suhyup/23/artclList.do',
   '입찰공고 게시판 첫 페이지 전체 (키워드 없이) → GPT 판별'],
  ['at', '한국농수산식품유통공사 (aT) 방콕지사', 'https://www.enjoykfood.com/bidding',
   'https://www.enjoykfood.com/?mid=bidding&search_target=title_content',
   '입찰공고 제목+내용 키워드 검색 (태국·방콕·치앙마이·푸켓·파타야·THAIFEX·동남아·아세안·ASEAN·메콩) → GPT 판별'],
  ['kotra', '대한무역투자진흥공사 (KOTRA) 방콕무역관', 'https://www.kotra.or.kr/bangkok/index.do',
   'https://www.kotra.or.kr/bangkok/subList/40000000403',
   '방콕무역관 사업 안내 목록 전체 (키워드 없이) → GPT 판별'],
  // v4.1 (2026-09-16) — 재조사 엑셀 S등급 추가. SBA(동적 페이지)·중진공(로그인)은 나라장터 채널로 커버.
  ['kofice', '한국국제문화교류진흥원 (KOFICE)', 'https://kofice.or.kr',
   'https://kofice.or.kr/www/bbs/list.do?mnucd=171&scBbsMngSn=8',
   '입찰공고 게시판 첫 페이지 전체 (키워드 없이) → GPT 판별. 코리아시즌·K-브랜드 융복합 등 태국 운영대행 발주처'],
  ['kocca', '한국콘텐츠진흥원 (KOCCA)', 'https://www.kocca.kr',
   'https://www.kocca.kr/kocca/pims/list.do?menuNo=204104, https://www.kocca.kr/kocca/bbs/list/B0000204.do?menuNo=204897',
   '지원공고 + 사업공고(타 기관 모음) 첫 페이지 전체 → GPT 판별. 태국 비즈니스센터 위탁용역 발주처'],
  ['gbsa', '경기도경제과학진흥원 (GBSA)', 'https://www.gbsa.or.kr',
   'https://www.gbsa.or.kr/board/bid_info.do',
   '입찰정보 게시판 첫 페이지 전체 → GPT 판별. 방콕 GBC 운영·현지 대행운영자 모집'],
];

// v4 컬럼 추가 (멱등) — overseas_notices 판별/요약 결과, overseas_cron_settings 오후 실행 슬롯
const ALTERS = [
  ['overseas_notices', 'grade',       "ALTER TABLE overseas_notices ADD COLUMN grade VARCHAR(2) NULL COMMENT 'A=태국 확정 / B=동남아·아세안 권역 / X=제외' AFTER organization"],
  ['overseas_notices', 'notice_type', "ALTER TABLE overseas_notices ADD COLUMN notice_type VARCHAR(20) NULL COMMENT '용역/모집/채용/안내' AFTER grade"],
  ['overseas_notices', 'topic',       "ALTER TABLE overseas_notices ADD COLUMN topic VARCHAR(100) NULL AFTER notice_type"],
  ['overseas_notices', 'amount',      "ALTER TABLE overseas_notices ADD COLUMN amount VARCHAR(100) NULL AFTER deadline"],
  ['overseas_notices', 'ai_reason',   "ALTER TABLE overseas_notices ADD COLUMN ai_reason TEXT NULL AFTER amount"],
  ['overseas_notices', 'idx_grade',   "ALTER TABLE overseas_notices ADD INDEX idx_grade (grade)"],
  ['overseas_cron_settings', 'hour2',    "ALTER TABLE overseas_cron_settings ADD COLUMN hour2 TINYINT NOT NULL DEFAULT 15 AFTER minute"],
  ['overseas_cron_settings', 'minute2',  "ALTER TABLE overseas_cron_settings ADD COLUMN minute2 TINYINT NOT NULL DEFAULT 0 AFTER hour2"],
  ['overseas_cron_settings', 'enabled2', "ALTER TABLE overseas_cron_settings ADD COLUMN enabled2 TINYINT(1) NOT NULL DEFAULT 1 AFTER minute2"],
];

async function main() {
  for (const k of ['DB_HOST','DB_USER','DB_PASSWORD','DB_NAME']) {
    if (!process.env[k]) { console.error(`❌ ${k} 미설정`); process.exit(1); }
  }
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  console.log(`[migrate-overseas] ${process.env.DB_HOST}/${process.env.DB_NAME} 연결됨`);

  let created = 0, skipped = 0;
  for (const [name, ddl] of TABLES) {
    const [[t]] = await conn.query(
      `SELECT 1 AS ok FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = ?`, [name]
    );
    if (t && t.ok) { console.log(`  - ${name}: 이미 있음 (skip)`); skipped++; continue; }
    await conn.query(ddl);
    console.log(`  + ${name}: 생성됨`);
    created++;
  }

  // 스케줄 단일행 시드 — 크롤러 미구현이라 enabled=0
  const [r] = await conn.execute(
    `INSERT IGNORE INTO overseas_cron_settings (id, hour, minute, enabled, days_back)
     VALUES (1, 11, 30, 0, 5)`
  );
  if (r.affectedRows > 0) console.log('  + overseas_cron_settings 시드 (11:30 KST, 비활성)');

  // 소스 시드 — source_key 기준 INSERT IGNORE (기존 행의 enabled 설정은 보존)
  let srcSeeded = 0;
  for (const [key, name, site, target, note] of SOURCES_SEED) {
    const [rs] = await conn.execute(
      `INSERT IGNORE INTO overseas_sources (source_key, name, site_url, target_url, method_note)
       VALUES (?, ?, ?, ?, ?)`,
      [key, name, site, target, note]
    );
    if (rs.affectedRows > 0) srcSeeded++;
  }
  console.log(`  + overseas_sources 시드 ${srcSeeded}건 (총 ${SOURCES_SEED.length}개 시도)`);
  // v4.1: KTO 제거 (서버 IP 차단 → 사용자 결정으로 소스 삭제)
  const [del] = await conn.execute(`DELETE FROM overseas_sources WHERE source_key = 'kto'`);
  if (del.affectedRows) console.log('  - overseas_sources: kto 삭제');
  // 수집 방식 설명은 항상 최신으로 (enabled 는 건드리지 않음)
  for (const [key, , , target, note] of SOURCES_SEED) {
    await conn.execute(`UPDATE overseas_sources SET method_note = ?, target_url = ? WHERE source_key = ?`, [note, target, key]);
  }

  // v4 컬럼/인덱스
  let altered = 0;
  for (const [table, col, ddl] of ALTERS) {
    const isIndex = col.startsWith('idx_');
    const [[has]] = await conn.query(
      isIndex
        ? `SELECT 1 AS ok FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`
        : `SELECT 1 AS ok FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
      [table, col]
    );
    if (has && has.ok) continue;
    await conn.query(ddl);
    console.log(`  + ${table}.${col} 추가`);
    altered++;
  }
  if (!altered) console.log('  - v4 컬럼: 이미 있음 (skip)');

  console.log(`\n✅ 완료 — 생성 ${created}, 스킵 ${skipped}`);
  await conn.end();
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
