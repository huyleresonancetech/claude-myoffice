// Parses a Claude Code session transcript (JSONL) and sums token usage
// across assistant messages. Transcript line shape is not a stable API —
// unknown/odd-shaped lines are skipped silently rather than throwing.
'use strict';

const fs = require('fs');

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

module.exports = { sumUsage };
