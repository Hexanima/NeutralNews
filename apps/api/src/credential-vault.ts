import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { err, ok, TaggedError, type Result } from "app-domain";

import type {
  JsonValue,
  LocalJsonFileRepository,
  LocalJsonFileRepositoryError,
} from "./local-json-file-repository.js";

export interface CredentialSecretMetadata {
  providerId: string;
  reference: string;
  createdAt: string;
  updatedAt: string;
}

export type CredentialSecretDescription =
  | { configured: false; providerId: string }
  | ({ configured: true } & CredentialSecretMetadata);

export type CredentialVaultError =
  | InvalidCredentialProviderError
  | CredentialNotFoundError
  | CredentialReferenceMismatchError
  | CredentialVaultUnavailableError
  | CredentialVaultStorageError;

export interface CredentialVault {
  saveSecret: (
    providerId: string,
    secret: string,
  ) => Promise<Result<CredentialSecretMetadata, CredentialVaultError>>;
  readSecret: (
    providerId: string,
    reference: string,
  ) => Promise<Result<string, CredentialVaultError>>;
  describeSecret: (
    providerId: string,
  ) => Promise<Result<CredentialSecretDescription, CredentialVaultError>>;
  deleteSecret: (
    providerId: string,
  ) => Promise<Result<void, CredentialVaultError>>;
}

export class InvalidCredentialProviderError extends TaggedError<"InvalidCredentialProvider"> {
  public readonly type = "InvalidCredentialProvider";

  constructor(public readonly providerId: string) {
    super("InvalidCredentialProvider");
    this.message =
      "Credential provider id must use lowercase letters, digits, underscores or hyphens";
  }
}

export class CredentialNotFoundError extends TaggedError<"CredentialNotFound"> {
  public readonly type = "CredentialNotFound";

  constructor(public readonly providerId: string) {
    super("CredentialNotFound");
    this.message = "Credential secret was not found";
  }
}

export class CredentialReferenceMismatchError extends TaggedError<"CredentialReferenceMismatch"> {
  public readonly type = "CredentialReferenceMismatch";

  constructor(public readonly providerId: string) {
    super("CredentialReferenceMismatch");
    this.message = "Credential reference does not match the current secret";
  }
}

export class CredentialVaultUnavailableError extends TaggedError<"CredentialVaultUnavailable"> {
  public readonly type = "CredentialVaultUnavailable";

  constructor() {
    super("CredentialVaultUnavailable");
    this.message = "Credential vault is unavailable";
  }
}

export class CredentialVaultStorageError extends TaggedError<"CredentialVaultStorage"> {
  public readonly type = "CredentialVaultStorage";

  constructor(
    public readonly operation: "read" | "write" | "decrypt",
    cause?: unknown,
  ) {
    super("CredentialVaultStorage");
    this.message = "Credential vault storage operation failed";
    this.cause = cause;
  }

  toJSON() {
    return {
      type: this.type,
      operation: this.operation,
    };
  }
}

interface StoredEncryptedSecret extends CredentialSecretMetadata {
  algorithm: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
}

interface StoredVault {
  version: 1;
  providers: Record<string, StoredEncryptedSecret>;
}

const defaultVaultPath = "credentials/vault.json";
const providerIdPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const algorithm = "aes-256-gcm";
const referencePrefix = "cred_v1_";

const isValidProviderId = (providerId: string): boolean =>
  providerIdPattern.test(providerId);

const validateProviderId = (
  providerId: string,
): Result<string, InvalidCredentialProviderError> =>
  isValidProviderId(providerId)
    ? ok(providerId)
    : err(new InvalidCredentialProviderError(providerId));

const createReference = (): string =>
  `${referencePrefix}${randomBytes(24).toString("base64url")}`;

const nowIso = () => new Date().toISOString();

const metadataFromStoredSecret = ({
  providerId,
  reference,
  createdAt,
  updatedAt,
}: CredentialSecretMetadata): CredentialSecretMetadata => ({
  providerId,
  reference,
  createdAt,
  updatedAt,
});

const timingSafeStringEqual = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);

  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
};

const readMemoryEntry = (
  entries: Map<string, { metadata: CredentialSecretMetadata; secret: string }>,
  providerId: string,
  reference: string,
): Result<{ metadata: CredentialSecretMetadata; secret: string }, CredentialVaultError> => {
  const entry = entries.get(providerId);

  if (entry === undefined) {
    return err(new CredentialNotFoundError(providerId));
  }

  if (!timingSafeStringEqual(entry.metadata.reference, reference)) {
    return err(new CredentialReferenceMismatchError(providerId));
  }

  return ok(entry);
};

