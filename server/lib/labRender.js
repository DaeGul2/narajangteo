// 실험실 — .hwp → pyhwp `hwp5html` → Playwright HTML→PDF → 페이지별 텍스트
//
// LibreOffice 26 은 hwpfilter 가 제거되어 HWP 변환 불가.
// 사용자 환경에 이미 설치된 도구만 사용:
//   - pyhwp (hwp5html)        : .hwp → HTML
//   - playwright + chromium   : HTML → PDF (이미 g2b 자동화에서 사용 중)
//   - pdfjs-dist              : PDF → 페이지별 텍스트
//
// .hwpx 는 pyhwp 미지원 → 명확한 안내 메시지.

import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import crypto from 'node:crypto';
import { chromium } from 'playwright';

const TTL_MS = 4 * 60 * 60 * 1000; // 4시간
const _cache = new Map(); // sid -> { pdfBuf, hwpBuf, filename, ts }

// 디스크 캐시 — 서버 재시작 (특히 node --watch) 에도 세션 유지
const CACHE_DIR = path.join(os.tmpdir(), 'g2b-lab-cache');
function _ensureDir() {
  try { fsSync.mkdirSync(CACHE_DIR, { recursive: true }); } catch {}
}
function _diskPath(sid, kind) {
  return path.join(CACHE_DIR, `${sid}.${kind}`);
}
async function _writeDisk(sid, filename, hwpBuf, pdfBuf) {
  _ensureDir();
  await fs.writeFile(_diskPath(sid, 'hwp'), hwpBuf);
  await fs.writeFile(_diskPath(sid, 'pdf'), pdfBuf);
  await fs.writeFile(_diskPath(sid, 'meta.json'), JSON.stringify({ filename, ts: Date.now() }));
}
function _gcDisk() {
  try {
    _ensureDir();
    const now = Date.now();
    for (const f of fsSync.readdirSync(CACHE_DIR)) {
      if (!f.endsWith('.meta.json')) continue;
      try {
        const meta = JSON.parse(fsSync.readFileSync(path.join(CACHE_DIR, f), 'utf-8'));
        if (now - meta.ts > TTL_MS) {
          const sid = f.replace('.meta.json', '');
          for (const ext of ['hwp', 'pdf', 'meta.json']) {
            try { fsSync.unlinkSync(_diskPath(sid, ext)); } catch {}
          }
        }
      } catch {}
    }
  } catch {}
}

function gc() {
  const now = Date.now();
  for (const [k, v] of _cache.entries()) {
    if (now - v.ts > TTL_MS) _cache.delete(k);
  }
  _gcDisk();
}

export function getCachedSession(sid) {
  gc();
  const inMem = _cache.get(sid);
  if (inMem) return inMem;
  // 메모리에 없으면 디스크에서 (재시작 후) — synchronous fallback
  try {
    const metaRaw = fsSync.readFileSync(_diskPath(sid, 'meta.json'), 'utf-8');
    const meta = JSON.parse(metaRaw);
    if (Date.now() - meta.ts > TTL_MS) return null;
    const hwpBuf = fsSync.readFileSync(_diskPath(sid, 'hwp'));
    const pdfBuf = fsSync.readFileSync(_diskPath(sid, 'pdf'));
    const entry = { hwpBuf, pdfBuf, filename: meta.filename, ts: meta.ts };
    _cache.set(sid, entry);
    return entry;
  } catch { return null; }
}

// 호환용 — 기존 PDF 다운로드 엔드포인트가 사용
export function getCachedPdf(sid) {
  const s = getCachedSession(sid);
  if (!s) return null;
  return { buf: s.pdfBuf, filename: s.filename, ts: s.ts };
}

async function exists(p) {
  return fs.stat(p).then(() => true).catch(() => false);
}

