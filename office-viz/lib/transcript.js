// Parses a Claude Code session transcript (JSONL): sums token usage across
// assistant messages, and flattens lines into human-readable log entries for
// the agent console. Transcript line shape is not a stable API — unknown/odd
// -shaped lines and blocks are skipped silently rather than throwing.
'use strict';

const fs = require('fs');
const path = require('path');

function toNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function sumUsage(transcriptPath) {
  let raw;
  try {
    raw = fs.readFileSync(transcriptPath, 'utf8');
  } catch {
    return null;
  }

  const totals = { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 };
  const lines = raw.split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;

    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const usage = entry && entry.message && entry.message.usage;
    if (!usage || typeof usage !== 'object') continue;

    totals.input += toNumber(usage.input_tokens);
    totals.cacheCreation += toNumber(usage.cache_creation_input_tokens);
    totals.cacheRead += toNumber(usage.cache_read_input_tokens);
    totals.output += toNumber(usage.output_tokens);
  }

  return totals;
}

// Long-form text (message bodies) gets an ellipsis char on truncation;
// short-form fragments (tool targets/commands) get "..." to read like a
// trailing-off command line, matching the console's compact log lines.
function truncate(str, max) {
  if (typeof str !== 'string') return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function truncateShort(str, max) {
  if (typeof str !== 'string') return '';
  return str.length > max ? str.slice(0, max) + '...' : str;
}

function makeEntry(ts, kind, text, sidechain, extra) {
  return { ts, kind, text: truncate(text || '', 2000), sidechain: !!sidechain, ...extra };
}

function toolTarget(name, input) {
  const args = input && typeof input === 'object' ? input : {};

  if (name === 'Edit' || name === 'Write' || name === 'Read') {
    return typeof args.file_path === 'string' ? path.basename(args.file_path) : undefined;
  }
  if (name === 'Bash') {
    return typeof args.command === 'string' ? truncateShort(args.command, 40) : undefined;
  }
  if (name === 'Task' || name === 'Agent') {
    return typeof args.description === 'string' ? args.description : undefined;
  }

  let json;
  try {
    json = JSON.stringify(args);
  } catch {
    json = '';
  }
  return truncateShort(json || '', 40);
}

function toolResultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n');
  }
  return '';
}

function parseAssistantBlock(block, ts, sidechain) {
  if (!block || typeof block !== 'object') return null;

  switch (block.type) {
    case 'text':
      return makeEntry(ts, 'text', block.text, sidechain);

    case 'thinking': {
      const text = typeof block.thinking === 'string' ? block.thinking : block.text;
      return makeEntry(ts, 'thinking', text, sidechain);
    }

    case 'tool_use': {
      const name = typeof block.name === 'string' ? block.name : 'Tool';
      const target = toolTarget(name, block.input);
      const text = target ? `${name} ${target}` : name;
      return makeEntry(ts, 'tool_use', text, sidechain, { tool: { name, target } });
    }

    default:
      return null;
  }
}

function parseUserBlock(block, ts, sidechain) {
  if (!block || typeof block !== 'object') return null;

  switch (block.type) {
    case 'tool_result':
      return makeEntry(ts, 'tool_result', truncate(toolResultText(block.content), 200), sidechain);

    case 'text':
      return makeEntry(ts, 'user', block.text, sidechain);

    default:
      return null;
  }
}

// A transcript line's message.content may be a plain string or an array of
// content blocks; a single line can therefore yield zero, one, or many
// entries. Unparseable/unrecognized lines yield [].
function parseLogLine(line) {
  if (typeof line !== 'string' || !line.trim()) return [];

  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return [];
  }
  if (!entry || typeof entry !== 'object') return [];

  const role = entry.type === 'assistant' || entry.type === 'user' ? entry.type : null;
  if (!role) return [];

  const message = entry.message;
  if (!message || typeof message !== 'object') return [];

  const ts = entry.timestamp;
  const sidechain = !!entry.isSidechain;
  const content = message.content;

  let blocks;
  if (Array.isArray(content)) {
    blocks = content;
  } else if (typeof content === 'string') {
    blocks = [{ type: 'text', text: content }];
  } else {
    return [];
  }

  const parseBlock = role === 'assistant' ? parseAssistantBlock : parseUserBlock;
  const out = [];
  for (const block of blocks) {
    const parsed = parseBlock(block, ts, sidechain);
    if (parsed) out.push(parsed);
  }
  return out;
}

function readLogTail(transcriptPath, maxEntries = 200) {
  let raw;
  try {
    raw = fs.readFileSync(transcriptPath, 'utf8');
  } catch {
    return [];
  }

  const limit = Number.isFinite(maxEntries) && maxEntries > 0 ? maxEntries : 200;
  const entries = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    for (const parsed of parseLogLine(line)) entries.push(parsed);
  }
  return entries.slice(-limit);
}

module.exports = { sumUsage, parseLogLine, readLogTail };
