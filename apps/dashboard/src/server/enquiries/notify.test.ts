import { afterEach, describe, expect, it, vi } from "vitest";
import { buildEnquiryMail, dashboardEnquiriesUrl, getMailer, readMailConfig, smtpOptions } from "./notify";

const CFG = { to: "hello@god.gaiada.com", from: "GOD website <no-reply@god.gaiada.com>" };
const enquiry = {
  id: "enq_abc",
  receivedAt: "2026-11-27T03:20:00.000Z",
  name: "Sam Lee",
  company: "Harbour & Bean",
  email: "sam@example.com",
  want: "Where do our customers live?\n\nAnd when do they shop?",
  budget: "$10,000 to $50,000",
  ipPrefix: "203.0.113.x",
};

describe("buildEnquiryMail", () => {
  it("is plain text, from and to the configured addresses, Reply-To the enquirer, subject from the company", () => {
    const m = buildEnquiryMail(CFG, enquiry, { dashboardUrl: "https://dashboard.god.gaiada.com/admin?tab=enquiries" });
    expect(m).toMatchObject({ from: CFG.from, to: CFG.to, replyTo: "sam@example.com", subject: "New enquiry from Harbour & Bean" });
    expect(m).not.toHaveProperty("html");
    expect(m.text).toContain("Name:     Sam Lee");
    expect(m.text).toContain("Company:  Harbour & Bean");
    expect(m.text).toContain("Email:    sam@example.com");
    expect(m.text).toContain("Budget:   $10,000 to $50,000");
    expect(m.text).toContain("Where do our customers live?\n\nAnd when do they shop?");
    expect(m.text).toContain("27 Nov 2026, 14:20 (Australian Eastern time). Enquiry enq_abc.");
    expect(m.text).toContain("https://dashboard.god.gaiada.com/admin?tab=enquiries");
    // The enquirer's network is not in the email.
    expect(m.text).not.toContain("203.0.113");
  });

  it("says so when no budget was given, and leaves out the dashboard line without a URL", () => {
    const m = buildEnquiryMail(CFG, { ...enquiry, budget: "" });
    expect(m.text).toContain("Budget:   Not given");
    expect(m.text).not.toContain("dashboard");
  });

  it("strips CR, LF and every other control character from every header value, whatever came in", () => {
    const hostile = {
      ...enquiry,
      name: "Sam\r\nBcc: evil@example.com",
      company: "Acme\r\nSubject: pwned\nX-Evil: 1\u2028\u0085\u0000done",
      email: "sam@example.com\r\nBcc: evil@example.com",
    };
    const m = buildEnquiryMail({ to: "hello@god.gaiada.com\r\nBcc: x@example.com", from: "GOD <a@god.gaiada.com>\nX: y" }, hostile);
    for (const [k, v] of Object.entries(m)) {
      if (k === "text") continue;
      // eslint-disable-next-line no-control-regex
      expect(v, k).not.toMatch(/[\r\n\u0000\u2028\u0085]/);
    }
    expect(m.subject).toBe("New enquiry from Acme Subject: pwned X-Evil: 1 done");
    // An address that is not an address any more gets no Reply-To at all.
    expect(m.replyTo).toBeUndefined();
    // And the body, which is not a header, still has no raw CR+LF line for a header to hide behind in the header part.
    expect(m.text.split("\n\n")[0]).not.toMatch(/\r/);
  });

  it("gives no Reply-To for an address that carries a second address or a display name", () => {
    for (const email of ["a@b.co,c@d.co", "Sam <a@b.co>", "a@b.co;c@d.co", '"x"@b.co']) {
      expect(buildEnquiryMail(CFG, { ...enquiry, email }).replyTo, email).toBeUndefined();
    }
  });

  it("keeps the subject short", () => {
    expect(buildEnquiryMail(CFG, { ...enquiry, company: "c".repeat(500) }).subject.length).toBeLessThanOrEqual(200);
  });
});

