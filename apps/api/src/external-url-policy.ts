import { lookup } from "node:dns/promises";
import { request as requestHttp } from "node:http";
import { request as requestHttps } from "node:https";
import { isIP } from "node:net";
import type { IncomingHttpHeaders } from "node:http";

import { err, ok, TaggedError, type Result } from "app-domain";

export type ExternalUrlPolicyErrorReason =
  | "InvalidUrl"
  | "InvalidProtocol"
  | "BlockedAddress"
  | "ResolutionFailed"
  | "TooManyRedirects"
  | "ResponseTooLarge"
  | "RequestFailed";

const sanitizeErrorUrl = (rawUrl: string): string => {
  try {
    const url = new URL(rawUrl);
    url.username = "";
    url.password = "";
    url.search = "";

    return url.href;
  } catch {
    return "[invalid-url]";
  }
};

export class ExternalUrlPolicyError extends TaggedError<"ExternalUrlPolicyError"> {
  public readonly type = "ExternalUrlPolicyError";
  public readonly url: string;

  constructor(
    public readonly reason: ExternalUrlPolicyErrorReason,
    rawUrl: string,
  ) {
    super("ExternalUrlPolicyError");
    this.url = sanitizeErrorUrl(rawUrl);
    this.message = `External URL rejected: ${reason}`;
  }

  toJSON() {
    return {
      type: this.type,
      reason: this.reason,
      url: this.url,
    };
  }
}

export interface ValidatedExternalUrl {
  readonly url: URL;
  readonly addresses: readonly string[];
}

export type ResolveHostname = (hostname: string) => Promise<readonly string[]>;

export interface ValidateExternalUrlOptions {
  readonly resolveHostname?: ResolveHostname | undefined;
}

export interface ExternalResourceResponse {
  readonly url: string;
  readonly statusCode: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: Uint8Array;
}

export type ExternalResourceRequest = (input: {
  readonly url: URL;
  readonly addresses: readonly string[];
  readonly maxBytes: number;
  readonly signal?: AbortSignal | undefined;
}) => Promise<{
  readonly statusCode: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: Uint8Array;
}>;

export interface RequestExternalResourceOptions extends ValidateExternalUrlOptions {
  readonly maxBytes: number;
  readonly maxRedirects: number;
  readonly signal?: AbortSignal | undefined;
  readonly requestUrl?: ExternalResourceRequest | undefined;
}

const defaultResolveHostname: ResolveHostname = async (hostname) => {
  const addresses = await lookup(hostname, { all: true, verbatim: true });

  return addresses.map((address) => address.address);
};

const normalizeHostname = (hostname: string): string =>
  hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");

const parseIpv4 = (address: string): number | null => {
  const parts = address.split(".");

  if (parts.length !== 4) {
    return null;
  }

  const bytes = parts.map((part) => {
    if (!/^\d+$/.test(part)) {
      return null;
    }

    const value = Number(part);
    return value >= 0 && value <= 255 ? value : null;
  });

  if (bytes.some((byte) => byte === null)) {
    return null;
  }

  return (
    ((bytes[0]! << 24) >>> 0) +
    (bytes[1]! << 16) +
    (bytes[2]! << 8) +
    bytes[3]!
  ) >>> 0;
};

const ipv4InRange = (address: number, base: string, prefix: number): boolean => {
  const baseAddress = parseIpv4(base);

  if (baseAddress === null) {
    return false;
  }

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;

  return (address & mask) === (baseAddress & mask);
};

const blockedIpv4Ranges: readonly [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

const expandIpv6 = (address: string): number[] | null => {
  const withoutZone = address.split("%", 1)[0] ?? "";
  const [head = "", tail = ""] = withoutZone.split("::");
  const hasCompression = withoutZone.includes("::");
  const headParts = head === "" ? [] : head.split(":");
  const tailParts = tail === "" ? [] : tail.split(":");
  const containsIpv4 = withoutZone.includes(".");

  if (containsIpv4) {
    return null;
  }

  if (withoutZone.split("::").length > 2) {
    return null;
  }

  const missing = hasCompression ? 8 - headParts.length - tailParts.length : 0;
  const parts = [
    ...headParts,
    ...Array.from({ length: missing }, () => "0"),
    ...tailParts,
  ];

  if (parts.length !== 8) {
    return null;
  }

  const groups = parts.map((part) => {
    if (!/^[0-9a-f]{1,4}$/i.test(part)) {
      return null;
    }

    return Number.parseInt(part, 16);
  });

  return groups.some((group) => group === null) ? null : (groups as number[]);
};

const ipv4FromMappedIpv6 = (groups: readonly number[]): number | null => {
  const hasMappedPrefix =
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0xffff;

  if (!hasMappedPrefix) {
    return null;
  }

  return (((groups[6]! << 16) >>> 0) + groups[7]!) >>> 0;
};

const isBlockedIpv6 = (address: string): boolean => {
  const groups = expandIpv6(address);

  if (groups === null) {
    return true;
  }

  const mappedIpv4 = ipv4FromMappedIpv6(groups);

  if (mappedIpv4 !== null) {
    return blockedIpv4Ranges.some(([base, prefix]) =>
      ipv4InRange(mappedIpv4, base, prefix),
    );
  }

  const first = groups[0]!;
  const second = groups[1]!;
  const isUnspecified = groups.every((group) => group === 0);
  const isLoopback = groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;

  const isIpv4Ipv6Translation =
    first === 0x0064 &&
    groups[1] === 0xff9b &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0;
  const isLocalIpv4Ipv6Translation =
    first === 0x0064 && groups[1] === 0xff9b && groups[2] === 0x0001;
  const isDiscardOnly =
    first === 0x0100 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0;
  const isProtocolAssignment = first === 0x2001 && (second & 0xfe00) === 0;
  const isSixToFour = first === 0x2002;
  const isSiteLocal = (first & 0xffc0) === 0xfec0;

  return (
    isUnspecified ||
    isLoopback ||
    isIpv4Ipv6Translation ||
    isLocalIpv4Ipv6Translation ||
    isDiscardOnly ||
    isProtocolAssignment ||
    isSixToFour ||
    isSiteLocal ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xff00) === 0xff00 ||
    (first === 0x2001 && second === 0x0db8)
  );
};

