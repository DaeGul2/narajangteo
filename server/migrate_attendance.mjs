#!/usr/bin/env node
// attendance_records 에 지각 판정 컬럼 추가 (멱등)
//   is_late          TINYINT(1)  — 0=통과 / 1=지각 / NULL=주말 등 평가 스킵
//   late_case_id     VARCHAR(30) — judgeV1 의 caseId
//   late_reason      TEXT
//   late_deadline    VARCHAR(20)
//   manual_override  TINYINT(1)  — 1 이면 사용자 수정. 재실행 시 보존
//   manual_note      TEXT

import 'dotenv/config';
import mysql from 'mysql2/promise';

const COLS = [
  ['is_late',         'TINYINT(1) DEFAULT NULL'],
  ['late_case_id',    'VARCHAR(30) DEFAULT NULL'],
  ['late_reason',     'TEXT DEFAULT NULL'],
  ['late_deadline',   'VARCHAR(20) DEFAULT NULL'],
  ['manual_override', 'TINYINT(1) NOT NULL DEFAULT 0'],
  ['manual_note',     'TEXT DEFAULT NULL'],
];

// bid_employees 에 추가할 컬럼
const EMP_COLS = [
  ['attendance_target', 'TINYINT(1) NOT NULL DEFAULT 1'],
];

// 공휴일 — 시스템이 평가 skip 할 날들 (회사 휴무일 포함)
// source 'kr_default' = 기본 시드 / 'manual' = 사용자 추가
const HOLIDAYS_SEED = [
  // 2024
  ['2024-10-01', '국군의 날 (임시공휴일)'],
  ['2024-10-03', '개천절'],
  ['2024-10-09', '한글날'],
  ['2024-12-25', '크리스마스'],
  // 2025
  ['2025-01-01', '신정'],
  ['2025-01-27', '설날 연휴 (대체)'],
  ['2025-01-28', '설날 전날'],
  ['2025-01-29', '설날'],
  ['2025-01-30', '설날 다음날'],
  ['2025-03-03', '삼일절 대체공휴일'],
  ['2025-05-01', '근로자의 날'],
  ['2025-05-05', '어린이날 / 부처님오신날'],
  ['2025-05-06', '어린이날 대체공휴일'],
  ['2025-06-06', '현충일'],
  ['2025-08-15', '광복절'],
  ['2025-10-03', '개천절'],
  ['2025-10-06', '추석 연휴'],
  ['2025-10-07', '추석'],
  ['2025-10-08', '추석 다음날'],
  ['2025-10-09', '한글날'],
  ['2025-12-25', '크리스마스'],
  // 2026
  ['2026-01-01', '신정'],
  ['2026-02-16', '설날 전날'],
  ['2026-02-17', '설날'],
  ['2026-02-18', '설날 다음날'],
  ['2026-03-02', '삼일절 대체공휴일'],
  ['2026-05-01', '근로자의 날'],
  ['2026-05-05', '어린이날'],
  ['2026-05-25', '부처님오신날 대체공휴일'],
  // 현충일 6/6, 광복절 8/15, 개천절 10/3 은 토요일이라 평일 룰 자동 skip
  ['2026-09-24', '추석 전날'],
  ['2026-09-25', '추석'],
  // 추석 다음날 9/26 = 토 (자동)
  ['2026-10-09', '한글날'],
  ['2026-12-25', '크리스마스'],
];

async function columnExists(conn, table, col) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, col]
  );
  return rows.length > 0;
}

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
  console.log(`[migrate-attendance] ${process.env.DB_HOST}/${process.env.DB_NAME} 연결됨`);

  // attendance_records 존재 확인
  const [[t]] = await conn.query(
    `SELECT 1 AS ok FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'attendance_records'`
  );
  if (!t || !t.ok) {
    console.error('❌ attendance_records 테이블이 없음 — 먼저 생성 필요');
    process.exit(1);
  }

  let added = 0, skipped = 0;
  for (const [col, def] of COLS) {
    if (await columnExists(conn, 'attendance_records', col)) {
      console.log(`  - ${col}: 이미 있음 (skip)`);
      skipped++;
      continue;
    }
    await conn.query(`ALTER TABLE attendance_records ADD COLUMN \`${col}\` ${def}`);
    console.log(`  + ${col}: 추가됨`);
    added++;
  }
  // 인덱스 — is_late 조회용
  const [[idx]] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.statistics
     WHERE table_schema=DATABASE() AND table_name='attendance_records' AND index_name='idx_is_late'`
  );
  if (Number(idx.n) === 0) {
    await conn.query(`ALTER TABLE attendance_records ADD INDEX idx_is_late (is_late)`);
    console.log('  + idx_is_late: 추가됨');
    added++;
  }

  // bid_employees.attendance_target
  console.log('\n[bid_employees]');
  for (const [col, def] of EMP_COLS) {
    if (await columnExists(conn, 'bid_employees', col)) {
      console.log(`  - ${col}: 이미 있음 (skip)`);
      skipped++;
      continue;
    }
    await conn.query(`ALTER TABLE bid_employees ADD COLUMN \`${col}\` ${def}`);
    console.log(`  + ${col}: 추가됨 (디폴트 1 — 전부 대상)`);
    added++;
  }

  // holidays 테이블 + 시드
  console.log('\n[holidays]');
  const [[h]] = await conn.query(
    `SELECT 1 AS ok FROM information_schema.tables
     WHERE table_schema=DATABASE() AND table_name='holidays'`
  );
  if (!h || !h.ok) {
    await conn.query(`
      CREATE TABLE holidays (
        date       DATE         PRIMARY KEY,
        name       VARCHAR(100) NOT NULL,
        source     VARCHAR(50)  NOT NULL DEFAULT 'manual',
        created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  + holidays 테이블 생성');
    added++;
  } else {
    console.log('  - holidays 테이블 이미 있음');
  }
  // 시드 — 이미 있는 날은 INSERT IGNORE
  let seeded = 0;
  for (const [d, n] of HOLIDAYS_SEED) {
    const [r] = await conn.execute(
      `INSERT IGNORE INTO holidays (date, name, source) VALUES (?, ?, 'kr_default')`,
      [d, n]
    );
    if (r.affectedRows > 0) seeded++;
  }
  console.log(`  + 시드 ${seeded}건 추가 (총 시드 ${HOLIDAYS_SEED.length}개 시도)`);

  console.log(`\n✅ 완료 — 추가 ${added}, 스킵 ${skipped}`);
  await conn.end();
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
