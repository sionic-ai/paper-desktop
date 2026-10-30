import { useEffect, useRef, useState } from 'react'
import type { Hit } from './api'

export type Pick = { hit: Hit; why: string }

export type ChatMsg =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; picks: Pick[] }
  | { role: 'error'; text: string }

export type ChatState = { messages: ChatMsg[]; loading: boolean }

type Props = {
  state: ChatState
  saved: Set<string>
  busyId: string | null
  onAsk: (text: string) => void
  onTranslate: (hit: Hit) => void
  onWeb: (hit: Hit) => void
}

const EXAMPLES = ['LLM 파라미터에 지식을 저장하는 메모리 방법 서베이', 'RAG 원조 논문이랑 최근 개선 연구', '긴 문맥에서 어텐션을 빠르게 하는 방법']

function authors(list: string[]): string {
  if (list.length <= 2) return list.join(', ')
  return `${list[0]} 외 ${list.length - 1}명`
}

export function AiChat({ state, saved, busyId, onAsk, onTranslate, onWeb }: Props) {
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const { messages, loading } = state

  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [messages.length, loading])
  useEffect(() => box.current?.focus(), [])

  const send = (q: string) => {
    const t = q.trim()
    if (!t || loading) return
    onAsk(t)
    setText('')
  }

  return (
    <section className="ai">
      <div className="ai-log">
        {messages.length === 0 && (
          <div className="ai-empty">
            <h1>어떤 논문을 찾고 있어요?</h1>
            <p>주제나 궁금한 점을 적으면 arXiv에서 찾아 추천해 드려요. 말풍선의 <b>번역하기</b>를 누르면 바로 나란히 읽기로 열려요.</p>
            <div className="ai-examples">
              {EXAMPLES.map(e => (
                <button key={e} onClick={() => send(e)}>{e}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="msg user"><div className="bubble">{m.text}</div></div>
          ) : m.role === 'error' ? (
            <div key={i} className="msg bot"><div className="bubble error-bubble">{m.text}</div></div>
          ) : (
            <div key={i} className="msg bot">
              <div className="bubble">
                <p className="reply">{m.text}</p>
                {m.picks.map(({ hit, why }) => (
                  <div key={hit.id} className="pick">
                    <div className="pick-title">{hit.title}</div>
                    <div className="pick-meta">
                      <span className="pick-id">arXiv:{hit.id}</span>
                      <span>{authors(hit.authors)}</span>
                      <span>{hit.published.slice(0, 4)}</span>
                    </div>
                    {why && <p className="pick-why">{why}</p>}
                    <div className="pick-actions">
                      <button className="go" onClick={() => onTranslate(hit)} disabled={busyId !== null}>
                        {busyId === hit.id ? '가져오는 중…' : saved.has(hit.id) ? '내 논문에서 열기' : '번역하기'}
                      </button>
                      <button className="web" onClick={() => onWeb(hit)} title={`https://arxiv.org/abs/${hit.id}`}>arxiv.org ↗</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        )}
        {loading && (
          <div className="msg bot"><div className="bubble typing">arXiv에서 찾는 중이에요<span className="dots" /></div></div>
        )}
        <div ref={end} />
      </div>
      <form
        className="ai-input"
        onSubmit={e => {
          e.preventDefault()
          send(text)
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
              send(text)
            }
          }}
          placeholder="예: 트랜스포머 KV 캐시 압축 논문 찾아줘"
          aria-label="찾고 싶은 논문"
          spellCheck={false}
        />
        <button type="submit" disabled={loading || !text.trim()}>보내기</button>
      </form>
    </section>
  )
}
