/**
 * A small Markdown reader for the Notes pane's preview, the file pane's and
 * the chat panes' replies. It produces a plain tree — never HTML — so the
 * renderer can build React elements from it and a note written by an agent
 * can carry no markup into the app. Covers what a notepad uses: headings,
 * paragraphs, bullet / numbered / task lists (nested by indent), fenced code,
 * block quotes, rules, GFM tables (Claude Code's replies use them), and
 * inline code, bold, italic, strikethrough, and links (http/https/mailto only).
 *
 * A chat reply passes `opts` (0.4.68, the Claude Code extension's rendering, docs in tm-chat-panes'
 * rea-findings *Markdown pass*): `breaks` keeps a paragraph's line breaks (the extension's
 * `white-space: pre-wrap`), `math` reads `\\(…\\)` and `$$…$$` inline and `$$` / `\\[` blocks as TeX — never a single
 * `$…$`, as the extension never does (`singleDollarTextMath: false`), so "$5 and $10" is money — and `paths`
 * makes a Windows path in the text, or a path in inline code, a `path` node the host opens.
 * Images become an `image` node the host shows as a placeholder; nothing is fetched.
 *
 * Block nodes: { type: 'heading', level, children } · { type: 'paragraph',
 * children } · { type: 'list', ordered, start, items: [{ checked, children }] }
 * · { type: 'code', lang, text } · { type: 'quote', children } · { type: 'hr' }
 * · { type: 'table', align: ('left'|'center'|'right'|null)[], head: Inline[][], rows: Inline[][][] }
 * Inline nodes: { type: 'text', text } · { type: 'code', text } ·
 * { type: 'strong' | 'em' | 'del', children } · { type: 'link', href, children }
 * With opts: { type: 'math', tex, display } (also a block) · { type: 'path', path, text, code, relative }
 * · { type: 'image', src, alt }
 */

const SAFE_HREF = /^(https?:\/\/|mailto:)/i

/** @typedef {{ breaks?: boolean, math?: boolean, paths?: boolean }} MarkdownOptions */

/** @param {MarkdownOptions} [opts] */
export function parseMarkdown(source, opts = {}) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n')
  return parseBlocks(lines, opts)
}

function parseBlocks(lines, opts = {}) {
  const join = opts.breaks ? '\n' : ' '
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

    // Display math: `$$` or `\\[` on its own line (or the whole block on one line), to the matching close.
    const mathOpen = opts.math ? /^\s{0,3}(\$\$|\\\[)(.*)$/.exec(line) : null
    if (mathOpen) {
      const closer = mathOpen[1] === '$$' ? '$$' : '\\]'
      const first = mathOpen[2]
      const endsHere = first.trimEnd().endsWith(closer)
      if (endsHere && first.trim().length > closer.length) {
        out.push({ type: 'math', tex: first.trimEnd().slice(0, -closer.length).trim(), display: true })
        i++
        continue
      }
      const body = first.trim() ? [first] : []
      let j = i + 1
      while (j < lines.length && !lines[j].trimEnd().endsWith(closer)) body.push(lines[j++])
      if (j < lines.length) {
        const last = lines[j].trimEnd().slice(0, -closer.length)
        if (last.trim()) body.push(last)
        out.push({ type: 'math', tex: body.join('\n').trim(), display: true })
        i = j + 1
        continue
      }
      // No close: not math, read as text below.
    }

    const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (heading) {
      out.push({ type: 'heading', level: heading[1].length, children: parseInline(heading[2], opts) })
      i++
      continue
    }

    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push({ type: 'hr' }); i++; continue }

    if (/^\s{0,3}>/.test(line)) {
      const inner = []
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) inner.push(lines[i++].replace(/^\s{0,3}>\s?/, ''))
      out.push({ type: 'quote', children: parseBlocks(inner, opts) })
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
          last.children.push(...parseBlocks(nested, opts))
          continue
        }
        const paragraph = [cur.text]
        i++
        // Lazy continuation lines: indented text that is not a new item.
        while (i < lines.length && lines[i].trim() && !listItem(lines[i]) && indentOf(lines[i]) > baseIndent) paragraph.push(lines[i++].trim())
        list.items.push({ checked: cur.checked, children: [{ type: 'paragraph', children: parseInline(paragraph.join(join), opts) }] })
      }
      out.push(list)
      continue
    }

    const table = tableStart(lines, i)
    if (table) {
      i += 2
      const rows = []
      // Rows run to a blank line or another block; a short row is padded, a long one cut to the header's width.
      while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i], opts)) {
        const cells = tableCells(lines[i]) ?? [lines[i].trim()]
        rows.push(table.align.map((_, k) => parseInline(cells[k] ?? '', opts)))
        i++
      }
      out.push({ type: 'table', align: table.align, head: table.head.map((cell) => parseInline(cell, opts)), rows })
      continue
    }

    const paragraph = [line.trim()]
    i++
    // A table interrupts a paragraph, as in GFM.
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i], opts) && !tableStart(lines, i)) paragraph.push(lines[i++].trim())
    out.push({ type: 'paragraph', children: parseInline(paragraph.join(join), opts) })
  }
  return out
}

