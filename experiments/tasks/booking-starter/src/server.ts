import { createServer } from "node:http";

const port = Number(process.env.PORT ?? "3000");

const server = createServer((_req, res) => {
  res.writeHead(501, {
    "content-type": "application/json"
  });

  res.end(JSON.stringify({
    error: {
      code: "NOT_IMPLEMENTED",
      message: "Application implementation required."
    }
  }));
});

server.listen(port, "127.0.0.1");