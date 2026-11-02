import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
  buildMuseInvocation,
  createMuseTransport,
  defaultWindowsMusePath
} from '../src/museTransport.mjs';

const COMSPEC = 'C:\\Windows\\System32\\cmd.exe';
const LOCALAPPDATA = 'C:\\Users\\test user\\AppData\\Local';
const SHORT_PATH =
  'C:\\Users\\TESTUS~1\\AppData\\Local\\Programs\\muse\\muse.cmd';

function windowsEnv() {
  return {
    LOCALAPPDATA,
    ComSpec: COMSPEC,
    PATH: ''
  };
}

test('launcher resolves the installed muse.cmd, never bare muse', () => {
  const env = windowsEnv();
  const installed = defaultWindowsMusePath(env);
  assert.ok(installed);
  assert.ok(installed.endsWith('muse.cmd'));

  const invocation = buildMuseInvocation({
    executable: 'muse',
    args: ['exec', '--provider', 'meta'],
    platform: 'win32',
    env,
    exists: candidate => candidate === installed,
    run: () => {
      throw new Error('no short path');
    },
    comSpec: COMSPEC
  });

  assert.equal(invocation.command, COMSPEC);
  assert.equal(invocation.resolvedExecutable, installed);
  const commandLine = invocation.commandArgs[3];
  assert.ok(commandLine.includes(`"${installed}"`));
  assert.ok(!commandLine.startsWith('"muse"'));
  assert.ok(!commandLine.includes('.muse-launcher.ps1'));
});

test('launcher prefers the 8.3 short path when the long path has spaces', () => {
  const env = windowsEnv();
  const installed = defaultWindowsMusePath(env);
  assert.ok(installed.includes(' '));

  const invocation = buildMuseInvocation({
    executable: 'muse',
    args: ['exec'],
    platform: 'win32',
    env,
    exists: () => true,
    run: () => SHORT_PATH,
    comSpec: COMSPEC
  });

  assert.equal(invocation.resolvedExecutable, SHORT_PATH);
  assert.ok(invocation.commandArgs[3].includes(`"${SHORT_PATH}"`));
  assert.ok(!invocation.commandArgs[3].includes('.muse-launcher.ps1'));
});

test('launcher falls back to the quoted long path when short-path expansion fails', () => {
  const env = windowsEnv();
  const installed = defaultWindowsMusePath(env);

  const invocation = buildMuseInvocation({
    executable: 'muse',
    args: ['exec'],
    platform: 'win32',
    env,
    exists: candidate => candidate === installed,
    run: () => {
      throw new Error('short path unavailable');
    },
    comSpec: COMSPEC
  });

  assert.equal(invocation.resolvedExecutable, installed);
  assert.ok(invocation.commandArgs[3].includes(`"${installed}"`));
});

test('decide() spawns the resolved absolute muse.cmd with all CLI args intact', async () => {
  const env = windowsEnv();
  const installed = defaultWindowsMusePath(env);
  const captured = {};

  const decision = JSON.stringify({
    type: 'action',
    tool: 'readOrder',
    args: { id: 'ORD-001' }
  });
  const stdout = JSON.stringify({
    record_type: 'event',
    payload_type: 'run.terminal.completed',
    payload: { kind: 'run_terminal', terminal: 'completed', text: decision }
  });

  function fakeSpawn(command, commandArgs, options) {
    captured.command = command;
    captured.commandArgs = commandArgs;
    captured.options = options;
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from(stdout));
      child.emit('close', 0);
    });
    return child;
  }

  const transport = createMuseTransport({
    workspace: process.cwd(),
    enabled: true,
    launcher: {
      platform: 'win32',
      env,
      exists: () => true,
      run: () => SHORT_PATH,
      comSpec: COMSPEC,
      spawn: fakeSpawn
    }
  });

  const result = await transport({
    messages: [{ role: 'user', content: 'decide' }]
  });

  assert.equal(result.decision.tool, 'readOrder');
  assert.equal(captured.command, COMSPEC);
  assert.deepEqual(captured.commandArgs.slice(0, 3), ['/d', '/s', '/c']);
  const commandLine = captured.commandArgs[3];
  assert.ok(commandLine.includes(`"${SHORT_PATH}"`));
  assert.ok(!commandLine.startsWith('"muse"'));
  assert.ok(!commandLine.includes('.muse-launcher.ps1'));
  for (const token of [
    '"exec"',
    '"--provider"',
    '"meta"',
    '"--model"',
    '"--disable-shell"',
    '"--disable-write"',
    '"--disable-web-tools"',
    '"--disable-reminders"',
    '"--disable-request-user-input"',
    '"--no-foreign-personal-context"',
    '"--no-session-log"',
    '"--approval-mode"',
    '"never"',
    '"--no-parallel-tool-calls"',
    '"--workspace"'
  ]) {
    assert.ok(
      commandLine.includes(token),
      `expected command line to contain ${token}`
    );
  }
  assert.equal(captured.options.shell, false);
  assert.equal(captured.options.windowsVerbatimArguments, true);
  assert.ok(installed.includes(' '));
});
