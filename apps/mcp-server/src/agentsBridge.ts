import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { discoverRepoRoot, LibrarianError } from './librarian.js';

/**
 * Read-only bridge between MCP tools and the existing agent-procedure
 * intelligence in packages/agents-intelligence.
 *
 * The trust decision always runs in the existing implementation:
 * selectProcedure with the AGENTS-002 library and its digest-bound
 * trust store, plus publicToolContracts for tool-version
 * compatibility. This module validates inputs, bounds responses, and
 * projects the result to a public view. It never executes procedure
 * steps, never performs inference, and never modifies the library.
 *
 * Remote transport note: this server speaks stdio only. A remote MCP
 * endpoint is deliberately not implemented — an unauthenticated
 * public remote MCP endpoint must never be exposed, and no
 * authentication layer exists in this architecture.
 */

export const AGENTS_SRC_REL = 'packages/agents-intelligence/src';
export const AGENTS_INSPECTED_MAX = 100;
export const AGENTS_TASK_MAX_LENGTH = 200;

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

interface ProcedureStep {
  op: string;
  args: Record<string, unknown>;
}

interface ProcedureRecord {
  id: string;
  version: string;
  task: string;
  toolVersion: string;
  steps: ProcedureStep[];
  constraints: string[];
}

interface SelectionInspected {
  id: string | null;
  version: string | null;
  reason: string;
}

interface SelectionResult {
  status: string;
  selected: ProcedureRecord | null;
  inspected: SelectionInspected[];
}

interface AgentsIndexModule {
  selectProcedure: (
    records: unknown[],
    query: { task: string; toolVersion: string },
    trust: unknown,
  ) => SelectionResult;
}

interface AgentsLibraryModule {
  AGENTS002_LIBRARY: ProcedureRecord[];
  AGENTS002_LIBRARY_VERSION: string;
  createAgents002Trust: () => { approvals: unknown[] };
}

interface AgentsContractsModule {
  publicToolContracts: (toolVersion: string) => {
    toolVersion: string;
    tools: Record<string, { required?: unknown }>;
  };
}

interface AgentsModules {
  index: AgentsIndexModule;
  library: AgentsLibraryModule;
  contracts: AgentsContractsModule;
}

const modulesCache = new Map<string, Promise<AgentsModules>>();

/** Load the real agents-intelligence implementation from the checkout. */
export function loadAgentsModules(repoRoot: string): Promise<AgentsModules> {
  const cached = modulesCache.get(repoRoot);
  if (cached) return cached;
  const task = (async (): Promise<AgentsModules> => {
    const base = join(repoRoot, AGENTS_SRC_REL);
    try {
      const [index, library, contracts] = await Promise.all([
        import(pathToFileURL(join(base, 'index.mjs')).href),
        import(pathToFileURL(join(base, 'agents002Library.mjs')).href),
        import(pathToFileURL(join(base, 'publicToolContracts.mjs')).href),
      ]);
      return {
        index: index as AgentsIndexModule,
        library: library as AgentsLibraryModule,
        contracts: contracts as AgentsContractsModule,
      };
    } catch (error: unknown) {
      throw new LibrarianError(
        'AGENTS_LOAD_ERROR',
        `Cannot load agent-procedure intelligence from ${base}: ${String(error)}`,
      );
    }
  })();
  modulesCache.set(repoRoot, task);
  task.catch(() => {
    modulesCache.delete(repoRoot);
  });
  return task;
}

export interface AgentProcedureView {
  id: string;
  version: string;
  task: string;
  toolVersion: string;
  steps: ProcedureStep[];
  constraints: string[];
}

export interface AgentSelection {
  status: string;
  selected: AgentProcedureView | null;
  inspected: SelectionInspected[];
  inspectedTruncated: boolean;
  libraryVersion: string;
  approvalsChecked: number;
  toolContract: { toolVersion: string; requiredResolveArgs: string[] } | null;
  contractNote: string | null;
  note: string;
}

function publicProcedure(record: ProcedureRecord): AgentProcedureView {
  return {
    id: record.id,
    version: record.version,
    task: record.task,
    toolVersion: record.toolVersion,
    steps: record.steps.map((step) => ({ op: step.op, args: { ...step.args } })),
    constraints: [...record.constraints],
  };
}