/** A row's cells: split on pipes, `\|` kept as a pipe inside a cell, the outer pipes optional, each trimmed. Null without a pipe. */
function tableCells(line) {
  if (!line.includes('|')) return null
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells = []
  let cur = ''
  for (let k = 0; k < s.length; k++) {
    if (s[k] === '\\' && s[k + 1] === '|') { cur += '|'; k++; continue }
    if (s[k] === '|') { cells.push(cur.trim()); cur = ''; continue }
    cur += s[k]
  }
  cells.push(cur.trim())
  return cells
}

/** A table starts at a header row followed by a delimiter row (`| --- | :---: | ---: |`) with as many cells; each delimiter names its column's alignment. */
function tableStart(lines, i) {
  const head = tableCells(lines[i])
  const delims = i + 1 < lines.length ? tableCells(lines[i + 1]) : null
  if (!head || !delims || head.length !== delims.length || !delims.every((c) => /^:?-+:?$/.test(c))) return null
  const align = delims.map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : null))
  return { head, align }
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

/** A line that ends a paragraph: a heading, quote, fence, rule or list item, and with math on, a `$$` or `\\[` line (a math block interrupts a paragraph, like a fence). */
function isBlockStart(line, opts = {}) {
  if (opts.math && /^\s{0,3}(\$\$|\\\[)/.test(line)) return true
  return /^\s{0,3}(#{1,6}\s|>|(`{3,}|~{3,}))/.test(line) || /^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line) || listItem(line) !== null
}

/** An absolute Windows path at the start of `text` (drive and separator), stopping at whitespace and quotes. */
const ABS_PATH = /^[A-Za-z]:[\\/][^\s"'<>|*?`]*/
/** A relative path as it appears in inline code: at least one folder, a file with an extension, an optional :line. */
const REL_PATH = /^(?:\.{1,2}[\\/])?(?:[\w.@-]+[\\/])+[\w.@-]+\.\w{1,8}(?::\d+(?::\d+)?)?$/

/** A path node: the path without a trailing :line[:col], the text as written. */
function pathNode(text, code) {
  const path = text.replace(/:\d+(?::\d+)?$/, '')
  return { type: 'path', path, text, code, relative: !/^[A-Za-z]:[\\/]/.test(path) }
}

/** Inline: code spans first (they hide everything), then links, then emphasis. */
export function parseInline(text, opts = {}) {
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
      if (end > 0) {
        const inner = rest.slice(code[0].length, end)
        const asPath = opts.paths && !/\s/.test(inner) && (/^[A-Za-z]:[\\/]\S+$/.test(inner) || REL_PATH.test(inner))
        push(asPath ? pathNode(inner, true) : { type: 'code', text: inner })
        rest = rest.slice(end + code[0].length)
        continue
      }
    }
    // An image: never fetched, a placeholder the host opens (a web address outside, a local file in a pane).
    const image = /^!\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\)/.exec(rest)
    if (image) {
      const src = image[2]
      const ok = /^https?:\/\//i.test(src) || (opts.paths && /^[A-Za-z]:[\\/]/.test(src))
      push(ok ? { type: 'image', src, alt: image[1] } : { type: 'text', text: image[1] })
      rest = rest.slice(image[0].length)
      continue
    }
    if (opts.math) {
      const math = /^\\\((.+?)\\\)/.exec(rest) ?? /^\$\$([^$\n]+?)\$\$/.exec(rest)
      if (math) { push({ type: 'math', tex: math[1], display: false }); rest = rest.slice(math[0].length); continue }
    }
    if (opts.paths) {
      const abs = ABS_PATH.exec(rest)
      if (abs) {
        // Sentence punctuation after a path is not part of it.
        const written = abs[0].replace(/[.,;:!?)\]]+$/, '')
        if (written.length > 3) { push(pathNode(written, false)); rest = rest.slice(written.length); continue }
      }
    }
    // The URL may hold one level of balanced parens (Wikipedia-style), so a
    // rejected `javascript:alert(1)` is consumed whole and leaves no stray ")".
    const link = /^\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\)/.exec(rest)
    if (link) {
      const href = SAFE_HREF.test(link[2]) ? link[2] : undefined
      // A link to a Windows path opens the file, as in the extension (`ys1`); its label is the text shown.
      const file = !href && opts.paths && /^[A-Za-z]:[\\/]/.test(link[2]) ? pathNode(link[2], false) : null
      push(href ? { type: 'link', href, children: parseInline(link[1], opts) } : file ? { ...file, text: link[1] } : { type: 'text', text: link[1] })
      rest = rest.slice(link[0].length)
      continue
    }
    const auto = /^<(https?:\/\/[^>\s]+)>/.exec(rest) ?? /^(https?:\/\/[^\s<]+[^\s<.,;:!?)])/.exec(rest)
    if (auto) { push({ type: 'link', href: auto[1], children: [{ type: 'text', text: auto[1] }] }); rest = rest.slice(auto[0].length); continue }
    const strong = /^(\*\*|__)(?=\S)([\s\S]+?\S)\1/.exec(rest)
    if (strong) { push({ type: 'strong', children: parseInline(strong[2], opts) }); rest = rest.slice(strong[0].length); continue }
    const del = /^~~(?=\S)([\s\S]+?\S)~~/.exec(rest)
    if (del) { push({ type: 'del', children: parseInline(del[1], opts) }); rest = rest.slice(del[0].length); continue }
    const em = /^(\*|_)(?=\S)([\s\S]+?\S)\1(?![\w*_])/.exec(rest)
    if (em) { push({ type: 'em', children: parseInline(em[2], opts) }); rest = rest.slice(em[0].length); continue }
    const escaped = /^\\([\\`*_{}[\]()#+\-.!~<>$])/.exec(rest)
    if (escaped) { push({ type: 'text', text: escaped[1] }); rest = rest.slice(2); continue }
    // Plain text up to the next character that could start something (with paths on, a drive letter after a
    // space or an opening bracket or quote, so the path is read whole).
    let chunk = /^[^`\[*_~\\<h!$]+|^./.exec(rest)[0]
    if (opts.paths && chunk.length > 1) {
      // Looked for in the rest, not the chunk: the chunk already stopped at the path's backslash.
      const drive = /[\s(["']([A-Za-z]:[\\/])/.exec(rest)
      const at = drive ? drive.index + drive[0].length - drive[1].length : -1
      if (at > 0 && at < chunk.length) chunk = chunk.slice(0, at)
    }
    push({ type: 'text', text: chunk })
    rest = rest.slice(chunk.length)
  }
  return out
}
