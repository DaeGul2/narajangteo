// HTML 엔티티 디코딩, 공백 정규화, 금액 포맷, 공고번호 정규화

const HTML_ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
  '&nbsp;': ' ',
};

function decodeHtmlEntities(s) {
  if (!s) return '';
  let out = String(s);
  // 명명 엔티티
  for (const [k, v] of Object.entries(HTML_ENTITIES)) {
    out = out.split(k).join(v);
  }
  // 숫자 엔티티 &#NNN;
  out = out.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
  // 16진 엔티티 &#xHH;
  out = out.replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
  return out;
}

export function clean(v) {
  if (v === null || v === undefined) return '';
  return decodeHtmlEntities(String(v)).trim();
}

// 입찰공고번호 정규화: 'R26BK01480852 - 000' → 'R26BK01480852-000'
export function normalizeBidNo(v) {
  return clean(v).replace(/\s+/g, '');
}

// 금액 포맷: 1234567 → '1,234,567원'
export function money(v) {
  const s = clean(v);
  if (!s) return '';
  const digits = s.replace(/[^\d]/g, '');
  if (!digits) return s;
  return Number(digits).toLocaleString('en-US') + '원';
}

// Playwright 공통 launch 옵션
// PW_BROWSER_PATH 환경변수 있으면 그 실행파일 사용 (Ubuntu 26.04 에서 시스템 Chrome 등)
export function browserLaunchOpts(extra = {}) {
  const opts = {
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
    ...extra,
  };
  if (process.env.PW_BROWSER_PATH) {
    opts.executablePath = process.env.PW_BROWSER_PATH;
  }
  return opts;
}
