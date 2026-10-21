import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { parseMarkdown, type BlockNode, type InlineNode, type MarkdownOptions } from '@shared/markdown.mjs'
import type { CodePart } from './highlightCode'

/** Past this size a block stays plain: colouring it would cost more than it helps. */
const MAX_HIGHLIGHT = 100_000
/** Past this size a formula stays TeX source: KaTeX's work grows with it. */
const MAX_TEX = 4000

/**
 * A fenced block: plain at once, then in the `--syn-*` colours once the
 * grammar its fence names has loaded (`highlightCode`, imported on demand).
 */
function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const [parts, setParts] = useState<CodePart[] | null>(null)
  useEffect(() => {
    let live = true
    setParts(null)
    if (!lang || text.length > MAX_HIGHLIGHT) return
    import('./highlightCode')
      .then((m) => m.highlightCode(text, lang))
      .then((p) => { if (live) setParts(p) })
      .catch(() => { /* an unknown or broken grammar leaves the block plain */ })
    return () => { live = false }
  }, [lang, text])
  return (
    <pre data-lang={lang || undefined}>
      <code>{parts ? parts.map((p, i) => (p.cls ? <span key={i} className={p.cls}>{p.text}</span> : p.text)) : text}</code>
    </pre>
  )
}

type Katex = { renderToString: (tex: string, options?: Record<string, unknown>) => string }
let katexLoad: Promise<Katex> | null = null
/** KaTeX and its stylesheet, fetched the first time a reply has math in it. */
function loadKatex(): Promise<Katex> {
  katexLoad ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([m]) => {
    const mod = m as unknown as { default?: Katex } & Katex
    return mod.default ?? mod
  })
  return katexLoad
}

/**
 * TeX as KaTeX draws it (the Claude Code extension renders math the same way). This is the one place the view
 * sets HTML: KaTeX builds it from the formula with `trust: false` (no \href, \url, \includegraphics or HTML
 * extensions), escaping all text, and with its size and macro-expansion limits, so a reply cannot put markup
 * into the app through it. Until KaTeX has loaded, and when it cannot parse the formula, the TeX shows as code.
 */
function MathView({ tex, display }: { tex: string; display: boolean }) {
  const [html, setHtml] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setHtml(null)
    if (tex.length > MAX_TEX) return
    loadKatex()
      .then((k) => k.renderToString(tex, { displayMode: display, throwOnError: true, trust: false, strict: 'ignore', maxSize: 20, maxExpand: 500, output: 'htmlAndMathml' }))
      .then((out) => { if (live) setHtml(out) })
      .catch(() => { /* not TeX after all: the source stays */ })
    return () => { live = false }
  }, [tex, display])
  if (html === null) return display ? <pre className="md-math is-source"><code>{tex}</code></pre> : <code className="md-math is-source">{tex}</code>
  const Tag = display ? 'div' : 'span'
  return <Tag className={display ? 'md-math is-display' : 'md-math'} dangerouslySetInnerHTML={{ __html: html }} />
}

/** What a chat reply's view adds: its folder (for relative paths) and how to open a file. */
export interface ChatMarkdown {
  cwd?: string
  openPath?: (path: string) => void
}

interface Ctx {
  breaks: boolean
  chat?: ChatMarkdown
}

/**
 * Renders the Notes pane's preview, a file's and a chat reply's from the parser's tree — React elements
 * only, never `dangerouslySetInnerHTML` (KaTeX's own output aside, above), so a note an agent wrote cannot
 * put markup or script into the app. Links open outside (main's `openExternal` route is the only way out of
 * the sandbox), and only http/https/mailto ever reach here (the parser drops the rest). With `chat`, a reply
 * keeps its line breaks, reads math, and its file paths and images open (a file in a pane, a web image in
 * the browser); nothing is fetched into the page.
 */
export function MarkdownView({ source, chat }: { source: string; chat?: ChatMarkdown }) {
  const opts: MarkdownOptions = chat ? { breaks: true, math: true, paths: !!chat.openPath } : {}
  const tree = useMemo(() => parseMarkdown(source, opts), [source, !!chat, !!chat?.openPath]) // eslint-disable-line react-hooks/exhaustive-deps
  if (tree.length === 0) return <div className="empty">Nothing to preview yet.</div>
  const ctx: Ctx = { breaks: !!chat, chat }
  return <div className="md" data-testid="notes-preview">{tree.map((node, i) => <Block key={i} node={node} ctx={ctx} />)}</div>
}

