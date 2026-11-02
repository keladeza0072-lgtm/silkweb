export function publicToolContracts(toolVersion) {
  if (!['2.0.0', '3.0.0'].includes(toolVersion)) {
    throw new Error(`Unsupported tool version: ${toolVersion}`);
  }

  const resolutionField =
    toolVersion === '3.0.0'
      ? 'resolutionCode'
      : 'resolution';

  return {
    toolVersion,
    tools: {
      readOrder: {
        description: 'Read an order.',
        required: ['id'],
        arguments: {
          id: 'string'
        }
      },
      resolveOrder: {
        description: 'Resolve an eligible order.',
        required: ['id', resolutionField],
        arguments: {
          id: 'string',
          [resolutionField]: 'string'
        }
      },
      writeAudit: {
        description: 'Write an audit record after resolution.',
        required: ['id', 'note'],
        arguments: {
          id: 'string',
          note: 'string'
        }
      }
    }
  };
}
