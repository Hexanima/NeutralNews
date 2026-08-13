import { describe, expect, it } from "vitest";

import {
  requestExternalResource,
  validateExternalUrl,
} from "./external-url-policy.js";

const resolveTo =
  (...addresses: string[]) =>
  async () =>
    addresses;

describe("external URL policy", () => {
  it("accepts HTTP and HTTPS URLs that resolve to public addresses", async () => {
    await expect(
      validateExternalUrl("https://example.com/feed.xml", {
        resolveHostname: resolveTo("93.184.216.34"),
      }),
    ).resolves.toMatchObject({ ok: true });

    await expect(
      validateExternalUrl("http://example.com/article", {
        resolveHostname: resolveTo("2606:2800:220:1:248:1893:25c8:1946"),
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it.each(["ftp://example.com/feed.xml", "file:///etc/passwd"])(
    "rejects non HTTP URLs: %s",
    async (url) => {
      await expect(validateExternalUrl(url)).resolves.toMatchObject({
        ok: false,
        error: { reason: "InvalidProtocol" },
      });
    },
  );

  it("rejects invalid URLs", async () => {
    await expect(validateExternalUrl("nota-politica")).resolves.toMatchObject({
      ok: false,
      error: { reason: "InvalidUrl" },
    });
  });

  it.each([
    "http://localhost/feed.xml",
    "http://news.localhost/feed.xml",
    "http://127.0.0.1/feed.xml",
    "http://[::1]/feed.xml",
    "http://10.1.2.3/feed.xml",
    "http://172.16.0.1/feed.xml",
    "http://192.168.1.10/feed.xml",
    "http://169.254.1.1/feed.xml",
    "http://100.64.0.1/feed.xml",
    "http://192.0.2.1/feed.xml",
    "http://198.18.0.1/feed.xml",
    "http://203.0.113.1/feed.xml",
    "http://224.0.0.1/feed.xml",
    "http://240.0.0.1/feed.xml",
    "http://[fe80::1]/feed.xml",
    "http://[fc00::1]/feed.xml",
    "http://[2001:db8::1]/feed.xml",
    "http://[ff00::1]/feed.xml",
  ])("rejects local, private, link-local, and reserved hosts: %s", async (url) => {
    await expect(validateExternalUrl(url)).resolves.toMatchObject({
      ok: false,
      error: { reason: "BlockedAddress" },
    });
  });

  it("redacts credentials from serialized URL errors", async () => {
    const result = await validateExternalUrl("https://user:secret@127.0.0.1/feed.xml");

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("user");
  });
  it("rejects hostnames when any resolved address is blocked", async () => {
    await expect(
      validateExternalUrl("https://malicious.example/feed.xml", {
        resolveHostname: resolveTo("93.184.216.34", "127.0.0.1"),
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { reason: "BlockedAddress" },
    });
  });

  it("validates every redirect before following it", async () => {
    const requestedUrls: string[] = [];

    const result = await requestExternalResource("https://example.com/feed.xml", {
      maxBytes: 1024,
      maxRedirects: 2,
      resolveHostname: async (hostname) =>
        hostname === "example.com" ? ["93.184.216.34"] : ["127.0.0.1"],
      requestUrl: async ({ url }) => {
        requestedUrls.push(url.href);

        return {
          statusCode: 302,
          headers: { location: "http://127.0.0.1/internal" },
          body: new Uint8Array(),
        };
      },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { reason: "BlockedAddress" },
    });
    expect(requestedUrls).toEqual(["https://example.com/feed.xml"]);
  });

  it("stops after the configured redirect limit", async () => {
    const result = await requestExternalResource("https://example.com/feed.xml", {
      maxBytes: 1024,
      maxRedirects: 1,
      resolveHostname: resolveTo("93.184.216.34"),
      requestUrl: async () => ({
        statusCode: 302,
        headers: { location: "/next.xml" },
        body: new Uint8Array(),
      }),
    });

    expect(result).toMatchObject({
      ok: false,
      error: { reason: "TooManyRedirects" },
    });
  });

  it("rejects responses that exceed the configured byte limit", async () => {
    const result = await requestExternalResource("https://example.com/feed.xml", {
      maxBytes: 4,
      maxRedirects: 0,
      resolveHostname: resolveTo("93.184.216.34"),
      requestUrl: async () => ({
        statusCode: 200,
        headers: {},
        body: new TextEncoder().encode("too large"),
      }),
    });

    expect(result).toMatchObject({
      ok: false,
      error: { reason: "ResponseTooLarge" },
    });
  });
});
