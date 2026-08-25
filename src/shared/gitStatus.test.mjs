import test from 'node:test'
import assert from 'node:assert/strict'
import { describeGitStatus, parseGitStatus } from './gitStatus.mjs'

test('branch, tracking, and dirty count parse from porcelain v1 with -b', () => {
  const out = '## main...origin/main [ahead 2, behind 1]\n M src/a.ts\n?? new.txt\nA  staged.md\n'
  assert.deepEqual(parseGitStatus(out), { branch: 'main', detached: false, ahead: 2, behind: 1, dirty: 3 })
  assert.deepEqual(parseGitStatus('## feature/x\n'), { branch: 'feature/x', detached: false, ahead: 0, behind: 0, dirty: 0 })
  assert.deepEqual(parseGitStatus('## release.v2...origin/release.v2 [ahead 1]\n'), { branch: 'release.v2', detached: false, ahead: 1, behind: 0, dirty: 0 })
})

test('fresh repos and detached heads are recognised', () => {
  assert.deepEqual(parseGitStatus('## No commits yet on main\n?? a\n'), { branch: 'main', detached: false, ahead: 0, behind: 0, dirty: 1 })
  assert.deepEqual(parseGitStatus('## HEAD (no branch)\n'), { branch: null, detached: true, ahead: 0, behind: 0, dirty: 0 })
  assert.equal(parseGitStatus('fatal: not a git repository'), null)
  assert.equal(parseGitStatus(''), null)
  assert.equal(parseGitStatus(undefined), null)
})

test('the chip text is short', () => {
  assert.equal(describeGitStatus({ branch: 'main', detached: false, ahead: 2, behind: 0, dirty: 3 }), 'main ↑2 ±3')
  assert.equal(describeGitStatus({ branch: null, detached: true, ahead: 0, behind: 1, dirty: 0 }), 'detached ↓1')
  assert.equal(describeGitStatus(null), '')
})
