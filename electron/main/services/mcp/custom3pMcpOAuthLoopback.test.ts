import { describe, expect, it } from "vitest";
import http from "node:http";
import {
  OAUTH_LOOPBACK_DEFAULT_HOST,
  oauthCallbackHost,
  oauthCallbackPort,
  oauthLoopbackRedirectUrl,
  startOAuthLoopback,
} from "./custom3pMcpOAuthLoopback";

describe("custom3p MCP OAuth loopback residual", () => {
  it("defaults callback port/host", () => {
    expect(oauthCallbackPort(undefined)).toBe(53280);
    expect(oauthCallbackPort({ callbackPort: 54000 })).toBe(54000);
    expect(oauthCallbackHost(undefined)).toBe("127.0.0.1");
    expect(oauthCallbackHost({ callbackHost: "localhost" })).toBe("localhost");
    expect(oauthLoopbackRedirectUrl({ callbackPort: 53280 })).toBe(
      "http://127.0.0.1:53280/callback",
    );
  });

  it("rejects state mismatch and accepts valid code", async () => {
    const port = 53281;
    const loopback = await startOAuthLoopback(
      port,
      OAUTH_LOOPBACK_DEFAULT_HOST,
      (state) => state === "good",
    );
    try {
      // Bad state
      const bad = await new Promise<{ status: number; body: string }>(
        (resolve, reject) => {
          http
            .get(
              `http://127.0.0.1:${port}/callback?code=abc&state=bad`,
              (res) => {
                let body = "";
                res.on("data", (c) => (body += c));
                res.on("end", () =>
                  resolve({ status: res.statusCode ?? 0, body }),
                );
              },
            )
            .on("error", reject);
        },
      );
      expect(bad.status).toBe(400);
      expect(bad.body).toContain("State mismatch");

      // Good state
      const wait = loopback.waitForCallback(5_000);
      const good = await new Promise<{ status: number }>((resolve, reject) => {
        http
          .get(
            `http://127.0.0.1:${port}/callback?code=tok123&state=good`,
            (res) => {
              res.resume();
              res.on("end", () => resolve({ status: res.statusCode ?? 0 }));
            },
          )
          .on("error", reject);
      });
      expect(good.status).toBe(200);
      await expect(wait).resolves.toEqual({ code: "tok123", state: "good" });
    } finally {
      await loopback.close();
    }
  });

  it("rejects Origin header callbacks", async () => {
    const port = 53282;
    const loopback = await startOAuthLoopback(
      port,
      OAUTH_LOOPBACK_DEFAULT_HOST,
      () => true,
    );
    try {
      const res = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          {
            host: "127.0.0.1",
            port,
            path: "/callback?code=x&state=y",
            headers: { Origin: "https://evil.example" },
          },
          (r) => {
            r.resume();
            r.on("end", () => resolve(r.statusCode ?? 0));
          },
        );
        req.on("error", reject);
        req.end();
      });
      expect(res).toBe(400);
    } finally {
      await loopback.close();
    }
  });
});
