import { useCallback, useEffect, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { api, errorText, type Doc, type Meta, type Status } from './api'
import { Reader } from './Reader'

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
  const openSeq = useRef(0)

  const refreshList = useCallback(() => api.list().then(setPapers).catch(() => {}), [])
  useEffect(() => void refreshList(), [refreshList])

  const open = useCallback(async (id: string, startTranslation: boolean) => {
    const seq = ++openSeq.current
    setError(null)
    try {
      const d = await api.get(id)
      if (seq !== openSeq.current) return
      setDoc(d)
      setKo({})
      setStatus(null)
      document.querySelector('.main')?.scrollTo(0, 0)
      if (startTranslation) await api.translate(id)
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

  const submitArxiv = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || busy) return
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

  const total = doc ? doc.blocks.reduce((n, b) => n + (b.kind === 'heading' || b.kind === 'para' || ((b.kind === 'figure' || b.kind === 'table') && b.caption) ? 1 : 0), 0) : 0
  const translated = Object.keys(ko).length
  const remaining = total - translated

  return (
    <div className="app">
      <aside className="side">
        <div className="side-top" onMouseDown={dragWindow} />
        <div className="brand" onMouseDown={dragWindow}>나란</div>
        <form className="import" onSubmit={submitArxiv}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="arXiv ID 또는 주소"
            spellCheck={false}
            disabled={!!busy}
            aria-label="arXiv ID 또는 주소"
          />
        </form>
        <button className="pdf-btn" onClick={pickPdf} disabled={!!busy}>PDF 파일 열기</button>
        <div className="list-label">내 논문</div>
        <ul className="papers">
          {papers.map(p => (
            <li key={p.id} className={doc?.id === p.id ? 'active' : ''}>
              <button className="paper" onClick={() => void open(p.id, false)} title={p.title}>
                <span className="t">{p.title}</span>
                <span className="src">{p.source}</span>
              </button>
              <button className="x" onClick={() => void remove(p.id)} aria-label={`${p.title} 삭제`}>×</button>
            </li>
          ))}
          {papers.length === 0 && <li className="empty">아직 연 논문이 없어요</li>}
        </ul>
      </aside>

      <main className="main">
        <header className="bar" onMouseDown={dragWindow}>
          <div className="bar-title" onMouseDown={dragWindow}>{doc?.title ?? ''}</div>
          {doc && (
            <div className="progress">
              {status?.running ? (
                <>
                  <span className="meter"><span style={{ width: `${total ? (translated / total) * 100 : 0}%` }} /></span>
                  <span>번역 중 {translated}/{total}</span>
                  <button onClick={() => void api.cancel(doc.id)}>멈춤</button>
                </>
              ) : remaining > 0 ? (
                <button className="primary" onClick={() => void open(doc.id, true)}>
                  {translated === 0 ? '번역하기' : `이어서 번역 (${remaining}개 남음)`}
                </button>
              ) : (
                <span className="done">번역 완료</span>
              )}
            </div>
          )}
        </header>
        {(error || status?.error) && <div className="error" role="alert">{error ?? status?.error}</div>}
        {busy && <div className="notice">{busy}</div>}
        {doc ? (
          <Reader doc={doc} ko={ko} />
        ) : (
          !busy && (
            <div className="welcome">
              <h1>영어 논문을 한국어와 나란히</h1>
              <p>왼쪽에 arXiv ID(예: 1706.03762)를 넣거나 PDF를 여세요.</p>
              <p className="sub">번역은 이 Mac에 로그인된 Claude Code로 하고, 결과는 이 Mac에만 저장돼요.</p>
            </div>
          )
        )}
      </main>
    </div>
  )
}
