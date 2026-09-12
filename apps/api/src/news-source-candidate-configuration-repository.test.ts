import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isOk } from "app-domain";
import { afterEach, describe, expect, it } from "vitest";

import { createJsonNewsSourceConfigurationRepository } from "./news-source-configuration-repository.js";

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), "neutralnews-candidates-"));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("news source candidate configuration repository", () => {
  it("records a domain once and refreshes only its last appearance on rediscovery", async () => {
    const directory = await createTemporaryDirectory();
    const repository = createJsonNewsSourceConfigurationRepository(directory);

    const before = await repository.getEffectiveConfiguration();
    const sourceCount = isOk(before) ? before.value.sources.length : 0;

    const created = await repository.recordDiscoveredCandidates({
      domains: ["Noticias.Example.", "noticias.example"],
      seenAt: "2026-09-06T12:00:00.000Z",
    });

    expect(isOk(created)).toBe(true);
    if (!isOk(created)) {
      return;
    }
    expect(created.value.sources).toHaveLength(sourceCount);
    expect(created.value.candidates).toEqual([
      expect.objectContaining({
        domain: "noticias.example",
        orientation: "sin_clasificar",
        active: false,
        approvalStatus: "pending_review",
        firstSeenAt: "2026-09-06T12:00:00.000Z",
        lastSeenAt: "2026-09-06T12:00:00.000Z",
      }),
    ]);

    const rediscovered = await repository.recordDiscoveredCandidates({
      domains: ["NOTICIAS.EXAMPLE"],
      seenAt: "2026-09-07T15:30:00.000Z",
    });

    expect(isOk(rediscovered)).toBe(true);
    if (isOk(rediscovered)) {
      expect(rediscovered.value.candidates).toEqual([
        expect.objectContaining({
          domain: "noticias.example",
          firstSeenAt: "2026-09-06T12:00:00.000Z",
          lastSeenAt: "2026-09-07T15:30:00.000Z",
        }),
      ]);
      expect(rediscovered.value.configurationVersion).toBe(3);
    }
  });
});