/**
 * Select the applicable approved agent procedure for one task and
 * tool version. Fail-closed: unknown tasks yield NO_MATCH, revoked
 * procedures are never selected, and unsupported tool versions are
 * reported with no contract. The returned procedure is guidance
 * data only — this server never executes it.
 */
export async function selectAgentProcedure(task: string, toolVersion: string): Promise<AgentSelection> {
  const cleanTask = typeof task === 'string' ? task.trim() : '';
  if (cleanTask.length === 0) {
    throw new LibrarianError('INVALID_INPUT', 'A non-empty task is required.');
  }
  if (cleanTask.length > AGENTS_TASK_MAX_LENGTH) {
    throw new LibrarianError(
      'INVALID_INPUT',
      `Task exceeds ${AGENTS_TASK_MAX_LENGTH} characters; refusing an unbounded query.`,
    );
  }
  if (typeof toolVersion !== 'string' || !VERSION_PATTERN.test(toolVersion)) {
    throw new LibrarianError(
      'INVALID_INPUT',
      `toolVersion must use major.minor.patch form, got ${JSON.stringify(toolVersion)}.`,
    );
  }

  const serverDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = discoverRepoRoot(serverDir);
  const modules = await loadAgentsModules(repoRoot);
  const library = modules.library.AGENTS002_LIBRARY;
  const trust = modules.library.createAgents002Trust();
  const approvalsChecked = Array.isArray(trust?.approvals) ? trust.approvals.length : 0;

  let selection: SelectionResult;
  try {
    selection = modules.index.selectProcedure(library, { task: cleanTask, toolVersion }, trust);
  } catch (error: unknown) {
    throw new LibrarianError(
      'AGENTS_SELECTION_ERROR',
      `Agent-procedure selection rejected the query: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let toolContract: AgentSelection['toolContract'] = null;
  let contractNote: string | null = null;
  try {
    const contracts = modules.contracts.publicToolContracts(toolVersion);
    const required = contracts?.tools?.resolveOrder?.required;
    toolContract = {
      toolVersion: contracts.toolVersion,
      requiredResolveArgs: Array.isArray(required) ? required.filter((entry): entry is string => typeof entry === 'string') : [],
    };
  } catch {
    contractNote =
      `No public tool contract exists for tool version ${JSON.stringify(toolVersion)} ` +
      '(supported: "2.0.0", "3.0.0"). Version compatibility cannot be confirmed.';
  }

  const inspected = (Array.isArray(selection.inspected) ? selection.inspected : [])
    .map((entry) => ({
      id: typeof entry?.id === 'string' ? entry.id : null,
      version: typeof entry?.version === 'string' ? entry.version : null,
      reason: typeof entry?.reason === 'string' ? entry.reason : 'UNKNOWN',
    }))
    .slice(0, AGENTS_INSPECTED_MAX);
  const inspectedTruncated = (selection.inspected?.length ?? 0) > inspected.length;

  if (selection.status === 'SELECTED' && selection.selected) {
    const selected = publicProcedure(selection.selected);
    return {
      status: 'SELECTED',
      selected,
      inspected,
      inspectedTruncated,
      libraryVersion: modules.library.AGENTS002_LIBRARY_VERSION,
      approvalsChecked,
      toolContract,
      contractNote,
      note:
        `Approved procedure ${selected.id}@${selected.version} passed the ` +
        'existing trust store and compatibility checks. Returned as guidance ' +
        'data only; this server never executes procedure steps and performs no inference.',
    };
  }
  return {
    status: selection.status,
    selected: null,
    inspected,
    inspectedTruncated,
    libraryVersion: modules.library.AGENTS002_LIBRARY_VERSION,
    approvalsChecked,
    toolContract,
    contractNote,
    note:
      `No approved procedure matches task ${JSON.stringify(cleanTask)} on tool ` +
      `version ${JSON.stringify(toolVersion)} (selection: ${selection.status}). ` +
      'Revoked procedures are never selected. None was invented to fill the gap.',
  };
}
