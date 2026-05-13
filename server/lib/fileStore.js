// 다운받은 첨부파일을 디스크에 보존 (admin 페이지 재다운로드용)
// 경로: server/data/files/<bidNo>/<원본파일명>

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_ROOT = path.resolve(__dirname, '../data/files');

function safeBidDir(bidNo) {
  return bidNo.replace(/[^A-Za-z0-9_\-]/g, '_');
}

function safeFileName(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_');
}

export function saveFiles(bidNo, files) {
  if (!files || !files.length) return [];
  const dir = path.join(STORE_ROOT, safeBidDir(bidNo));
  fs.mkdirSync(dir, { recursive: true });
  const out = [];
  for (const f of files) {
    const fname = safeFileName(f.name);
    const fpath = path.join(dir, fname);
    fs.writeFileSync(fpath, f.bytes);
    out.push({
      name: f.name,
      size: f.bytes.length,
      path: path.relative(STORE_ROOT, fpath).replace(/\\/g, '/'),
    });
  }
  return out;
}

export function listFiles(bidNo) {
  const dir = path.join(STORE_ROOT, safeBidDir(bidNo));
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map(name => ({
    name,
    size: fs.statSync(path.join(dir, name)).size,
  }));
}

export function readFile(bidNo, name) {
  const dir = path.join(STORE_ROOT, safeBidDir(bidNo));
  const fpath = path.join(dir, safeFileName(name));
  // path traversal 방지
  if (!fpath.startsWith(dir)) return null;
  if (!fs.existsSync(fpath)) return null;
  return fs.readFileSync(fpath);
}

export { STORE_ROOT };
