import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyRetention, blockedExe, blocklistEntry, clipPreview, clipTitle, dedupeKey, describeSource, domainBlocked, filterClips, groupNameOk, inGroup,
  looksLikeCode, looksSecret, mergeText, orderFavorites, parseDropFiles, parseSnippetNote, sanitizeClip, sanitizeGroups, shouldCapture, sizeLabel,
  appDisplayName, sanitizeSource, sourceLabel, summarize, upsertClip, CF_HDROP, EXCLUSION_FORMATS, MAX_CLIP_BYTES, MAX_IMAGE_BYTES, INTERNAL_COPY_WINDOW_MS, BURST_MS
} from './clips.mjs'

/** Build a DROPFILES payload the way Explorer does: 20-byte header, then paths. */
function dropFiles(paths, { wide = true, offset = 20 } = {}) {
  const header = Buffer.alloc(offset)
  header.writeUInt32LE(offset, 0)
  header.writeUInt32LE(wide ? 1 : 0, 16)
  const list = paths.map((p) => `${p}\0`).join('') + '\0'
  return Buffer.concat([header, Buffer.from(list, wide ? 'utf16le' : 'latin1')])
}

function textClip(id, text, extra = {}) {
  return { id, kind: 'text', text, groups: [], favorite: false, source: { kind: 'app', exe: 'notepad.exe' }, bytes: Buffer.byteLength(text), createdAt: 1000, copiedAt: 1000, copies: 1, ...extra }
}

test('constants match the Windows definitions', () => {
  assert.equal(CF_HDROP, 15)
  assert.equal(EXCLUSION_FORMATS.exclude, 'ExcludeClipboardContentFromMonitorProcessing')
  assert.equal(EXCLUSION_FORMATS.history, 'CanIncludeInClipboardHistory')
  assert.equal(EXCLUSION_FORMATS.cloud, 'CanUploadToCloudClipboard')
})

test('parseDropFiles reads a wide (UTF-16) Explorer file list', () => {
  const paths = ['C:\\Users\\me\\Pictures\\shot.png', 'C:\\Users\\me\\Documents\\naïve résumé.docx']
  assert.deepEqual(parseDropFiles(dropFiles(paths)), paths)
})

test('parseDropFiles reads an ANSI list and honours a header offset beyond 20', () => {
  assert.deepEqual(parseDropFiles(dropFiles(['C:\\a.txt', 'D:\\b'], { wide: false })), ['C:\\a.txt', 'D:\\b'])
  assert.deepEqual(parseDropFiles(dropFiles(['C:\\x'], { offset: 32 })), ['C:\\x'])
})

test('parseDropFiles refuses garbage', () => {
  assert.deepEqual(parseDropFiles(null), [])
  assert.deepEqual(parseDropFiles(Buffer.alloc(8)), [])
  const badOffset = Buffer.alloc(24)
  badOffset.writeUInt32LE(4000, 0)
  assert.deepEqual(parseDropFiles(badOffset), [])
  const tooSmallOffset = dropFiles(['C:\\x'])
  tooSmallOffset.writeUInt32LE(4, 0)
  assert.deepEqual(parseDropFiles(tooSmallOffset), [])
  assert.deepEqual(parseDropFiles(dropFiles([])), [])
})

test('looksSecret catches the fix-evals families and nothing ordinary', () => {
  assert.equal(looksSecret('Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'), 'jwt')
  assert.equal(looksSecret('ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123'), 'anthropic/openai key')
  assert.equal(looksSecret('token ghp_abcdefghijklmnopqrstuvwxyz0123456789'), 'github token')
  assert.equal(looksSecret('xoxb-1234567890-abcdef'), 'slack token')
  assert.equal(looksSecret('AKIAIOSFODNN7EXAMPLE'), 'aws access key')
  assert.equal(looksSecret('-----BEGIN RSA PRIVATE KEY-----\nMIIE'), 'private key')
  assert.equal(looksSecret('sk_live_abcdefghijklmnopqrstu'), 'clerk/stripe secret')
  assert.equal(looksSecret('mongodb+srv://user:hunter22@cluster0.example.net/db'), 'connection string with password')
  assert.equal(looksSecret('line one\nDB_PASSWORD=supersecretvalue\nline three'), '.env assignment')
  assert.equal(looksSecret('npm run dist && git tag --no-sign v0.4.20'), null)
  assert.equal(looksSecret('The password field is empty.'), null)
  assert.equal(looksSecret(''), null)
  assert.equal(looksSecret(null), null)
})

