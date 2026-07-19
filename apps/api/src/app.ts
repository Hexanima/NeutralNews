import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import {
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

import { isOk, neutralNewsReadinessUseCase } from "app-domain";

import { loadApiConfig, type ApiConfig } from "./config.js";
export { ConfigurationError, loadApiConfig } from "./config.js";

export interface HealthResponse {
  app: "neutral-news";
  domain: "ready" | "error";
  aiProvider: "not_configured";
}

export interface AppOptions {
  staticRoot?: string;
  config?: ApiConfig;
}

type RequestEventSource =
  | Pick<IncomingMessage, "on" | "off">
  | Pick<EventTarget, "addEventListener" | "removeEventListener">;

interface StartAppOptions {
  createServer?: () => {
    listen: (
      port: number,
      hostname: string,
      listeningListener?: () => void,
    ) => unknown;
  };
  environment?: NodeJS.ProcessEnv;
}

const defaultStaticRoot = fileURLToPath(
  new URL("../../web/dist/", import.meta.url),
);

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

export const createHealthResponse = async (
  config?: Pick<ApiConfig, "aiProviderStatus">,
): Promise<HealthResponse> => {
  const result = await neutralNewsReadinessUseCase.execute(undefined, undefined);

  return {
    app: "neutral-news",
    domain: isOk(result) ? "ready" : "error",
    aiProvider: config?.aiProviderStatus ?? "not_configured",
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

const sendFile = (
  response: ServerResponse,
  statusCode: number,
  filePath: string,
  body: Buffer,
) => {
  response.writeHead(statusCode, {
    "content-type":
      contentTypes[extname(filePath).toLowerCase()] ??
      "application/octet-stream",
  });
  response.end(body);
};

export const createRequestAbortSignal = (
  request: RequestEventSource,
): AbortSignal => {
  const controller = new AbortController();
  const abortRequest = () => {
    controller.abort();
  };

  if ("addEventListener" in request) {
    request.addEventListener("abort", abortRequest, { once: true });
    return controller.signal;
  }

  request.on("aborted", abortRequest);

  return controller.signal;
};

const isInsideDirectory = (directory: string, filePath: string): boolean => {
  const pathDifference = relative(directory, filePath);

  return (
    pathDifference === "" ||
    (!pathDifference.startsWith("..") && !isAbsolute(pathDifference))
  );
};

const hasPathTraversal = (url: string): boolean => /(?:\.\.|%2e)/i.test(url);

const resolveStaticFilePath = (
  staticRoot: string,
  pathname: string,
): string | null => {
  const decodedPathname = decodeURIComponent(pathname);
  const relativePath =
    decodedPathname === "/" ? "index.html" : decodedPathname.replace(/^\/+/, "");
  const filePath = resolve(staticRoot, relativePath);

  return isInsideDirectory(staticRoot, filePath) ? filePath : null;
};

const serveFrontend = async (
  request: IncomingMessage,
  response: ServerResponse,
  staticRoot: string,
) => {
  if (request.method !== "GET") {
    sendJson(response, 404, { error: "NotFound" });
    return;
  }

  const rawUrl = request.url ?? "/";

  if (hasPathTraversal(rawUrl)) {
    sendJson(response, 404, { error: "NotFound" });
    return;
  }

  const requestUrl = new URL(rawUrl, "http://127.0.0.1");
  const staticFilePath = resolveStaticFilePath(staticRoot, requestUrl.pathname);

  if (staticFilePath === null) {
    sendJson(response, 404, { error: "NotFound" });
    return;
  }

  try {
    const fileStats = await stat(staticFilePath);

    if (fileStats.isFile()) {
      sendFile(response, 200, staticFilePath, await readFile(staticFilePath));
      return;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  if (extname(staticFilePath) !== "") {
    sendJson(response, 404, { error: "NotFound" });
    return;
  }

  const indexPath = join(staticRoot, "index.html");

  sendFile(response, 200, indexPath, await readFile(indexPath));
};

export const requestHandler = async (
  request: IncomingMessage,
  response: ServerResponse,
  options: AppOptions = {},
) => {
  if (
    request.method === "GET" &&
    (request.url === "/health" || request.url === "/api/health")
  ) {
    sendJson(response, 200, await createHealthResponse(options.config));
    return;
  }

  if (request.url?.startsWith("/api/")) {
    sendJson(response, 404, { error: "NotFound" });
    return;
  }

  await serveFrontend(request, response, options.staticRoot ?? defaultStaticRoot);
};

export const createApp = (options: AppOptions = {}) =>
  createServer((request, response) => {
    requestHandler(request, response, options).catch(() => {
      if (!response.headersSent) {
        sendJson(response, 500, { error: "InternalServerError" });
        return;
      }

      response.end();
    });
  });

export const resolveApiHost = (
  environment: NodeJS.ProcessEnv = process.env,
): string => environment.API_HOST ?? "127.0.0.1";

export const resolveApiPort = (
  environment: NodeJS.ProcessEnv = process.env,
): number => Number(environment.API_PORT ?? environment.PORT ?? 3000);

export const startApp = (options: StartAppOptions = {}) => {
  const environment = options.environment ?? process.env;
  const config = loadApiConfig(environment);
  const server = options.createServer?.() ?? createApp({ config });

  server.listen(config.port, config.host, () => {
    console.log(`API listening on http://${config.host}:${config.port}`);
  });

  return server;
};

const isEntrypoint =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  startApp();
}