const isBlockedAddress = (address: string): boolean => {
  if (isIP(address) === 4) {
    const ipv4 = parseIpv4(address);

    return (
      ipv4 === null ||
      blockedIpv4Ranges.some(([base, prefix]) => ipv4InRange(ipv4, base, prefix))
    );
  }

  if (isIP(address) === 6) {
    return isBlockedIpv6(address);
  }

  return true;
};

const isBlockedHostname = (hostname: string): boolean => {
  const normalized = normalizeHostname(hostname);

  return normalized === "localhost" || normalized.endsWith(".localhost");
};

export const validateExternalUrl = async (
  rawUrl: string,
  options: ValidateExternalUrlOptions = {},
): Promise<Result<ValidatedExternalUrl, ExternalUrlPolicyError>> => {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    return err(new ExternalUrlPolicyError("InvalidUrl", rawUrl));
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return err(new ExternalUrlPolicyError("InvalidProtocol", rawUrl));
  }

  const hostname = normalizeHostname(url.hostname);

  if (isBlockedHostname(hostname)) {
    return err(new ExternalUrlPolicyError("BlockedAddress", rawUrl));
  }

  const literalAddress = isIP(hostname) === 0 ? null : hostname;
  const addresses =
    literalAddress === null
      ? await (options.resolveHostname ?? defaultResolveHostname)(hostname).catch(
          () => null,
        )
      : [literalAddress];

  if (addresses === null || addresses.length === 0) {
    return err(new ExternalUrlPolicyError("ResolutionFailed", rawUrl));
  }

  if (addresses.some(isBlockedAddress)) {
    return err(new ExternalUrlPolicyError("BlockedAddress", rawUrl));
  }

  return ok({ url, addresses });
};

const getHeader = (
  headers: IncomingHttpHeaders,
  name: string,
): string | undefined => {
  const value = headers[name.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
};

const defaultRequestUrl: ExternalResourceRequest = ({
  url,
  addresses,
  maxBytes,
  signal,
}) =>
  new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? requestHttps : requestHttp)(
      url,
      {
        lookup: (_hostname, _options, callback) => {
          callback(null, addresses[0]!, isIP(addresses[0]!) as 4 | 6);
        },
        signal,
      },
      (response) => {
        let size = 0;
        const chunks: Buffer[] = [];

        response.on("data", (chunk: Buffer) => {
          size += chunk.byteLength;

          if (size > maxBytes) {
            request.destroy(
              new ExternalUrlPolicyError("ResponseTooLarge", url.href),
            );
            return;
          }

          chunks.push(chunk);
        });

        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );

    request.on("error", reject);
    request.end();
  });

const isRedirectStatus = (statusCode: number): boolean =>
  statusCode >= 300 && statusCode <= 399;

export const requestExternalResource = async (
  rawUrl: string,
  options: RequestExternalResourceOptions,
): Promise<Result<ExternalResourceResponse, ExternalUrlPolicyError>> => {
  const requestUrl = options.requestUrl ?? defaultRequestUrl;
  let nextUrl = rawUrl;

  for (let redirects = 0; ; redirects += 1) {
    const validated = await validateExternalUrl(nextUrl, {
      resolveHostname: options.resolveHostname,
    });

    if (!validated.ok) {
      return validated;
    }

    let response: Awaited<ReturnType<ExternalResourceRequest>>;

    try {
      response = await requestUrl({
        url: validated.value.url,
        addresses: validated.value.addresses,
        maxBytes: options.maxBytes,
        signal: options.signal,
      });
    } catch (error) {
      if (
        error instanceof ExternalUrlPolicyError &&
        error.reason === "ResponseTooLarge"
      ) {
        return err(error);
      }

      return err(new ExternalUrlPolicyError("RequestFailed", nextUrl));
    }

    if (response.body.byteLength > options.maxBytes) {
      return err(new ExternalUrlPolicyError("ResponseTooLarge", nextUrl));
    }

    const location = getHeader(response.headers, "location");

    if (!isRedirectStatus(response.statusCode) || location === undefined) {
      return ok({
        url: validated.value.url.href,
        statusCode: response.statusCode,
        headers: response.headers,
        body: response.body,
      });
    }

    if (redirects >= options.maxRedirects) {
      return err(new ExternalUrlPolicyError("TooManyRedirects", nextUrl));
    }

    try {
      nextUrl = new URL(location, validated.value.url).href;
    } catch {
      return err(new ExternalUrlPolicyError("InvalidUrl", location));
    }
  }
};