export const createInMemoryCredentialVault = (): CredentialVault => {
  const entries = new Map<
    string,
    { metadata: CredentialSecretMetadata; secret: string }
  >();

  return {
    saveSecret: async (providerId, secret) => {
      const validProviderId = validateProviderId(providerId);

      if (!validProviderId.ok) {
        return validProviderId;
      }

      const currentEntry = entries.get(providerId);
      const timestamp = nowIso();
      const metadata: CredentialSecretMetadata = {
        providerId,
        reference: createReference(),
        createdAt: currentEntry?.metadata.createdAt ?? timestamp,
        updatedAt: timestamp,
      };

      entries.set(providerId, { metadata, secret });

      return ok(metadata);
    },

    readSecret: async (providerId, reference) => {
      const validProviderId = validateProviderId(providerId);

      if (!validProviderId.ok) {
        return validProviderId;
      }

      const entry = readMemoryEntry(entries, providerId, reference);

      return entry.ok ? ok(entry.value.secret) : entry;
    },

    describeSecret: async (providerId) => {
      const validProviderId = validateProviderId(providerId);

      if (!validProviderId.ok) {
        return validProviderId;
      }

      const entry = entries.get(providerId);

      return ok(
        entry === undefined
          ? { configured: false, providerId }
          : { configured: true, ...entry.metadata },
      );
    },

    deleteSecret: async (providerId) => {
      const validProviderId = validateProviderId(providerId);

      if (!validProviderId.ok) {
        return validProviderId;
      }

      entries.delete(providerId);

      return ok(undefined);
    },
  };
};

export interface LocalEncryptedCredentialVaultOptions {
  repository: LocalJsonFileRepository;
  key?: string;
  relativePath?: string;
}

const decodeVaultKey = (key: string | undefined): Buffer | null => {
  const trimmedKey = key?.trim();

  if (trimmedKey === undefined || trimmedKey === "") {
    return null;
  }

  const candidates = [
    Buffer.from(trimmedKey, "base64url"),
    Buffer.from(trimmedKey, "base64"),
    /^[a-f0-9]{64}$/i.test(trimmedKey)
      ? Buffer.from(trimmedKey, "hex")
      : Buffer.alloc(0),
  ];

  return candidates.find((candidate) => candidate.length === 32) ?? null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStoredEncryptedSecret = (
  value: unknown,
): value is StoredEncryptedSecret => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.providerId === "string" &&
    typeof value.reference === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    value.algorithm === algorithm &&
    typeof value.iv === "string" &&
    typeof value.tag === "string" &&
    typeof value.ciphertext === "string"
  );
};

const parseStoredVault = (
  value: unknown,
): Result<StoredVault, CredentialVaultStorageError> => {
  if (value === null) {
    return ok({ version: 1, providers: {} });
  }

  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !isRecord(value.providers)
  ) {
    return err(new CredentialVaultStorageError("read"));
  }

  const providers: Record<string, StoredEncryptedSecret> = {};

  for (const [providerId, storedSecret] of Object.entries(value.providers)) {
    if (!isValidProviderId(providerId) || !isStoredEncryptedSecret(storedSecret)) {
      return err(new CredentialVaultStorageError("read"));
    }

    providers[providerId] = storedSecret;
  }

  return ok({ version: 1, providers });
};

const toJsonValue = (vault: StoredVault): JsonValue => ({
  version: vault.version,
  providers: Object.fromEntries(
    Object.entries(vault.providers).map(([providerId, storedSecret]) => [
      providerId,
      {
        providerId: storedSecret.providerId,
        reference: storedSecret.reference,
        createdAt: storedSecret.createdAt,
        updatedAt: storedSecret.updatedAt,
        algorithm: storedSecret.algorithm,
        iv: storedSecret.iv,
        tag: storedSecret.tag,
        ciphertext: storedSecret.ciphertext,
      },
    ]),
  ),
});

const mapRepositoryError = (
  operation: "read" | "write",
  error: LocalJsonFileRepositoryError,
) => new CredentialVaultStorageError(operation, error);

const readVault = async (
  repository: LocalJsonFileRepository,
  relativePath: string,
): Promise<Result<StoredVault, CredentialVaultStorageError>> => {
  const read = await repository.readJson(relativePath);

  if (!read.ok) {
    return err(mapRepositoryError("read", read.error));
  }

  return parseStoredVault(read.value);
};

const writeVault = async (
  repository: LocalJsonFileRepository,
  relativePath: string,
  vault: StoredVault,
): Promise<Result<void, CredentialVaultStorageError>> => {
  const write = await repository.writeJson(relativePath, toJsonValue(vault));

  return write.ok ? ok(undefined) : err(mapRepositoryError("write", write.error));
};

