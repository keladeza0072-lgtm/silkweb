import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

export const DECISION_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['type', 'tool', 'args'],
  properties: {
    type: {
      type: 'string',
      enum: ['action', 'finish']
    },
    tool: {
      type: ['string', 'null']
    },
    args: {
      type: ['object', 'null'],
      additionalProperties: true
    }
  }
});

export function parseMuseDecision(value) {
  if (typeof value === 'string') {
    value = JSON.parse(value);
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Muse decision');
  }

  if (value.type === 'finish') {
    return { type: 'finish' };
  }

  if (
    value.type !== 'action' ||
    !['readOrder', 'resolveOrder', 'writeAudit'].includes(value.tool) ||
    !value.args ||
    typeof value.args !== 'object' ||
    Array.isArray(value.args)
  ) {
    throw new Error('Invalid Muse action');
  }

  return {
    type: 'action',
    tool: value.tool,
    args: value.args
  };
}

export function extractMuseOutput(stdout) {
  const events = [];

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;

    try {
      events.push(JSON.parse(line));
    } catch {
      // Ignore diagnostic lines outside the JSONL stream.
    }
  }

  const candidates = [];
  const outputChunks = [];
  const usage = [];

  for (const event of events) {
    if (
      event.payload_type === 'run.output.delta' &&
      typeof event.payload?.text === 'string'
    ) {
      outputChunks.push(event.payload.text);
    }

    if (
      event.payload_type === 'run.terminal.completed' &&
      typeof event.payload?.text === 'string'
    ) {
      candidates.push(event.payload.text);
    }

    if (
      event.payload_type === 'run.usage' &&
      event.payload?.kind === 'run_usage'
    ) {
      usage.push(event.payload);
    }

    // Compatibility with existing synthetic test fixtures.
    if (event.type === 'result' && event.result !== undefined) {
      candidates.push(event.result);
    }

    if (event.type === 'message' && event.role === 'assistant') {
      candidates.push(event.content);
    }
  }

  if (outputChunks.length > 0) {
    candidates.push(outputChunks.join(''));
  }

  for (const candidate of candidates.reverse()) {
    try {
      return {
        decision: parseMuseDecision(candidate),
        events,
        usage
      };
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(
    'No valid structured Muse decision found in JSONL output'
  );
}
// The installed Windows launcher (muse.cmd) locates its PowerShell host
// through %~dp0, which expands to the batch file's own directory ONLY when
// the batch file is invoked by an absolute path. Invoking it by bare name
// through cmd.exe /c makes %~dp0 expand against the current working
// directory, so PowerShell receives a -File path to a .muse-launcher.ps1
// that does not exist and the run fails before any inference. Resolution
// below therefore always prefers the real installed muse.cmd path.
export const MUSE_WINDOWS_LAUNCHER = 'muse.cmd';

export function defaultWindowsMusePath(env = process.env) {
  const localAppData =
    env.LOCALAPPDATA ??
    env.LocalAppData ??
    (env.USERPROFILE ? join(env.USERPROFILE, 'AppData', 'Local') : null);

  if (!localAppData) return null;

  return join(localAppData, 'Programs', 'muse', MUSE_WINDOWS_LAUNCHER);
}

export function resolveMuseExecutable({
  executable = 'muse',
  platform = process.platform,
  env = process.env,
  exists = existsSync
} = {}) {
  if (typeof executable !== 'string' || executable.length === 0) {
    throw new Error('A Muse executable is required');
  }

  const looksLikePath =
    executable.includes('/') ||
    executable.includes('\\') ||
    /^[A-Za-z]:/.test(executable) ||
    executable.toLowerCase().endsWith('.cmd') ||
    executable.toLowerCase().endsWith('.exe');

  if (looksLikePath) {
    return executable;
  }

  if (platform !== 'win32') {
    return executable;
  }

  const candidates = [];

  if (env.MUSE_EXECUTABLE) {
    candidates.push(env.MUSE_EXECUTABLE);
  }

  const installed = defaultWindowsMusePath(env);
  if (installed) candidates.push(installed);

  if (env.ProgramFiles) {
    candidates.push(
      join(env.ProgramFiles, 'muse', MUSE_WINDOWS_LAUNCHER)
    );
  }

  const pathValue = env.PATH ?? env.Path ?? '';
  for (const dir of pathValue.split(';')) {
    if (dir.trim()) {
      candidates.push(join(dir.trim(), MUSE_WINDOWS_LAUNCHER));
    }
  }

  for (const candidate of candidates) {
    try {
      if (candidate && exists(candidate)) return candidate;
    } catch {
      // Ignore filesystem probe failures and keep searching.
    }
  }

  return executable;
}

function expandShortPath(longPath, run = execFileSync) {
  const comSpec = process.env.ComSpec || 'cmd.exe';
  const output = run(
    comSpec,
    ['/d', '/c', `for %A in ("${longPath}") do @echo %~sA`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );

  const lines = String(output)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

  return lines.length > 0 ? lines[lines.length - 1] : longPath;
}

// Prefer the Windows 8.3 short path (no spaces) for the installed
// muse.cmd. Any failure falls back to the resolved long path, which the
// caller still quotes, so spaces remain safe either way.
export function toShortPath(
  longPath,
  { platform = process.platform, exists = existsSync, run = execFileSync } = {}
) {
  if (platform !== 'win32') return longPath;
  if (typeof longPath !== 'string' || !longPath.includes(' ')) {
    return longPath;
  }

  try {
    const short = expandShortPath(longPath, run);
    if (short && short !== longPath && exists(short)) return short;
  } catch {
    // Fall through to the quoted long path.
  }

  return longPath;
}

export function quoteWindowsArgument(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

// Builds the Windows process invocation with the RESOLVED absolute
// launcher path as the first token, so %~dp0 inside muse.cmd expands to
// the install directory. Never references a .muse-launcher.ps1 file: the
// installed muse.cmd locates its own launcher.
export function buildMuseCommand({
  executable,
  args = [],
  platform = process.platform,
  comSpec = process.env.ComSpec || 'cmd.exe'
} = {}) {
  if (!executable) {
    throw new Error('A resolved Muse executable is required');
  }

  if (platform !== 'win32') {
    return { command: executable, commandArgs: [...args] };
  }

  const commandLine = [executable, ...args]
    .map(quoteWindowsArgument)
    .join(' ');

  return {
    command: comSpec,
    commandArgs: ['/d', '/s', '/c', `"${commandLine}"`]
  };
}

// Pure launcher construction: resolve the real installed muse.cmd to an
// absolute path (so %~dp0 inside it expands to the install directory),
// prefer its 8.3 short path when the long path contains spaces, and build
// the process invocation. No child process is started here, so tests can
// verify the exact command line without paid inference.
export function buildMuseInvocation({
  executable = 'muse',
  args = [],
  platform = process.platform,
  env = process.env,
  exists = existsSync,
  run = execFileSync,
  comSpec = env.ComSpec || process.env.ComSpec || 'cmd.exe'
} = {}) {
  const resolved = resolveMuseExecutable({
    executable,
    platform,
    env,
    exists
  });
  const launchable = toShortPath(resolved, { platform, exists, run });
  const built = buildMuseCommand({
    executable: launchable,
    args,
    platform,
    comSpec
  });

  return { ...built, resolvedExecutable: launchable };
}

export function createMuseTransport({
  executable = 'muse',
  model = 'muse-spark-1.3',
  reasoningEffort = 'high',
  workspace,
  timeoutMs = 120000,
  maxModelSteps = 2,
  enabled = false,
  launcher = {}
} = {}) {
  if (!workspace) {
    throw new Error('An isolated Muse workspace is required');
  }

  if (!Number.isInteger(maxModelSteps) || maxModelSteps < 1) {
    throw new Error('Invalid maxModelSteps');
  }

  return async function decide({ messages }) {
    if (!enabled) {
      throw new Error(
        'Paid Muse transport disabled. Explicit opt-in required.'
      );
    }

    const directory = await mkdtemp(
      join(tmpdir(), 'silkweb-muse-')
    );

    const promptFile = join(directory, 'prompt.txt');
    const schemaFile = join(directory, 'schema.json');

    const prompt = messages
      .map(message =>
        `${message.role.toUpperCase()}:\n${message.content}`
      )
      .join('\n\n');

    await writeFile(promptFile, prompt, 'utf8');
    await writeFile(
      schemaFile,
      JSON.stringify(DECISION_SCHEMA),
      'utf8'
    );

    const args = [
      'exec',
      '--json',
      '--provider', 'meta',
      '--model', model,
      '--reasoning-effort', reasoningEffort,
      '--prompt-file', promptFile,
      '--output-schema', schemaFile,
      '--workspace', workspace,
      '--max-model-steps', String(maxModelSteps),
      '--disable-shell',
      '--disable-write',
      '--disable-web-tools',
      '--disable-reminders',
      '--disable-request-user-input',
      '--no-foreign-personal-context',
      '--no-session-log',
      '--approval-mode', 'never',
      '--no-parallel-tool-calls'
    ];

    const start = performance.now();

    try {
      const invocation = buildMuseInvocation({
        executable,
        args,
        platform: launcher.platform ?? process.platform,
        env: launcher.env ?? process.env,
        exists: launcher.exists ?? existsSync,
        run: launcher.run ?? execFileSync,
        comSpec: launcher.comSpec
      });
      const command = invocation.command;
      const commandArgs = invocation.commandArgs;
      const spawnFn = launcher.spawn ?? spawn;
      const isWindows =
        (launcher.platform ?? process.platform) === 'win32';

      const execution = await new Promise((resolve, reject) => {
        const child = spawnFn(command, commandArgs, {
          shell: false,
          windowsVerbatimArguments: isWindows,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        });
        let stdout = '';
        let stderr = '';
        let settled = false;

        const timer = setTimeout(() => {
          child.kill();
          if (!settled) {
            settled = true;
            reject(new Error('Muse execution timed out'));
          }
        }, timeoutMs);

        child.stdout.on('data', chunk => {
          stdout += chunk.toString();
        });

        child.stderr.on('data', chunk => {
          stderr += chunk.toString();
        });

        child.on('error', error => {
          clearTimeout(timer);
          if (!settled) {
            settled = true;
            reject(error);
          }
        });

        child.on('close', code => {
          clearTimeout(timer);

          if (!settled) {
            settled = true;
            resolve({ code, stdout, stderr });
          }
        });
      });

      if (execution.code !== 0) {
        throw new Error(
          `Muse exited with code ${execution.code}: ` +
          execution.stderr.slice(-1000)
        );
      }

      const parsed = extractMuseOutput(execution.stdout);

      return {
        decision: parsed.decision,
        elapsedMs: performance.now() - start,
        events: parsed.events,
        usage: parsed.usage
      };
    } finally {
      await rm(directory, {
        recursive: true,
        force: true
      });
    }
  };
}


