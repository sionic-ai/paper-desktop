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

export const api = {
  list: () => invoke<Meta[]>('library_list'),
  get: (id: string) => invoke<Doc>('library_get', { id }),
  remove: (id: string) => invoke<void>('library_remove', { id }),
  openArxiv: (input: string) => invoke<Meta>('open_arxiv', { input }),
  openPdf: () => invoke<Meta | null>('open_pdf'),
  translate: (id: string) => invoke<void>('translation_start', { id }),
  status: (id: string) => invoke<Status>('translation_status', { id }),
  cancel: (id: string) => invoke<void>('translation_cancel', { id })
}

export function errorText(e: unknown): string {
  return typeof e === 'string' ? e : e instanceof Error ? e.message : '알 수 없는 오류가 났어요'
}
