export type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong' | 'em' | 'del'; children: InlineNode[] }
  | { type: 'link'; href: string; children: InlineNode[] }
  | { type: 'math'; tex: string; display: boolean }
  | { type: 'path'; path: string; text: string; code: boolean; relative: boolean }
  | { type: 'image'; src: string; alt: string }

export type BlockNode =
  | { type: 'heading'; level: number; children: InlineNode[] }
  | { type: 'paragraph'; children: InlineNode[] }
  | { type: 'list'; ordered: boolean; start: number; items: { checked: boolean | null; children: BlockNode[] }[] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'quote'; children: BlockNode[] }
  | { type: 'hr' }
  | { type: 'table'; align: ('left' | 'center' | 'right' | null)[]; head: InlineNode[][]; rows: InlineNode[][][] }
  | { type: 'math'; tex: string; display: true }

export interface MarkdownOptions { breaks?: boolean; math?: boolean; paths?: boolean }

export function parseMarkdown(source: string, opts?: MarkdownOptions): BlockNode[]
export function parseInline(text: string, opts?: MarkdownOptions): InlineNode[]
