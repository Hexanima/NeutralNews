import { argon2, createHmac, timingSafeEqual } from "node:crypto";

interface Argon2idHash {
  memory: number;
  passes: number;
  parallelism: number;
  salt: Buffer;
  tag: Buffer;
}

interface SessionPayload {
  issuedAt: number;
  expiresAt: number;
}

const cookieName = "neutralnews_session";
const argon2idHashPattern =
  /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2})$/;
const sessionPayloadPattern = /^(\d+)\.(\d+)$/;

export const sessionLifetimeSeconds = 7 * 24 * 60 * 60;

const parseArgon2idHash = (encodedHash: string): Argon2idHash | null => {
  const match = argon2idHashPattern.exec(encodedHash);

  if (match === null) {
    return null;
  }

  const [, memory, passes, parallelism, salt, tag] = match;
  const parsedMemory = Number(memory);
  const parsedPasses = Number(passes);
  const parsedParallelism = Number(parallelism);
  const parsedSalt = Buffer.from(salt!, "base64");
  const parsedTag = Buffer.from(tag!, "base64");

  if (
    !Number.isSafeInteger(parsedMemory) ||
    !Number.isSafeInteger(parsedPasses) ||
    !Number.isSafeInteger(parsedParallelism) ||
    parsedParallelism < 2 ||
    parsedPasses < 2 ||
    parsedMemory < 8 * parsedParallelism ||
    parsedSalt.byteLength < 8 ||
    parsedTag.byteLength < 5
  ) {
    return null;
  }

  return {
    memory: parsedMemory,
    passes: parsedPasses,
    parallelism: parsedParallelism,
    salt: parsedSalt,
    tag: parsedTag,
  };
};

const deriveArgon2id = (
  password: string,
  hash: Argon2idHash,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    argon2(
      "argon2id",
      {
        message: Buffer.from(password),
        nonce: hash.salt,
        parallelism: hash.parallelism,
        tagLength: hash.tag.byteLength,
        memory: hash.memory,
        passes: hash.passes,
      },
      (error, derivedTag) => {
        if (error !== null) {
          reject(error);
          return;
        }

        resolve(derivedTag);
      },
    );
  });

const sign = (payload: string, secret: string): Buffer =>
  createHmac("sha256", secret).update(payload).digest();

const toTimestamp = (date: Date): number => Math.floor(date.getTime() / 1_000);

export const verifyPassword = async (
  password: string,
  encodedHash: string,
): Promise<boolean> => {
  const hash = parseArgon2idHash(encodedHash);

  if (hash === null) {
    return false;
  }

  return timingSafeEqual(await deriveArgon2id(password, hash), hash.tag);
};

export const createSession = ({
  secret,
  now = new Date(),
}: {
  secret: string;
  now?: Date;
}): string => {
  const issuedAt = toTimestamp(now);
  const payload = `${issuedAt}.${issuedAt + sessionLifetimeSeconds}`;
  const signature = sign(payload, secret).toString("base64url");

  return `${payload}.${signature}`;
};

export const parseSession = ({
  token,
  secret,
  now = new Date(),
}: {
  token: string;
  secret: string;
  now?: Date;
}): SessionPayload | null => {
  const parts = token.split(".");

  if (parts.length !== 3) {
    return null;
  }

  const [issuedAt, expiresAt, encodedSignature] = parts;
  const payload = `${issuedAt}.${expiresAt}`;
  const payloadMatch = sessionPayloadPattern.exec(payload);

  if (payloadMatch === null || encodedSignature === undefined) {
    return null;
  }

  const expectedSignature = sign(payload, secret);
  const receivedSignature = Buffer.from(encodedSignature, "base64url");

  if (
    receivedSignature.byteLength !== expectedSignature.byteLength ||
    !timingSafeEqual(receivedSignature, expectedSignature)
  ) {
    return null;
  }

  const parsedIssuedAt = Number(payloadMatch[1]);
  const parsedExpiresAt = Number(payloadMatch[2]);

  if (
    !Number.isSafeInteger(parsedIssuedAt) ||
    !Number.isSafeInteger(parsedExpiresAt) ||
    parsedExpiresAt !== parsedIssuedAt + sessionLifetimeSeconds ||
    toTimestamp(now) >= parsedExpiresAt
  ) {
    return null;
  }

  return { issuedAt: parsedIssuedAt, expiresAt: parsedExpiresAt };
};

const parseCookies = (cookieHeader: string): Map<string, string> => {
  const cookies = new Map<string, string>();

  for (const cookie of cookieHeader.split(";")) {
    const separatorIndex = cookie.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    cookies.set(
      cookie.slice(0, separatorIndex).trim(),
      cookie.slice(separatorIndex + 1).trim(),
    );
  }

  return cookies;
};

export const hasValidSessionCookie = ({
  cookieHeader,
  secret,
  now = new Date(),
}: {
  cookieHeader: string | undefined;
  secret: string;
  now?: Date;
}): boolean => {
  if (cookieHeader === undefined) {
    return false;
  }

  const token = parseCookies(cookieHeader).get(cookieName);

  return token !== undefined && parseSession({ token, secret, now }) !== null;
};

const cookieAttributes = (secure: boolean): string =>
  `Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;

export const serializeSessionCookie = ({
  token,
  secure,
}: {
  token: string;
  secure: boolean;
}): string =>
  `${cookieName}=${token}; ${cookieAttributes(secure)}; Max-Age=${sessionLifetimeSeconds}`;

export const serializeExpiredSessionCookie = ({
  secure,
}: {
  secure: boolean;
}): string => `${cookieName}=; ${cookieAttributes(secure)}; Max-Age=0`;
