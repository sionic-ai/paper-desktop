import katex from 'katex'

const TOKEN = /⟦M(\d+)⟧/g
const cache = new Map<string, string>()

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function tex(source: string, display: boolean): string {
  const key = `${display ? 'D' : 'I'}${source}`
  let html = cache.get(key)
  if (html === undefined) {
    html = katex.renderToString(source, { displayMode: display, throwOnError: false, output: 'html', strict: 'ignore' })
    cache.set(key, html)
  }
  return html
}

/** Escapes text and renders `⟦M<n>⟧` placeholders as inline KaTeX. */
export function inline(text: string, math: string[]): string {
  let out = ''
  let last = 0
  for (const m of text.matchAll(TOKEN)) {
    out += escape(text.slice(last, m.index))
    const source = math[Number(m[1])]
    out += source === undefined ? escape(m[0]) : tex(source, false)
    last = m.index + m[0].length
  }
  return out + escape(text.slice(last))
}