test('blocklistEntry normalises what the user types into an exe name or a host name', () => {
  assert.equal(blocklistEntry('app', '  Slack  '), 'slack.exe')
  assert.equal(blocklistEntry('app', 'C:\\Program Files\\1Password\\1Password.exe'), '1password.exe')
  assert.equal(blocklistEntry('app', 'KeePassXC.EXE'), 'keepassxc.exe')
  assert.equal(blocklistEntry('app', 'some app.exe'), null, 'no spaces in an exe name')
  assert.equal(blocklistEntry('app', ''), null)
  assert.equal(blocklistEntry('site', 'https://Mail.Google.com/mail/u/0/'), 'mail.google.com')
  assert.equal(blocklistEntry('site', '.Bank.Example.'), 'bank.example')
  assert.equal(blocklistEntry('site', 'localhost'), 'localhost')
  assert.equal(blocklistEntry('site', 'example.com/path?q=1'), 'example.com')
  assert.equal(blocklistEntry('site', 'not a host'), null)
  assert.equal(blocklistEntry('site', '-bad.com'), null)
  assert.equal(blocklistEntry('other', 'x'), null)
})

test('blockedExe compares basenames case-insensitively; domainBlocked covers subdomains', () => {
  assert.ok(blockedExe('C:\\Program Files\\1Password\\1Password.exe', ['1password.exe']))
  assert.ok(blockedExe('KeePassXC.exe', ['keepassxc.exe']))
  assert.ok(!blockedExe('notepad.exe', ['1password.exe']))
  assert.ok(!blockedExe(undefined, ['1password.exe']))
  assert.ok(domainBlocked('https://mail.google.com/mail/u/0/', ['google.com']))
  assert.ok(domainBlocked('https://bank.example/login', ['.bank.example']))
  assert.ok(!domainBlocked('https://notgoogle.com/', ['google.com']))
  assert.ok(!domainBlocked('not a url', ['google.com']))
  assert.ok(!domainBlocked('https://a.b/', []))
})

test('shouldCapture: files beat text beat image; blanks, secrets, sizes and exclusions are refused', () => {
  assert.deepEqual(shouldCapture({ text: 'hi', files: ['C:\\a'] }), { keep: true, kind: 'files' })
  assert.deepEqual(shouldCapture({ text: 'hi', hasImage: true }), { keep: true, kind: 'text' })
  assert.deepEqual(shouldCapture({ text: '   \n', hasImage: true, imageBytes: 1000 }), { keep: true, kind: 'image' })
  assert.deepEqual(shouldCapture({ text: '   \n' }), { keep: false, reason: 'empty' })
  assert.deepEqual(shouldCapture({ text: 'x', excluded: true }), { keep: false, reason: 'excluded' })
  assert.deepEqual(shouldCapture({ text: 'x' }, { paused: true }), { keep: false, reason: 'paused' })
  assert.deepEqual(shouldCapture({ text: 'x' }, { ownerExe: '1Password.exe' }), { keep: false, reason: 'password-manager' })
  assert.deepEqual(shouldCapture({ text: 'x' }, { ownerExe: 'slack.exe', blockedExes: ['Slack.exe'] }), { keep: false, reason: 'blocked-app' })
  assert.deepEqual(shouldCapture({ text: 'AKIAIOSFODNN7EXAMPLE' }), { keep: false, reason: 'secret:aws access key' })
  assert.deepEqual(shouldCapture({ text: 'AKIAIOSFODNN7EXAMPLE' }, { redactSecrets: false }), { keep: true, kind: 'text' })
  assert.deepEqual(shouldCapture({ text: 'a'.repeat(MAX_CLIP_BYTES + 1) }), { keep: false, reason: 'too-large' })
  assert.deepEqual(shouldCapture({ text: '', hasImage: true, imageBytes: MAX_IMAGE_BYTES + 1 }), { keep: false, reason: 'too-large' })
  assert.deepEqual(shouldCapture(null), { keep: false, reason: 'excluded' })
})

