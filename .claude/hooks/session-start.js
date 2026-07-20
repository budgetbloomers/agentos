#!/usr/bin/env node
/**
 * SessionStart hook — makes the TCB-KB-V3 "always-on" layer literally always on.
 * Whatever this prints lands in Claude's context at the start of every session.
 */
const fs = require('fs');
const path = require('path');

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const bootstrap = path.join(root, 'chatterbox-kb', 'data', 'modules', '01_BOOTSTRAP_ALWAYS_ON.yaml');
const kbState = path.join(root, 'chatterbox-kb', 'context', 'kb-state.md');

try {
  const boot = fs.readFileSync(bootstrap, 'utf8');
  console.log('## Chatterbox always-on context (TCB-KB-V3 bootstrap)\n');
  console.log('```yaml\n' + boot.trim() + '\n```');
} catch (e) {
  console.log('[session-start hook] Bootstrap module not found at ' + bootstrap + ' — KB always-on layer NOT loaded.');
}

// Brain vault hot-cache — the LLM-wiki "state of play", read every session.
try {
  const hot = fs.readFileSync(path.join(root, 'brain', 'hot.md'), 'utf8');
  console.log('\n## Brain hot-cache (brain/hot.md)\n');
  console.log(hot.trim());
} catch (e) { /* brain vault optional */ }

// Surface any session-ingested overrides so stale pack facts are never used blindly.
try {
  const state = fs.readFileSync(kbState, 'utf8');
  const empty = /Nothing recorded yet/.test(state) ||
    /\[None recorded\][\s\S]*\[None recorded\][\s\S]*\[None recorded\][\s\S]*\[None recorded\]/.test(state);
  const hasEntries = !empty;
  if (hasEntries) {
    console.log('\n## KB state overlay has recorded entries — check chatterbox-kb/context/kb-state.md before quoting pack facts.');
  }
} catch (e) { /* overlay optional */ }
