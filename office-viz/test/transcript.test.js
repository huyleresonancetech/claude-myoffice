'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { sumUsage } = require('../lib/transcript.js');

function writeTranscript(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-test-'));
  const file = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(file, lines.join('\n'));
  return { dir, file };
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

test('sums usage across assistant lines', () => {
  const { dir, file } = writeTranscript([
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        usage: {
          input_tokens: 10,
          cache_creation_input_tokens: 2,
          cache_read_input_tokens: 3,
          output_tokens: 5,
        },
      },
    }),
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        usage: {
          input_tokens: 7,
          cache_creation_input_tokens: 1,
          cache_read_input_tokens: 0,
          output_tokens: 4,
        },
      },
    }),
  ]);

  try {
    assert.deepEqual(sumUsage(file), {
      input: 17,
      cacheCreation: 3,
      cacheRead: 3,
      output: 9,
    });
  } finally {
    cleanup(dir);
  }
});

test('skips malformed lines mixed with valid ones', () => {
  const { dir, file } = writeTranscript([
    'not json at all {{{',
    JSON.stringify({
      type: 'assistant',
      message: { usage: { input_tokens: 5, output_tokens: 1 } },
    }),
    '{"unterminated": ',
  ]);

  try {
    assert.deepEqual(sumUsage(file), {
      input: 5,
      cacheCreation: 0,
      cacheRead: 0,
      output: 1,
    });
  } finally {
    cleanup(dir);
  }
});

test('lines without usage contribute nothing', () => {
  const { dir, file } = writeTranscript([
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant' } }),
    JSON.stringify({ type: 'system' }),
  ]);

  try {
    assert.deepEqual(sumUsage(file), {
      input: 0,
      cacheCreation: 0,
      cacheRead: 0,
      output: 0,
    });
  } finally {
    cleanup(dir);
  }
});

test('odd-shaped usage fields are treated as zero', () => {
  const { dir, file } = writeTranscript([
    JSON.stringify({
      type: 'assistant',
      message: { usage: { input_tokens: 'lots', output_tokens: null } },
    }),
  ]);

  try {
    assert.deepEqual(sumUsage(file), {
      input: 0,
      cacheCreation: 0,
      cacheRead: 0,
      output: 0,
    });
  } finally {
    cleanup(dir);
  }
});

test('empty file returns zeroed totals', () => {
  const { dir, file } = writeTranscript(['']);

  try {
    assert.deepEqual(sumUsage(file), {
      input: 0,
      cacheCreation: 0,
      cacheRead: 0,
      output: 0,
    });
  } finally {
    cleanup(dir);
  }
});

test('nonexistent path returns null', () => {
  assert.equal(sumUsage(path.join(os.tmpdir(), 'office-viz-does-not-exist.jsonl')), null);
});
