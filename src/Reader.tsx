import { Fragment, memo, useEffect, useRef } from 'react'
import type { Block, Doc, Unit } from './api'
import { inline, tex } from './render'

type Ko = Record<string, string[]>

function Sentences({ unit, lang, math, ko }: { unit: Unit; lang: 'en' | 'ko'; math: string[]; ko: Ko }) {
  const translated = ko[String(unit.id)]
  if (lang === 'ko' && !translated) {
    return <span className="pending" aria-label="번역 전">{unit.sentences.map((_, i) => <i key={i} />)}</span>
  }
  const list = lang === 'en' ? unit.sentences : translated!
  return (
    <>
      {list.map((s, i) =>
        s ? (
          <Fragment key={i}>
            <span className="s" data-s={`${unit.id}:${i}`} dangerouslySetInnerHTML={{ __html: inline(s, math) }} />{' '}
          </Fragment>
        ) : null
      )}
    </>
  )
}

function Pair({ unit, math, ko, as: Tag, className }: { unit: Unit; math: string[]; ko: Ko; as: 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'figcaption'; className?: string }) {
  return (
    <div className={`row ${className ?? ''}`}>
      <Tag className="en" lang="en"><Sentences unit={unit} lang="en" math={math} ko={ko} /></Tag>
      <Tag className="ko" lang="ko"><Sentences unit={unit} lang="ko" math={math} ko={ko} /></Tag>
    </div>
  )
}

const BlockView = memo(function BlockView({ block, math, ko }: { block: Block; math: string[]; ko: Ko }) {
  switch (block.kind) {
    case 'heading': {
      const tag = (['h1', 'h2', 'h3', 'h4'] as const)[Math.min(block.level, 4) - 1] ?? 'h4'
      return <Pair unit={block.unit} math={math} ko={ko} as={tag} className={`heading ${tag}`} />
    }
    case 'para':
      return <Pair unit={block.unit} math={math} ko={ko} as="p" />
    case 'static':
      return block.code ? <pre className="wide code">{block.text}</pre> : <p className="wide static" dangerouslySetInnerHTML={{ __html: inline(block.text, math) }} />
    case 'equation':
      return <div className="wide equation" dangerouslySetInnerHTML={{ __html: block.tex.map(t => tex(t, true)).join('') }} />
    case 'figure':
      return (
        <figure className="wide-figure">
          {block.images.length > 0 && (
            <div className="images">{block.images.map((src, i) => <img key={i} src={src} alt="" loading="lazy" />)}</div>
          )}
          {block.caption && <Pair unit={block.caption} math={math} ko={ko} as="figcaption" className="caption" />}
        </figure>
      )
    case 'table':
      return (
        <figure className="wide-figure">
          {block.caption && <Pair unit={block.caption} math={math} ko={ko} as="figcaption" className="caption" />}
          <div className="table-wrap">
            <table>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r}>{row.map((cell, c) => <td key={c} dangerouslySetInnerHTML={{ __html: inline(cell, math) }} />)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </figure>
      )
  }
})

function unitIds(block: Block): number[] {
  switch (block.kind) {
    case 'heading':
    case 'para':
      return [block.unit.id]
    case 'figure':
    case 'table':
      return block.caption ? [block.caption.id] : []
    default:
      return []
  }
}

/** Only blocks whose translation changed re-render while a job streams in. */
function sliceKo(ko: Ko, ids: number[]): Ko {
  const out: Ko = {}
  for (const id of ids) {
    const t = ko[String(id)]
    if (t) out[String(id)] = t
  }
  return out
}

const KoSlice = memo(
  function KoSlice({ block, math, ko }: { block: Block; math: string[]; ko: Ko }) {
    return <BlockView block={block} math={math} ko={ko} />
  },
  (a, b) => a.block === b.block && unitIds(a.block).every(id => a.ko[String(id)] === b.ko[String(id)])
)

export function Reader({ doc, ko }: { doc: Doc; ko: Ko }) {
  const root = useRef<HTMLDivElement>(null)
  const style = useRef<HTMLStyleElement>(null)

  // Hover highlight writes one CSS rule instead of re-rendering the paper.
  useEffect(() => {
    const el = root.current
    if (!el) return
    let current = ''
    const set = (key: string) => {
      if (key === current) return
      current = key
      if (style.current) style.current.textContent = key ? `.reader [data-s="${key}"]{background:var(--hl);box-shadow:0 0 0 2px var(--hl);}` : ''
    }
    const over = (e: MouseEvent) => {
      const s = (e.target as HTMLElement).closest<HTMLElement>('.s')
      set(s?.dataset.s ?? '')
    }
    const leave = () => set('')
    el.addEventListener('mouseover', over)
    el.addEventListener('mouseleave', leave)
    return () => {
      el.removeEventListener('mouseover', over)
      el.removeEventListener('mouseleave', leave)
    }
  }, [])

  return (
    <div className="reader" ref={root}>
      <style ref={style} />
      <div className="cols-head">
        <span>원문</span>
        <span>한국어</span>
      </div>
      {doc.blocks.map((block, i) => (
        <KoSlice key={i} block={block} math={doc.math} ko={sliceKo(ko, unitIds(block))} />
      ))}
    </div>
  )
}
