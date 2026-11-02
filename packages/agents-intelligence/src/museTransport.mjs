import { spawn } from 'node:child_process';
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
export function createMuseTransport({
  executable = 'muse',
  model = 'muse-spark-1.3',
  reasoningEffort = 'high',
  workspace,
  timeoutMs = 120000,
  maxModelSteps = 2,
  enabled = false
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
      const execution = await new Promise((resolve, reject) => {
        const child = spawn(executable, args, {
          shell: false,
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

