import { describe, expect, it, vi } from "vitest";
import { createMemoryEnquiryStore } from "../store/memory";
import type { Enquiry } from "../store/types";
import type { Mailer, OutgoingMail } from "./notify";
import {
  EMAIL_WAIT_MS,
  MAX_BODY_BYTES,
  handlePublicContact,
  originAllowed,
  siteOriginFromEnv,
  type PublicContactDeps,
} from "./public-contact";
import { createEnquiryLimiter } from "./rate-limit";

const SITE = "https://god.gaiada.com";
const T0 = Date.parse("2026-11-27T01:00:00Z");

const good = {
  name: "Sam Lee",
  company: "Harbour & Bean",
  email: "sam@example.com",
  want: "Where do our customers live?",
  budget: "$10,000 to $50,000",
  website: "",
};

function request(
  body: unknown,
  headers: Record<string, string> = {},
  opts: { raw?: BodyInit; method?: string } = {},
): Request {
  return new Request(`${SITE}/api/public/contact`, {
    method: opts.method ?? "POST",
    headers: {
      origin: SITE,
      "content-type": "application/json",
      "x-real-ip": "203.0.113.77",
      ...headers,
    },
    body: opts.raw ?? JSON.stringify(body),
  });
}

function setup(over: PublicContactDeps = {}) {
  const store = createMemoryEnquiryStore({ now: () => T0 });
  const sent: OutgoingMail[] = [];
  const logs: { event: string; detail?: Record<string, unknown> }[] = [];
  const mailer: Mailer = {
    to: "hello@god.gaiada.com",
    from: "GOD website <no-reply@god.gaiada.com>",
    async send(m) {
      sent.push(m);
    },
  };
  const deps: PublicContactDeps = {
    stores: { enquiries: store },
    mailer,
    // Generous, so a test that sends many requests is not stopped by the limit it is not about. The rate-limit tests
    // pass the real defaults.
    limiter: createEnquiryLimiter({ perPrefix: 10_000, global: 100_000 }),
    now: () => T0,
    siteOrigin: SITE,
    allowLocalhost: false,
    log: (event, detail) => logs.push({ event, ...(detail ? { detail } : {}) }),
    ...over,
  };
  return { store, sent, logs, mailer, deps, post: (r: Request) => handlePublicContact(r, deps) };
}

const stored = (store: ReturnType<typeof createMemoryEnquiryStore>): Promise<Enquiry[]> => store.list();

