import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api, errorText } from './api'

export type AskMsg =
  | { role: 'user'; text: string; quote: string | null }
  | { role: 'assistant'; text: string; streaming?: boolean }
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
      // The streaming answer is always the last message while this request is current.
      const write = (f: (m: AskMsg | undefined) => AskMsg | null) =>
        setMessages(ms => {
          const last = ms[ms.length - 1]
          const live = last?.role === 'assistant' && last.streaming ? last : undefined
          const next = f(live)
          const base = live ? ms.slice(0, -1) : ms
          return next ? [...base, next] : base
        })
      api
        .ask(q, quote, docId, history, d => {
          if (id === seq.current) write(m => ({ role: 'assistant', text: (m?.text ?? '') + d, streaming: true }))
        })
        .then(r => {
          if (id === seq.current) write(() => ({ role: 'assistant', text: r.reply }))
        })
        .catch(err => {
          // Keep whatever was already written, then say what went wrong.
          if (id === seq.current) write(m => (m ? { ...m, streaming: false } : null))
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

// Like Claude Code's status line: a turning glyph, a playful verb, and the elapsed time.
const SPIN = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢']
const VERBS = ['생각하는 중', '곱씹는 중', '논문 뒤적이는 중', '궁리하는 중', '되새기는 중', '골똘히 보는 중', '정리하는 중', '실마리 찾는 중']
const TIPS = [
  '본문을 드래그하면 그 부분만 콕 집어 물어볼 수 있어요',
  '이어서 물어보면 앞 대화를 기억하고 답해요',
  'Esc로 창을 닫아도 대화는 남아 있어요',
  '새 대화를 누르면 처음부터 다시 물어볼 수 있어요',
]

function Thinking() {
  const [tick, setTick] = useState(0)
  const [pick] = useState(() => ({ verb: Math.floor(Math.random() * VERBS.length), tip: Math.floor(Math.random() * TIPS.length) }))
  useEffect(() => {
    const t = window.setInterval(() => setTick(n => n + 1), 120)
    return () => window.clearInterval(t)
  }, [])
  // Change the verb every ~4 s so long answers feel alive.
  const verb = VERBS[(pick.verb + Math.floor(tick / 33)) % VERBS.length]
  const secs = Math.floor((tick * 120) / 1000)
  return (
    <div className="thinking" role="status" aria-live="polite">
      <div className="thinking-line">
        <span className="thinking-glyph" aria-hidden="true">{SPIN[tick % SPIN.length]}</span>
        <span className="thinking-verb">{verb}…</span>
        {secs > 0 && <span className="thinking-time">({secs}초)</span>}
      </div>
      <div className="thinking-tip"><span aria-hidden="true">└ </span>Tip: {TIPS[pick.tip]}</div>
    </div>
  )
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

  // Follow the answer as it streams in, unless the reader scrolled up to look at something.
  const stick = useRef(true)
  const last = messages[messages.length - 1]
  useEffect(() => {
    const el = log.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [messages.length, last?.text, loading, open])
  useEffect(() => {
    stick.current = true
  }, [messages.length])
  const waiting = loading && !(last?.role === 'assistant' && last.streaming)

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
          <div
            className="asst-log"
            ref={log}
            onScroll={e => {
              const el = e.currentTarget
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
            }}
          >
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
                  <div className={`bubble${m.role === 'error' ? ' error-bubble' : ''}${m.role === 'assistant' && m.streaming ? ' streaming' : ''}`}>
                    {m.role === 'error' ? m.text : <Reply text={m.text} />}
                  </div>
                </div>
              )
            )}
            {waiting && <Thinking />}
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

const BUBBLE_W = 300

type Spot = { quote: string; range: Range }

// Keeps the dragged passage painted after focus moves to the input (which clears the
// native selection) and while the reader scrolls. WebKit 17.2+ has the Highlight API.
const HL = 'nanran-quote'
type HighlightRegistry = { set: (name: string, h: unknown) => void; delete: (name: string) => void }
function paintQuote(range: Range | null) {
  const reg = (globalThis.CSS as unknown as { highlights?: HighlightRegistry } | undefined)?.highlights
  const Ctor = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight
  if (!reg || !Ctor) return
  if (range) reg.set(HL, new Ctor(range))
  else reg.delete(HL)
}

function EnterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13 3.5v4.5a2 2 0 0 1-2 2H3.5M6.5 7 3.5 10l3 3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Speech bubble under a drag selection in the reader; asking opens the floating panel with the selection as a quote. */
export function SelectionAsk({ busy, resetKey, onAsk }: { busy: boolean; resetKey: string | null; onAsk: (question: string, quote: string) => void }) {
  const [spot, setSpot] = useState<Spot | null>(null)
  const [text, setText] = useState('')
  const el = useRef<HTMLDivElement>(null)
  const engaged = useRef(false)

  const hide = useCallback(() => {
    engaged.current = false
    paintQuote(null)
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
        engaged.current = false
        setText('')
        const kept = range.cloneRange()
        paintQuote(kept)
        setSpot({ quote, range: kept })
      }, 0)
    }
    const down = (e: MouseEvent) => {
      if (el.current?.contains(e.target as Node)) engaged.current = true
      // Grabbing the reader's own scrollbar is scrolling, not a new click.
      else if (e.target instanceof Element && e.target.classList.contains('main')) return
      else if (el.current) hide()
    }
    const change = () => {
      // Typing in the bubble or scrolling must not drop the passage; only a new click elsewhere does.
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
    const scroll = () => place.current()
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
  // Re-run on scroll so the bubble follows the passage instead of closing.
  const place = useRef(() => {})
  place.current = () => {
    const b = el.current
    if (!spot || !b) return
    const rects = Array.from(spot.range.getClientRects()).filter(r => r.width > 0 || r.height > 0)
    const all = spot.range.getBoundingClientRect()
    const lastRect = rects[rects.length - 1] ?? all
    const firstRect = rects[0] ?? all
    const main = document.querySelector('.main')?.getBoundingClientRect()
    const offscreen = !!main && (all.bottom < main.top + 48 || all.top > main.bottom)
    b.style.visibility = offscreen ? 'hidden' : ''
    const s2 = { x: lastRect.right, below: lastRect.bottom, above: firstRect.top }
    const h = b.offsetHeight
    const left = Math.min(Math.max(s2.x - BUBBLE_W / 2, 8), window.innerWidth - BUBBLE_W - 8)
    const fitsBelow = s2.below + 10 + h <= window.innerHeight - 8
    const top = fitsBelow ? s2.below + 10 : Math.max(s2.above - 10 - h, 8)
    b.style.left = `${left}px`
    b.style.top = `${top}px`
    b.style.setProperty('--tail', `${Math.min(Math.max(s2.x - left, 16), BUBBLE_W - 16)}px`)
    b.classList.toggle('above', !fitsBelow)
  }
  useLayoutEffect(() => place.current(), [spot])

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
      // Clicking the send button must not move focus; only the input takes it.
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
          placeholder={busy ? '앞 질문의 답을 기다리는 중이에요' : '질문을 입력하세요'}
          aria-label="선택한 부분에 대한 질문"
          spellCheck={false}
          disabled={busy}
        />
        <button type="submit" disabled={busy || !text.trim()} aria-label="보내기" title="보내기 (Enter)"><EnterIcon /></button>
      </form>
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
