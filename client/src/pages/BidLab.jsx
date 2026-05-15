// 입찰 — 실험실
// 1. hwp/hwpx 업로드 → 서버에서 페이지 단위로 분할
// 2. 기준 페이지 1개 선택 (템플릿)
// 3. DB 데이터 범위 + GPT 지시사항 입력
// 4. GPT 호출 → 결과
import { useRef, useState } from 'react'
import { authFetch, getToken } from '../auth.js'

const S = {
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 12 },
  cardTitle: { fontWeight: 700, fontSize: 14, marginBottom: 10, color: '#0f172a' },
  pageCard: (active) => ({
    background: active ? '#eff6ff' : '#fff',
    border: active ? '2px solid #1d4ed8' : '1px solid #e5e7eb',
    borderRadius: 8, padding: 12, marginBottom: 8,
  }),
  pageHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  pageText: {
    whiteSpace: 'pre-wrap', fontSize: 12, color: '#374151',
    maxHeight: 280, overflow: 'auto',
    background: '#f9fafb', padding: 10, borderRadius: 6,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    marginTop: 8,
  },
  resultBox: {
    whiteSpace: 'pre-wrap', fontSize: 13, color: '#0f172a',
    background: '#f9fafb', padding: 12, borderRadius: 6,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    border: '1px solid #e5e7eb',
  },
  miniBtn: { padding: '4px 10px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 5, background: '#fff', cursor: 'pointer' },
  activeBtn: { padding: '4px 10px', fontSize: 12, border: '1px solid #1d4ed8', borderRadius: 5, background: '#1d4ed8', color: '#fff', cursor: 'pointer', fontWeight: 600 },
  primaryBtn: { padding: '8px 20px', fontSize: 13, border: 'none', borderRadius: 6, background: '#1d4ed8', color: '#fff', cursor: 'pointer', fontWeight: 600 },
  textarea: {
    padding: 10, fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6,
    background: '#fff', width: '100%', boxSizing: 'border-box', resize: 'vertical',
    fontFamily: 'inherit',
  },
  errBox: { background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: 8, borderRadius: 6, fontSize: 13, marginBottom: 10 },
  badge: { display: 'inline-block', padding: '2px 8px', borderRadius: 999, background: '#f1f5f9', color: '#475569', fontSize: 11, fontWeight: 600 },
}

const SCOPES = [
  { key: 'employees',         label: '직원 기본정보' },
  { key: 'educations',        label: '직원 학력' },
  { key: 'careers',           label: '직원 경력' },
  { key: 'certifications',    label: '직원 자격증' },
  { key: 'projects',          label: '유사사업' },
  { key: 'employee_projects', label: '직원 ↔ 유사사업' },
]

