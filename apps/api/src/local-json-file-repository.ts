import {
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
} from "node:path";
import { randomUUID } from "node:crypto";

import { err, ok, TaggedError, type Result } from "app-domain";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type LocalJsonFileRepositoryError =
  | InvalidPathError
  | CorruptJsonError
  | FileSystemError;

export class InvalidPathError extends TaggedError<"InvalidPath"> {
  public readonly type = "InvalidPath";

  constructor(public readonly relativePath: string) {
    super("InvalidPath");
    this.message = "JSON file path must stay inside the runtime directory";
  }
}

export class CorruptJsonError extends TaggedError<"CorruptJson"> {
  public readonly type = "CorruptJson";

  constructor(
    public readonly filePath: string,
    public readonly recoveryPath: string,
  ) {
    super("CorruptJson");
    this.message = "JSON file is corrupt";
  }
}

export class FileSystemError extends TaggedError<"FileSystemError"> {
  public readonly type = "FileSystemError";

  constructor(
    public readonly operation: "read" | "write",
    public readonly filePath: string,
    cause: unknown,
  ) {
    super("FileSystemError");
    this.message = `Could not ${operation} local JSON file`;
    this.cause = cause;
  }
}

export interface LocalJsonFileRepository {
  readJson: (
    relativePath: string,
  ) => Promise<Result<unknown | null, LocalJsonFileRepositoryError>>;
  writeJson: (
    relativePath: string,
    value: JsonValue,
  ) => Promise<Result<void, LocalJsonFileRepositoryError>>;
}

const writeQueues = new Map<string, Promise<void>>();

const timestampForFileName = () => new Date().toISOString().replace(/\D/g, "");

const isMissingPathError = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException).code === "ENOENT";

const isInsideDirectory = (directory: string, filePath: string): boolean => {
  const pathDifference = relative(directory, filePath);

  return (
    pathDifference === "" ||
    (!pathDifference.startsWith("..") && !isAbsolute(pathDifference))
  );
};

const resolveJsonFilePath = (
  dataDirectory: string,
  requestedPath: string,
): Result<string, InvalidPathError> => {
  const trimmedPath = requestedPath.trim();

  if (trimmedPath === "" || isAbsolute(trimmedPath)) {
    return err(new InvalidPathError(requestedPath));
  }

  const runtimeDirectory = resolve(dataDirectory);
  const filePath = resolve(runtimeDirectory, trimmedPath);

  if (!isInsideDirectory(runtimeDirectory, filePath)) {
    return err(new InvalidPathError(requestedPath));
  }

  return ok(filePath);
};

const ensureRuntimeDirectory = async (dataDirectory: string) => {
  await mkdir(resolve(dataDirectory), { recursive: true });
};

const resolveRealPathIfExists = async (
  filePath: string,
  operation: "read" | "write",
): Promise<Result<string | null, FileSystemError>> => {
  try {
    return ok(await realpath(filePath));
  } catch (error) {
    if (isMissingPathError(error)) {
      return ok(null);
    }

    return err(new FileSystemError(operation, filePath, error));
  }
};

const findExistingParentRealPath = async (
  filePath: string,
  operation: "read" | "write",
): Promise<Result<string | null, FileSystemError>> => {
  let parentPath = filePath;

  while (dirname(parentPath) !== parentPath) {
    const parentRealPath = await resolveRealPathIfExists(parentPath, operation);

    if (!parentRealPath.ok || parentRealPath.value !== null) {
      return parentRealPath;
    }

    parentPath = dirname(parentPath);
  }

  return ok(null);
};

