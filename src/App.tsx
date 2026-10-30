import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { api, arxivDocId, arxivIdOf, errorText, looksLikeArxivId, type Doc, type Hit, type Meta, type Status } from './api'
import { Reader } from './Reader'
import { SearchResults, type SearchState } from './Search'
import { AiChat, type ChatState } from './Ai'
import { FloatingAssistant, SelectionAsk, useAsk } from './Assistant'
import { dragSplit, stored } from './resize'
import { applyTheme, initialTheme, type Theme } from './theme'

function ThemeButton() {
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const next: Theme = theme === 'dark' ? 'light' : 'dark'
  const label = next === 'dark' ? '다크 모드로 바꾸기' : '라이트 모드로 바꾸기'
  return (
    <button
      className="theme-btn"
      onClick={() => {
        applyTheme(next, true)
        setTheme(next)
      }}
      title={label}
      aria-label={label}
    >
      {theme === 'dark' ? (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
          <circle cx="8" cy="8" r="3" />
          <path d="M8 1.5v1.3M8 13.2v1.3M1.5 8h1.3M13.2 8h1.3M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
          <path d="M13.5 9.6A5.6 5.6 0 0 1 6.4 2.5a5.6 5.6 0 1 0 7.1 7.1Z" />
        </svg>
      )}
    </button>
  )
}

const SIDE_W = 260
const SIDE_MIN = 200
const SIDE_MAX = 440

function SidebarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
      <path d="M6 2.75v10.5" />
    </svg>
  )
}

const UPDATE_EVERY = 3 * 60 * 60 * 1000

/** Shown at the bottom of the sidebar only when a newer release exists. */
function UpdateButton() {
  const [latest, setLatest] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const check = () =>
      api
        .updateCheck()
        .then(u => setLatest(u.available ? u.latest ?? '' : null))
        .catch(() => {})
    void check()
    const timer = setInterval(check, UPDATE_EVERY)
    return () => clearInterval(timer)
  }, [])

  if (latest === null) return null
  const v = latest ? `v${latest.replace(/^v/, '')}` : ''

  const install = async () => {
    setInstalling(true)
    setError(null)
    try {
      await api.updateInstall()
    } catch (err) {
      setError(errorText(err))
      setInstalling(false)
    }
  }

  return (
    <div className="update">
      <button className="update-btn" onClick={() => void install()} disabled={installing} title={`새 버전${v && ` ${v}`}이 나왔어요. 누르면 설치하고 다시 열어요`}>
        {installing ? (
          <><span className="update-spin" aria-hidden="true" /> 업데이트하는 중…</>
        ) : (
          <><span className="update-glyph" aria-hidden="true">↻</span> 업데이트{v && ` ${v}`}</>
        )}
      </button>
      {error && <div className="update-error" role="alert">{error}</div>}
    </div>
  )
}

type Ko = Record<string, string[]>

/** Keeps array identity for units that were already translated so their blocks skip re-rendering. */
function mergeKo(prev: Ko, next: Ko): Ko {
  let changed = Object.keys(prev).length !== Object.keys(next).length
  const out: Ko = {}
  for (const [k, v] of Object.entries(next)) {
    const old = prev[k]
    if (old && old.length === v.length && old.every((s, i) => s === v[i])) out[k] = old
    else {
      out[k] = v
      changed = true
    }
  }
  return changed ? out : prev
}

function dragWindow(e: React.MouseEvent) {
  if (e.button === 0 && e.target === e.currentTarget) void getCurrentWindow().startDragging()
}

