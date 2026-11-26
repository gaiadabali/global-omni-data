import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresStores, type PostgresStores } from "./index";
import { handlePublicContact } from "../../enquiries/public-contact";
import { createEnquiryLimiter } from "../../enquiries/rate-limit";
import { handleEnquiryUpdate } from "../../audit/handlers";
import { viewerFromDevCookie } from "../../viewer";

/**
 * The enquiry store against a real Postgres 18 as god_app (scripts/server-f/db-test.sh). The table is shared and never
 * deleted from, so every test marks its rows with its own tag and filters by it. Skips without a database.
 */
const URL_ = process.env.GOD_TEST_DATABASE_URL;
const tag = () => `T${randomBytes(5).toString("hex")}`;

describe.skipIf(!URL_)("Postgres enquiry store", () => {
  let s: PostgresStores;
  beforeAll(() => {
    s = createPostgresStores(URL_!);
  });
  afterAll(async () => {
    await s?.close();
  });

  const mk = (t: string, over: Partial<Parameters<PostgresStores["enquiries"]["create"]>[0]> = {}) => ({
    name: `Sam ${t}`,
    company: `Harbour & Bean ${t}`,
    email: `sam-${t}@example.test`,
    want: `Where do our customers live? ${t}`,
    budget: "$10,000 to $50,000",
    ipPrefix: "203.0.113.x",
    ...over,
  });

  it("stores an enquiry as new, with a database id and time, and reads it back", async () => {
    const t = tag();
    const e = await s.enquiries.create(mk(t));
    expect(e).toMatchObject({ name: `Sam ${t}`, status: "new", handledBy: null, handledAt: null, ipPrefix: "203.0.113.x", budget: "$10,000 to $50,000" });
    expect(e.id).toMatch(/^enq_[0-9a-f]{32}$/);
    expect(Math.abs(Date.parse(e.receivedAt) - Date.now())).toBeLessThan(60_000);
    expect(await s.enquiries.find(e.id)).toEqual(e);
    expect(await s.enquiries.find("enq_missing")).toBeNull();
  });

  it("keeps line breaks, unicode and a missing network prefix exactly", async () => {
    const t = tag();
    const e = await s.enquiries.create(mk(t, { want: `Line one\n\nLine two 😀 Kōwhai ${t}`, ipPrefix: null, budget: "" }));
    expect(await s.enquiries.find(e.id)).toMatchObject({ want: `Line one\n\nLine two 😀 Kōwhai ${t}`, ipPrefix: null, budget: "" });
  });

  it("lists newest first, filters by status and by text, counts, and limits", async () => {
    const t = tag();
    const a = await s.enquiries.create(mk(t, { company: `Alpha ${t}` }));
    const b = await s.enquiries.create(mk(t, { company: `Beta ${t}`, want: `pharmacy sites ${t}` }));
    const c = await s.enquiries.create(mk(t, { company: `Gamma ${t}`, email: `cy-${t}@example.org` }));
    await s.enquiries.setStatus(a.id, "read", "dev-owner", new Date().toISOString());
    await s.enquiries.setStatus(b.id, "archived", "dev-owner", new Date().toISOString());

    expect((await s.enquiries.list({ q: t })).map((e) => e.id)).toEqual([c.id, b.id, a.id]);
    expect((await s.enquiries.list({ q: t, status: "open" })).map((e) => e.id)).toEqual([c.id, a.id]);
    expect((await s.enquiries.list({ q: t, status: "new" })).map((e) => e.id)).toEqual([c.id]);
    expect((await s.enquiries.list({ q: t, status: "archived" })).map((e) => e.id)).toEqual([b.id]);
    expect((await s.enquiries.list({ q: `PHARMACY SITES ${t}` })).map((e) => e.id)).toEqual([b.id]);
    expect((await s.enquiries.list({ q: `cy-${t}@example.org` })).map((e) => e.id)).toEqual([c.id]);
    expect((await s.enquiries.list({ q: t, limit: 2 })).map((e) => e.id)).toEqual([c.id, b.id]);
    expect(await s.enquiries.count({ q: t })).toBe(3);
    expect(await s.enquiries.count({ q: t, status: "open" })).toBe(2);
    expect(await s.enquiries.count({ q: t, status: "new" })).toBe(1);
    expect(typeof (await s.enquiries.count({ status: "new" }))).toBe("number");
  });

  it("searches for the text itself: % and _ are not wildcards, and a quote is only a quote", async () => {
    const t = tag();
    const e = await s.enquiries.create(mk(t, { want: `100% sure, a_b and O'Brien's ${t}` }));
    expect((await s.enquiries.list({ q: `100% sure, a_b and O'Brien's ${t}` })).map((x) => x.id)).toEqual([e.id]);
    expect(await s.enquiries.list({ q: `%${t}` })).toEqual([]);
    expect(await s.enquiries.list({ q: `a_b${t}` })).toEqual([]);
    expect(await s.enquiries.list({ q: `'; DROP TABLE god_app.enquiries; -- ${t}` })).toEqual([]);
    expect((await s.enquiries.list({ q: t })).length).toBeGreaterThan(0);
  });

  it("marks read or archived with who and when; new clears them; the visitor's words never change", async () => {
    const t = tag();
    const e = await s.enquiries.create(mk(t));
    const at = "2026-11-27T02:30:00.000Z";
    expect(await s.enquiries.setStatus(e.id, "read", "dev-owner", at)).toMatchObject({ status: "read", handledBy: "dev-owner", handledAt: at, name: e.name, want: e.want });
    expect(await s.enquiries.setStatus(e.id, "archived", "dev-owner", at)).toMatchObject({ status: "archived" });
    expect(await s.enquiries.setStatus(e.id, "new", "dev-owner", at)).toMatchObject({ status: "new", handledBy: null, handledAt: null });
    expect(await s.enquiries.setStatus("enq_missing", "read", "dev-owner", at)).toBeNull();
    expect(await s.enquiries.find(e.id)).toMatchObject({ receivedAt: e.receivedAt, email: e.email, ipPrefix: e.ipPrefix });
  });

  it("the database refuses what the validation would have: a newline in the name, a comma in the email", async () => {
    const t = tag();
    await expect(s.enquiries.create(mk(t, { name: "Sam\nBcc: x@y.co" }))).rejects.toMatchObject({ code: "23514" });
    await expect(s.enquiries.create(mk(t, { email: "a@b.co,c@d.co" }))).rejects.toMatchObject({ code: "23514" });
    await expect(s.enquiries.create(mk(t, { want: "w".repeat(4001) }))).rejects.toMatchObject({ code: "23514" });
  });

  describe("the whole path, against the real table", () => {
    const post = (body: unknown, limiter = createEnquiryLimiter({ perPrefix: 1000, global: 10_000 })) =>
      handlePublicContact(
        new Request("https://god.gaiada.com/api/public/contact", {
          method: "POST",
          headers: { origin: "https://god.gaiada.com", "content-type": "application/json", "x-real-ip": "203.0.113.9" },
          body: JSON.stringify(body),
        }),
        { stores: s, mailer: null, limiter, allowLocalhost: false },
      );

    it("POST stores a row, a bot and a bad enquiry store nothing", async () => {
      const t = tag();
      const body = { name: `Sam ${t}`, company: `Acme ${t}`, email: `sam-${t}@example.test`, want: `Hello ${t}`, budget: "", website: "" };
      expect((await post(body)).status).toBe(201);
      expect((await post({ ...body, website: "http://spam.example" })).status).toBe(204);
      expect((await post({ ...body, email: "nope" })).status).toBe(422);
      const rows = await s.enquiries.list({ q: t });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ company: `Acme ${t}`, status: "new", ipPrefix: "203.0.113.x" });
    });

    it("an Owner marking it read writes the audit event to the real append-only log", async () => {
      const t = tag();
      await post({ name: `Sam ${t}`, company: `Acme ${t}`, email: `sam-${t}@example.test`, want: `Hello ${t}` });
      const [e] = await s.enquiries.list({ q: t });
      const owner = viewerFromDevCookie("owner")!;
      const res = await handleEnquiryUpdate(owner, { id: e!.id, status: "read" }, { stores: s, audit: s.audit });
      expect(res).toMatchObject({ ok: true, status: "read" });
      expect(await s.enquiries.find(e!.id)).toMatchObject({ status: "read", handledBy: owner.id });
      const events = await s.audit.list({ action: "enquiry.update", target: e!.id });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ who: owner.id, reason: "Marked as read (was new)", outcome: "done" });
    });
  });
});