describe("readMailConfig", () => {
  const all = {
    GOD_SMTP_URL: "smtp://127.0.0.1:25",
    GOD_ENQUIRY_TO: "hello@god.gaiada.com",
    GOD_ENQUIRY_FROM: "GOD website <no-reply@god.gaiada.com>",
  };
  it("needs all three", () => {
    expect(readMailConfig(all)).toEqual({ smtpUrl: "smtp://127.0.0.1:25", to: all.GOD_ENQUIRY_TO, from: all.GOD_ENQUIRY_FROM });
    for (const k of Object.keys(all)) {
      expect(readMailConfig({ ...all, [k]: undefined }), k).toBeNull();
      expect(readMailConfig({ ...all, [k]: "  " }), k).toBeNull();
    }
    expect(readMailConfig({})).toBeNull();
  });
  it("takes control characters out of the two header addresses", () => {
    expect(readMailConfig({ ...all, GOD_ENQUIRY_TO: "hello@god.gaiada.com\r\nBcc: x@example.com" })?.to).toBe(
      "hello@god.gaiada.com Bcc: x@example.com",
    );
  });
});

describe("smtpOptions", () => {
  it("talks plain to the local postfix (nothing to protect on loopback) with short timeouts", () => {
    expect(smtpOptions("smtp://127.0.0.1:25")).toMatchObject({
      host: "127.0.0.1",
      port: 25,
      secure: false,
      ignoreTLS: true,
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    expect(smtpOptions("smtp://localhost")).toMatchObject({ host: "localhost", port: 25, ignoreTLS: true });
    expect(smtpOptions("smtp://[::1]:25")).toMatchObject({ host: "::1", ignoreTLS: true });
  });
  it("requires TLS anywhere else, and takes credentials from the URL", () => {
    const o = smtpOptions("smtp://u%40x:p%2Fw@mail.example.org:587");
    expect(o).toMatchObject({ host: "mail.example.org", port: 587, secure: false, requireTLS: true, auth: { user: "u@x", pass: "p/w" } });
    expect(o).not.toHaveProperty("ignoreTLS");
    expect(smtpOptions("smtps://mail.example.org")).toMatchObject({ port: 465, secure: true });
  });
  it("refuses a URL that is not smtp", () => {
    expect(() => smtpOptions("http://127.0.0.1:25")).toThrow(RangeError);
    expect(() => smtpOptions("not a url")).toThrow();
  });
});

describe("dashboardEnquiriesUrl", () => {
  it("is built from GOD_PUBLIC_URL, or left out", () => {
    expect(dashboardEnquiriesUrl({ GOD_PUBLIC_URL: "https://dashboard.god.gaiada.com/" })).toBe(
      "https://dashboard.god.gaiada.com/admin?tab=enquiries",
    );
    expect(dashboardEnquiriesUrl({})).toBeUndefined();
    expect(dashboardEnquiriesUrl({ GOD_PUBLIC_URL: "javascript:alert(1)" })).toBeUndefined();
  });
});

describe("getMailer", () => {
  const holder = globalThis as { __godMailer?: unknown };
  afterEach(() => {
    delete holder.__godMailer;
    vi.unstubAllEnvs();
  });

  it("with the variables unset, sends nothing and logs that ONCE, however many enquiries arrive", () => {
    delete holder.__godMailer;
    for (const k of ["GOD_SMTP_URL", "GOD_ENQUIRY_TO", "GOD_ENQUIRY_FROM"]) vi.stubEnv(k, "");
    const log = vi.fn();
    expect(getMailer(log)).toBeNull();
    expect(getMailer(log)).toBeNull();
    expect(getMailer(log)).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toBe("enquiry.mail.disabled");
  });

  it("with all three set, builds a mailer for the configured addresses without connecting", () => {
    delete holder.__godMailer;
    vi.stubEnv("GOD_SMTP_URL", "smtp://127.0.0.1:25");
    vi.stubEnv("GOD_ENQUIRY_TO", CFG.to);
    vi.stubEnv("GOD_ENQUIRY_FROM", CFG.from);
    const log = vi.fn();
    const m = getMailer(log);
    expect(m).toMatchObject({ to: CFG.to, from: CFG.from });
    expect(log).not.toHaveBeenCalled();
  });

  it("an unusable GOD_SMTP_URL turns the email off with one log line, and never throws", () => {
    delete holder.__godMailer;
    vi.stubEnv("GOD_SMTP_URL", "http://nope");
    vi.stubEnv("GOD_ENQUIRY_TO", CFG.to);
    vi.stubEnv("GOD_ENQUIRY_FROM", CFG.from);
    const log = vi.fn();
    expect(getMailer(log)).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
  });
});
