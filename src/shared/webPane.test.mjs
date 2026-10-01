import test from 'node:test'
import assert from 'node:assert/strict'
import { WEB_PARTITION, plainUserAgent, sameOrigin, sanitizeWebConfig, sanitizeWebUrl, webLabel, webPaneKey } from './webPane.mjs'

const SITE = 'https://taylormade-content-production.up.railway.app/'

test('sanitizeWebUrl: http(s) only, no credentials, normalized', () => {
  assert.equal(sanitizeWebUrl(SITE), SITE)
  assert.equal(sanitizeWebUrl('  https://Example.com  '), 'https://example.com/')
  assert.equal(sanitizeWebUrl('http://localhost:3000/app?x=1#y'), 'http://localhost:3000/app?x=1#y')
  for (const bad of ['file:///C:/x', 'javascript:alert(1)', 'data:text/html,hi', 'chrome://settings', 'https://user:pw@example.com/', 'not a url', '', null, 5]) {
    assert.equal(sanitizeWebUrl(bad), null, String(bad))
  }
  assert.equal(sanitizeWebUrl(`https://example.com/${'a'.repeat(3000)}`), null)
})

test('webLabel and sameOrigin', () => {
  assert.equal(webLabel(SITE), 'taylormade-content-production.up.railway.app')
  assert.equal(webLabel('https://www.example.com/x'), 'example.com')
  assert.equal(webLabel('nope'), 'Web')
  assert.equal(sameOrigin(SITE, `${SITE}sign-in?x=1`), true)
  assert.equal(sameOrigin(SITE, 'https://accounts.google.com/'), false)
  assert.equal(sameOrigin(SITE, 'javascript:1'), false)
})

test('sanitizeWebConfig keeps a loadable URL and a label, drops the rest', () => {
  assert.deepEqual(sanitizeWebConfig({ url: SITE, label: ' TaylorMade Content ', extra: 1 }), { url: SITE, label: 'TaylorMade Content' })
  assert.deepEqual(sanitizeWebConfig({ url: 'https://example.com' }), { url: 'https://example.com/', label: 'example.com' })
  assert.equal(sanitizeWebConfig({ url: 'file:///x' }), null)
  assert.equal(sanitizeWebConfig(null), null)
  assert.equal(WEB_PARTITION.startsWith('persist:'), true, 'a sign-in must survive restarts')
})

test('webPaneKey: only the keys that work inside a terminal leave the page', () => {
  const down = (key, code, mods = {}) => ({ type: 'keyDown', key, code, ...mods })
  assert.deepEqual(webPaneKey(down('j', 'KeyJ', { alt: true })), { action: 'waiting' })
  assert.deepEqual(webPaneKey(down('Tab', 'Tab', { control: true })), { action: 'nextPane' })
  assert.deepEqual(webPaneKey({ ...down('~', 'Backquote', { control: true, shift: true }), type: 'rawKeyDown' }), { action: 'newTerminal' })
  assert.deepEqual(webPaneKey(down('2', 'Digit2', { control: true })), { action: 'focusPane', arg: 2 })
  // Plain Ctrl keys belong to the page (Ctrl+K is a site's search, Ctrl+B bold…).
  assert.equal(webPaneKey(down('k', 'KeyK', { control: true })), null)
  assert.equal(webPaneKey(down('b', 'KeyB', { control: true })), null)
  assert.equal(webPaneKey(down('a', 'KeyA')), null)
  assert.equal(webPaneKey({ type: 'keyUp', key: 'j', code: 'KeyJ', alt: true }), null)
  assert.equal(webPaneKey(null), null)
})

test('plainUserAgent drops the Electron and app tokens, keeps what Chrome sends', () => {
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) taylormade-agent-monitor/0.4.46 Chrome/140.0.7339.41 Electron/42.10.0 Safari/537.36'
  assert.equal(plainUserAgent(ua), 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.41 Safari/537.36')
  assert.equal(plainUserAgent(plainUserAgent(ua)), plainUserAgent(ua))
  assert.equal(plainUserAgent(undefined), '')
})
