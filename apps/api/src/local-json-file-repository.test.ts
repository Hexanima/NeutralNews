import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createLocalJsonFileRepository } from "./local-json-file-repository.js";

const temporaryDirectories: string[] = [];
const mockRecoveryRace = vi.hoisted(() => ({
  enabled: false,
  sourcePath: "",
  replacementBody: "",
}));

vi.mock("node:fs/promises", async (importActual) => {
  const actual =
    await importActual<typeof import("node:fs/promises")>();

  return {
    ...actual,
    copyFile: async (
      source: Parameters<typeof actual.copyFile>[0],
      destination: Parameters<typeof actual.copyFile>[1],
      mode?: Parameters<typeof actual.copyFile>[2],
    ) => {
      if (mockRecoveryRace.enabled && source === mockRecoveryRace.sourcePath) {
        await actual.writeFile(source, mockRecoveryRace.replacementBody);
      }

      return actual.copyFile(source, destination, mode);
    },
    writeFile: async (
      file: Parameters<typeof actual.writeFile>[0],
      data: Parameters<typeof actual.writeFile>[1],
      options?: Parameters<typeof actual.writeFile>[2],
    ) => {
      if (
        mockRecoveryRace.enabled &&
        typeof file === "string" &&
        file.includes(".corrupt-")
      ) {
        await actual.writeFile(
          mockRecoveryRace.sourcePath,
          mockRecoveryRace.replacementBody,
        );
      }

      return actual.writeFile(file, data, options);
    },
  };
});

const createTemporaryDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), "neutralnews-local-json-"));
  temporaryDirectories.push(directory);

  return directory;
};

afterEach(async () => {
  mockRecoveryRace.enabled = false;
  mockRecoveryRace.sourcePath = "";
  mockRecoveryRace.replacementBody = "";

  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("local JSON file repository", () => {
  it("creates the runtime directory automatically before writing", async () => {
    const parentDirectory = await createTemporaryDirectory();
    const runtimeDirectory = join(parentDirectory, "runtime", "data");
    const repository = createLocalJsonFileRepository(runtimeDirectory);

    const result = await repository.writeJson("sources.json", {
      sources: [],
    });

    expect(result.ok).toBe(true);
    expect(
      JSON.parse(await readFile(join(runtimeDirectory, "sources.json"), "utf8")),
    ).toEqual({ sources: [] });
  });

  it("reads null when the JSON file does not exist", async () => {
    const runtimeDirectory = await createTemporaryDirectory();
    const repository = createLocalJsonFileRepository(runtimeDirectory);

    const result = await repository.readJson("cache/feed.json");

    expect(result).toEqual({ ok: true, value: null });
  });

  it("writes JSON atomically and reads it back", async () => {
    const runtimeDirectory = await createTemporaryDirectory();
    const repository = createLocalJsonFileRepository(runtimeDirectory);
    const payload = {
      feed: [{ id: "topic-1", title: "Argentina" }],
      version: 1,
    };

    const writeResult = await repository.writeJson("cache/feed.json", payload);
    const readResult = await repository.readJson("cache/feed.json");
    const rawFile = await readFile(
      join(runtimeDirectory, "cache", "feed.json"),
      "utf8",
    );

    expect(writeResult.ok).toBe(true);
    expect(readResult).toEqual({ ok: true, value: payload });
    expect(rawFile.endsWith("\n")).toBe(true);
  });

  it("rejects paths outside the runtime directory", async () => {
    const runtimeDirectory = await createTemporaryDirectory();
    const repository = createLocalJsonFileRepository(runtimeDirectory);

    const traversalResult = await repository.readJson("../outside.json");
    const absoluteResult = await repository.writeJson(
      join(runtimeDirectory, "absolute.json"),
      {},
    );

    expect(traversalResult.ok).toBe(false);
    expect(absoluteResult.ok).toBe(false);

    if (!traversalResult.ok && !absoluteResult.ok) {
      expect(traversalResult.error.type).toBe("InvalidPath");
      expect(absoluteResult.error.type).toBe("InvalidPath");
    }
  });

  it("keeps a recoverable copy when a JSON file is corrupt", async () => {
    const runtimeDirectory = await createTemporaryDirectory();
    const filePath = join(runtimeDirectory, "sources.json");
    const corruptBody = "{\"sources\":";
    const repository = createLocalJsonFileRepository(runtimeDirectory);

    await writeFile(filePath, corruptBody);

    const result = await repository.readJson("sources.json");

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.type).toBe("CorruptJson");

      if (result.error.type === "CorruptJson") {
        expect(result.error.filePath).toBe(filePath);
        expect(result.error.recoveryPath).toContain("sources.json.corrupt-");
        expect(isAbsolute(result.error.recoveryPath)).toBe(true);
        expect(await readFile(result.error.recoveryPath, "utf8")).toBe(
          corruptBody,
        );
      }
    }
  });

  it("recovers the corrupt content already read when the source file changes", async () => {
    const runtimeDirectory = await createTemporaryDirectory();
    const filePath = join(runtimeDirectory, "sources.json");
    const corruptBody = "{\"sources\":";
    const replacementBody = JSON.stringify({ sources: [] });
    const repository = createLocalJsonFileRepository(runtimeDirectory);

    await writeFile(filePath, corruptBody);
    mockRecoveryRace.enabled = true;
    mockRecoveryRace.sourcePath = filePath;
    mockRecoveryRace.replacementBody = replacementBody;

    const result = await repository.readJson("sources.json");

    expect(result.ok).toBe(false);

    if (!result.ok && result.error.type === "CorruptJson") {
      expect(await readFile(result.error.recoveryPath, "utf8")).toBe(
        corruptBody,
      );
    }
  });

  it("keeps complete JSON after simultaneous writes to the same file", async () => {
    const runtimeDirectory = await createTemporaryDirectory();
    const repository = createLocalJsonFileRepository(runtimeDirectory);
    const writes = Array.from({ length: 20 }, (_, index) => ({
      index,
      body: "x".repeat(5000),
    }));

    const results = await Promise.all(
      writes.map((payload) =>
        repository.writeJson("metrics/current.json", payload),
      ),
    );
    const rawFile = await readFile(
      join(runtimeDirectory, "metrics", "current.json"),
      "utf8",
    );
    const parsedFile = JSON.parse(rawFile) as { index: number; body: string };
    const metricFiles = await readdir(join(runtimeDirectory, "metrics"));

    expect(results.every((result) => result.ok)).toBe(true);
    expect(writes).toContainEqual(parsedFile);
    expect(metricFiles.filter((fileName) => fileName.includes(".tmp-"))).toEqual(
      [],
    );
  });

  it("returns a controlled filesystem error without exposing the JSON payload", async () => {
    const runtimeDirectory = await createTemporaryDirectory();
    const blockedRuntimePath = join(runtimeDirectory, "blocked");
    const repository = createLocalJsonFileRepository(blockedRuntimePath);

    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(blockedRuntimePath, "not a directory");

    const result = await repository.writeJson("secrets.json", {
      value: "top-secret-runtime-value",
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.type).toBe("FileSystemError");
      expect(JSON.stringify(result.error)).not.toContain(
        "top-secret-runtime-value",
      );
    }
  });
});
