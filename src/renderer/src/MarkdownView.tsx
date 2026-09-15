import { useMemo, type ReactNode } from 'react'
import { parseMarkdown, type BlockNode, type InlineNode } from '@shared/markdown.mjs'

/**
 * Renders the Notes pane's preview from the parser's tree — React elements
 * only, never `dangerouslySetInnerHTML`, so a note an agent wrote cannot put
 * markup or script into the app. Links open outside (main's `openExternal`
 * route is the only way out of the sandbox), and only http/https/mailto ever
 * reach here (the parser drops the rest).
 */
export function MarkdownView({ source }: { source: string }) {
  const tree = useMemo(() => parseMarkdown(source), [source])
  if (tree.length === 0) return <div className="empty">Nothing to preview yet.</div>
  return <div className="md" data-testid="notes-preview">{tree.map((node, i) => <Block key={i} node={node} />)}</div>
}

function Block({ node }: { node: BlockNode }): ReactNode {
  switch (node.type) {
    case 'heading': {
      const Tag = `h${Math.min(6, Math.max(1, node.level))}` as 'h1'
      return <Tag><Inline nodes={node.children} /></Tag>
    }
    case 'paragraph':
      return <p><Inline nodes={node.children} /></p>
    case 'hr':
      return <hr />
    case 'code':
      return <pre data-lang={node.lang || undefined}><code>{node.text}</code></pre>
    case 'quote':
      return <blockquote>{node.children.map((child, i) => <Block key={i} node={child} />)}</blockquote>
    case 'list': {
      const Tag = node.ordered ? 'ol' : 'ul'
      return (
        <Tag start={node.ordered && node.start !== 1 ? node.start : undefined}>
          {node.items.map((item, i) => (
            <li key={i} className={item.checked === null ? undefined : item.checked ? 'md-task is-done' : 'md-task'}>
              {item.checked !== null && <input type="checkbox" checked={item.checked} readOnly tabIndex={-1} aria-label={item.checked ? 'done' : 'to do'} />}
              {item.children.map((child, j) => <Block key={j} node={child} />)}
            </li>
          ))}
        </Tag>
      )
    }
  }
}

function Inline({ nodes }: { nodes: InlineNode[] }): ReactNode {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'text': return node.text
      case 'code': return <code key={i}>{node.text}</code>
      case 'strong': return <strong key={i}><Inline nodes={node.children} /></strong>
      case 'em': return <em key={i}><Inline nodes={node.children} /></em>
      case 'del': return <del key={i}><Inline nodes={node.children} /></del>
      case 'link':
        return (
          <a key={i} href={node.href} title={node.href} onClick={(e) => { e.preventDefault(); void window.watch.openExternal(node.href) }}>
            <Inline nodes={node.children} />
          </a>
        )
    }
  })
}