export function App() {
  const [papers, setPapers] = useState<Meta[]>([])
  const [doc, setDoc] = useState<Doc | null>(null)
  const [ko, setKo] = useState<Ko>({})
  const [status, setStatus] = useState<Status | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState<SearchState | null>(null)
  const [view, setView] = useState<'doc' | 'search' | 'ai'>('doc')
  const [chat, setChat] = useState<ChatState>({ messages: [], loading: false })
  const [fetchingId, setFetchingId] = useState<string | null>(null)
  const [swapped, setSwapped] = useState(() => localStorage.getItem('nanran.swapped') === '1')
  const toggleSwap = () =>
    setSwapped(s => {
      localStorage.setItem('nanran.swapped', s ? '0' : '1')
      return !s
    })
  // Sidebar: drag its edge to resize, drag it narrow (or press ⌘B) to fold it away.
  const app = useRef<HTMLDivElement>(null)
  const [sideW, setSideW] = useState(() => stored('nanran.sideWidth', SIDE_W, SIDE_MIN, SIDE_MAX))
  const [folded, setFolded] = useState(() => localStorage.getItem('nanran.sideFolded') === '1')
  const fold = (f: boolean) => {
    localStorage.setItem('nanran.sideFolded', f ? '1' : '0')
    setFolded(f)
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setFolded(f => {
          localStorage.setItem('nanran.sideFolded', f ? '0' : '1')
          return !f
        })
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  const resizeSide = (e: React.PointerEvent) => {
    const el = app.current
    if (!el) return
    let w = sideW
    let fold = false
    dragSplit(
      e,
      x => {
        fold = x < SIDE_MIN - 60
        w = Math.min(SIDE_MAX, Math.max(SIDE_MIN, Math.round(x)))
        el.style.setProperty('--side-w', `${fold ? 0 : w}px`)
        el.classList.toggle('folding', fold)
      },
      () => {
        // React owns this inline value too, so leave it at the settled width rather than removing it.
        el.style.setProperty('--side-w', `${fold ? sideW : w}px`)
        el.classList.remove('folding')
        if (fold) {
          localStorage.setItem('nanran.sideFolded', '1')
          setFolded(true)
        } else {
          localStorage.setItem('nanran.sideWidth', String(w))
          setSideW(w)
        }
      }
    )
  }
  const openSeq = useRef(0)
  const searchSeq = useRef(0)
  // Questions are about the paper on screen; search results and the welcome page ask without one.
  const shownDoc = view === 'doc' ? doc : null
  const assistant = useAsk(shownDoc?.id ?? null)

  const refreshList = useCallback(() => api.list().then(setPapers).catch(() => {}), [])
  useEffect(() => void refreshList(), [refreshList])

  // Translation and AI search need a logged-in Claude Code CLI; say so up front instead of on first use.
  const [claude, setClaude] = useState<'ok' | 'missing' | 'logout' | null>(null)
  const checkClaude = useCallback(
    () => api.claude().then(s => setClaude(!s.installed ? 'missing' : s.loggedIn ? 'ok' : 'logout')).catch(() => {}),
    []
  )
  useEffect(() => {
    void checkClaude()
    window.addEventListener('focus', checkClaude)
    return () => window.removeEventListener('focus', checkClaude)
  }, [checkClaude])

  const open = useCallback(async (id: string, startTranslation: boolean | 'redo') => {
    const seq = ++openSeq.current
    setError(null)
    try {
      const d = await api.get(id)
      if (seq !== openSeq.current) return
      setDoc(d)
      setView('doc')
      setKo({})
      setStatus(null)
      document.querySelector('.main')?.scrollTo(0, 0)
      if (startTranslation === 'redo') await api.retranslate(id)
      else if (startTranslation) await api.translate(id)
      const s = await api.status(id)
      if (seq !== openSeq.current) return
      setStatus(s)
      setKo(s.units)
    } catch (e) {
      if (seq === openSeq.current) setError(errorText(e))
    }
  }, [])

  // Poll while a translation job runs.
  useEffect(() => {
    if (!doc || !status?.running) return
    const id = doc.id
    const timer = setInterval(async () => {
      try {
        const s = await api.status(id)
        setStatus(s)
        setKo(prev => mergeKo(prev, s.units))
      } catch {
        /* next tick retries */
      }
    }, 1200)
    return () => clearInterval(timer)
  }, [doc, status?.running])

  const imported = async (meta: Meta | null) => {
    if (!meta) return
    await refreshList()
    await open(meta.id, true)
  }

  const runSearch = async (query: string, start: number) => {
    const seq = ++searchSeq.current
    setView('search')
    setSearch(prev =>
      start > 0 && prev ? { ...prev, loading: true, error: null } : { query, hits: [], total: 0, loading: true, error: null }
    )
    if (start === 0) document.querySelector('.main')?.scrollTo(0, 0)
    try {
      const page = await api.search(query, start)
      if (seq !== searchSeq.current) return
      setSearch(prev => {
        const kept = start > 0 && prev ? prev.hits : []
        const seen = new Set(kept.map(h => h.id))
        return { query, hits: [...kept, ...page.hits.filter(h => !seen.has(h.id))], total: page.total, loading: false, error: null }
      })
    } catch (err) {
      if (seq === searchSeq.current) setSearch(prev => (prev ? { ...prev, loading: false, error: errorText(err) } : prev))
    }
  }

  /** Opens a search or AI pick side by side; a paper not in the library is fetched and translation starts. */
  const openHit = async (hit: Hit, onError: (msg: string) => void) => {
    const docId = arxivDocId(hit.id)
    if (papers.some(p => p.id === docId)) return void open(docId, false)
    if (fetchingId) return
    setFetchingId(hit.id)
    setError(null)
    try {
      await imported(await api.openArxiv(hit.id))
    } catch (err) {
      onError(errorText(err))
    } finally {
      setFetchingId(null)
    }
  }

  const ask = async (text: string) => {
    const history = chat.messages
      .filter(m => m.role !== 'error')
      .map(m => ({
        role: m.role,
        text: m.role === 'assistant' && m.picks.length ? `${m.text}\n${m.picks.map(p => `${p.hit.id} ${p.hit.title}`).join('\n')}` : m.text,
      }))
    setChat(c => ({ messages: [...c.messages, { role: 'user', text }], loading: true }))
    try {
      const a = await api.recommend(text, history)
      setChat(c => ({ messages: [...c.messages, { role: 'assistant', text: a.reply, picks: a.picks }], loading: false }))
    } catch (err) {
      setChat(c => ({ messages: [...c.messages, { role: 'error', text: errorText(err) }], loading: false }))
    }
  }
  const chatError = (msg: string) => setChat(c => ({ ...c, messages: [...c.messages, { role: 'error', text: msg }] }))

  const openWeb = (id: string) => void api.openArxivPage(id).catch(err => setError(errorText(err)))

  const submitArxiv = async (e: React.FormEvent) => {
    e.preventDefault()
    const q = input.trim()
    if (!q || busy) return
    if (!looksLikeArxivId(q)) return void runSearch(q, 0)
    setBusy('arXiv에서 논문을 가져오는 중…')
    setError(null)
    try {
      await imported(await api.openArxiv(input))
      setInput('')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(null)
    }
  }

  const pickPdf = async () => {
    if (busy) return
    setBusy('PDF를 읽는 중…')
    setError(null)
    try {
      await imported(await api.openPdf())
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(null)
    }
  }

  const remove = async (id: string) => {
    await api.remove(id).catch(() => {})
    if (doc?.id === id) {
      openSeq.current++
      setDoc(null)
      setStatus(null)
    }
    await refreshList()
  }

  // Same units the Rust job translates: paragraphs and captions. Headings stay in English, and
  // papers translated before that rule may still carry heading entries, so count by id.
  const unitIds = useMemo(() => {
    const ids: number[] = []
    for (const b of doc?.blocks ?? []) {
      if (b.kind === 'para') ids.push(b.unit.id)
      else if ((b.kind === 'figure' || b.kind === 'table') && b.caption) ids.push(b.caption.id)
    }
    return ids
  }, [doc])
  const total = unitIds.length
  const translated = unitIds.filter(id => ko[id] !== undefined).length
  const remaining = total - translated

  return (
    <div className={`app${folded ? ' folded' : ''}`} ref={app} style={{ '--side-w': `${sideW}px` } as React.CSSProperties}>
      <aside className="side" aria-hidden={folded || undefined} inert={folded || undefined}>
        <div className="side-top" onMouseDown={dragWindow}>
          <button className="side-fold" onClick={() => fold(true)} title="사이드바 접기 (⌘B)" aria-label="사이드바 접기">
            <SidebarIcon />
          </button>
        </div>
        <div className="brand" onMouseDown={dragWindow}>나란</div>
        <form className="import" onSubmit={submitArxiv}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="arXiv 검색 · ID · 주소"
            spellCheck={false}
            disabled={!!busy}
            aria-label="arXiv 검색어, ID 또는 주소"
          />
        </form>
        <button className="pdf-btn" onClick={pickPdf} disabled={!!busy}>PDF 파일 열기</button>
        <button className={`ai-btn${view === 'ai' ? ' active' : ''}`} onClick={() => setView('ai')}>
          <span className="spark" aria-hidden="true">✦</span> AI로 논문 찾기
          {chat.loading && <span className="ai-dot" aria-label="찾는 중" />}
        </button>
        {search && (
          <button className={`search-tab${view === 'search' ? ' active' : ''}`} onClick={() => setView('search')}>
            <span className="t">검색: {search.query}</span>
            <span className="n">{search.loading && !search.hits.length ? '…' : search.total.toLocaleString()}</span>
          </button>
        )}
        <div className="list-label">내 논문</div>
        <ul className="papers">
          {papers.map(p => (
            <li key={p.id} className={view === 'doc' && doc?.id === p.id ? 'active' : ''}>
              <button className="paper" onClick={() => void open(p.id, false)} title={p.title}>
                <span className="t">{p.title}</span>
                <span className="src">{p.source.split('/').pop()}</span>
              </button>
              <button className="x" onClick={() => void remove(p.id)} aria-label={`${p.title} 삭제`}>×</button>
            </li>
          ))}
          {papers.length === 0 && <li className="empty">아직 연 논문이 없어요</li>}
        </ul>
        <UpdateButton />
        <div className="side-foot">
          <ThemeButton />
        </div>
      </aside>
      {!folded && (
        <div
          className="side-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="사이드바 너비"
          title="끌어서 너비 조절 · 두 번 눌러 기본값"
          onPointerDown={resizeSide}
          onDoubleClick={() => {
            localStorage.setItem('nanran.sideWidth', String(SIDE_W))
            setSideW(SIDE_W)
          }}
        />
      )}

      <main className="main">
        <header className="bar" onMouseDown={dragWindow}>
          {folded && (
            <button className="side-fold" onClick={() => fold(false)} title="사이드바 펼치기 (⌘B)" aria-label="사이드바 펼치기">
              <SidebarIcon />
            </button>
          )}
          <div className="bar-title" onMouseDown={dragWindow}>{view === 'search' ? 'arXiv 검색' : view === 'ai' ? 'AI로 논문 찾기' : doc?.title ?? ''}</div>
          {view === 'doc' && doc && (
            <button className="bar-link" onClick={toggleSwap} title="원문과 한국어 칸의 좌우 위치를 바꿔요">
              ⇄ {swapped ? '원문을 왼쪽으로' : '한국어를 왼쪽으로'}
            </button>
          )}
          {view === 'doc' && doc && arxivIdOf(doc.id) && (
            <button className="bar-link" onClick={() => openWeb(arxivIdOf(doc.id)!)} title="기본 브라우저로 arxiv.org 열기">
              arxiv.org ↗
            </button>
          )}
          {view === 'doc' && doc && (
            <div className="progress">
              {status?.running && status.redo ? (
                <>
                  <span className="meter"><span style={{ width: `${status.total ? (status.done / status.total) * 100 : 0}%` }} /></span>
                  <span>다시 번역 중 {status.done}/{status.total}</span>
                  <button onClick={() => void api.cancel(doc.id)}>멈춤</button>
                </>
              ) : status?.running ? (
                <>
                  <span className="meter"><span style={{ width: `${total ? (translated / total) * 100 : 0}%` }} /></span>
                  <span>번역 중 {translated}/{total}</span>
                  <button onClick={() => void api.cancel(doc.id)}>멈춤</button>
                </>
              ) : remaining > 0 && !status?.outdated ? (
                <button className="primary" onClick={() => void open(doc.id, true)}>
                  {translated === 0 ? '번역하기' : `이어서 번역 (${remaining}개 남음)`}
                </button>
              ) : status?.outdated ? (
                <button
                  className="primary"
                  onClick={() => void open(doc.id, 'redo')}
                  title="읽기 편한 합니다체로 처음부터 다시 번역해요. 끝날 때까지 지금 번역이 그대로 보여요"
                >
                  새 문체로 다시 번역
                </button>
              ) : (
                <span className="done">번역 완료</span>
              )}
            </div>
          )}
        </header>
        {(claude === 'missing' || claude === 'logout') && (
          <div className="notice claude-notice" role="status">
            {claude === 'missing' ? (
              <>Claude Code가 없어서 번역과 AI 찾기를 쓸 수 없어요. 터미널에서 <code>curl -fsSL https://claude.ai/install.sh | bash</code> 후 <code>claude auth login</code>을 실행해 주세요.</>
            ) : (
              <>Claude Code에 로그인되어 있지 않아요. 터미널에서 <code>claude auth login</code>을 실행하면 이 창으로 돌아올 때 자동으로 다시 확인해요.</>
            )}
          </div>
        )}
        {(error || status?.error) && <div className="error" role="alert">{error ?? status?.error}</div>}
        {busy && <div className="notice">{busy}</div>}
        {view === 'ai' ? (
          <AiChat
            state={chat}
            saved={new Set(papers.map(p => arxivIdOf(p.id)).filter((x): x is string => !!x))}
            busyId={fetchingId}
            onAsk={q => void ask(q)}
            onTranslate={hit => void openHit(hit, chatError)}
            onWeb={hit => openWeb(hit.id)}
          />
        ) : view === 'search' && search ? (
          <SearchResults
            state={search}
            saved={new Set(papers.map(p => arxivIdOf(p.id)).filter((x): x is string => !!x))}
            busyId={fetchingId}
            onOpen={hit => void openHit(hit, msg => setSearch(prev => (prev ? { ...prev, error: msg } : prev)))}
            onWeb={hit => openWeb(hit.id)}
            onMore={() => void runSearch(search.query, search.hits.length)}
          />
        ) : doc ? (
          <Reader doc={doc} ko={ko} swapped={swapped} />
        ) : (
          !busy && (
            <div className="welcome">
              <h1>영어 논문을 한국어와 나란히</h1>
              <p>
                왼쪽 칸에 <span className="nowrap">검색어(예: flash attention)나</span>{' '}
                <span className="nowrap">arXiv ID(예: 1706.03762)를</span> 넣거나 PDF를 여세요.
              </p>
              <p className="sub">번역은 이 Mac에 로그인된 Claude Code로 하고, 결과는 이 Mac에만 저장돼요.</p>
            </div>
          )
        )}
      </main>
      {view !== 'ai' && (
        <>
          <FloatingAssistant ask={assistant} docTitle={shownDoc?.title ?? null} />
          <SelectionAsk busy={assistant.loading} resetKey={`${view}:${doc?.id ?? ''}`} onAsk={(q, quote) => assistant.send(q, quote)} />
        </>
      )}
    </div>
  )
}