test('dedupeKey distinguishes kinds; upsert moves a re-copy to the top and keeps its metadata', () => {
  assert.equal(dedupeKey({ kind: 'text', text: 'a' }), 't:a')
  assert.equal(dedupeKey({ kind: 'files', files: ['C:\\a', 'C:\\b'] }), 'f:C:\\a\nC:\\b')
  assert.equal(dedupeKey({ kind: 'image', image: { hash: 'abc' } }), 'i:abc')
  const a = textClip('a', 'alpha', { favorite: true, groups: ['Prompts'], title: 'Alpha' })
  const b = textClip('b', 'beta', { copiedAt: 2000 })
  const first = upsertClip([b, a], { id: 'c', kind: 'text', text: 'gamma', source: { kind: 'app' }, bytes: 5 }, 3000)
  assert.equal(first.existed, false)
  assert.deepEqual(first.clips.map((c) => c.id), ['c', 'b', 'a'])
  assert.equal(first.clip.copiedAt, 3000)
  assert.equal(first.clip.createdAt, 3000)
  const again = upsertClip(first.clips, { id: 'zzz', kind: 'text', text: 'alpha', source: { kind: 'chrome', exe: 'chrome.exe' }, bytes: 5 }, 4000)
  assert.equal(again.existed, true)
  assert.deepEqual(again.clips.map((c) => c.id), ['a', 'c', 'b'], 'the existing clip moved up under its own id')
  assert.equal(again.clip.copies, 2)
  assert.equal(again.clip.title, 'Alpha')
  assert.deepEqual(again.clip.groups, ['Prompts'])
  assert.equal(again.clip.favorite, true)
  assert.equal(again.clip.source.kind, 'chrome', 'the newest source wins')
  assert.equal(again.clip.createdAt, 1000, 'first-seen time is kept')
  assert.equal(first.clips.length, 3, 'inputs are not mutated')
  const own = upsertClip(again.clips, { id: 'q', kind: 'text', text: 'alpha', source: { kind: 'app', app: 'TaylorMade Agents' }, bytes: 5 }, 5000, { keepSource: true })
  assert.equal(own.clip.source.kind, 'chrome', 'a re-copy from our own pane keeps the original source')
  assert.equal(own.clip.copies, 3)
  // A write-then-flush burst: the same content on top again 300 ms later is the same copy.
  const burst = upsertClip(own.clips, { id: 'r', kind: 'text', text: 'alpha', source: { kind: 'app' }, bytes: 5 }, 5300)
  assert.equal(burst.burst, true)
  assert.equal(burst.clip.copies, 3)
  assert.equal(burst.clips, own.clips, 'nothing changes')
  const later = upsertClip(own.clips, { id: 'r', kind: 'text', text: 'alpha', source: { kind: 'app' }, bytes: 5 }, 5000 + BURST_MS)
  assert.equal(later.burst, undefined)
  assert.equal(later.clip.copies, 4)
  const notTop = upsertClip([textClip('x', 'other', { copiedAt: 5100 }), ...own.clips], { id: 'r', kind: 'text', text: 'alpha', source: { kind: 'app' }, bytes: 5 }, 5200)
  assert.equal(notTop.burst, undefined, 'only the clip on top can be a burst echo')
})

