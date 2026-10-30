import type { Hit } from './api'

export type SearchState = {
  query: string
  hits: Hit[]
  total: number
  loading: boolean
  error: string | null
}

function authors(list: string[]): string {
  if (list.length <= 3) return list.join(', ')
  return `${list.slice(0, 3).join(', ')} 외 ${list.length - 3}명`
}

type Props = {
  state: SearchState
  saved: Set<string>
  busyId: string | null
  onOpen: (hit: Hit) => void
  onWeb: (hit: Hit) => void
  onMore: () => void
}

export function SearchResults({ state, saved, busyId, onOpen, onWeb, onMore }: Props) {
  const { query, hits, total, loading, error } = state
  return (
    <section className="search">
      <div className="search-head">
        <span className="q">“{query}”</span>
        {!loading || hits.length ? <span className="n">검색 결과 {total.toLocaleString()}개</span> : null}
      </div>
      {hits.map(h => (
        <article key={h.id} className="hit">
          <h2 className="hit-title">
            <button onClick={() => onOpen(h)} disabled={busyId !== null} title="나란히 읽기">{h.title}</button>
          </h2>
          <div className="hit-meta">
            <span>{authors(h.authors)}</span>
            <span className="dot">·</span>
            <span>{h.published}</span>
            {h.category && (
              <>
                <span className="dot">·</span>
                <span>{h.category}</span>
              </>
            )}
            <span className="dot">·</span>
            <span>arXiv:{h.id}</span>
          </div>
          <p className="hit-summary">{h.summary}</p>
          <div className="hit-actions">
            <button className="open" onClick={() => onOpen(h)} disabled={busyId !== null}>
              {busyId === h.id ? '가져오는 중…' : saved.has(h.id) ? '내 논문에서 열기' : '나란히 읽기'}
            </button>
            <button className="web" onClick={() => onWeb(h)}>arxiv.org ↗</button>
          </div>
        </article>
      ))}
      {error && <div className="error inline" role="alert">{error}</div>}
      {loading && <div className="search-loading">검색하는 중…</div>}
      {!loading && !error && hits.length === 0 && <div className="search-empty">찾은 논문이 없어요. 다른 단어로 검색해 보세요.</div>}
      {!loading && hits.length > 0 && hits.length < total && (
        <button className="more" onClick={onMore}>결과 더 보기</button>
      )}
    </section>
  )
}
