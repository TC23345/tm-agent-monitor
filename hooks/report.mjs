#!/usr/bin/env node
// Backward-compatible Claude Code shim. New installs call bridge.mjs directly,
// but existing settings can keep pointing here while gaining endpoint discovery,
// authenticated /v1/events delivery, and provider-neutral normalization.

import { runBridge } from './bridge.mjs'

await runBridge({ provider: 'claude' })
