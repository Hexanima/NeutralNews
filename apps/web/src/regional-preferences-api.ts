import type { RegionalPreferencesInput } from "app-domain";

export type RegionalPreferencesFetch = Pick<typeof globalThis, "fetch">["fetch"];

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

  return response.json() as Promise<unknown>;
};
