import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isOk, testUseCase } from "app-domain";

export interface HealthResponse {
  app: "clean-architecture-template";
  domain: "ready" | "error";
}

export const createHealthResponse = async (): Promise<HealthResponse> => {
  const result = await testUseCase.execute(undefined, undefined);

  return {
    app: "clean-architecture-template",
    domain: isOk(result) ? "ready" : "error",
  };
};

const sendJson = (
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
) => {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
};

export const requestHandler = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, await createHealthResponse());
    return;
  }

  sendJson(response, 404, { error: "NotFound" });
};

export const createApp = () => createServer(requestHandler);

const isEntrypoint =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const port = Number(process.env.PORT ?? 3000);
  createApp().listen(port, () => {
    console.log(`API listening on http://localhost:${port}`);
  });
}
