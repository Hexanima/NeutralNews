import type { IncomingMessage, ServerResponse } from "node:http";

import {
  createNewsSourceCatalog,
  initialNewsSourceCatalogSnapshot,
  type EffectiveNewsSourceConfiguration,
  type InvalidNewsSourceCatalogError,
  type InvalidNewsSourceConfigurationError,
  type NewsSourceCatalogEntry,
  type NewsSourceCatalogEntrySnapshot,
  type RegionalPreferencesSnapshot,
  toNewsSourceSnapshot,
} from "app-domain";

import type { ApiConfig } from "./config.js";
import {
  validateExternalUrl,
  type ValidateExternalUrlOptions,
} from "./external-url-policy.js";
import { createJsonNewsSourceConfigurationRepository } from "./news-source-configuration-repository.js";

const newsSourcesPath = "/api/configuration/news-sources";
const regionalPreferencesPath = "/api/configuration/regional-preferences";
const restoreDefaultsPath = `${newsSourcesPath}/restore-defaults`;
const maxJsonBodyBytes = 64 * 1024;

interface ErrorResponseBody {
  error: {
    code: string;
    message?: string;
    id?: string;
    details?: unknown;
  };
}

export interface ConfigurationRequestOptions {
  externalUrlValidation?: ValidateExternalUrlOptions | undefined;
}

interface ConfigurationResponseBody {
  schemaVersion: number;
  configurationVersion: number;
  cacheVersion: string;
  sources: readonly NewsSourceCatalogEntry[];
  regionalPreferences: RegionalPreferencesSnapshot;
}

class RequestBodyError extends Error {
  constructor(
    public readonly code: "InvalidJson" | "RequestBodyTooLarge",
    message: string,
  ) {
    super(message);
  }
}

const sendJson = (
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
) => {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
};

const toConfigurationResponse = (
  configuration: EffectiveNewsSourceConfiguration,
): ConfigurationResponseBody => ({
  schemaVersion: configuration.schemaVersion,
  configurationVersion: configuration.configurationVersion,
  cacheVersion: configuration.cacheVersion,
  sources: configuration.sources,
  regionalPreferences: configuration.regionalPreferences,
});

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  let size = 0;
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;

    if (size > maxJsonBodyBytes) {
      throw new RequestBodyError(
        "RequestBodyTooLarge",
        "Request body is too large",
      );
    }

    chunks.push(buffer);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");

  if (rawBody.trim() === "") {
    throw new RequestBodyError("InvalidJson", "Request body must be JSON");
  }

  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw new RequestBodyError("InvalidJson", "Request body must be JSON");
  }
};

const validationDetails = (error: InvalidNewsSourceCatalogError): unknown[] => {
  const details: unknown[] = [];

  for (const catalogError of error.errors) {
    if ("errors" in catalogError) {
      details.push(
        ...catalogError.errors.map((sourceError) => ({
          type: sourceError.type,
          field: sourceError.field,
          value: sourceError.value,
        })),
      );
      continue;
    }

    details.push({
      type: catalogError.type,
      field: catalogError.field,
      value: catalogError.value,
    });
  }

  return details;
};

const configurationValidationDetails = (
  error: InvalidNewsSourceConfigurationError,
): unknown[] =>
  error.errors.map((configurationError) => {
    if ("field" in configurationError) {
      return {
        type: configurationError.type,
        field: configurationError.field,
        value: configurationError.value,
      };
    }

    return {
      type: configurationError.type,
      message: configurationError.message,
    };
  });