describe("a good enquiry", () => {
  it("is stored and answered 201 with no body", async () => {
    const { post, store } = setup();
    const res = await post(request(good));
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("");
    const [e] = await stored(store);
    expect(e).toMatchObject({
      name: "Sam Lee",
      company: "Harbour & Bean",
      email: "sam@example.com",
      want: "Where do our customers live?",
      budget: "$10,000 to $50,000",
      status: "new",
      handledBy: null,
    });
  });

  it("sets no cookie and no CSP, and says not to cache", async () => {
    const { post } = setup();
    for (const res of [
      await post(request(good)),
      await post(request(good, { origin: "https://evil.example" })),
      await post(request({ ...good, website: "x" })),
      await post(request({ ...good, name: "" })),
    ]) {
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(res.headers.get("content-security-policy")).toBeNull();
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("keeps only a coarse prefix of X-Real-IP, never the whole address", async () => {
    const { post, store } = setup();
    await post(request(good));
    await post(request(good, { "x-real-ip": "2001:db8:1:2:3:4:5:6" }));
    const rows = await stored(store);
    expect(rows.map((r) => r.ipPrefix).sort()).toEqual(["2001:db8:1::/48", "203.0.113.x"]);
    expect(JSON.stringify(rows)).not.toContain("203.0.113.77");
    expect(JSON.stringify(rows)).not.toContain("2001:db8:1:2");
  });

  it("trusts X-Real-IP only: a client-sent X-Forwarded-For is never used", async () => {
    const { post, store } = setup();
    const r = new Request(`${SITE}/api/public/contact`, {
      method: "POST",
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": "198.51.100.9" },
      body: JSON.stringify(good),
    });
    expect((await post(r)).status).toBe(201);
    expect((await stored(store))[0]?.ipPrefix).toBeNull();
  });

  it("accepts a charset on the content type", async () => {
    const { post } = setup();
    expect((await post(request(good, { "content-type": "application/json; charset=utf-8" }))).status).toBe(201);
  });
});

describe("origin", () => {
  it("refuses any Origin but the site's, and stores nothing", async () => {
    const { post, store, sent } = setup();
    for (const origin of [
      "https://evil.example",
      "https://god.gaiada.com.evil.example",
      "http://god.gaiada.com",
      "https://dashboard.god.gaiada.com",
      "https://GOD.gaiada.com ",
      "null",
      "",
      "http://localhost:3125",
      "http://127.0.0.1:3125",
    ]) {
      const res = await post(request(good, { origin }));
      expect(res.status, origin).toBe(403);
    }
    expect(await stored(store)).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("refuses a request with no Origin at all, even one that says it is same-origin", async () => {
    const { post, store } = setup();
    const r = new Request(`${SITE}/api/public/contact`, {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
      body: JSON.stringify(good),
    });
    expect((await post(r)).status).toBe(403);
    expect(await stored(store)).toHaveLength(0);
  });

  it("is decided before the rate limit, so a refused origin uses nobody's turn", async () => {
    const limiter = createEnquiryLimiter({ perPrefix: 1 });
    const { post } = setup({ limiter });
    for (let i = 0; i < 10; i++) expect((await post(request(good, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await post(request(good))).status).toBe(201);
  });

  it("allows localhost only in dev", async () => {
    const dev = setup({ allowLocalhost: true });
    expect((await dev.post(request(good, { origin: "http://localhost:3125" }))).status).toBe(201);
    expect((await dev.post(request(good, { origin: "http://127.0.0.1:3000" }))).status).toBe(201);
    expect((await dev.post(request(good, { origin: "http://localhost.evil.example" }))).status).toBe(403);
    expect((await dev.post(request(good, { origin: "https://localhost:3125" }))).status).toBe(403);
    expect(originAllowed("http://localhost:3125", SITE, false)).toBe(false);
  });

  it("the site origin is GOD_SITE_ORIGIN, as a bare origin, and defaults to the live site", () => {
    expect(siteOriginFromEnv({})).toBe("https://god.gaiada.com");
    expect(siteOriginFromEnv({ GOD_SITE_ORIGIN: "https://staging.example.org/" })).toBe("https://staging.example.org");
    expect(siteOriginFromEnv({ GOD_SITE_ORIGIN: "not a url" })).toBe("https://god.gaiada.com");
    expect(originAllowed("https://staging.example.org", "https://staging.example.org", false)).toBe(true);
  });
});

describe("JSON only, and 8 KB at most", () => {
  it("refuses anything but application/json with 415", async () => {
    const { post, store } = setup();
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", ""]) {
      const headers: Record<string, string> = { "content-type": type };
      const res = await post(request(good, headers, { raw: "name=Sam&email=sam@example.com" }));
      expect(res.status, type).toBe(415);
    }
    expect(await stored(store)).toHaveLength(0);
  });

  const padded = (bytes: number): string => {
    const base = JSON.stringify({ ...good, pad: "" });
    return JSON.stringify({ ...good, pad: "a".repeat(bytes - Buffer.byteLength(base)) });
  };

  it("takes a body of exactly 8 KB and refuses one byte more with 413", async () => {
    const { post, store } = setup();
    const at = padded(MAX_BODY_BYTES);
    expect(Buffer.byteLength(at)).toBe(MAX_BODY_BYTES);
    expect((await post(request(null, {}, { raw: at }))).status).toBe(201);
    const over = padded(MAX_BODY_BYTES + 1);
    expect((await post(request(null, {}, { raw: over }))).status).toBe(413);
    expect(await stored(store)).toHaveLength(1);
  });

  it("refuses on the declared Content-Length without reading the body", async () => {
    const { post, store } = setup();
    const res = await post(request(good, { "content-length": String(MAX_BODY_BYTES + 1) }));
    expect(res.status).toBe(413);
    expect(await stored(store)).toHaveLength(0);
  });

  it("refuses a long body that declares nothing or lies about its length", async () => {
    const { post, store } = setup();
    expect((await post(request(null, {}, { raw: "x".repeat(MAX_BODY_BYTES * 4) }))).status).toBe(413);
    // A streamed body of unknown length, over the limit.
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < 20; i++) c.enqueue(new TextEncoder().encode("x".repeat(1024)));
        c.close();
      },
    });
    const r = new Request(`${SITE}/api/public/contact`, {
      method: "POST",
      headers: { origin: SITE, "content-type": "application/json", "content-length": "10" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect((await post(r)).status).toBe(413);
    expect(await stored(store)).toHaveLength(0);
  });

  it("refuses bodies that are not a JSON object with 400", async () => {
    const { post, store } = setup();
    for (const raw of ["", "{", "not json", "[]", "null", '"text"', "42", '[{"name":"x"}]']) {
      expect((await post(request(null, {}, { raw }))).status, raw).toBe(400);
    }
    // Bytes that are not UTF-8.
    expect((await post(request(null, {}, { raw: new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]) }))).status).toBe(400);
    expect(await stored(store)).toHaveLength(0);
  });
});

describe("the honeypot", () => {
  it("answers 204, stores nothing, sends nothing, even when the rest is invalid", async () => {
    const { post, store, sent, logs } = setup();
    for (const website of ["https://spam.example", " ", "x", 1, true, ["a"], { a: 1 }]) {
      const res = await post(request({ ...good, website }));
      expect(res.status, JSON.stringify(website)).toBe(204);
      expect(await res.text()).toBe("");
    }
    expect((await post(request({ name: "", website: "x" }))).status).toBe(204);
    expect(await stored(store)).toHaveLength(0);
    expect(sent).toHaveLength(0);
    // Counted in the log, without anything the bot wrote.
    expect(logs.filter((l) => l.event === "enquiry.honeypot")).toHaveLength(8);
    expect(JSON.stringify(logs)).not.toContain("spam.example");
  });

  it("an empty or missing website is a person", async () => {
    const { post, store } = setup();
    expect((await post(request({ ...good, website: "" }))).status).toBe(201);
    expect((await post(request({ ...good, website: null }))).status).toBe(201);
    const noTrap = { name: good.name, company: good.company, email: good.email, want: good.want };
    expect((await post(request(noTrap))).status).toBe(201);
    expect(await stored(store)).toHaveLength(3);
  });
});

describe("validation is the server's", () => {
  it("answers 422 with the field messages, stores nothing, sends nothing", async () => {
    const { post, store, sent } = setup();
    const res = await post(request({ ...good, name: "", email: "nope", want: "x".repeat(4001) }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { ok: boolean; errors: Record<string, string> };
    expect(body.ok).toBe(false);
    expect(Object.keys(body.errors).sort()).toEqual(["email", "name", "want"]);
    expect(await stored(store)).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("holds every limit at the door", async () => {
    const { post, store } = setup({ limiter: createEnquiryLimiter({ perPrefix: 100, global: 1000 }) });
    expect((await post(request({ ...good, name: "n".repeat(100) }))).status).toBe(201);
    expect((await post(request({ ...good, name: "n".repeat(101) }))).status).toBe(422);
    expect((await post(request({ ...good, company: "c".repeat(120) }))).status).toBe(201);
    expect((await post(request({ ...good, company: "c".repeat(121) }))).status).toBe(422);
    expect((await post(request({ ...good, want: "w".repeat(4000) }))).status).toBe(201);
    expect((await post(request({ ...good, want: "w".repeat(4001) }))).status).toBe(422);
    expect((await post(request({ ...good, budget: "b".repeat(60) }))).status).toBe(201);
    expect((await post(request({ ...good, budget: "b".repeat(61) }))).status).toBe(422);
    expect(await stored(store)).toHaveLength(4);
  });
});

describe("rate limits", () => {
  it("5 an hour per network prefix, then 429 with Retry-After; another prefix is not affected", async () => {
    const { post, store } = setup({ limiter: createEnquiryLimiter() });
    for (let i = 0; i < 5; i++) expect((await post(request(good, { "x-real-ip": `203.0.113.${i + 1}` }))).status).toBe(201);
    const res = await post(request(good, { "x-real-ip": "203.0.113.200" }));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBe(3600);
    expect((await post(request(good, { "x-real-ip": "198.51.100.1" }))).status).toBe(201);
    expect(await stored(store)).toHaveLength(6);
  });

  it("100 an hour in total, whoever asks", async () => {
    const { post, store } = setup({ limiter: createEnquiryLimiter() });
    for (let i = 0; i < 100; i++) {
      const ip = `10.${Math.floor(i / 250)}.${i % 250}.1`;
      expect((await post(request(good, { "x-real-ip": ip }))).status, String(i)).toBe(201);
    }
    const res = await post(request(good, { "x-real-ip": "192.0.2.1" }));
    expect(res.status).toBe(429);
    expect(await stored(store)).toHaveLength(100);
  });

  it("opens again when the hour is up", async () => {
    let t = T0;
    const { post } = setup({ now: () => t, limiter: createEnquiryLimiter() });
    for (let i = 0; i < 5; i++) await post(request(good));
    expect((await post(request(good))).status).toBe(429);
    t += 3_599_000;
    expect((await post(request(good))).status).toBe(429);
    t += 2_000;
    expect((await post(request(good))).status).toBe(201);
  });

  it("counts a bot, a bad body and an invalid enquiry too, so probing is not free", async () => {
    const { post } = setup({ limiter: createEnquiryLimiter() });
    await post(request({ ...good, website: "x" }));
    await post(request({ ...good, name: "" }));
    await post(request(null, {}, { raw: "{" }));
    await post(request(null, {}, { raw: "x".repeat(20_000) }));
    await post(request(good, { "content-type": "text/plain" }));
    expect((await post(request(good))).status).toBe(429);
  });

  it("puts every request with no usable address in one shared bucket", async () => {
    const { post } = setup({ limiter: createEnquiryLimiter() });
    for (let i = 0; i < 5; i++) await post(request(good, { "x-real-ip": "not an ip" }));
    expect((await post(request(good, { "x-real-ip": "" }))).status).toBe(429);
    expect((await post(request(good))).status).toBe(201);
  });
});

describe("the email notification", () => {
  it("is sent only after the enquiry is stored", async () => {
    const { post, store, mailer } = setup();
    const seen: number[] = [];
    mailer.send = async () => {
      seen.push((await stored(store)).length);
    };
    expect((await post(request(good))).status).toBe(201);
    expect(seen).toEqual([1]);
  });

  it("goes to the configured inbox, from the configured sender, with Reply-To the enquirer", async () => {
    const { post, sent } = setup();
    await post(request(good));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      from: "GOD website <no-reply@god.gaiada.com>",
      to: "hello@god.gaiada.com",
      replyTo: "sam@example.com",
      subject: "New enquiry from Harbour & Bean",
    });
    expect(sent[0]!.text).toContain("Where do our customers live?");
  });

  it("a failing email is logged, never fails the request, and the enquiry stays stored", async () => {
    const { post, store, mailer, logs } = setup();
    mailer.send = async () => {
      throw Object.assign(new Error("550 5.1.1 <sam@example.com> rejected"), { code: "EENVELOPE" });
    };
    const res = await post(request(good));
    expect(res.status).toBe(201);
    expect(await stored(store)).toHaveLength(1);
    expect(logs.find((l) => l.event === "enquiry.mail.failed")?.detail).toMatchObject({ error: "EENVELOPE" });
    // The log carries a reason code, not the SMTP text (which can quote an address) and not the enquiry.
    expect(JSON.stringify(logs)).not.toContain("sam@example.com");
  });

  it("a mailer that throws at once is only a log line too", async () => {
    const { post, store, mailer } = setup();
    mailer.send = () => {
      throw new Error("boom");
    };
    expect((await post(request(good))).status).toBe(201);
    expect(await stored(store)).toHaveLength(1);
  });

  it("does not hold the response past the wait when the mail server hangs", async () => {
    const { post, store, mailer } = setup({ emailWaitMs: 40 });
    mailer.send = () => new Promise<void>(() => undefined);
    const t = Date.now();
    expect((await post(request(good))).status).toBe(201);
    expect(Date.now() - t).toBeLessThan(1_000);
    expect(await stored(store)).toHaveLength(1);
    expect(EMAIL_WAIT_MS).toBeLessThanOrEqual(3_000);
  });

  it("with no mail configured the enquiry is still stored and answered 201", async () => {
    const { post, store } = setup({ mailer: null });
    expect((await post(request(good))).status).toBe(201);
    expect(await stored(store)).toHaveLength(1);
  });

  it("is not sent for a refusal, a bot or an invalid enquiry", async () => {
    const { post, sent } = setup();
    await post(request(good, { origin: "https://evil.example" }));
    await post(request({ ...good, website: "x" }));
    await post(request({ ...good, email: "bad" }));
    expect(sent).toHaveLength(0);
  });
});

describe("a store failure", () => {
  it("answers 500, logs a reason code, and sends no email", async () => {
    const { post, sent, logs, deps } = setup();
    deps.stores = {
      enquiries: {
        ...createMemoryEnquiryStore(),
        async create() {
          throw Object.assign(new Error("connection refused to 127.0.0.1"), { code: "ECONNREFUSED" });
        },
      },
    };
    const res = await post(request(good));
    expect(res.status).toBe(500);
    expect(sent).toHaveLength(0);
    expect(logs[0]).toMatchObject({ event: "enquiry.store.failed", detail: { error: "ECONNREFUSED" } });
  });
});

describe("header injection", () => {
  it("a newline in the name or company is cleaned away; no header line ever carries one", async () => {
    const { post, store, sent } = setup();
    const res = await post(
      request({
        ...good,
        name: "Sam\r\nBcc: evil@example.com",
        company: "Acme\r\nSubject: pwned\r\n\r\nbody",
      }),
    );
    expect(res.status).toBe(201);
    const [e] = await stored(store);
    expect(e?.name).toBe("Sam Bcc: evil@example.com");
    expect(e?.company).toBe("Acme Subject: pwned body");
    const m = sent[0]!;
    for (const v of [m.subject, m.from, m.to, m.replyTo ?? ""]) expect(v).not.toMatch(/[\r\n]/);
    expect(m.subject).toBe("New enquiry from Acme Subject: pwned body");
  });

  it("a newline in the email is refused, not repaired: nothing is stored or sent", async () => {
    const { post, store, sent } = setup();
    for (const email of [
      "a@example.com\r\nBcc: evil@example.com",
      "a@example.com\nBcc: evil@example.com",
      "a@example.com\rBcc: evil@example.com",
      "a@example.com%0d%0aBcc:evil@example.com ",
      "a@example.com, evil@example.com",
      "evil@example.com Bcc: x@example.com",
    ]) {
      const res = await post(request({ ...good, email }));
      expect(res.status, JSON.stringify(email)).toBe(422);
    }
    expect(await stored(store)).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("a newline in the budget cannot reach a header either", async () => {
    const { post, sent } = setup();
    expect((await post(request({ ...good, budget: "$1\r\nBcc: evil@example.com" }))).status).toBe(201);
    expect(sent[0]!.text).toContain("Budget:   $1 Bcc: evil@example.com");
  });
});

describe("the route file", () => {
  it("exports POST and nothing else, so every other method is Next's own 405", async () => {
    const route = await import("@/app/api/public/contact/route");
    expect(Object.keys(route).sort()).toEqual(["POST", "dynamic"]);
  });

  it("is not covered by the CSP proxy (route handlers set no CSP), and is public in the access table", async () => {
    const { config } = await import("@/proxy");
    const source = (config.matcher[0] as { source: string }).source;
    const re = new RegExp(`^${source}$`);
    expect(re.test("/api/public/contact")).toBe(false);
    expect(re.test("/api/map/summary")).toBe(false);
    expect(re.test("/admin")).toBe(true);
    const { PUBLIC_ROUTES } = await import("../access");
    expect(PUBLIC_ROUTES.map((r) => `${r.method} ${r.path}`)).toEqual(["POST /api/public/contact"]);
  });
});

describe("the stored row survives a message at its limits", () => {
  it("keeps line breaks in the message", async () => {
    const { post, store } = setup();
    await post(request({ ...good, want: "Line one\r\n\r\nLine two" }));
    expect((await stored(store))[0]?.want).toBe("Line one\n\nLine two");
  });

  it("clean up timers: the wait does not leave the process holding a handle", async () => {
    const spy = vi.spyOn(globalThis, "clearTimeout");
    const { post } = setup();
    await post(request(good));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
