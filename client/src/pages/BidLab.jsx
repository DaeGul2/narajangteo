// 입찰 — 실험실
// 1. .hwp 업로드 (드래그앤드롭) → 서버에서 hwp5html→PDF 변환 + 원본 hwp 캐시
// 2. PDF 페이지 썸네일 그리드 / 클릭 시 모달 (검증용)
// 3. 직원 선택 → GPT가 hwp 트리를 직원 데이터로 채움 → 진짜 .hwp 다운로드
import { useCallback, useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { authFetch, getToken } from '../auth.js'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const S = {
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 18, marginBottom: 14 },
  cardTitle: { fontWeight: 700, fontSize: 14, marginBottom: 12, color: '#0f172a' },
  dropZone: (active) => ({
    border: `2px dashed ${active ? '#1d4ed8' : '#cbd5e1'}`,
    background: active ? '#eff6ff' : '#f8fafc',
    borderRadius: 12, padding: '44px 24px', textAlign: 'center',
    cursor: 'pointer', transition: 'all .15s ease',
  }),
  dropTitle: { fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 6 },
  dropHint: { fontSize: 12, color: '#64748b' },
  fileBar: {
    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
    background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 14px',
  },
  fileName: { fontWeight: 700, color: '#0f172a', fontSize: 13 },
  badge: { display: 'inline-block', padding: '2px 8px', borderRadius: 999, background: '#e2e8f0', color: '#475569', fontSize: 11, fontWeight: 600 },
  blueBadge: { display: 'inline-block', padding: '2px 8px', borderRadius: 999, background: '#dbeafe', color: '#1d4ed8', fontSize: 11, fontWeight: 700 },
  ghostBtn: { padding: '6px 12px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer', color: '#0f172a' },
  primaryBtn: { padding: '10px 22px', fontSize: 13, border: 'none', borderRadius: 8, background: '#1d4ed8', color: '#fff', cursor: 'pointer', fontWeight: 700 },
  bigBtn: { padding: '12px 26px', fontSize: 14, border: 'none', borderRadius: 8, background: '#0f172a', color: '#fff', cursor: 'pointer', fontWeight: 700 },
  thumbGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16 },
  thumb: (active) => ({
    position: 'relative', background: '#fff', border: '1px solid #e5e7eb',
    borderRadius: 10, padding: 8, cursor: 'pointer',
    boxShadow: active ? '0 0 0 3px #1d4ed8' : '0 1px 2px rgba(0,0,0,0.04)',
    transition: 'transform .12s ease, box-shadow .12s ease', overflow: 'hidden',
  }),
  thumbCanvas: { display: 'block', width: '100%', height: 'auto', borderRadius: 6, background: '#f1f5f9' },
  thumbLabel: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, padding: '0 2px' },
  thumbNum: { fontSize: 12, fontWeight: 700, color: '#334155' },
  textarea: {
    padding: 10, fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6,
    background: '#fff', width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit',
  },
  select: {
    padding: '8px 12px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6,
    background: '#fff', minWidth: 240, fontFamily: 'inherit',
  },
  errBox: { background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: 10, borderRadius: 8, fontSize: 13, marginBottom: 12 },
  okBox: { background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', padding: 10, borderRadius: 8, fontSize: 13, marginBottom: 12 },
  modalBackdrop: {
    position: 'fixed', inset: 0, background: 'rgba(15,23,42,.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
  },
  modalBox: {
    background: '#fff', borderRadius: 12, width: 'min(960px, 100%)',
    maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    boxShadow: '0 20px 60px rgba(0,0,0,.3)',
  },
  modalHead: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 18px', borderBottom: '1px solid #e5e7eb',
  },
  modalBody: { padding: 18, overflow: 'auto', background: '#f8fafc' },
  modalCanvasWrap: {
    display: 'flex', justifyContent: 'center', background: '#fff', padding: 16,
    borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,.08)',
  },
  modalCanvas: { display: 'block', maxWidth: '100%', height: 'auto' },
  modalFoot: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
    padding: '12px 18px', borderTop: '1px solid #e5e7eb', background: '#fff',
  },
  treeBox: {
    background: '#0f172a', color: '#e2e8f0', fontSize: 11.5,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    padding: 14, borderRadius: 8, whiteSpace: 'pre-wrap', maxHeight: '65vh', overflow: 'auto',
  },
  empGridHead: {
    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10,
  },
  empGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 6,
    maxHeight: 280, overflow: 'auto',
    background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8, padding: 10,
  },
  empItem: (checked) => ({
    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
    background: checked ? '#eff6ff' : '#fff',
    border: `1px solid ${checked ? '#93c5fd' : '#e5e7eb'}`,
    borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#0f172a',
    userSelect: 'none',
  }),
  empName: { fontWeight: 600 },
  empPos: { fontSize: 11, color: '#64748b' },
  progressWrap: {
    background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8,
    padding: 14, marginTop: 14,
  },
  progressBar: {
    width: '100%', height: 10, background: '#e2e8f0', borderRadius: 999, overflow: 'hidden',
    marginTop: 8,
  },
  progressFill: (pct, color = '#1d4ed8') => ({
    height: '100%', background: color, width: `${pct}%`, transition: 'width .25s ease',
  }),
}

