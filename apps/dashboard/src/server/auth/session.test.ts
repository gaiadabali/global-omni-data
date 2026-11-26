import { describe, expect, it } from "vitest";
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from "../store/limits";
import { createMemoryAllowList, createMemorySessionStore } from "../store/memory";
import { ALLOW_LIST_SEED } from "../store/seed";
import { sha256Hex } from "./crypto";
import { FRESH_MS, freshGate, isFreshAuth } from "./fresh";
import { deviceLabel, ipPrefixOf, resolveSession, startSession } from "./session";

const T0 = Date.parse("2026-11-26T00:00:00Z");

async function started(amr: string[] = ["hwk"]) {
  const stores = {
    allowList: createMemoryAllowList({ seed: ALLOW_LIST_SEED }),
    sessions: createMemorySessionStore(),
  };
  const entry = (await stores.allowList.find("dev-data"))!;
  const { token, session } = await startSession(stores, {
    entry,
    authTime: new Date(T0).toISOString(),
    amr,
    userAgent: null,
    ip: null,
    now: T0,
  });
  return { stores, token, session };
}

describe("session check on every request", () => {
  it("accepts a fresh session and gives the allow-listed viewer", async () => {
    const { stores, token } = await started();
    const s = await resolveSession(token, stores, T0 + 1000);
    expect(s).toMatchObject({
      kind: "ok",
      viewer: { id: "dev-data", displayName: "Jordan Lee", role: "data" },
    });
  });

  it("ends at 30 minutes idle, to the millisecond", async () => {
    const { stores, token } = await started();
    expect((await resolveSession(token, stores, T0 + SESSION_IDLE_MS - 1)).kind).toBe("ok");
    const again = await started();
    expect(await resolveSession(again.token, again.stores, T0 + SESSION_IDLE_MS)).toEqual({
      kind: "ended",
      why: "idle",
    });
  });

  it("ends at 8 hours however busy, to the millisecond", async () => {
    const { stores, token } = await started();
    // Busy: a request every 20 minutes keeps it from going idle.
    for (let t = T0 + 20 * 60_000; t < T0 + SESSION_ABSOLUTE_MS; t += 20 * 60_000) {
      expect((await resolveSession(token, stores, t)).kind).toBe("ok");
    }
    expect((await resolveSession(token, stores, T0 + SESSION_ABSOLUTE_MS - 1)).kind).toBe("ok");
    expect(await resolveSession(token, stores, T0 + SESSION_ABSOLUTE_MS)).toEqual({
      kind: "ended",
      why: "absolute",
    });
  });

  it("writes lastSeenAt at most once a minute", async () => {
    const { stores, token, session } = await started();
    await resolveSession(token, stores, T0 + 30_000);
    expect((await stores.sessions.findByTokenHash(sha256Hex(token)))?.lastSeenAt).toBe(
      session.createdAt,
    );
    await resolveSession(token, stores, T0 + 61_000);
    expect((await stores.sessions.findByTokenHash(sha256Hex(token)))?.lastSeenAt).toBe(
      new Date(T0 + 61_000).toISOString(),
    );
  });

  it("refuses a revoked session", async () => {
    const { stores, token, session } = await started();
    await stores.sessions.revoke(session.id, "dev-owner", new Date(T0 + 10).toISOString());
    expect(await resolveSession(token, stores, T0 + 20)).toEqual({ kind: "ended", why: "revoked" });
  });

  it("refuses a session whose person was suspended or removed", async () => {
    const { stores, token } = await started();
    await stores.allowList.setStatus("dev-data", "suspended");
    expect(await resolveSession(token, stores, T0 + 20)).toEqual({
      kind: "ended",
      why: "not-listed",
    });
  });

  it("knows nothing of a token it never issued, a malformed one, or the hash itself used as a token", async () => {
    const { stores, token } = await started();
    const altered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    for (const t of [undefined, "", "x", altered, sha256Hex(token), `${token} `]) {
      expect((await resolveSession(t, stores, T0 + 20)).kind).toBe("none");
    }
  });
});

describe("the fresh passkey gate", () => {
  const session = (authTime: number, amr = ["hwk"]) => ({
    authTime: new Date(authTime).toISOString(),
    amr,
  });

  it("is fresh for under 5 minutes after a passkey sign-in, and never without hwk", () => {
    expect(isFreshAuth(session(T0), T0 + FRESH_MS - 1)).toBe(true);
    expect(isFreshAuth(session(T0), T0 + FRESH_MS)).toBe(false);
    expect(isFreshAuth(session(T0, ["pwd"]), T0 + 1000)).toBe(false);
    expect(isFreshAuth(session(T0, ["otp", "mfa"]), T0 + 1000)).toBe(false);
    expect(isFreshAuth(session(T0 + 10 * 60_000), T0)).toBe(false);
  });

  it("sends a stale session to /auth/start?fresh=1, refuses no session, and passes dev sign-in", async () => {
    const { stores, token } = await started();
    const ok = await resolveSession(token, stores, T0 + 1000);
    expect(freshGate(ok, false, T0 + 1000)).toEqual({ ok: true });
    const later = await resolveSession(token, stores, T0 + FRESH_MS + 1000);
    expect(freshGate(later, false, T0 + FRESH_MS + 1000)).toEqual({
      ok: false,
      error: "Confirm with your passkey to carry on.",
      freshUrl: "/auth/start?fresh=1",
    });
    expect(freshGate({ kind: "none" }, false, T0)).toMatchObject({ ok: false });
    expect(freshGate({ kind: "none" }, false, T0)).not.toHaveProperty("freshUrl");
    expect(freshGate({ kind: "none" }, true, T0)).toEqual({ ok: true });
  });
});

describe("what Admin sees of a session", () => {
  it("keeps only a coarse network prefix", () => {
    expect(ipPrefixOf("203.0.113.77")).toBe("203.0.113.x");
    expect(ipPrefixOf("198.51.100.9, 10.0.0.1")).toBe("198.51.100.x");
    expect(ipPrefixOf("::ffff:192.0.2.4")).toBe("192.0.2.x");
    expect(ipPrefixOf("2001:db8:1:2:3:4:5:6")).toBe("2001:db8:1::/48");
    expect(ipPrefixOf(null)).toBeNull();
    expect(ipPrefixOf("not an address")).toBeNull();
  });

  it("names the browser and system", () => {
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/142.0")).toBe(
      "Chrome on Windows",
    );
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) Safari/605.1")).toBe(
      "Safari on iPhone",
    );
    expect(deviceLabel(null)).toBe("Unknown device");
  });
});
