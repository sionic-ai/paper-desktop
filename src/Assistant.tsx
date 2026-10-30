import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api, errorText } from './api'

export type AskMsg =
  | { role: 'user'; text: string; quote: string | null }
  | { role: 'assistant'; text: string }
  | { role: 'error'; text: string }

export type Ask = {
  messages: AskMsg[]
  loading: boolean
  open: boolean
  setOpen: (open: boolean) => void
  send: (question: string, quote: string | null) => void
  reset: () => void
}

const HISTORY_TURNS = 8
const QUOTE_IN_HISTORY = 600

/** One conversation shared by the floating panel and the selection bubble. */
export function useAsk(docId: string | null): Ask {
  const [messages, setMessages] = useState<AskMsg[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const seq = useRef(0)

  const send = useCallback(
    (question: string, quote: string | null) => {
      const q = question.trim()
      setOpen(true)
      if (!q || loading) return
      const history = messages
        .filter((m): m is Exclude<AskMsg, { role: 'error' }> => m.role !== 'error')
        .slice(-HISTORY_TURNS)
        .map(m => ({
          role: m.role,
          text: m.role === 'user' && m.quote ? `> ${m.quote.slice(0, QUOTE_IN_HISTORY)}\n\n${m.text}` : m.text,
        }))
      const id = ++seq.current
      setMessages(ms => [...ms, { role: 'user', text: q, quote }])
      setLoading(true)
      api
        .ask(q, quote, docId, history)
        .then(r => {
          if (id === seq.current) setMessages(ms => [...ms, { role: 'assistant', text: r.reply }])
        })
        .catch(err => {
          if (id === seq.current) setMessages(ms => [...ms, { role: 'error', text: errorText(err) }])
        })
        .finally(() => {
          if (id === seq.current) setLoading(false)
        })
    },
    [docId, loading, messages]
  )

  const reset = useCallback(() => {
    seq.current++
    setMessages([])
    setLoading(false)
  }, [])

  return { messages, loading, open, setOpen, send, reset }
}

function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 13V3.5M3.5 7.5 8 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Round ✦ button at the bottom right; opens a composer that grows into a chat panel once a question is sent. */
export function FloatingAssistant({ ask, docTitle }: { ask: Ask; docTitle: string | null }) {
  const { messages, loading, open, setOpen, send, reset } = ask
  const [text, setText] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)
  const log = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const expanded = messages.length > 0 || loading

  useEffect(() => {
    if (open) box.current?.focus()
  }, [open, expanded])

  useEffect(() => {
    const el = log.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, loading, open])

  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !e.isComposing) setOpen(false)
    }
    // The bare composer closes on an outside click; the chat panel stays so the paper can be read next to it.
    const down = (e: MouseEvent) => {
      if (!expanded && root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', key)
    document.addEventListener('mousedown', down)
    return () => {
      document.removeEventListener('keydown', key)
      document.removeEventListener('mousedown', down)
    }
  }, [open, expanded, setOpen])

  const submit = () => {
    const t = text.trim()
    if (!t || loading) return
    send(t, null)
    setText('')
  }

  if (!open) {
    return (
      <button className="asst-fab" onClick={() => setOpen(true)} title="Claude에게 물어보기" aria-label="Claude에게 물어보기">
        <span aria-hidden="true">✦</span>
        {loading && <span className="asst-fab-dot" />}
      </button>
    )
  }

  return (
    <div ref={root} className={`asst${expanded ? ' expanded' : ''}`} role="dialog" aria-label="Claude에게 질문">
      {expanded && (
        <>
          <header className="asst-head">
            <span className="asst-title"><span className="spark" aria-hidden="true">✦</span> Claude에게 질문</span>
            {docTitle ? <span className="asst-chip" title={docTitle} lang="en">{docTitle}</span> : <span className="asst-gap" />}
            <button className="asst-new" onClick={reset}>새 대화</button>
            <button className="asst-close" onClick={() => setOpen(false)} aria-label="닫기">×</button>
          </header>
          <div className="asst-log" ref={log}>
            {messages.map((m, i) =>
              m.role === 'user' ? (
                <div key={i} className="msg user">
                  <div className="bubble">
                    {m.quote && <blockquote className="asst-quote">{m.quote}</blockquote>}
                    {m.text}
                  </div>
                </div>
              ) : (
                <div key={i} className="msg bot">
                  <div className={`bubble${m.role === 'error' ? ' error-bubble' : ''}`}>{m.role === 'error' ? m.text : <Reply text={m.text} />}</div>
                </div>
              )
            )}
            {loading && (
              <div className="msg bot"><div className="bubble typing">생각하는 중이에요<span className="dots" /></div></div>
            )}
          </div>
        </>
      )}
      <form
        className="asst-input"
        onSubmit={e => {
          e.preventDefault()
          submit()
        }}
      >
        <textarea
          ref={box}
          value={text}
          rows={1}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={docTitle ? '이 논문에 대해 물어보세요' : 'Claude에게 물어보세요'}
          aria-label="Claude에게 할 질문"
          spellCheck={false}
        />
        <button type="submit" disabled={loading || !text.trim()} aria-label="보내기"><SendIcon /></button>
      </form>
    </div>
  )
}

