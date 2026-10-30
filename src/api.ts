import { invoke } from '@tauri-apps/api/core'

export type Unit = { id: number; sentences: string[] }

export type Block =
  | { kind: 'heading'; level: number; unit: Unit }
  | { kind: 'para'; unit: Unit }
  | { kind: 'static'; text: string; code: boolean }
  | { kind: 'figure'; images: string[]; caption: Unit | null }
  | { kind: 'equation'; tex: string[] }
  | { kind: 'table'; caption: Unit | null; rows: string[][] }

export type Doc = { id: string; title: string; source: string; blocks: Block[]; math: string[] }

export type Meta = { id: string; title: string; source: string; addedAt: number; units: number }

export type Status = {
  total: number
  done: number
  running: boolean
  error: string | null
  units: Record<string, string[]>
}

export type Hit = {
  id: string
  title: string
  authors: string[]
  summary: string
  published: string
  category: string
}

export type SearchPage = { total: number; start: number; hits: Hit[] }

export const api = {
  list: () => invoke<Meta[]>('library_list'),
  get: (id: string) => invoke<Doc>('library_get', { id }),
  remove: (id: string) => invoke<void>('library_remove', { id }),
  openArxiv: (input: string) => invoke<Meta>('open_arxiv', { input }),
  search: (query: string, start: number) => invoke<SearchPage>('arxiv_search', { query, start }),
  openArxivPage: (id: string) => invoke<void>('open_arxiv_page', { id }),
  openPdf: () => invoke<Meta | null>('open_pdf'),
  translate: (id: string) => invoke<void>('translation_start', { id }),
  status: (id: string) => invoke<Status>('translation_status', { id }),
  cancel: (id: string) => invoke<void>('translation_cancel', { id })
}

export function errorText(e: unknown): string {
  return typeof e === 'string' ? e : e instanceof Error ? e.message : '알 수 없는 오류가 났어요'
}

/** Library id of an arXiv paper, mirroring `arxiv::fetch`. */
export const arxivDocId = (id: string) => `arxiv-${id.replace('/', '_')}`

/** arXiv ID of a library paper, or null for PDFs. */
export const arxivIdOf = (docId: string) => (docId.startsWith('arxiv-') ? docId.slice(6).replace('_', '/') : null)

/** True for inputs the importer accepts directly: an arXiv ID, `arXiv:` reference or arxiv.org URL. */
export function looksLikeArxivId(input: string): boolean {
  const s = input.trim()
  return (
    /^(arxiv:\s*)?\d{4}\.\d{4,5}(v\d+)?$/i.test(s) ||
    /^(arxiv:\s*)?[a-z-]+(\.[a-z]{2})?\/\d{7}(v\d+)?$/i.test(s) ||
    /^(https?:\/\/)?(www\.|export\.)?arxiv\.org\//i.test(s)
  )
}