test('applyRetention drops old and surplus unpinned clips only', () => {
  const day = 86_400_000
  const now = 100 * day
  const clips = [
    textClip('fresh', 'f', { copiedAt: now - day }),
    textClip('old-fav', 'o', { copiedAt: now - 60 * day, favorite: true }),
    textClip('old-grouped', 'g', { copiedAt: now - 60 * day, groups: ['Keep'] }),
    textClip('old', 'x', { copiedAt: now - 31 * day }),
    textClip('mid', 'm', { copiedAt: now - 10 * day }),
    textClip('mid2', 'n', { copiedAt: now - 20 * day })
  ]
  const aged = applyRetention(clips, { now })
  assert.deepEqual(aged.map((c) => c.id), ['fresh', 'old-fav', 'old-grouped', 'mid', 'mid2'])
  const capped = applyRetention(clips, { now, maxItems: 3 })
  assert.deepEqual(capped.map((c) => c.id), ['fresh', 'old-fav', 'old-grouped'], 'pinned stay, oldest unpinned go first')
  const capped2 = applyRetention(clips, { now, maxItems: 4 })
  assert.deepEqual(capped2.map((c) => c.id), ['fresh', 'old-fav', 'old-grouped', 'mid'])
})

test('groups: names are validated, built-ins are views, membership follows the view', () => {
  assert.ok(groupNameOk('Prompts'))
  assert.ok(groupNameOk('Q3 launch'))
  for (const bad of ['', ' lead', 'trail ', 'All', 'favorites', 'IMAGES', 'x'.repeat(41), 'a\u0000b', 12]) assert.ok(!groupNameOk(bad), String(bad))
  const img = { id: 'i', kind: 'image', groups: ['Shots'], favorite: false }
  assert.ok(inGroup(img, 'all'))
  assert.ok(inGroup(img, 'images'))
  assert.ok(inGroup(img, 'Shots'))
  assert.ok(!inGroup(img, 'favorites'))
  assert.ok(!inGroup(img, 'Other'))
  assert.ok(inGroup({ favorite: true, groups: [] }, 'favorites'))
  assert.deepEqual(sanitizeGroups(['Prompts', 'Prompts', 'All', 7, 'Work ']), ['Prompts'])
})

test('filterClips honours group, source and a fuzzy query, newest first when unqueried', () => {
  const clips = [
    textClip('a', 'npm run build', { copiedAt: 1, source: { kind: 'terminal', provider: 'claude', project: 'claude-watch' } }),
    textClip('b', 'Meeting notes for Thursday', { copiedAt: 3, favorite: true, source: { kind: 'chrome', exe: 'chrome.exe' } }),
    textClip('c', 'git status --porcelain', { copiedAt: 2, source: { kind: 'app', exe: 'pwsh.exe' } })
  ]
  assert.deepEqual(filterClips(clips).map((c) => c.id), ['b', 'c', 'a'])
  assert.deepEqual(filterClips(clips, { group: 'favorites' }).map((c) => c.id), ['b'])
  assert.deepEqual(filterClips(clips, { source: 'chrome' }).map((c) => c.id), ['b'])
  assert.deepEqual(filterClips(clips, { source: 'project:Claude-Watch' }).map((c) => c.id), ['a'])
  assert.deepEqual(filterClips(clips, { source: 'exe:PWSH.EXE' }).map((c) => c.id), ['c'])
  assert.deepEqual(filterClips(clips, { query: 'git' }).map((c) => c.id), ['c'])
  assert.deepEqual(filterClips(clips, { query: 'zzzz' }), [])
  assert.deepEqual(filterClips(clips, { limit: 2 }).map((c) => c.id), ['b', 'c'])
})

test('titles, previews, sizes and code detection', () => {
  assert.equal(clipTitle(textClip('a', '\n\n  first line here \nsecond')), 'first line here')
  assert.equal(clipTitle(textClip('a', 'x', { title: '  Named  ' })), 'Named')
  assert.equal(clipTitle(textClip('a', 'y'.repeat(100))).length, 80)
  assert.equal(clipTitle({ kind: 'files', files: ['C:\\dir\\report.pdf'] }), 'report.pdf')
  assert.equal(clipTitle({ kind: 'files', files: ['C:\\a', 'C:\\b'] }), '2 files')
  assert.equal(clipTitle({ kind: 'image', image: { width: 800, height: 600 } }), 'Image 800×600')
  assert.equal(clipPreview(textClip('a', 'one\n\n  two   three ')), 'one two three')
  assert.equal(clipPreview(textClip('a', 'z'.repeat(300)), 20).length, 20)
  assert.equal(sizeLabel(512), '512 B')
  assert.equal(sizeLabel(4300), '4.2 KB')
  assert.equal(sizeLabel(200 * 1024), '200 KB')
  assert.equal(sizeLabel(3 * 1024 * 1024), '3.0 MB')
  assert.ok(looksLikeCode('import x from "y"\nexport function f() {\n  return 1\n}'))
  assert.ok(looksLikeCode('npm run dist'))
  assert.ok(!looksLikeCode('Please review the attached notes before Thursday.\nThanks!'))
})