const CHIPS = ['설명해 줘', '쉽게 풀어 줘', '한국어로 번역해 줘']
const BUBBLE_W = 300

type Spot = { quote: string; x: number; below: number; above: number }

/** Speech bubble under a drag selection in the reader; asking opens the floating panel with the selection as a quote. */
export function SelectionAsk({ busy, resetKey, onAsk }: { busy: boolean; resetKey: string | null; onAsk: (question: string, quote: string) => void }) {
  const [spot, setSpot] = useState<Spot | null>(null)
  const [text, setText] = useState('')
  const el = useRef<HTMLDivElement>(null)
  const engaged = useRef(false)

  const hide = useCallback(() => {
    engaged.current = false
    setSpot(null)
    setText('')
  }, [])

  useEffect(hide, [resetKey, hide])

  useEffect(() => {
    let timer = 0
    const up = (e: MouseEvent) => {
      if (e.button !== 0 || el.current?.contains(e.target as Node)) return
      window.clearTimeout(timer)
      // Let WebKit settle double/triple-click selections before reading them.
      timer = window.setTimeout(() => {
        const sel = window.getSelection()
        const reader = document.querySelector('.reader')
        if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !reader) return
        const range = sel.getRangeAt(0)
        if (!reader.contains(range.commonAncestorContainer)) return
        const quote = sel.toString().trim()
        if (quote.length < 2 || quote.length > 2000) return
        const rects = Array.from(range.getClientRects()).filter(r => r.width > 0 || r.height > 0)
        const all = range.getBoundingClientRect()
        const last = rects[rects.length - 1] ?? all
        const first = rects[0] ?? all
        engaged.current = false
        setText('')
        setSpot({ quote, x: last.right, below: last.bottom, above: first.top })
      }, 0)
    }
    const down = (e: MouseEvent) => {
      if (el.current?.contains(e.target as Node)) engaged.current = true
      else if (el.current) hide()
    }
    const change = () => {
      if (!el.current || engaged.current || el.current.contains(document.activeElement)) return
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed) hide()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && el.current && !e.isComposing) {
        e.preventDefault()
        hide()
      }
    }
    const scroll = (e: Event) => {
      if (el.current && e.target instanceof Element && e.target.classList.contains('main')) hide()
    }
    document.addEventListener('mouseup', up)
    document.addEventListener('mousedown', down, true)
    document.addEventListener('selectionchange', change)
    window.addEventListener('keydown', key, true)
    window.addEventListener('scroll', scroll, true)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('mouseup', up)
      document.removeEventListener('mousedown', down, true)
      document.removeEventListener('selectionchange', change)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('scroll', scroll, true)
    }
  }, [hide])

  // Place under the end of the selection, or above its start when there is no room; clamp into the window.
  useLayoutEffect(() => {
    const b = el.current
    if (!spot || !b) return
    const h = b.offsetHeight
    const left = Math.min(Math.max(spot.x - BUBBLE_W / 2, 8), window.innerWidth - BUBBLE_W - 8)
    const fitsBelow = spot.below + 10 + h <= window.innerHeight - 8
    const top = fitsBelow ? spot.below + 10 : Math.max(spot.above - 10 - h, 8)
    b.style.left = `${left}px`
    b.style.top = `${top}px`
    b.style.setProperty('--tail', `${Math.min(Math.max(spot.x - left, 16), BUBBLE_W - 16)}px`)
    b.classList.toggle('above', !fitsBelow)
  }, [spot])

  if (!spot) return null

  const go = (q: string) => {
    const t = q.trim()
    if (!t || busy) return
    onAsk(t, spot.quote)
    hide()
  }

  return (
    <div
      ref={el}
      className="sel-ask"
      style={{ width: BUBBLE_W }}
      // Clicking a chip must not clear the selection; only the input takes focus.
      onMouseDown={e => {
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault()
      }}
    >
      <form
        onSubmit={e => {
          e.preventDefault()
          go(text)
        }}
      >
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={busy ? '앞 질문의 답을 기다리는 중이에요' : '선택한 부분을 물어보세요'}
          aria-label="선택한 부분에 대한 질문"
          spellCheck={false}
          disabled={busy}
        />
      </form>
      <div className="sel-chips">
        {CHIPS.map(c => (
          <button key={c} onClick={() => go(c)} disabled={busy}>{c}</button>
        ))}
      </div>
    </div>
  )
}

/** Plain-text reply: blank lines split paragraphs, `- ` lines become a list with a hanging indent. */
function Reply({ text }: { text: string }) {
  const blocks = text.trim().split(/\n\s*\n/)
  return (
    <>
      {blocks.map((b, i) => {
        const lines = b.split('\n').filter(l => l.trim())
        if (lines.length && lines.every(l => /^\s*[-•*]\s+/.test(l))) {
          return <ul key={i} className="asst-list">{lines.map((l, j) => <li key={j}>{l.replace(/^\s*[-•*]\s+/, '')}</li>)}</ul>
        }
        return <p key={i} className="asst-p">{lines.join('\n')}</p>
      })}
    </>
  )
}
