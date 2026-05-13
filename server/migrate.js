#!/usr/bin/env node
// schema.sql 을 RDS 에 적용. 멱등(여러 번 실행 OK).

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const required = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
  for (const k of required) {
    if (!process.env[k]) {
      console.error(`❌ ${k} 미설정 — .env 확인`);
      process.exit(1);
    }
  }

  console.log(`[migrate] ${process.env.DB_HOST}/${process.env.DB_NAME} 연결...`);
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });

  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  console.log('[migrate] schema.sql 적용 중...');
  await conn.query(sql);
  console.log('✅ 완료');

  const [tables] = await conn.query('SHOW TABLES');
  console.log('테이블:', tables.map(r => Object.values(r)[0]));

  await conn.end();
}

main().catch(e => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
