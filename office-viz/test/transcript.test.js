'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { sumUsage, parseLogLine, readLogTail } = require('../lib/transcript.js');

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

test('multi-block assistant line yields multiple entries in order', () => {
  const line = JSON.stringify({
    type: 'assistant',
    timestamp: '2026-08-12T00:00:00.000Z',
    isSidechain: false,
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'let me check the file' },
        { type: 'text', text: 'Here is the plan.' },
        { type: 'tool_use', name: 'Edit', input: { file_path: '/repo/src/auth.ts' } },
      ],
    },
  });

  const entries = parseLogLine(line);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].kind, 'thinking');
  assert.equal(entries[0].text, 'let me check the file');
  assert.equal(entries[1].kind, 'text');
  assert.equal(entries[1].text, 'Here is the plan.');
  assert.equal(entries[2].kind, 'tool_use');
  assert.equal(entries[2].text, 'Edit auth.ts');
  entries.forEach((e) => assert.equal(e.ts, '2026-08-12T00:00:00.000Z'));
});

test('tool_use target rules: Edit basename, Bash truncation, Task description', () => {
  const editLine = JSON.stringify({
    type: 'assistant',
    timestamp: 't1',
    message: {
      content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'C:/repo/src/auth.ts' } }],
    },
  });
  const [editEntry] = parseLogLine(editLine);
  assert.equal(editEntry.tool.target, 'auth.ts');
  assert.equal(editEntry.text, 'Edit auth.ts');

  const longCommand = 'npm test -- --grep "some long test name that goes on"';
  const bashLine = JSON.stringify({
    type: 'assistant',
    timestamp: 't2',
    message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: longCommand } }] },
  });
  const [bashEntry] = parseLogLine(bashLine);
  assert.equal(bashEntry.tool.target, longCommand.slice(0, 40) + '...');
  assert.equal(bashEntry.text, 'Bash ' + longCommand.slice(0, 40) + '...');

  const taskLine = JSON.stringify({
    type: 'assistant',
    timestamp: 't3',
    message: {
      content: [{ type: 'tool_use', name: 'Task', input: { description: 'review the diff' } }],
    },
  });
  const [taskEntry] = parseLogLine(taskLine);
  assert.equal(taskEntry.tool.target, 'review the diff');
  assert.equal(taskEntry.text, 'Task review the diff');
});

test('tool_result content is truncated to ~200 chars', () => {
  const longResult = 'x'.repeat(250);
  const line = JSON.stringify({
    type: 'user',
    timestamp: 't4',
    message: {
      content: [{ type: 'tool_result', content: longResult }],
    },
  });

  const [entry] = parseLogLine(line);
  assert.equal(entry.kind, 'tool_result');
  assert.equal(entry.text, 'x'.repeat(200) + '…');
});

test('tool_result content as concatenated text blocks', () => {
  const line = JSON.stringify({
    type: 'user',
    timestamp: 't5',
    message: {
      content: [
        {
          type: 'tool_result',
          content: [{ type: 'text', text: 'part one' }, { type: 'text', text: 'part two' }],
        },
      ],
    },
  });

  const [entry] = parseLogLine(line);
  assert.equal(entry.text, 'part one\npart two');
});

test('plain user message (string content)', () => {
  const line = JSON.stringify({
    type: 'user',
    timestamp: 't6',
    message: { content: 'please continue' },
  });

  const entries = parseLogLine(line);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'user');
  assert.equal(entries[0].text, 'please continue');
});

test('sidechain flag reflects isSidechain', () => {
  const line = JSON.stringify({
    type: 'assistant',
    timestamp: 't7',
    isSidechain: true,
    message: { content: [{ type: 'text', text: 'hi' }] },
  });

  const [entry] = parseLogLine(line);
  assert.equal(entry.sidechain, true);
});

test('garbage/unknown lines return an empty array', () => {
  assert.deepEqual(parseLogLine('not json {{{'), []);
  assert.deepEqual(parseLogLine(''), []);
  assert.deepEqual(parseLogLine(JSON.stringify({ type: 'system' })), []);
  assert.deepEqual(
    parseLogLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'redacted_thinking' }] } })),
    [],
  );
});

test('text is truncated to 2000 chars with an ellipsis', () => {
  const longText = 'y'.repeat(2100);
  const line = JSON.stringify({
    type: 'assistant',
    timestamp: 't8',
    message: { content: [{ type: 'text', text: longText }] },
  });

  const [entry] = parseLogLine(line);
  assert.equal(entry.text.length, 2001);
  assert.equal(entry.text, 'y'.repeat(2000) + '…');
});

test('readLogTail respects maxEntries and returns the last N in file order', () => {
  const lines = [];
  for (let i = 0; i < 5; i++) {
    lines.push(
      JSON.stringify({
        type: 'assistant',
        timestamp: `t${i}`,
        message: { content: [{ type: 'text', text: `message ${i}` }] },
      }),
    );
  }
  const { dir, file } = writeTranscript(lines);

  try {
    const tail = readLogTail(file, 2);
    assert.equal(tail.length, 2);
    assert.equal(tail[0].text, 'message 3');
    assert.equal(tail[1].text, 'message 4');
  } finally {
    cleanup(dir);
  }
});

test('readLogTail returns [] for a missing file', () => {
  assert.deepEqual(readLogTail(path.join(os.tmpdir(), 'office-viz-does-not-exist.jsonl')), []);
});
