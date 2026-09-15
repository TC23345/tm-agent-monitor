/**
 * A small Markdown reader for the Notes pane's preview. It produces a plain
 * tree — never HTML — so the renderer can build React elements from it and
 * a note written by an agent can carry no markup into the app. Covers what
 * a notepad uses: headings, paragraphs, bullet / numbered / task lists
 * (nested by indent), fenced code, block quotes, rules, and inline code,
 * bold, italic, strikethrough, and links (http/https/mailto only).
 *
 * Block nodes: { type: 'heading', level, children } · { type: 'paragraph',
 * children } · { type: 'list', ordered, start, items: [{ checked, children }] }
 * · { type: 'code', lang, text } · { type: 'quote', children } · { type: 'hr' }
 * Inline nodes: { type: 'text', text } · { type: 'code', text } ·
 * { type: 'strong' | 'em' | 'del', children } · { type: 'link', href, children }
 */

const SAFE_HREF = /^(https?:\/\/|mailto:)/i

export function parseMarkdown(source) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n')
  return parseBlocks(lines)
}

function parseBlocks(lines) {
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }

    const fence = /^\s{0,3}(`{3,}|~{3,})\s*([\w+-]*)\s*$/.exec(line)
    if (fence) {
      const close = fence[1][0]
      const body = []
      i++
      while (i < lines.length && !new RegExp(`^\\s{0,3}${close}{${fence[1].length},}\\s*$`).test(lines[i])) body.push(lines[i++])
      // Unterminated: the note's trailing newline is not part of the code.
      if (i >= lines.length) while (body.length && !body[body.length - 1].trim()) body.pop()
      i++ // the closing fence, or end of input
      out.push({ type: 'code', lang: fence[2] || '', text: body.join('\n') })
      continue
    }

    const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (heading) {
      out.push({ type: 'heading', level: heading[1].length, children: parseInline(heading[2]) })
      i++
      continue
    }

    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push({ type: 'hr' }); i++; continue }

    if (/^\s{0,3}>/.test(line)) {
      const inner = []
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) inner.push(lines[i++].replace(/^\s{0,3}>\s?/, ''))
      out.push({ type: 'quote', children: parseBlocks(inner) })
      continue
    }

    const item = listItem(line)
    if (item) {
      const list = { type: 'list', ordered: item.ordered, start: item.start, items: [] }
      const baseIndent = item.indent
      while (i < lines.length) {
        const cur = listItem(lines[i])
        if (!cur || cur.indent < baseIndent || cur.ordered !== list.ordered) break
        if (cur.indent > baseIndent) {
          // A deeper item belongs to the previous item as a nested list.
          const nested = []
          while (i < lines.length) {
            const probe = listItem(lines[i])
            const continuation = !probe && lines[i].trim() && indentOf(lines[i]) > baseIndent
            if (!probe && !continuation) break
            if (probe && probe.indent <= baseIndent) break
            nested.push(lines[i].slice(Math.min(cur.indent, indentOf(lines[i]))))
            i++
          }
          const last = list.items[list.items.length - 1] ?? (list.items.push({ checked: null, children: [] }), list.items[0])
          last.children.push(...parseBlocks(nested))
          continue
        }
        const paragraph = [cur.text]
        i++
        // Lazy continuation lines: indented text that is not a new item.
        while (i < lines.length && lines[i].trim() && !listItem(lines[i]) && indentOf(lines[i]) > baseIndent) paragraph.push(lines[i++].trim())
        list.items.push({ checked: cur.checked, children: [{ type: 'paragraph', children: parseInline(paragraph.join(' ')) }] })
      }
      out.push(list)
      continue
    }

    const paragraph = [line.trim()]
    i++
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) paragraph.push(lines[i++].trim())
    out.push({ type: 'paragraph', children: parseInline(paragraph.join(' ')) })
  }
  return out
}

function indentOf(line) {
  return /^\s*/.exec(line)[0].replace(/\t/g, '    ').length
}

function listItem(line) {
  const m = /^(\s*)(?:([-*+])|(\d{1,9})[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(line)
  if (!m) return null
  return {
    indent: m[1].replace(/\t/g, '    ').length,
    ordered: m[3] !== undefined,
    start: m[3] !== undefined ? Number(m[3]) : 1,
    checked: m[4] === undefined ? null : m[4] !== ' ',
    text: m[5]
  }
}

function isBlockStart(line) {
  return /^\s{0,3}(#{1,6}\s|>|(`{3,}|~{3,}))/.test(line) || /^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line) || listItem(line) !== null
}

/** Inline: code spans first (they hide everything), then links, then emphasis. */
export function parseInline(text) {
  const out = []
  let rest = String(text ?? '')
  const push = (node) => {
    const last = out[out.length - 1]
    if (node.type === 'text' && last && last.type === 'text') last.text += node.text
    else out.push(node)
  }
  while (rest.length) {
    const code = /^`+/.exec(rest)
    if (code) {
      const end = rest.indexOf(code[0], code[0].length)
      if (end > 0) { push({ type: 'code', text: rest.slice(code[0].length, end) }); rest = rest.slice(end + code[0].length); continue }
    }
    // The URL may hold one level of balanced parens (Wikipedia-style), so a
    // rejected `javascript:alert(1)` is consumed whole and leaves no stray ")".
    const link = /^\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\)/.exec(rest)
    if (link) {
      const href = SAFE_HREF.test(link[2]) ? link[2] : undefined
      push(href ? { type: 'link', href, children: parseInline(link[1]) } : { type: 'text', text: link[1] })
      rest = rest.slice(link[0].length)
      continue
    }
    const auto = /^<(https?:\/\/[^>\s]+)>/.exec(rest) ?? /^(https?:\/\/[^\s<]+[^\s<.,;:!?)])/.exec(rest)
    if (auto) { push({ type: 'link', href: auto[1], children: [{ type: 'text', text: auto[1] }] }); rest = rest.slice(auto[0].length); continue }
    const strong = /^(\*\*|__)(?=\S)([\s\S]+?\S)\1/.exec(rest)
    if (strong) { push({ type: 'strong', children: parseInline(strong[2]) }); rest = rest.slice(strong[0].length); continue }
    const del = /^~~(?=\S)([\s\S]+?\S)~~/.exec(rest)
    if (del) { push({ type: 'del', children: parseInline(del[1]) }); rest = rest.slice(del[0].length); continue }
    const em = /^(\*|_)(?=\S)([\s\S]+?\S)\1(?![\w*_])/.exec(rest)
    if (em) { push({ type: 'em', children: parseInline(em[2]) }); rest = rest.slice(em[0].length); continue }
    const escaped = /^\\([\\`*_{}[\]()#+\-.!~<>])/.exec(rest)
    if (escaped) { push({ type: 'text', text: escaped[1] }); rest = rest.slice(2); continue }
    // Plain text up to the next character that could start something.
    const plain = /^[^`\[*_~\\<h]+|^./.exec(rest)
    push({ type: 'text', text: plain[0] })
    rest = rest.slice(plain[0].length)
  }
  return out
}