test('describeSource: our own copy within the pane window is that pane, else owner, else foreground', () => {
  const self = 4242
  const internal = { at: 10_000, terminalId: 'pty-1', project: 'gs-referral' }
  const pane = describeSource({ owner: { pid: self, exe: 'electron.exe' }, selfPid: self, internal, agent: { provider: 'claude', id: 'claude:abc', project: 'gs-referral' }, now: 10_500 })
  assert.deepEqual(pane, { kind: 'terminal', app: 'TaylorMade Agents', terminalId: 'pty-1', project: 'gs-referral', provider: 'claude', agentId: 'claude:abc' })
  const late = describeSource({ owner: { pid: self, exe: 'electron.exe' }, selfPid: self, internal, now: 10_000 + INTERNAL_COPY_WINDOW_MS + 1 })
  assert.equal(late.kind, 'app')
  assert.equal(late.app, 'TaylorMade Agents')
  const chrome = describeSource({ owner: { pid: 7, exe: 'chrome.exe', title: 'GitHub - Google Chrome' }, foreground: { pid: 9, exe: 'pwsh.exe' } })
  assert.deepEqual(chrome, { kind: 'chrome', exe: 'chrome.exe', app: 'Chrome', title: 'GitHub - Google Chrome' })
  const console = describeSource({ owner: null, foreground: { pid: 9, exe: 'WindowsTerminal.exe', title: 'pwsh' } })
  assert.deepEqual(console, { kind: 'app', exe: 'windowsterminal.exe', app: 'Windows Terminal', title: 'pwsh' })
  assert.deepEqual(describeSource({}), { kind: 'app' })
  assert.equal(sourceLabel(pane), 'Claude Code · gs-referral')
  assert.equal(sourceLabel(chrome), 'Chrome · GitHub - Google Chrome')
  assert.equal(sourceLabel({ kind: 'chrome', app: 'Chrome', url: 'https://github.com/x/y' }), 'Chrome · github.com')
  assert.equal(sourceLabel({ kind: 'agent', provider: 'codex', project: 'p' }), 'added by Codex · p')
  assert.equal(sourceLabel({ kind: 'manual' }), 'added by you')
  // A selection saved through the extension's right-click is filed as its page, never as an agent's add.
  const saved = sanitizeSource({ kind: 'chrome', app: 'Chrome', url: 'https://docs.example.com/a?b=1', title: 'Docs' })
  assert.deepEqual(saved, { kind: 'chrome', app: 'Chrome', title: 'Docs', url: 'https://docs.example.com/a?b=1' })
  assert.equal(sourceLabel(saved), 'Chrome · docs.example.com')
  assert.doesNotMatch(sourceLabel(saved), /added by/)
})

test('an app is named by its label, else by its title-cased exe stem — never the raw .exe', () => {
  assert.equal(appDisplayName('Wispr Flow Helper.exe'), 'Wispr Flow')
  assert.equal(appDisplayName('C:\\Program Files\\Wispr Flow\\Wispr Flow.exe'), 'Wispr Flow')
  assert.equal(appDisplayName('chrome.exe'), 'Chrome')
  assert.equal(appDisplayName('some_tool.exe'), 'Some Tool')
  assert.equal(appDisplayName('my-app-v2.EXE'), 'My App V2')
  assert.equal(appDisplayName('zoom'), 'Zoom')
  assert.equal(appDisplayName(undefined), '')
  // Clips stored before a label existed carry only the exe; their meta line reads the name too.
  assert.equal(sourceLabel({ kind: 'app', exe: 'wispr flow helper.exe' }), 'Wispr Flow')
  assert.equal(sourceLabel({ kind: 'app', exe: 'acme_notes.exe', title: 'Todo' }), 'Acme Notes · Todo')
})

