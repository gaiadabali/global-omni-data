import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { codeHash, newEnrolmentCode, normaliseCode } from "../../breakglass/codes";
import { createCeremonyStore, createRateLimiter } from "../../breakglass/ceremonies";
import { emergencyOptions, emergencyVerify } from "../../breakglass/signin";
import { CONFIG, authResponse, fakeWebAuthn } from "../../breakglass/testing/fixtures";
import { createPostgresStores, type PostgresStores } from "./index";

/**
 * The break-glass store against a real Postgres 18 as god_app (scripts/server-f/db-test.sh). Enrolment codes are
 * made as god_migrator (GOD_MIGRATE_DATABASE_URL), as the server CLI does: god_app cannot make one. Active keys are
 * counted across the whole table (at most 2), so every test starts with none active. Skips without a database.
 */
const URL_ = process.env.GOD_TEST_DATABASE_URL;
const MIGRATOR = process.env.GOD_MIGRATE_DATABASE_URL;
const rand = () => randomBytes(5).toString("hex");
const iso = (ms = Date.now()) => new Date(ms).toISOString();

describe.skipIf(!URL_ || !MIGRATOR)("Postgres break-glass store", () => {
  let s: PostgresStores;
  let app: pg.Client;
  let mig: pg.Client;
  const revokeAll = () => app.query("UPDATE god_app.break_glass_credentials SET revoked_at = now() WHERE revoked_at IS NULL");

  beforeAll(async () => {
    s = createPostgresStores(URL_!);
    app = new pg.Client({ connectionString: URL_! });
    mig = new pg.Client({ connectionString: MIGRATOR! });
    await Promise.all([app.connect(), mig.connect()]);
  });
  afterAll(async () => {
    await revokeAll().catch(() => undefined);
    await Promise.all([s?.close(), app?.end(), mig?.end()]);
  });

  async function person(role: "owner" | "data" = "owner") {
    const e = await s.allowList.invite({
      name: "BG Store Test",
      email: `${rand()}@example.test`,
      role,
      agreementSigned: "2026-11-02",
      originalHeldBy: "Safe",
      invitedBy: "dev-owner",
    });
    expect(await s.allowList.bindSub(e!.id, `sub-${rand()}`)).toBe(true);
    return e!.id;
  }
  const cred = () => randomBytes(32).toString("base64url");
  const key = (ownerId: string, credentialId = cred(), signCount = 0) =>
    s.breakGlass.create({ credentialId, publicKey: new Uint8Array(randomBytes(77)), signCount, ownerId });

  async function issue(ownerId: string, minutes = 15): Promise<string> {
    const code = newEnrolmentCode();
    await mig.query(
      "INSERT INTO god_app.break_glass_enrolment_codes (code_hash, owner_id, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))",
      [codeHash(normaliseCode(code)!), ownerId, minutes],
    );
    return codeHash(normaliseCode(code)!);
  }

  it("stores only the key, reads it back byte for byte, lists newest first", async () => {
    await revokeAll();
    const o = await person();
    const id = cred();
    const pk = new Uint8Array(randomBytes(91));
    const k = await s.breakGlass.create({ credentialId: id, publicKey: pk, signCount: 3, ownerId: o });
    expect(k).toMatchObject({ credentialId: id, ownerId: o, signCount: 3, lastUsedAt: null, revokedAt: null });
    expect(Buffer.from(k!.publicKey).equals(Buffer.from(pk))).toBe(true);
    expect(Math.abs(Date.parse(k!.createdAt) - Date.now())).toBeLessThan(60_000);
    expect(await s.breakGlass.findActive(id)).toEqual(k);
    expect((await s.breakGlass.list())[0]?.credentialId).toBe(id);
    expect(await s.breakGlass.findActive("nope")).toBeNull();
    await revokeAll();
  });

  it("one active per Owner, two in total, Owners only: refusals come back as null", async () => {
    await revokeAll();
    const [a, b, c] = [await person(), await person(), await person()];
    expect(await key(a)).not.toBeNull();
    expect(await key(a)).toBeNull();
    expect(await key(await person("data"))).toBeNull();
    expect(await key("no-such-entry")).toBeNull();
    const kb = await key(b);
    expect(kb).not.toBeNull();
    expect(await key(c)).toBeNull();
    expect(await s.breakGlass.revoke(kb!.credentialId, iso())).toBe(true);
    expect(await s.breakGlass.revoke(kb!.credentialId, iso())).toBe(false);
    expect(await key(c)).not.toBeNull();
    await revokeAll();
  });

  it("recordUse: forward only (or 0 and 0), never on a revoked key", async () => {
    await revokeAll();
    const o = await person();
    const id = cred();
    await key(o, id, 5);
    expect(await s.breakGlass.recordUse(id, 5, iso())).toBe(false);
    expect(await s.breakGlass.recordUse(id, 4, iso())).toBe(false);
    const t = iso();
    expect(await s.breakGlass.recordUse(id, 6, t)).toBe(true);
    expect(await s.breakGlass.findActive(id)).toMatchObject({ signCount: 6, lastUsedAt: t });
    await s.breakGlass.revoke(id, iso());
    expect(await s.breakGlass.recordUse(id, 7, iso())).toBe(false);
    const z = cred();
    await key(await person(), z, 0);
    expect(await s.breakGlass.recordUse(z, 0, iso())).toBe(true);
    expect(await s.breakGlass.recordUse(z, 0, iso())).toBe(true);
    await revokeAll();
  });

  it("codes: checked by hash, used once by their Owner only, expired after their time", async () => {
    const o = await person();
    const other = await person();
    const h = await issue(o);
    const now = iso();
    expect(await s.breakGlass.checkCode(h, now)).toEqual({ state: "ok", ownerId: o });
    expect(await s.breakGlass.checkCode("0".repeat(64), now)).toEqual({ state: "unknown" });
    expect(await s.breakGlass.checkCode(h, iso(Date.now() + 16 * 60_000))).toEqual({ state: "expired", ownerId: o });
    expect(await s.breakGlass.useCode(h, other, now)).toBe(false);
    expect(await s.breakGlass.useCode(h, o, iso(Date.now() + 16 * 60_000))).toBe(false);
    expect(await s.breakGlass.useCode(h, o, now)).toBe(true);
    expect(await s.breakGlass.useCode(h, o, now)).toBe(false);
    expect(await s.breakGlass.checkCode(h, now)).toEqual({ state: "used", ownerId: o });
  });

  it("an emergency session: 1 hour is the most, and a passkey check leaves it alone", async () => {
    const o = await person();
    const t = Date.now();
    const base = { userId: o, createdAt: iso(t), authTime: iso(t), amr: ["hwk", "break-glass"], userAgent: null, ipPrefix: null };
    const hash = () => createHash("sha256").update(randomBytes(16)).digest("hex");
    await expect(s.sessions.create({ ...base, tokenHash: hash(), absoluteExpiresAt: iso(t + 2 * 3_600_000) })).rejects.toThrow();
    const ok = await s.sessions.create({ ...base, tokenHash: hash(), absoluteExpiresAt: iso(t + 3_600_000) });
    await s.sessions.updateAuth(ok.id, iso(t + 1000), ["hwk"]);
    const live = (await s.sessions.listActive(iso(t + 1000))).find((x) => x.id === ok.id);
    expect(live?.amr).toEqual(["hwk", "break-glass"]);
    expect(live?.authTime).toBe(iso(t));
  });

  it("the sign-in handler end to end on Postgres: session row, audit events in the real table", async () => {
    await revokeAll();
    const o = await person();
    const id = cred();
    await key(o, id, 0);
    const deps = {
      stores: s,
      config: CONFIG,
      webauthn: fakeWebAuthn(),
      ceremonies: createCeremonyStore(),
      limiter: createRateLimiter(),
      now: Date.now,
      notify: () => undefined,
    };
    const ip = `198.51.${Math.floor(Math.random() * 200)}.9`;
    const bad = await emergencyOptions({ ip }, deps);
    if (!bad.ok) throw new Error("options");
    expect(
      await emergencyVerify({ ceremonyId: bad.ceremonyId, response: authResponse(id, 1, "bad"), ip, userAgent: null, sessionToken: undefined }, deps),
    ).toMatchObject({ ok: false, status: 401 });
    const good = await emergencyOptions({ ip }, deps);
    if (!good.ok) throw new Error("options");
    const r = await emergencyVerify({ ceremonyId: good.ceremonyId, response: authResponse(id, 1), ip, userAgent: null, sessionToken: undefined }, deps);
    if (!r.ok) throw new Error("refused");
    expect(r.session.amr).toEqual(["hwk", "break-glass"]);
    expect(Date.parse(r.session.absoluteExpiresAt) - Date.parse(r.session.createdAt)).toBe(3_600_000);
    expect((await s.audit.list({ who: o, action: "breakglass.signin" })).map((e) => e.target)).toEqual([`session:${r.session.id}`]);
    expect((await s.audit.list({ action: "breakglass.refused", target: `key:${id.slice(0, 12)}` })).length).toBe(1);
    // The CHECK now takes the sign-in events too (0002 did not).
    for (const action of ["signin.ok", "signin.fresh", "signout"] as const) {
      await expect(s.audit.append({ who: o, action, target: "session:x" })).resolves.toMatchObject({ action });
    }
    await revokeAll();
  });
});
