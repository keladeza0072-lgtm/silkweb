import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../apps/mcp-server/dist/index.js', import.meta.url));
const config = {
  schema_version: 1,
  mcp_servers: {
    silkweb: {
      transport: 'stdio',
      command: 'node',
      args: [entry],
      enabled: true,
      mode: 'required'
    }
  }
};
process.stdout.write(JSON.stringify(config, null, 2) + '\n');
process.stderr.write('MERGE this mcp_servers entry into ~/.config/muse/settings.json; preserve other settings.\n');