const validateEntry = async (
  value: unknown,
  options: ConfigurationRequestOptions = {},
): Promise<NewsSourceCatalogEntrySnapshot | ErrorResponseBody> => {
  const catalog = createNewsSourceCatalog({ schemaVersion: 1, sources: [value] });

  if (!catalog.ok) {
    return {
      error: {
        code: "InvalidNewsSource",
        message: catalog.error.message,
        details: validationDetails(catalog.error),
      },
    };
  }

  const [entry] = catalog.value.sources;

  if (entry!.discovery.mode === "rss") {
    const externalUrl = await validateExternalUrl(
      entry!.discovery.feedUrl,
      options.externalUrlValidation,
    );

    if (!externalUrl.ok) {
      return {
        error: {
          code: "BlockedExternalUrl",
          message: externalUrl.error.message,
          details: [
            { field: "feedUrl", reason: externalUrl.error.reason },
          ],
        },
      };
    }
  }

  return {
    source: toNewsSourceSnapshot(entry!.source),
    discovery: entry!.discovery,
  };
};
const findEntry = (
  configuration: EffectiveNewsSourceConfiguration,
  id: string,
): NewsSourceCatalogEntry | null =>
  configuration.sources.find((entry) => entry.source.id === id) ?? null;

const defaultSourceIds = new Set(
  initialNewsSourceCatalogSnapshot.sources.map((entry) => entry.source.id),
);

const sourceIdExists = (
  configuration: EffectiveNewsSourceConfiguration,
  id: string,
): boolean => defaultSourceIds.has(id) || findEntry(configuration, id) !== null;

const sendRepositoryError = (response: ServerResponse) => {
  sendJson(response, 500, {
    error: { code: "ConfigurationStorageError" },
  });
};

const sendBodyError = (response: ServerResponse, error: RequestBodyError) => {
  sendJson(response, 400, {
    error: { code: "InvalidNewsSource", message: error.message, details: [] },
  });
};

const sendNotFound = (response: ServerResponse, id: string) => {
  sendJson(response, 404, {
    error: { code: "NewsSourceNotFound", id },
  });
};

const parseSourceActionPath = (
  pathname: string,
): { id: string; action?: "activate" | "deactivate" } | null => {
  if (!pathname.startsWith(`${newsSourcesPath}/`)) {
    return null;
  }

  const segments = pathname.slice(newsSourcesPath.length + 1).split("/");

  if (segments.length === 1 && segments[0] !== "") {
    return { id: decodeURIComponent(segments[0]!) };
  }

  if (
    segments.length === 2 &&
    segments[0] !== "" &&
    (segments[1] === "activate" || segments[1] === "deactivate")
  ) {
    return {
      id: decodeURIComponent(segments[0]!),
      action: segments[1],
    };
  }

  return null;
};

