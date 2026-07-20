// 목록 페이지네이션 — 클라이언트 사이드 (전체를 받아온 뒤 잘라 보여줌)
// 사용: const { pageItems, ...pager } = usePagination(filteredItems, 20)
//       <Pagination {...pager} />

import { useEffect, useMemo, useState } from 'react'

export function usePagination(items, perPage = 20) {
  const [page, setPage] = useState(1)
  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / perPage))

  // 필터·검색으로 목록이 줄어 현재 페이지가 범위를 벗어나면 되돌림
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const pageItems = useMemo(() => {
    const start = (page - 1) * perPage
    return items.slice(start, start + perPage)
  }, [items, page, perPage])

  return {
    pageItems,
    page, setPage, totalPages, total, perPage,
    from: total === 0 ? 0 : (page - 1) * perPage + 1,
    to: Math.min(page * perPage, total),
  }
}

// 현재 페이지 주변 번호 + 처음/끝 (… 로 축약)
function pageNumbers(page, totalPages) {
  const span = 2
  const nums = new Set([1, totalPages])
  for (let i = page - span; i <= page + span; i++) {
    if (i >= 1 && i <= totalPages) nums.add(i)
  }
  const sorted = [...nums].sort((a, b) => a - b)
  const out = []
  let prev = 0
  for (const n of sorted) {
    if (prev && n - prev > 1) out.push('…')
    out.push(n)
    prev = n
  }
  return out
}

export default function Pagination({ page, setPage, totalPages, total, from, to }) {
  if (total === 0) return null

  return (
    <div className="pagination">
      <span className="pagination-info">
        {from}–{to} / 총 {total}건
      </span>
      <div className="pagination-nav">
        <button onClick={() => setPage(1)} disabled={page === 1} title="첫 페이지">«</button>
        <button onClick={() => setPage(page - 1)} disabled={page === 1} title="이전">‹</button>
        {pageNumbers(page, totalPages).map((n, i) =>
          n === '…'
            ? <span key={`gap-${i}`} className="pagination-gap">…</span>
            : (
              <button
                key={n}
                onClick={() => setPage(n)}
                className={n === page ? 'active' : ''}
                aria-current={n === page ? 'page' : undefined}
              >
                {n}
              </button>
            )
        )}
        <button onClick={() => setPage(page + 1)} disabled={page === totalPages} title="다음">›</button>
        <button onClick={() => setPage(totalPages)} disabled={page === totalPages} title="마지막">»</button>
      </div>
    </div>
  )
}