export default function BidLab() {
  const fileRef = useRef(null)
  const [filename, setFilename] = useState('')
  const [pages, setPages] = useState([])
  const [activePage, setActivePage] = useState(null)
  const [expanded, setExpanded] = useState({})
  const [scopes, setScopes] = useState(['employees', 'projects'])
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState('')

  const onFile = async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    const lower = f.name.toLowerCase()
    if (!lower.endsWith('.hwp') && !lower.endsWith('.hwpx')) {
      setErr('.hwp / .hwpx 파일만 가능합니다')
      return
    }
    setErr(''); setPages([]); setActivePage(null); setResult(''); setExpanded({})
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
      setPages(j.pages || [])
      if (!(j.pages || []).length) setErr('추출된 페이지가 없습니다. 파일을 확인하세요.')
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const toggleScope = (k) =>
    setScopes(s => s.includes(k) ? s.filter(x => x !== k) : [...s, k])

  const generate = async () => {
    if (activePage == null) { setErr('기준 페이지를 1개 선택하세요'); return }
    if (!instruction.trim()) { setErr('지시사항을 입력하세요'); return }
    setErr(''); setBusy(true); setResult('')
    try {
      const page = pages.find(p => p.index === activePage)
      const r = await authFetch('/api/admin/lab/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template: page?.text || '',
          instruction,
          scopes,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setResult(j.result || '')
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const copyResult = async () => {
    try {
      await navigator.clipboard.writeText(result)
    } catch {}
  }

  return (
    <div>
      <div className="page-head">
        <h2>입찰 — 실험실</h2>
        <div className="page-sub">.hwp / .hwpx 업로드 → 페이지 분할 → 기준 페이지 선택 → GPT + DB로 새 내용 생성</div>
      </div>

      {err && <div style={S.errBox}>{err}</div>}

      {/* 1. 업로드 */}
      <div style={S.card}>
        <div style={S.cardTitle}>1. 파일 업로드</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            ref={fileRef}
            type="file"
            accept=".hwp,.hwpx"
            onChange={onFile}
            disabled={busy}
            style={{ fontSize: 13 }}
          />
          {filename && (
            <span style={{ fontSize: 12, color: '#475569' }}>
              <strong>{filename}</strong> · {pages.length}페이지
            </span>
          )}
          {busy && pages.length === 0 && <span style={{ fontSize: 12, color: '#1d4ed8' }}>파싱중…</span>}
        </div>
      </div>

      {/* 2. 페이지 목록 */}
      {pages.length > 0 && (
        <div style={S.card}>
          <div style={S.cardTitle}>
            2. 페이지 목록 — 기준 페이지(템플릿) 1개 선택
            {activePage != null && (
              <span style={{ marginLeft: 8, ...S.badge, background: '#dbeafe', color: '#1d4ed8' }}>
                현재 선택: {activePage}
              </span>
            )}
          </div>
          {pages.map(p => {
            const isActive = activePage === p.index
            const isOpen = !!expanded[p.index]
            return (
              <div key={p.index} style={S.pageCard(isActive)}>
                <div style={S.pageHead}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', minWidth: 0, flex: 1 }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>
                      {p.unit === 'section' ? '섹션' : '페이지'} {p.index}
                    </span>
                    <span style={{ fontSize: 12, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.title}
                    </span>
                    <span style={S.badge}>{p.text.length}자</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      style={S.miniBtn}
                      onClick={() => setExpanded(e => ({ ...e, [p.index]: !e[p.index] }))}
                    >
                      {isOpen ? '본문 닫기' : '본문 보기'}
                    </button>
                    <button
                      style={isActive ? S.activeBtn : S.miniBtn}
                      onClick={() => setActivePage(isActive ? null : p.index)}
                    >
                      {isActive ? '✓ 기준 페이지' : '기준 페이지로 선택'}
                    </button>
                  </div>
                </div>
                {isOpen && <div style={S.pageText}>{p.text}</div>}
              </div>
            )
          })}
        </div>
      )}

      {/* 3. DB 범위 + 지시사항 */}
      {pages.length > 0 && (
        <div style={S.card}>
          <div style={S.cardTitle}>3. DB 데이터 범위 + GPT 지시사항</div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6, fontWeight: 600 }}>
              DB 데이터 (필요한 항목만 체크)
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
              {SCOPES.map(s => (
                <label key={s.key} style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={scopes.includes(s.key)}
                    onChange={() => toggleScope(s.key)}
                  />
                  {s.label}
                </label>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6, fontWeight: 600 }}>
              GPT 지시사항
            </div>
            <textarea
              style={{ ...S.textarea, minHeight: 130 }}
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              placeholder={
                '예) 위 기준 페이지의 표 형식을 그대로 유지하면서, ' +
                '우리 회사 직원 중 경력 5년 이상인 사람들로 표를 다시 만들어줘. ' +
                '학력·자격증 컬럼 포함.'
              }
            />
          </div>

          <button style={S.primaryBtn} onClick={generate} disabled={busy}>
            {busy ? '생성중…' : 'GPT로 생성'}
          </button>
        </div>
      )}

      {/* 4. 결과 */}
      {result && (
        <div style={S.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={S.cardTitle}>4. 생성 결과</div>
            <button style={S.miniBtn} onClick={copyResult}>복사</button>
          </div>
          <div style={S.resultBox}>{result}</div>
        </div>
      )}
    </div>
  )
}