export const handleConfigurationRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  config?: ApiConfig,
  options: ConfigurationRequestOptions = {},
): Promise<boolean> => {
  const rawUrl = request.url ?? "/";
  const requestUrl = new URL(rawUrl, "http://127.0.0.1");
  const pathname = requestUrl.pathname;

  if (
    pathname !== regionalPreferencesPath &&
    pathname !== newsSourcesPath &&
    !pathname.startsWith(`${newsSourcesPath}/`)
  ) {
    return false;
  }

  if (config === undefined) {
    sendRepositoryError(response);
    return true;
  }

  const repository = createJsonNewsSourceConfigurationRepository(
    config.dataDirectory,
  );

  if (pathname === newsSourcesPath && request.method === "GET") {
    const configuration = await repository.getEffectiveConfiguration();

    if (!configuration.ok) {
      sendRepositoryError(response);
      return true;
    }

    sendJson(response, 200, toConfigurationResponse(configuration.value));
    return true;
  }

  if (pathname === regionalPreferencesPath && request.method === "PUT") {
    let body: unknown;

    try {
      body = await readJsonBody(request);
    } catch (error) {
      sendBodyError(response, error as RequestBodyError);
      return true;
    }

    const saved = await repository.saveRegionalPreferences({
      regionalPreferences: body as never,
    });

    if (!saved.ok) {
      if (saved.error.type === "InvalidNewsSourceConfiguration") {
        sendJson(response, 400, {
          error: {
            code: "InvalidNewsSourceConfiguration",
            message: saved.error.message,
            details: configurationValidationDetails(saved.error),
          },
        });
        return true;
      }

      sendRepositoryError(response);
      return true;
    }

    sendJson(response, 200, toConfigurationResponse(saved.value));
    return true;
  }

  if (pathname === newsSourcesPath && request.method === "POST") {
    let body: unknown;

    try {
      body = await readJsonBody(request);
    } catch (error) {
      sendBodyError(response, error as RequestBodyError);
      return true;
    }

    const entry = await validateEntry(body, options);

    if ("error" in entry) {
      sendJson(response, 400, entry);
      return true;
    }

    const configuration = await repository.getEffectiveConfiguration();

    if (!configuration.ok) {
      sendRepositoryError(response);
      return true;
    }

    if (sourceIdExists(configuration.value, entry.source.id)) {
      sendJson(response, 409, {
        error: { code: "SourceIdAlreadyExists", id: entry.source.id },
      });
      return true;
    }

    const saved = await repository.saveEntry({ entry });

    if (!saved.ok) {
      sendRepositoryError(response);
      return true;
    }

    sendJson(response, 201, toConfigurationResponse(saved.value));
    return true;
  }

  if (pathname === restoreDefaultsPath && request.method === "POST") {
    const restored = await repository.restoreDefaults();

    if (!restored.ok) {
      sendRepositoryError(response);
      return true;
    }

    sendJson(response, 200, toConfigurationResponse(restored.value));
    return true;
  }

  const sourcePath = parseSourceActionPath(pathname);

  if (sourcePath === null) {
    return false;
  }

  if (sourcePath.action === undefined && request.method === "PUT") {
    let body: unknown;

    try {
      body = await readJsonBody(request);
    } catch (error) {
      sendBodyError(response, error as RequestBodyError);
      return true;
    }

    const entry = await validateEntry(body, options);

    if ("error" in entry) {
      sendJson(response, 400, entry);
      return true;
    }

    if (entry.source.id !== sourcePath.id) {
      sendJson(response, 400, {
        error: {
          code: "InvalidNewsSource",
          message: "Path id must match body source id",
          details: [{ field: "id", value: entry.source.id }],
        },
      });
      return true;
    }

    const configuration = await repository.getEffectiveConfiguration();

    if (!configuration.ok) {
      sendRepositoryError(response);
      return true;
    }

    if (findEntry(configuration.value, sourcePath.id) === null) {
      sendNotFound(response, sourcePath.id);
      return true;
    }

    const saved = await repository.saveEntry({ entry });

    if (!saved.ok) {
      sendRepositoryError(response);
      return true;
    }

    sendJson(response, 200, toConfigurationResponse(saved.value));
    return true;
  }

  if (sourcePath.action === undefined && request.method === "DELETE") {
    const configuration = await repository.getEffectiveConfiguration();

    if (!configuration.ok) {
      sendRepositoryError(response);
      return true;
    }

    if (findEntry(configuration.value, sourcePath.id) === null) {
      sendNotFound(response, sourcePath.id);
      return true;
    }

    const deleted = await repository.deleteSource({ id: sourcePath.id });

    if (!deleted.ok) {
      sendRepositoryError(response);
      return true;
    }

    sendJson(response, 200, toConfigurationResponse(deleted.value));
    return true;
  }

  if (sourcePath.action !== undefined && request.method === "POST") {
    const configuration = await repository.getEffectiveConfiguration();

    if (!configuration.ok) {
      sendRepositoryError(response);
      return true;
    }

    const entry = findEntry(configuration.value, sourcePath.id);

    if (entry === null) {
      sendNotFound(response, sourcePath.id);
      return true;
    }

    const saved = await repository.saveEntry({
      entry: {
        ...entry,
        source: {
          ...entry.source,
          active: sourcePath.action === "activate",
        },
      },
    });

    if (!saved.ok) {
      sendRepositoryError(response);
      return true;
    }

    sendJson(response, 200, toConfigurationResponse(saved.value));
    return true;
  }

  return false;
};
