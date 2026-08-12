// Shared constants for office-viz. Other subtasks require() this module — do not edit
// its exported shape without updating schema.md and every consumer.
'use strict';

const os = require('os');
const path = require('path');

const EVENT_TYPES = Object.freeze({
  SESSION_START: 'session_start',
  SESSION_END: 'session_end',
  AGENT_START: 'agent_start',
  AGENT_ACTIVITY: 'agent_activity',
  AGENT_STOP: 'agent_stop',
  STOP: 'stop',
  RUN: 'run',
});

const ROLES = Object.freeze([
  'scout',
  'planner',
  'implementer',
  'reviewer',
  'tester',
  'analyst',
  'claude', // fallback role when subagent_type is missing/unrecognized
]);

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function stateDir() {
  return path.join(configDir(), 'office-state');
}

function eventsFile(date) {
  return path.join(stateDir(), `events-${date}.jsonl`);
}

module.exports = {
  EVENT_TYPES,
  ROLES,
  configDir,
  stateDir,
  eventsFile,
};
