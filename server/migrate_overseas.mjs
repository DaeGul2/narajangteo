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

// 소스 시드 — 엑셀 '공공기관 방콕지사 리스트업.xlsx' 의 '방법' 열이 있는 4곳
const SOURCES_SEED = [
  ['kcca', '주태국 한국문화원(KCCA)', 'https://thailand.korean-culture.org/ko',
   'https://thailand.korean-culture.org/ko/1056/board/805/list',
   '새로운 공고 있으면 제목과 해당 디테일 페이지 url, 게시일을 메일로 보내줌'],
  ['kec', '태국한국교육원', 'https://kecthai.kr/',
   'https://kecthai.kr/sub/news/1-1.php',
   '공지사항에 새로운 글 올라오면 제목과 해당 디테일 페이지 url, 게시일을 메일로'],
  ['koipa', '한국지식재산보호원 동남아 서부 IP센터', 'https://www.koipa.re.kr',
   'https://www.koipa.re.kr/home/board/brdList.do?menu_cd=000041, https://www.koipa.re.kr/home/board/brdList.do?menu_cd=000042',
   "검색어 '태국' or '방콕' 입력했을 때 새로운 공고 있으면 제목, 등록일, 디테일 페이지 url 메일로"],
  ['bizinfo', '기업마당', 'https://www.bizinfo.go.kr',
   'https://www.bizinfo.go.kr/sii/siia/selectSIIA200View.do',
   "지원사업명에 태국/방콕/bangkok/thailand 검색해서 새로운 거 지원사업명, 게시일, 디테일 페이지 url 메일로"],
  ['kto', '한국관광공사 (KTO) 방콕지사', 'https://touraz.kr',
   'https://touraz.kr/publicTenderList, https://touraz.kr/announcementList',
   "입찰공고(KTO+유관기관 2탭) 및 공고·공모에서 검색조건 '전체'로 태국/방콕/bangkok/thailand 검색"],
  ['suhyup', '수협중앙회 방콕무역지원센터', 'https://www.suhyup.co.kr',
   'https://www.suhyup.co.kr/bbs/suhyup/23/artclList.do',
   '입찰공고 게시판 제목 검색 — 방콕, 태국, bangkok, thailand'],
  ['at', '한국농수산식품유통공사 (aT) 방콕지사', 'https://www.enjoykfood.com/bidding',
   'https://www.enjoykfood.com/?mid=bidding&search_target=title_content',
   '입찰공고 제목+내용 검색 — 방콕, 태국, bangkok, thailand'],
  ['kotra', '대한무역투자진흥공사 (KOTRA) 방콕무역관', 'https://www.kotra.or.kr/bangkok/index.do',
   'https://www.kotra.or.kr/bangkok/subList/40000000403',
   '방콕무역관 사업 안내 목록 검색 — bangkok, thailand, 방콕, 태국'],
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

  console.log(`\n✅ 완료 — 생성 ${created}, 스킵 ${skipped}`);
  await conn.end();
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
