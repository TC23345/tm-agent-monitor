export type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong' | 'em' | 'del'; children: InlineNode[] }
  | { type: 'link'; href: string; children: InlineNode[] }

export type BlockNode =
  | { type: 'heading'; level: number; children: InlineNode[] }
  | { type: 'paragraph'; children: InlineNode[] }
  | { type: 'list'; ordered: boolean; start: number; items: { checked: boolean | null; children: BlockNode[] }[] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'quote'; children: BlockNode[] }
  | { type: 'hr' }

export function parseMarkdown(source: string): BlockNode[]
export function parseInline(text: string): InlineNode[]
