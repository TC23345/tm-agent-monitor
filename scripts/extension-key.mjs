#!/usr/bin/env node
// Print a fresh RSA public key for extension/manifest.json's "key" and the
// extension id Chrome derives from it, or — with an existing manifest — the
// id of the key already in it. An unpacked extension's id otherwise depends
// on its folder path, and the native host's allowed_origins must not drift.
//
//   node scripts/extension-key.mjs            # id of the committed key
//   node scripts/extension-key.mjs --new      # a brand-new key + id (rotate)
import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extensionIdFromKey } from '../hooks/clipHostCore.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (process.argv.includes('--new')) {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const key = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  console.log(JSON.stringify({ key, id: extensionIdFromKey(key) }, null, 2))
} else {
  const manifest = JSON.parse(readFileSync(join(repo, 'extension', 'manifest.json'), 'utf8'))
  console.log(extensionIdFromKey(manifest.key))
}
