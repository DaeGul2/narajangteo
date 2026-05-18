// 실험실 — 배치 한글파일 생성 진행률 추적용 메모리 스토어
//
// 폴링 기반. POST /replicate-bulk 즉시 jobId 반환 → 클라가 1초 간격으로 GET.
// done=true 가 되면 download URL 로 ZIP 받기.

import crypto from 'node:crypto';

const TTL_MS = 60 * 60 * 1000; // 1시간
const _jobs = new Map(); // jobId -> { phase, current, total, currentName, failed, zipBuf, error, ts }

function gc() {
  const now = Date.now();
  for (const [k, v] of _jobs.entries()) {
    if (now - v.ts > TTL_MS) _jobs.delete(k);
  }
}

export function createJob(total) {
  gc();
  const id = crypto.randomBytes(10).toString('hex');
  _jobs.set(id, {
    phase: 'queued',
    stage: '',
    current: 0,
    total,
    currentName: '',
    failed: [],
    successNames: [],
    zipBuf: null,
    error: null,
    startedAt: Date.now(),
    ts: Date.now(),
  });
  return id;
}

export function updateJob(id, patch) {
  const j = _jobs.get(id);
  if (!j) return;
  Object.assign(j, patch, { ts: Date.now() });
}

export function getJob(id) {
  gc();
  return _jobs.get(id) || null;
}

// 클라이언트에 노출 가능한 형태 (zipBuf 제거)
export function jobStatus(id) {
  const j = getJob(id);
  if (!j) return null;
  return {
    phase: j.phase,
    stage: j.stage || '',
    current: j.current,
    total: j.total,
    currentName: j.currentName,
    successCount: j.successNames.length,
    failedCount: j.failed.length,
    failed: j.failed,
    successNames: j.successNames,
    error: j.error,
    hasZip: !!j.zipBuf,
    elapsedMs: Date.now() - (j.startedAt || j.ts),
  };
}