const encryptSecret = (
  key: Buffer,
  metadata: CredentialSecretMetadata,
  secret: string,
): StoredEncryptedSecret => {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, key, iv);
  cipher.setAAD(Buffer.from(`${metadata.providerId}:${metadata.reference}`));
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);

  return {
    ...metadata,
    algorithm,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
};

const decryptSecret = (
  key: Buffer,
  storedSecret: StoredEncryptedSecret,
): Result<string, CredentialVaultStorageError> => {
  try {
    const decipher = createDecipheriv(
      algorithm,
      key,
      Buffer.from(storedSecret.iv, "base64url"),
    );
    decipher.setAAD(
      Buffer.from(`${storedSecret.providerId}:${storedSecret.reference}`),
    );
    decipher.setAuthTag(Buffer.from(storedSecret.tag, "base64url"));

    return ok(
      Buffer.concat([
        decipher.update(Buffer.from(storedSecret.ciphertext, "base64url")),
        decipher.final(),
      ]).toString("utf8"),
    );
  } catch (error) {
    return err(new CredentialVaultStorageError("decrypt", error));
  }
};

const unavailable = <TResult>(): Promise<
  Result<TResult, CredentialVaultUnavailableError>
> => Promise.resolve(err(new CredentialVaultUnavailableError()));

export const createLocalEncryptedCredentialVault = ({
  repository,
  key,
  relativePath = defaultVaultPath,
}: LocalEncryptedCredentialVaultOptions): CredentialVault => {
  const vaultKey = decodeVaultKey(key);
  let mutationQueue = Promise.resolve();

  const enqueueMutation = async <TResult>(
    operation: () => Promise<Result<TResult, CredentialVaultError>>,
  ): Promise<Result<TResult, CredentialVaultError>> => {
    const queuedMutation = mutationQueue.catch(() => undefined).then(operation);
    const queueMarker = queuedMutation.then(
      () => undefined,
      () => undefined,
    );

    mutationQueue = queueMarker;

    try {
      return await queuedMutation;
    } finally {
      if (mutationQueue === queueMarker) {
        mutationQueue = Promise.resolve();
      }
    }
  };

  if (vaultKey === null) {
    return {
      saveSecret: async () => unavailable(),
      readSecret: async () => unavailable(),
      describeSecret: async () => unavailable(),
      deleteSecret: async () => unavailable(),
    };
  }

  return {
    saveSecret: async (providerId, secret) => {
      const validProviderId = validateProviderId(providerId);

      if (!validProviderId.ok) {
        return validProviderId;
      }

      return enqueueMutation(async () => {
        const vault = await readVault(repository, relativePath);

        if (!vault.ok) {
          return vault;
        }

        const currentSecret = vault.value.providers[providerId];
        const timestamp = nowIso();
        const metadata: CredentialSecretMetadata = {
          providerId,
          reference: createReference(),
          createdAt: currentSecret?.createdAt ?? timestamp,
          updatedAt: timestamp,
        };

        vault.value.providers[providerId] = encryptSecret(
          vaultKey,
          metadata,
          secret,
        );

        const write = await writeVault(repository, relativePath, vault.value);

        return write.ok ? ok(metadata) : write;
      });
    },

    readSecret: async (providerId, reference) => {
      const validProviderId = validateProviderId(providerId);

      if (!validProviderId.ok) {
        return validProviderId;
      }

      const vault = await readVault(repository, relativePath);

      if (!vault.ok) {
        return vault;
      }

      const storedSecret = vault.value.providers[providerId];

      if (storedSecret === undefined) {
        return err(new CredentialNotFoundError(providerId));
      }

      if (!timingSafeStringEqual(storedSecret.reference, reference)) {
        return err(new CredentialReferenceMismatchError(providerId));
      }

      return decryptSecret(vaultKey, storedSecret);
    },

    describeSecret: async (providerId) => {
      const validProviderId = validateProviderId(providerId);

      if (!validProviderId.ok) {
        return validProviderId;
      }

      const vault = await readVault(repository, relativePath);

      if (!vault.ok) {
        return vault;
      }

      const storedSecret = vault.value.providers[providerId];

      return ok(
        storedSecret === undefined
          ? { configured: false, providerId }
          : {
              configured: true,
              ...metadataFromStoredSecret(storedSecret),
            },
      );
    },

    deleteSecret: async (providerId) => {
      const validProviderId = validateProviderId(providerId);

      if (!validProviderId.ok) {
        return validProviderId;
      }

      return enqueueMutation(async () => {
        const vault = await readVault(repository, relativePath);

        if (!vault.ok) {
          return vault;
        }

        delete vault.value.providers[providerId];

        return writeVault(repository, relativePath, vault.value);
      });
    },
  };
};
