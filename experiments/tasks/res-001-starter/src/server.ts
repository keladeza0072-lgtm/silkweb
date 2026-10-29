import { createServer } from 'node:http';

/**
 * RES-001 starter only. There is deliberately NO booking implementation.
 * Both agent conditions start from exactly the same bytes.
 * Read the separately supplied RES-001 task contract to implement the API.
 */
const port = Number.parseInt(process.env.PORT ?? '3000', 10);

const server = createServer((_request, response) => {
  response.writeHead(501, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ error: { code: 'NOT_IMPLEMENTED' } }));
});

server.listen(port, '127.0.0.1');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close());
}
