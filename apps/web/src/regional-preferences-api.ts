import type { RegionalPreferencesInput } from "app-domain";

export type RegionalPreferencesFetch = Pick<typeof globalThis, "fetch">["fetch"];

export class RegionalPreferencesRequestError extends Error {
  public readonly status: number;
  public readonly body: unknown;

  constructor(status: number, body: unknown) {
    super("Regional preferences request failed");
    this.name = "RegionalPreferencesRequestError";
    this.status = status;
    this.body = body;
  }
}

export interface SaveRegionalPreferencesDependencies {
  readonly detectTimeZone?: (() => string | undefined) | undefined;
  readonly fetch?: RegionalPreferencesFetch | undefined;
}

const defaultDetectTimeZone = (): string | undefined =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;

const withDetectedTimeZone = (
  preferences: RegionalPreferencesInput,
  detectTimeZone: () => string | undefined,
): RegionalPreferencesInput => {
  if (
    preferences.timeZone.mode !== "automatic" ||
    preferences.timeZone.detectedTimeZone !== undefined
  ) {
    return preferences;
  }

  const detectedTimeZone = detectTimeZone();

  return detectedTimeZone === undefined || detectedTimeZone.trim() === ""
    ? preferences
    : {
        ...preferences,
        timeZone: {
          ...preferences.timeZone,
          detectedTimeZone,
        },
      };
};

const readJsonResponse = async (response: Response): Promise<unknown> => {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
};

export const saveRegionalPreferences = async (
  preferences: RegionalPreferencesInput,
  dependencies: SaveRegionalPreferencesDependencies = {},
): Promise<unknown> => {
  const fetcher = dependencies.fetch ?? globalThis.fetch;
  const body = withDetectedTimeZone(
    preferences,
    dependencies.detectTimeZone ?? defaultDetectTimeZone,
  );
  const response = await fetcher("/api/configuration/regional-preferences", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const responseBody = await readJsonResponse(response);

  if (!response.ok) {
    throw new RegionalPreferencesRequestError(response.status, responseBody);
  }

  return responseBody;
};