const THUMB_DPR = Math.min(window.devicePixelRatio || 1, 2)

const STAGE_LABELS = {
  openHwp: 'hwp 로드',
  paste: '구조 paste',
  db: 'DB 조회',
  tree: '트리 추출',
  gpt: 'GPT 호출',
  apply: '수정 적용',
  done: '완료',
  fail: '실패',
}
const stageLabel = (s) => STAGE_LABELS[s] || s

export default function BidLab() {
  const fileRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)
  const [filename, setFilename] = useState('')
  const [sid, setSid] = useState('')
  const [pages, setPages] = useState([])
  const [pdfDoc, setPdfDoc] = useState(null)
  const [modalPage, setModalPage] = useState(null)

  // 직원 + 한글 생성
  const [employees, setEmployees] = useState([])
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [instruction, setInstruction] = useState('')
  const [job, setJob] = useState(null) // { jobId, phase, current, total, currentName, ... }

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [showTree, setShowTree] = useState(false)
  const [treeText, setTreeText] = useState('')

  const thumbRefs = useRef(new Map())
  const modalCanvasRef = useRef(null)

  // 직원 리스트 한 번 로드 + 디폴트로 전체 선택
  useEffect(() => {
    (async () => {
      try {
        const r = await authFetch('/api/admin/lab/employees')
        const j = await r.json().catch(() => ({}))
        if (r.ok) {
          const emps = j.employees || []
          setEmployees(emps)
          setSelectedIds(new Set(emps.map(e => e.id)))
        }
      } catch {}
    })()
  }, [])

  // 진행률 polling — job 이 처리중일 때만 1초마다
  useEffect(() => {
    if (!job?.jobId) return
    if (job.phase === 'done' || job.phase === 'error') return
    const t = setInterval(async () => {
      try {
        const r = await authFetch(`/api/admin/lab/replicate-bulk/${job.jobId}`)
        if (!r.ok) return
        const s = await r.json()
        setJob(prev => prev ? { ...prev, ...s } : prev)
      } catch {}
    }, 800)
    return () => clearInterval(t)
  }, [job?.jobId, job?.phase])

  // done 되면 자동 다운로드
  useEffect(() => {
    if (job?.phase !== 'done' || !job?.jobId || job.downloaded) return
    (async () => {
      try {
        const r = await authFetch(`/api/admin/lab/replicate-bulk/${job.jobId}/download`)
        if (!r.ok) {
          const j = await r.json().catch(() => ({}))
          throw new Error(j.error || `HTTP ${r.status}`)
        }
        const cd = r.headers.get('Content-Disposition') || ''
        const m = cd.match(/filename="([^"]+)"/)
        const downloadName = m ? decodeURIComponent(m[1]) : 'output.hwp'
        const blob = await r.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = downloadName
        document.body.appendChild(a); a.click(); a.remove()
        URL.revokeObjectURL(url)
        setJob(prev => prev ? { ...prev, downloaded: true, downloadName } : prev)
        setOkMsg(
          `${downloadName} 다운로드 완료 — ` +
          `성공 ${job.successCount}명${job.failedCount ? ` / 실패 ${job.failedCount}명` : ''}`
        )
      } catch (e) {
        setErr(`다운로드 실패: ${e.message}`)
      }
    })()
  }, [job?.phase, job?.jobId, job?.downloaded, job?.successCount, job?.failedCount])

  const handleFile = useCallback(async (f) => {
    if (!f) return
    const lower = f.name.toLowerCase()
    if (!lower.endsWith('.hwp') && !lower.endsWith('.hwpx')) {
      setErr('.hwp / .hwpx 파일만 가능합니다')
      return
    }
    setErr(''); setOkMsg(''); setPages([]); setPdfDoc(null); setSid('')
    setBusy(true)
    try {
      const t = getToken()
      const r = await fetch(`/api/admin/lab/parse?filename=${encodeURIComponent(f.name)}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          ...(t ? { Authorization: `Bearer ${t}` } : {}),
          'Content-Type': 'application/octet-stream',
        },
        body: f,
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setFilename(j.filename || f.name)
      setSid(j.sid || '')
      setPages(j.pages || [])
      if (!(j.pages || []).length) {
        setErr('추출된 페이지가 없습니다. 파일을 확인하세요.')
        return
      }
      const pdfRes = await authFetch(`/api/admin/lab/pdf/${j.sid}`)
      if (!pdfRes.ok) throw new Error(`PDF 로드 실패 HTTP ${pdfRes.status}`)
      const buf = await pdfRes.arrayBuffer()
      const doc = await pdfjs.getDocument({ data: buf }).promise
      setPdfDoc(doc)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }, [])

  // 썸네일 렌더링
  useEffect(() => {
    if (!pdfDoc || !pages.length) return
    let cancelled = false
    ;(async () => {
      for (const p of pages) {
        if (cancelled) return
        const canvas = thumbRefs.current.get(p.index)
        if (!canvas) continue
        try {
          const page = await pdfDoc.getPage(p.index)
          const baseVp = page.getViewport({ scale: 1 })
          const scale = (240 / baseVp.width) * THUMB_DPR
          const viewport = page.getViewport({ scale })
          canvas.width = viewport.width
          canvas.height = viewport.height
          canvas.style.aspectRatio = `${baseVp.width} / ${baseVp.height}`
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
          page.cleanup?.()
        } catch {}
      }
    })()
    return () => { cancelled = true }
  }, [pdfDoc, pages])

  // 모달 큰 렌더
  useEffect(() => {
    if (modalPage == null || !pdfDoc) return
    let cancelled = false
    ;(async () => {
      const canvas = modalCanvasRef.current
      if (!canvas) return
      const page = await pdfDoc.getPage(modalPage)
      const baseVp = page.getViewport({ scale: 1 })
      const targetW = Math.min(880, window.innerWidth - 120)
      const scale = (targetW / baseVp.width) * Math.min(window.devicePixelRatio || 1, 2)
      const viewport = page.getViewport({ scale })
      if (cancelled) return
      canvas.width = viewport.width
      canvas.height = viewport.height
      canvas.style.width = `${targetW}px`
      canvas.style.height = 'auto'
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
      page.cleanup?.()
    })()
    return () => { cancelled = true }
  }, [modalPage, pdfDoc])

  useEffect(() => {
    if (modalPage == null && !showTree) return
    const onKey = (e) => {
      if (e.key === 'Escape') { setModalPage(null); setShowTree(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modalPage, showTree])

  const onDrop = (e) => {
    e.preventDefault(); e.stopPropagation()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) handleFile(f)
  }

  const viewTree = async () => {
    if (!sid) return
    setErr(''); setOkMsg(''); setBusy(true)
    try {
      const r = await authFetch(`/api/admin/lab/tree/${sid}`)
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setTreeText(JSON.stringify(j.tree, null, 2))
      setShowTree(true)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const toggleEmployee = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const selectAll = () => setSelectedIds(new Set(employees.map(e => e.id)))
  const clearAll = () => setSelectedIds(new Set())

  const startReplicate = async () => {
    if (!sid) { setErr('파일을 먼저 업로드하세요'); return }
    if (selectedIds.size === 0) { setErr('직원을 한 명 이상 선택하세요'); return }
    setErr(''); setOkMsg(''); setJob(null)
    try {
      const r = await authFetch('/api/admin/lab/replicate-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sid,
          employeeIds: Array.from(selectedIds),
          instruction,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setJob({
        jobId: j.jobId,
        phase: 'queued',
        current: 0,
        total: j.total,
        currentName: '',
        successCount: 0,
        failedCount: 0,
        failed: [],
        downloaded: false,
      })
    } catch (e) {
      setErr(e.message)
    }
  }

  return (
    <div>
      <div className="page-head">
        <h2>입찰 — 실험실</h2>
        <div className="page-sub">.hwp 업로드 → 직원 선택 → GPT가 한글 트리를 직원 데이터로 채워서 .hwp 생성</div>
      </div>

      {err && <div style={S.errBox}>{err}</div>}
      {okMsg && <div style={S.okBox}>{okMsg}</div>}

      {/* 1. 업로드 */}
      <div style={S.card}>
        <div style={S.cardTitle}>1. 템플릿 파일 업로드</div>
        {!filename && (
          <div
            style={S.dropZone(dragOver)}
            onClick={() => fileRef.current?.click()}
            onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true) }}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true) }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false) }}
            onDrop={onDrop}
          >
            <div style={{ fontSize: 36, marginBottom: 8 }}>📄</div>
            <div style={S.dropTitle}>여기로 한글 파일을 끌어다 놓거나 클릭해서 선택</div>
            <div style={S.dropHint}>.hwp · 최대 30MB</div>
            {busy && (
              <div style={{ marginTop: 14, fontSize: 12, color: '#1d4ed8', fontWeight: 600 }}>
                변환중… (hwp5html → Chromium → PDF)
              </div>
            )}
          </div>
        )}
        {filename && (
          <div style={S.fileBar}>
            <span style={{ fontSize: 18 }}>📄</span>
            <span style={S.fileName}>{filename}</span>
            <span style={S.badge}>{pages.length}페이지</span>
            <div style={{ flex: 1 }} />
            <button style={S.ghostBtn} onClick={viewTree} disabled={busy || !sid}>
              트리 구조 보기
            </button>
            <button
              style={S.ghostBtn}
              onClick={() => {
                setFilename(''); setPages([]); setPdfDoc(null); setSid('')
                setOkMsg(''); setErr('')
              }}
              disabled={busy}
            >
              다른 파일
            </button>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".hwp,.hwpx"
          onChange={(e) => handleFile(e.target.files?.[0])}
          disabled={busy}
          style={{ display: 'none' }}
        />
      </div>

      {/* 2. 페이지 미리보기 */}
      {pages.length > 0 && (
        <div style={S.card}>
          <div style={S.cardTitle}>2. 페이지 미리보기 (검증용)</div>
          <div style={S.thumbGrid}>
            {pages.map(p => (
              <div
                key={p.index}
                style={S.thumb(false)}
                onClick={() => setModalPage(p.index)}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)' }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)' }}
              >
                <canvas
                  ref={(el) => { if (el) thumbRefs.current.set(p.index, el); else thumbRefs.current.delete(p.index) }}
                  style={S.thumbCanvas}
                />
                <div style={S.thumbLabel}>
                  <span style={S.thumbNum}>페이지 {p.index}</span>
                  <span style={S.badge}>{p.text.length}자</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. 직원 선택 + 한글 파일 생성 */}
      {pages.length > 0 && (
        <div style={S.card}>
          <div style={S.cardTitle}>3. 직원 선택 → 단일 한글 파일에 차례로 채워서 다운로드</div>

          <div style={S.empGridHead}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
              활성 직원 {employees.length}명
            </span>
            <span style={S.blueBadge}>선택 {selectedIds.size}명</span>
            <div style={{ flex: 1 }} />
            <button style={S.ghostBtn} onClick={selectAll} disabled={!!job && job.phase !== 'done' && job.phase !== 'error'}>
              전체 선택
            </button>
            <button style={S.ghostBtn} onClick={clearAll} disabled={!!job && job.phase !== 'done' && job.phase !== 'error'}>
              전체 해제
            </button>
          </div>

          <div style={S.empGrid}>
            {employees.map(e => {
              const checked = selectedIds.has(e.id)
              return (
                <label key={e.id} style={S.empItem(checked)}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleEmployee(e.id)}
                    disabled={!!job && job.phase !== 'done' && job.phase !== 'error'}
                  />
                  <span style={S.empName}>{e.name}</span>
                  {e.position && <span style={S.empPos}>({e.position})</span>}
                </label>
              )
            })}
          </div>

          <div style={{ marginTop: 14, marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6, fontWeight: 600 }}>
              지시사항 (선택) — 비워두면 GPT가 라벨을 보고 알아서 채움
            </div>
            <textarea
              style={{ ...S.textarea, minHeight: 80 }}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="예) 이름·연락처·이메일·학력·해당분야 근무경력만 채우고 나머지는 그대로 두세요."
              disabled={!!job && job.phase !== 'done' && job.phase !== 'error'}
            />
          </div>

          <button
            style={S.bigBtn}
            onClick={startReplicate}
            disabled={
              busy ||
              selectedIds.size === 0 ||
              (!!job && job.phase !== 'done' && job.phase !== 'error')
            }
          >
            {job && job.phase !== 'done' && job.phase !== 'error'
              ? '처리중…'
              : `한글 파일 생성 (${selectedIds.size}명, 단일 .hwp)`}
          </button>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>
            템플릿이 N벌 복제되어 한 파일 안에 차례로 들어가고, 각 영역이 해당 직원 데이터로 채워집니다. 사람 사이는 빈 줄 2개로 구분.
          </div>

          {/* 진행률 */}
          {job && (
            <div style={S.progressWrap}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#0f172a' }}>
                <span style={{ fontWeight: 700 }}>
                  {job.phase === 'queued'      && '대기중…'}
                  {job.phase === 'init'        && '초기화중…'}
                  {job.phase === 'duplicating' && '템플릿 복제 중'}
                  {job.phase === 'mapping'     && (job.currentName || '직원 매핑 중')}
                  {job.phase === 'processing'  && (job.currentName || '시작중…')}
                  {job.phase === 'exporting'   && 'hwp 저장중…'}
                  {job.phase === 'done'        && '완료'}
                  {job.phase === 'error'       && '오류'}
                  {job.stage && (
                    <span style={{ marginLeft: 8, fontWeight: 600, color: '#1d4ed8', fontSize: 12 }}>
                      [{stageLabel(job.stage)}]
                    </span>
                  )}
                </span>
                <span style={{ color: '#475569' }}>
                  {job.current ?? 0} / {job.total ?? 0}
                  {job.failedCount ? ` (실패 ${job.failedCount})` : ''}
                  {typeof job.elapsedMs === 'number' && (
                    <span style={{ marginLeft: 10, color: '#94a3b8' }}>
                      {(job.elapsedMs / 1000).toFixed(1)}s
                    </span>
                  )}
                </span>
              </div>
              <div style={S.progressBar}>
                <div
                  style={S.progressFill(
                    job.total ? Math.round(((job.current || 0) / job.total) * 100) : 0,
                    job.phase === 'error' ? '#dc2626' : job.phase === 'done' ? '#16a34a' : '#1d4ed8'
                  )}
                />
              </div>
              {job.phase === 'error' && (
                <div style={{ marginTop: 8, fontSize: 12, color: '#b91c1c' }}>
                  {job.error}
                </div>
              )}
              {job.phase === 'done' && job.failedCount > 0 && (
                <div style={{ marginTop: 8, fontSize: 12, color: '#475569' }}>
                  실패: {job.failed?.slice(0, 5).map(f => f.name || `#${f.employeeId}`).join(', ')}
                  {job.failed?.length > 5 ? ` 외 ${job.failed.length - 5}명` : ''}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 모달 — 페이지 미리보기 */}
      {modalPage != null && (
        <div style={S.modalBackdrop} onClick={() => setModalPage(null)}>
          <div style={S.modalBox} onClick={(e) => e.stopPropagation()}>
            <div style={S.modalHead}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>페이지 {modalPage}</span>
              </div>
              <button style={S.ghostBtn} onClick={() => setModalPage(null)}>닫기 (Esc)</button>
            </div>
            <div style={S.modalBody}>
              <div style={S.modalCanvasWrap}>
                <canvas ref={modalCanvasRef} style={S.modalCanvas} />
              </div>
            </div>
            <div style={S.modalFoot}>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  style={S.ghostBtn}
                  disabled={modalPage <= 1}
                  onClick={() => setModalPage(modalPage - 1)}
                >
                  ← 이전
                </button>
                <button
                  style={S.ghostBtn}
                  disabled={modalPage >= pages.length}
                  onClick={() => setModalPage(modalPage + 1)}
                >
                  다음 →
                </button>
              </div>
              <span style={{ fontSize: 12, color: '#64748b' }}>{pages.length} 페이지 중 {modalPage}</span>
            </div>
          </div>
        </div>
      )}

      {/* 모달 — 트리 구조 JSON */}
      {showTree && (
        <div style={S.modalBackdrop} onClick={() => setShowTree(false)}>
          <div style={S.modalBox} onClick={(e) => e.stopPropagation()}>
            <div style={S.modalHead}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>한글 트리 구조 (디버그)</span>
              <button style={S.ghostBtn} onClick={() => setShowTree(false)}>닫기 (Esc)</button>
            </div>
            <div style={S.modalBody}>
              <pre style={S.treeBox}>{treeText}</pre>
            </div>
            <div style={S.modalFoot}>
              <span style={{ fontSize: 12, color: '#64748b' }}>
                전체 JSON ({treeText.length.toLocaleString()}자)
              </span>
              <button
                style={S.ghostBtn}
                onClick={() => { navigator.clipboard?.writeText(treeText).catch(() => {}) }}
              >
                JSON 복사
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