// hwp5html.exe 자동 탐지. env > 일반 설치 경로 > PATH 의 hwp5html
async function findHwp5Html() {
  if (process.env.HWP5HTML_PATH) return process.env.HWP5HTML_PATH;
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || '';
    const candidates = [];
    for (const v of ['Python313', 'Python312', 'Python311', 'Python310']) {
      candidates.push(path.join(local, 'Programs', 'Python', v, 'Scripts', 'hwp5html.exe'));
    }
    for (const c of candidates) if (await exists(c)) return c;
  } else {
    for (const c of ['/usr/local/bin/hwp5html', '/usr/bin/hwp5html']) {
      if (await exists(c)) return c;
    }
  }
  return 'hwp5html'; // PATH 에 있길 기대
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, ...opts });
    let out = '', err = '';
    p.stdout?.on('data', (d) => (out += d.toString()));
    p.stderr?.on('data', (d) => (err += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve({ out, err });
      else reject(new Error(`${path.basename(cmd)} exit ${code}: ${(err + out).slice(0, 600)}`));
    });
  });
}

async function htmlToPdf(htmlPath) {
  const launchOpts = {};
  if (process.env.PW_BROWSER_PATH) launchOpts.executablePath = process.env.PW_BROWSER_PATH;
  const browser = await chromium.launch(launchOpts);
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');
    await page.goto(fileUrl, { waitUntil: 'load', timeout: 30000 });
    // 외부 자원(이미지) 로딩 대기
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    const pdf = await page.pdf({
      format: 'A4',
      margin: { top: '15mm', right: '12mm', bottom: '15mm', left: '12mm' },
      printBackground: true,
      preferCSSPageSize: false,
    });
    return pdf;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function hwpToPdf(buf, filename) {
  const ext = path.extname(filename || '').toLowerCase();
  if (ext === '.hwpx') {
    throw new Error(
      '.hwpx 는 아직 지원하지 않습니다. ' +
      '한글에서 "다른 이름으로 저장 → 한글 문서(.hwp)" 로 변환해 올려주세요.'
    );
  }
  if (ext !== '.hwp') {
    throw new Error('.hwp 파일만 지원합니다');
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'g2b-lab-'));
  const inPath = path.join(tmpDir, 'in.hwp');
  const htmlDir = path.join(tmpDir, 'html');
  await fs.writeFile(inPath, buf);
  await fs.mkdir(htmlDir, { recursive: true });

  try {
    const hwp5html = await findHwp5Html();
    await run(hwp5html, [inPath, '--output', htmlDir]);

    const htmlPath = path.join(htmlDir, 'index.xhtml');
    if (!(await exists(htmlPath))) {
      const list = await fs.readdir(htmlDir).catch(() => []);
      throw new Error(`hwp5html 결과 HTML 없음. htmlDir: ${list.join(', ')}`);
    }

    return await htmlToPdf(htmlPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// pdfjs-dist legacy build (Node 호환). 한 번만 require.
let _pdfjs = null;
async function loadPdfjs() {
  if (_pdfjs) return _pdfjs;
  const mod = await import('pdfjs-dist/legacy/build/pdf.mjs');
  _pdfjs = mod;
  return mod;
}

async function pdfToPageTexts(pdfBuf) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(pdfBuf),
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let lastY = null;
    const parts = [];
    for (const it of content.items) {
      const y = it.transform?.[5];
      if (lastY != null && y != null && Math.abs(y - lastY) > 4) parts.push('\n');
      else if (parts.length) parts.push(' ');
      parts.push(it.str || '');
      lastY = y;
    }
    const text = parts.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    const firstLine = (text.split('\n').find((s) => s.trim().length > 0) || '').slice(0, 60).trim();
    pages.push({
      index: i,
      title: firstLine || `페이지 ${i}`,
      text,
    });
    page.cleanup?.();
  }
  await doc.destroy?.();
  return pages;
}

export async function renderToSession(buf, filename) {
  const pdf = await hwpToPdf(buf, filename);
  const pages = await pdfToPageTexts(pdf);
  const sid = crypto.randomBytes(12).toString('hex');
  const hwpBuf = Buffer.from(buf);
  _cache.set(sid, {
    pdfBuf: pdf,
    hwpBuf, // 트리 추출·재조립용 원본 hwp
    filename,
    ts: Date.now(),
  });
  // 디스크에도 백업 — 서버 재시작 (node --watch 등) 에도 세션 유지
  _writeDisk(sid, filename, hwpBuf, pdf).catch(e => console.warn('[lab] disk cache write fail:', e.message));
  gc();
  return { sid, pages, pageCount: pages.length };
}