const validateRealPathInsideRuntime = async (
  runtimeDirectory: string,
  filePath: string,
  operation: "read" | "write",
): Promise<Result<"exists" | "missing", LocalJsonFileRepositoryError>> => {
  const realRuntimeDirectory = await resolveRealPathIfExists(
    runtimeDirectory,
    operation,
  );

  if (!realRuntimeDirectory.ok) {
    return realRuntimeDirectory;
  }

  if (realRuntimeDirectory.value === null) {
    return err(new FileSystemError(operation, runtimeDirectory, "missing"));
  }

  const realFilePath = await resolveRealPathIfExists(filePath, operation);

  if (!realFilePath.ok) {
    return realFilePath;
  }

  if (realFilePath.value !== null) {
    return isInsideDirectory(realRuntimeDirectory.value, realFilePath.value)
      ? ok("exists")
      : err(new InvalidPathError(filePath));
  }

  const existingParentRealPath = await findExistingParentRealPath(
    dirname(filePath),
    operation,
  );

  if (!existingParentRealPath.ok) {
    return existingParentRealPath;
  }

  if (
    existingParentRealPath.value !== null &&
    !isInsideDirectory(realRuntimeDirectory.value, existingParentRealPath.value)
  ) {
    return err(new InvalidPathError(filePath));
  }

  return ok("missing");
};

const writeJsonAtomically = async (filePath: string, value: JsonValue) => {
  const targetDirectory = dirname(filePath);
  await mkdir(targetDirectory, { recursive: true });

  const temporaryFilePath = resolve(
    targetDirectory,
    `${basename(filePath)}.tmp-${process.pid}-${randomUUID()}`,
  );

  let shouldRemoveTemporaryFile = true;
  const fileHandle = await open(temporaryFilePath, "wx");

  try {
    await fileHandle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fileHandle.sync();
  } finally {
    await fileHandle.close();
  }

  try {
    await rename(temporaryFilePath, filePath);
    shouldRemoveTemporaryFile = false;
  } finally {
    if (shouldRemoveTemporaryFile) {
      await unlink(temporaryFilePath).catch(() => undefined);
    }
  }
};

const enqueueWrite = async <TResult>(
  filePath: string,
  operation: () => Promise<TResult>,
): Promise<TResult> => {
  const previousWrite = writeQueues.get(filePath) ?? Promise.resolve();
  const queuedWrite = previousWrite.catch(() => undefined).then(operation);
  const queueMarker = queuedWrite.then(
    () => undefined,
    () => undefined,
  );

  writeQueues.set(filePath, queueMarker);

  try {
    return await queuedWrite;
  } finally {
    if (writeQueues.get(filePath) === queueMarker) {
      writeQueues.delete(filePath);
    }
  }
};

export const createLocalJsonFileRepository = (
  dataDirectory: string,
): LocalJsonFileRepository => ({
  readJson: async (relativePath) => {
    const resolvedPath = resolveJsonFilePath(dataDirectory, relativePath);

    if (!resolvedPath.ok) {
      return resolvedPath;
    }

    const filePath = resolvedPath.value;

    try {
      await ensureRuntimeDirectory(dataDirectory);
      const realPathValidation = await validateRealPathInsideRuntime(
        resolve(dataDirectory),
        filePath,
        "read",
      );

      if (!realPathValidation.ok) {
        return realPathValidation;
      }

      if (realPathValidation.value === "missing") {
        return ok(null);
      }

      const fileBody = await readFile(filePath, "utf8");

      try {
        return ok(JSON.parse(fileBody) as unknown);
      } catch (error) {
        if (error instanceof SyntaxError) {
          const recoveryPath =
            `${filePath}.corrupt-${timestampForFileName()}-${randomUUID()}`;
          await writeFile(recoveryPath, fileBody, { flag: "wx" });

          return err(new CorruptJsonError(filePath, recoveryPath));
        }

        return err(new FileSystemError("read", filePath, error));
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return ok(null);
      }

      return err(new FileSystemError("read", filePath, error));
    }
  },

  writeJson: async (relativePath, value) => {
    const resolvedPath = resolveJsonFilePath(dataDirectory, relativePath);

    if (!resolvedPath.ok) {
      return resolvedPath;
    }

    const filePath = resolvedPath.value;

    return enqueueWrite(filePath, async () => {
      try {
        await ensureRuntimeDirectory(dataDirectory);
        const realPathValidation = await validateRealPathInsideRuntime(
          resolve(dataDirectory),
          filePath,
          "write",
        );

        if (!realPathValidation.ok) {
          return realPathValidation;
        }

        await writeJsonAtomically(filePath, value);

        return ok(undefined);
      } catch (error) {
        return err(new FileSystemError("write", filePath, error));
      }
    });
  },
});
