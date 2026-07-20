#!/usr/bin/env node
// 기존 DATETIME 값 UTC → KST 보정 (+9시간). 1회만 실행 (app_secrets 플래그로 가드).
//
// 배경: RDS 의 time_zone 이 UTC 라 NOW()/CURRENT_TIMESTAMP 가 UTC 로 저장돼 왔다.
//       lib/db.js 가 이제 커넥션마다 SET time_zone='+09:00' 하므로 신규 행은 KST.
//       과거 행만 이 스크립트로 한 번 밀어준다.
//
// 사용: node migrate_timezone.mjs          (dry-run — 무엇이 바뀔지만 출력)
//       node migrate_timezone.mjs --apply  (실제 반영)

import 'dotenv/config';
import mysql from 'mysql2/promise';

const FLAG = 'tz_migrated_kst_v1';

// [테이블, [컬럼...]] — DB 의 CURRENT_TIMESTAMP / NOW() 로 채워지는 것만 (= UTC 로 저장돼 있음)
//
// ⚠️ 제외 대상:
//   notices.email_sent_at  — cron.js 가 JS Date 로 넣고 mysql2 timezone '+09:00' 으로 직렬화 → 이미 KST
//   attendance_snapshots   — 테이블 통째로 제외. captured_at 은 27건 중 17건이 백필의
//                            '<date> 17:00:00' 리터럴(의도된 KST 벽시계값)이고 나머지는 JS 로컬시각이라
//                            provenance 가 섞여 있다. 지각 판정의 근거 데이터라 손대지 않는다.
const TARGETS = [
  ['notices',              ['created_at', 'updated_at']],
  ['cron_runs',            ['started_at', 'finished_at']],
  ['recipients',           ['created_at']],
  ['cron_settings',        ['updated_at']],
  ['app_secrets',          ['updated_at', 'last_used_at']],
  ['bid_employees',        ['created_at', 'updated_at']],
  ['holidays',             ['created_at']],
  ['overseas_notices',     ['created_at', 'updated_at', 'email_sent_at']],
  ['overseas_recipients',  ['created_at']],
  ['overseas_cron_settings', ['updated_at']],
  ['overseas_cron_runs',   ['started_at', 'finished_at']],
  ['overseas_sources',     ['created_at', 'updated_at', 'last_crawled_at']],
];

const apply = process.argv.includes('--apply');

async function tableExists(conn, name) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?`, [name]
  );
  return rows.length > 0;
}
async function columnExists(conn, table, col) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`, [table, col]
  );
  return rows.length > 0;
}

async function main() {
  for (const k of ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
    if (!process.env[k]) { console.error(`❌ ${k} 미설정`); process.exit(1); }
  }
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    dateStrings: true,
  });
  console.log(`[migrate-timezone] ${process.env.DB_HOST}/${process.env.DB_NAME} 연결됨`);

  // 이미 돌았는지 확인
  if (await tableExists(conn, 'app_secrets')) {
    const [[done]] = await conn.query(`SELECT v FROM app_secrets WHERE k = ?`, [FLAG]);
    if (done) {
      console.log(`✅ 이미 적용됨 (${done.v}) — 중복 실행 방지, 아무것도 하지 않음`);
      await conn.end();
      return;
    }
  }

  let totalRows = 0;
  for (const [table, cols] of TARGETS) {
    if (!(await tableExists(conn, table))) { console.log(`  - ${table}: 테이블 없음 (skip)`); continue; }
    const present = [];
    for (const c of cols) if (await columnExists(conn, table, c)) present.push(c);
    if (!present.length) { console.log(`  - ${table}: 대상 컬럼 없음 (skip)`); continue; }

    const whereAny = present.map(c => `\`${c}\` IS NOT NULL`).join(' OR ');
    const [[cnt]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE ${whereAny}`);
    if (Number(cnt.n) === 0) { console.log(`  - ${table}: 값 있는 행 0 (skip)`); continue; }

    if (apply) {
      const sets = present.map(c => `\`${c}\` = DATE_ADD(\`${c}\`, INTERVAL 9 HOUR)`).join(', ');
      const [r] = await conn.query(`UPDATE \`${table}\` SET ${sets} WHERE ${whereAny}`);
      console.log(`  + ${table}.(${present.join(', ')}): ${r.affectedRows}행 +9h`);
      totalRows += r.affectedRows;
    } else {
      console.log(`  ~ ${table}.(${present.join(', ')}): ${cnt.n}행 대상`);
      totalRows += Number(cnt.n);
    }
  }

  if (apply) {
    await conn.execute(
      `INSERT INTO app_secrets (k, v, note) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE v = VALUES(v)`,
      [FLAG, new Date().toISOString(), 'UTC→KST +9h 보정 완료']
    );
    console.log(`\n✅ 완료 — 총 ${totalRows}행 보정, 플래그(${FLAG}) 기록`);
  } else {
    console.log(`\n(dry-run) 총 ${totalRows}행이 대상입니다. --apply 로 실제 반영하세요.`);
  }
  await conn.end();
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
