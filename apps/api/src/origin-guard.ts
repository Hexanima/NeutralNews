import type { IncomingMessage, ServerResponse } from "node:http";

import type { ApiConfig } from "./config.js";

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const sendForbidden = (response: ServerResponse) => {
  response.writeHead(403, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "Forbidden" }));
};

const isAllowedOrigin = (origin: string, config: ApiConfig): boolean => {
  try {
    const parsed = new URL(origin);

    return (
      parsed.origin === origin &&
      config.allowedOrigins.includes(origin)
    );
  } catch {
    return false;
  }
};

export const handleOriginGuard = (
  request: IncomingMessage,
  response: ServerResponse,
  config: ApiConfig,
): boolean => {
  if (!unsafeMethods.has(request.method ?? "")) {
    return false;
  }

  const origin = request.headers.origin;

  if (typeof origin !== "string" || !isAllowedOrigin(origin, config)) {
    sendForbidden(response);
    return true;
  }

  return false;
};
