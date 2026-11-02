import { selectProcedure } from './index.mjs';

function publicGuidance(record) {
  return Object.freeze({
    id: record.id,
    version: record.version,
    task: record.task,
    toolVersion: record.toolVersion,
    steps: Object.freeze([...record.steps]),
    constraints: Object.freeze([...record.constraints])
  });
}

export function createIntelligenceHost({
  procedures,
  approvals
}) {
  if (!Array.isArray(procedures)) {
    throw new TypeError('procedures must be an array');
  }

  if (!Array.isArray(approvals)) {
    throw new TypeError('approvals must be an array');
  }

  // Host-owned copies prevent subsequent caller-side mutation.
  const trustedProcedures = structuredClone(procedures);
  const trustedApprovals = structuredClone(approvals);

  return Object.freeze({
    requestGuidance(query) {
      const selection = selectProcedure(
        trustedProcedures,
        query,
        { approvals: trustedApprovals }
      );

      if (selection.status !== 'SELECTED') {
        return {
          status: selection.status,
          guidance: null,
          inspected: selection.inspected
        };
      }

      return {
        status: 'SELECTED',
        guidance: publicGuidance(selection.selected),
        inspected: selection.inspected
      };
    }
  });
}
