#!/usr/bin/env node
// 수신자 관리 CLI
//
// 사용:
//   node recipients.js list
//   node recipients.js add foo@bar.com [이름]
//   node recipients.js remove foo@bar.com

import 'dotenv/config';
import pool, { getActiveRecipients, addRecipient, deactivateRecipient } from './lib/db.js';

const [, , cmd, ...args] = process.argv;

async function main() {
  switch (cmd) {
    case 'list': {
      const rows = await getActiveRecipients();
      console.log(`활성 수신자 ${rows.length}명:`);
      for (const r of rows) console.log(`  - ${r.name ? r.name + ' ' : ''}<${r.email}>`);
      break;
    }
    case 'add': {
      const [email, name] = args;
      if (!email) throw new Error('email 인자 필요');
      await addRecipient(email, name || null);
      console.log(`✅ 추가/활성화: ${email}${name ? ' (' + name + ')' : ''}`);
      break;
    }
    case 'remove': {
      const [email] = args;
      if (!email) throw new Error('email 인자 필요');
      await deactivateRecipient(email);
      console.log(`✅ 비활성화: ${email}`);
      break;
    }
    default:
      console.log('사용법: node recipients.js [list|add <email> [name]|remove <email>]');
  }
  await pool.end();
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
