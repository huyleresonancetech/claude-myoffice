#!/usr/bin/env node
// Idempotent installer: registers office-viz's emit.js as a Claude Code hook
// command in settings.json, without touching any other settings the user has.
'use strict';

const fs = require('fs');
const path = require('path');
const schema = require('./schema.js');

function parseArgs(argv) {
  const args = { settings: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--settings') {
      args.settings = argv[++i];
    } else if (argv[i] === '--dry-run') {
      args.dryRun = true;
    }
  }
  return args;
}

function readSettings(settingsPath) {
  if (!fs.existsSync(settingsPath)) return {};
  const raw = fs.readFileSync(settingsPath, 'utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function isOurs(hook) {
  if (!hook || typeof hook.command !== 'string') return false;
  const stripped = hook.command.replace(/"/g, '').trim();
  return hook.command.includes('office-viz') && stripped.endsWith('emit.js');
}

function sameMatcher(a, b) {
  const norm = (m) => (m === undefined || m === null ? undefined : m);
  return norm(a) === norm(b);
}

// Inserts/updates our command inside settings.hooks[eventName], scoped to the
// matcher-group matching `matcher` (undefined = matcherless event). Never
// touches other command entries or other settings keys.
function upsertHook(settings, eventName, matcher, command) {
  if (!settings.hooks || typeof settings.hooks !== 'object') settings.hooks = {};
  if (!Array.isArray(settings.hooks[eventName])) settings.hooks[eventName] = [];
  const groups = settings.hooks[eventName];

  let group = groups.find((g) => sameMatcher(g.matcher, matcher));
  if (!group) {
    group = matcher !== undefined ? { matcher, hooks: [] } : { hooks: [] };
    groups.push(group);
  }
  if (!Array.isArray(group.hooks)) group.hooks = [];

  const idx = group.hooks.findIndex(isOurs);
  if (idx === -1) {
    group.hooks.push({ type: 'command', command });
    return 'installed';
  }
  if (group.hooks[idx].command === command) {
    return 'unchanged';
  }
  group.hooks[idx] = { type: 'command', command };
  return 'updated';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const settingsPath = args.settings
    ? path.resolve(args.settings)
    : path.join(schema.configDir(), 'settings.json');

  let settings;
  try {
    settings = readSettings(settingsPath);
  } catch (err) {
    console.error(`office-viz: could not parse ${settingsPath}: ${err.message}`);
    process.exit(1);
  }

  const emitPath = path.resolve(__dirname, 'emit.js');
  const command = `node "${emitPath}"`;

  const results = [
    upsertHook(settings, 'PreToolUse', 'Task', command),
    upsertHook(settings, 'PostToolUse', 'Task|Edit|Write|Bash', command),
    upsertHook(settings, 'SessionStart', undefined, command),
    upsertHook(settings, 'SessionEnd', undefined, command),
    upsertHook(settings, 'SubagentStop', undefined, command),
    upsertHook(settings, 'Stop', undefined, command),
  ];

  const counts = { installed: 0, updated: 0, unchanged: 0 };
  for (const r of results) counts[r]++;

  const json = JSON.stringify(settings, null, 2);

  if (args.dryRun) {
    console.log(json);
    return;
  }

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, json + '\n');

  if (counts.installed === 0 && counts.updated === 0) {
    console.log(`office-viz hooks: already up to date (${settingsPath})`);
  } else {
    console.log(
      `office-viz hooks: ${counts.installed} installed, ${counts.updated} updated, ${counts.unchanged} unchanged (${settingsPath})`
    );
  }
}

main();