test('parseSnippetNote reads the shortcut line and leaves the expansion clean', () => {
  assert.deepEqual(parseSnippetNote('shortcut: ;sig\n\nBest,\nTaylor\n'), { shortcut: ';sig', body: 'Best,\nTaylor' })
  assert.deepEqual(parseSnippetNote('Shortcut:\t;addr\r\n1 Main St\r\n'), { shortcut: ';addr', body: '1 Main St' })
  assert.deepEqual(parseSnippetNote('# Prompt\n\nWrite a PRD for…\n'), { shortcut: null, body: '# Prompt\n\nWrite a PRD for…' })
  assert.deepEqual(parseSnippetNote('shortcut: ;only'), { shortcut: ';only', body: '' })
  assert.deepEqual(parseSnippetNote(undefined), { shortcut: null, body: '' })
})

test('mergeText joins bodies in order and skips blanks', () => {
  assert.equal(mergeText([textClip('a', 'one'), { kind: 'files', files: ['C:\\x'] }, textClip('b', '  '), textClip('c', 'three')]), 'one\nC:\\x\nthree')
})

test('sanitizeClip enforces the record shape and bounds', () => {
  const ok = sanitizeClip({ id: 'abc-123', kind: 'text', text: 'hello', groups: ['Work', 'All', 'Work'], favorite: 'yes', title: ' T ', createdAt: 5, copiedAt: 9, copies: 3, source: { kind: 'chrome', exe: 'chrome.exe', url: 'javascript:alert(1)', junk: 1 }, edited: true, extra: 'dropped' })
  assert.deepEqual(ok, { id: 'abc-123', kind: 'text', text: 'hello', groups: ['Work'], favorite: false, source: { kind: 'chrome', exe: 'chrome.exe' }, title: 'T', createdAt: 5, copiedAt: 9, copies: 3, bytes: 5, edited: true })
  assert.equal(sanitizeClip({ id: 'x', kind: 'text', text: '   ' }), null)
  assert.equal(sanitizeClip({ id: 'bad id!', kind: 'text', text: 'a' }), null)
  assert.equal(sanitizeClip({ id: 'x', kind: 'image', image: { width: 1, height: 1, bytes: 10 } }), null, 'an image needs its hash')
  const img = sanitizeClip({ id: 'x', kind: 'image', image: { width: 10, height: 20, bytes: 300, hash: 'h' } })
  assert.equal(img.bytes, 300)
  assert.equal(img.text, '')
  const files = sanitizeClip({ id: 'x', kind: 'files', files: ['C:\\a', 3, ' '] })
  assert.deepEqual(files.files, ['C:\\a'])
  assert.equal(files.text, 'C:\\a')
  assert.equal(sanitizeClip({ id: 'x', kind: 'files', files: [] }), null)
  const future = sanitizeClip({ id: 'x', kind: 'text', text: 'a', createdAt: Date.now() + 10 * 86_400_000 })
  assert.ok(future.createdAt <= Date.now())
})

test('orderFavorites puts the saved order first, then the rest newest first; summarize drops the body', () => {
  const clips = [textClip('a', 'a', { favorite: true, copiedAt: 1 }), textClip('b', 'b', { favorite: true, copiedAt: 3 }), textClip('c', 'c', { favorite: true, copiedAt: 2 }), textClip('d', 'd', { copiedAt: 9 })]
  assert.deepEqual(orderFavorites(clips, ['c', 'zzz', 'c']).map((c) => c.id), ['c', 'b', 'a'])
  assert.deepEqual(orderFavorites(clips, null).map((c) => c.id), ['b', 'c', 'a'])
  const s = summarize(textClip('a', 'body text here', { title: 'Named' }))
  assert.equal(s.text, undefined)
  assert.equal(s.title, 'Named')
  assert.equal(s.custom, true)
  assert.equal(s.preview, 'body text here')
  assert.equal(summarize(textClip('a', 'first\nsecond')).custom, false)
})