function Block({ node, ctx }: { node: BlockNode; ctx: Ctx }): ReactNode {
  switch (node.type) {
    case 'heading': {
      const Tag = `h${Math.min(6, Math.max(1, node.level))}` as 'h1'
      return <Tag><Inline nodes={node.children} ctx={ctx} /></Tag>
    }
    case 'paragraph':
      return <p><Inline nodes={node.children} ctx={ctx} /></p>
    case 'hr':
      return <hr />
    case 'code':
      return <CodeBlock lang={node.lang} text={node.text} />
    case 'math':
      return <MathView tex={node.tex} display />
    case 'quote':
      return <blockquote>{node.children.map((child, i) => <Block key={i} node={child} ctx={ctx} />)}</blockquote>
    case 'table': {
      const align = (k: number) => (node.align[k] ? { textAlign: node.align[k]! } : undefined)
      // The wrapper scrolls sideways when a table is wider than its pane, instead of clipping it.
      return (
        <div className="md-table">
          <table>
            <thead><tr>{node.head.map((cell, k) => <th key={k} style={align(k)}><Inline nodes={cell} ctx={ctx} /></th>)}</tr></thead>
            {node.rows.length > 0 && <tbody>{node.rows.map((row, r) => <tr key={r}>{row.map((cell, k) => <td key={k} style={align(k)}><Inline nodes={cell} ctx={ctx} /></td>)}</tr>)}</tbody>}
          </table>
        </div>
      )
    }
    case 'list': {
      const Tag = node.ordered ? 'ol' : 'ul'
      return (
        <Tag start={node.ordered && node.start !== 1 ? node.start : undefined}>
          {node.items.map((item, i) => (
            <li key={i} className={item.checked === null ? undefined : item.checked ? 'md-task is-done' : 'md-task'}>
              {item.checked !== null && <input type="checkbox" checked={item.checked} readOnly tabIndex={-1} aria-label={item.checked ? 'done' : 'to do'} />}
              {item.children.map((child, j) => <Block key={j} node={child} ctx={ctx} />)}
            </li>
          ))}
        </Tag>
      )
    }
  }
}

/** A path as the file pane opens it: a relative one against the reply's folder, in Windows separators. */
function resolvePath(path: string, relative: boolean, cwd?: string): string | null {
  if (!relative) return path.replace(/\//g, '\\')
  if (!cwd) return null
  return `${cwd.replace(/[\\/]+$/, '')}\\${path.replace(/^\.[\\/]/, '').replace(/\//g, '\\')}`
}

/** Text with its line breaks kept (a chat reply), as text and `<br>`s. */
function textWithBreaks(text: string, key: number): ReactNode {
  const lines = text.split('\n')
  return lines.map((line, k) => (k === 0 ? line : [<br key={`${key}-${k}`} />, line]))
}

function Inline({ nodes, ctx }: { nodes: InlineNode[]; ctx: Ctx }): ReactNode {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'text': return ctx.breaks && node.text.includes('\n') ? textWithBreaks(node.text, i) : node.text
      case 'code': return <code key={i}>{node.text}</code>
      case 'strong': return <strong key={i}><Inline nodes={node.children} ctx={ctx} /></strong>
      case 'em': return <em key={i}><Inline nodes={node.children} ctx={ctx} /></em>
      case 'del': return <del key={i}><Inline nodes={node.children} ctx={ctx} /></del>
      case 'math': return <MathView key={i} tex={node.tex} display={false} />
      case 'path': {
        const full = resolvePath(node.path, node.relative, ctx.chat?.cwd)
        const open = ctx.chat?.openPath
        if (!full || !open) return node.code ? <code key={i}>{node.text}</code> : node.text
        return (
          <a key={i} className="md-path" href="#" title={`Open ${full}`} onClick={(e) => { e.preventDefault(); open(full) }} data-testid="md-path">
            {node.code ? <code>{node.text}</code> : node.text}
          </a>
        )
      }
      case 'image': {
        const web = /^https?:\/\//i.test(node.src)
        const name = node.alt || node.src.replace(/^.*[\\/]/, '') || 'image'
        const open = () => { if (web) void window.watch.openExternal(node.src); else ctx.chat?.openPath?.(node.src) }
        return (
          <button key={i} type="button" className="md-image" title={web ? `Open ${node.src} in your browser` : `Open ${node.src}`} onClick={open} data-testid="md-image">
            <span className="md-image-ic" aria-hidden>▣</span>{name}
          </button>
        )
      }
      case 'link':
        return (
          <a key={i} href={node.href} title={node.href} onClick={(e) => { e.preventDefault(); void window.watch.openExternal(node.href) }}>
            <Inline nodes={node.children} ctx={ctx} />
          </a>
        )
    }
  })
}
