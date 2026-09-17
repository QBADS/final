import http, { type IncomingMessage, type ServerResponse } from "node:http";

/**
 * A tiny real HTTP server standing in for services/quantum-pipeline in
 * tests, so quantumJobsClient.ts's actual retry/timeout logic runs against
 * real (if fake) network behavior rather than a mocked fetch function -
 * closer to how a downed/slow/misbehaving quantum-pipeline actually looks
 * on the wire.
 */
export type FakeHandler = (req: IncomingMessage, res: ServerResponse, body: string) => void;

export interface FakeQuantumPipeline {
  url: string;
  on: (method: string, path: string, handler: FakeHandler) => void;
  close: () => Promise<void>;
}

export function startFakeQuantumPipeline(): Promise<FakeQuantumPipeline> {
  const routes = new Map<string, FakeHandler>();
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const key = `${req.method} ${req.url}`;
      const handler = routes.get(key);
      if (!handler) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: `no fake route registered for ${key}` }));
        return;
      }
      handler(req, res, body);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        on: (method, path, handler) => routes.set(`${method} ${path}`, handler),
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res());
            // Force-close any hung connections (e.g. a deliberately
            // never-responding timeout test) so close() doesn't wait forever.
            server.closeAllConnections();
          }),
      });
    });
  });
}

export function jsonHandler(status: number, body: unknown): FakeHandler {
  return (_req, res) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
}

export function noResponseHandler(): FakeHandler {
  return () => {
    // Deliberately never respond - exercises the client's own timeout path.
  };
}
