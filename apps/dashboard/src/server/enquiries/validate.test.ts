import { describe, expect, it } from "vitest";
import { LIMITS, charLength, cleanLine, cleanMessage, validateEnquiry } from "./validate";

const good = {
  name: "Sam Lee",
  company: "Harbour & Bean",
  email: "sam@example.com",
  want: "Where do our customers live?",
  budget: "$10,000 to $50,000",
};

const fields = (v: ReturnType<typeof validateEnquiry>) => (v.ok ? [] : Object.keys(v.errors).sort());

describe("validateEnquiry: the site's rules", () => {
  it("accepts a complete enquiry and returns it trimmed", () => {
    const v = validateEnquiry({ ...good, name: "  Sam Lee  ", budget: "" });
    expect(v).toEqual({ ok: true, value: { ...good, budget: "" } });
  });

  it("requires name, company, email and message, and treats whitespace as empty", () => {
    for (const k of ["name", "company", "email", "want"] as const) {
      expect(fields(validateEnquiry({ ...good, [k]: "" }))).toEqual([k]);
      expect(fields(validateEnquiry({ ...good, [k]: " \t " }))).toEqual([k]);
    }
  });

  it("does not require the budget", () => {
    expect(validateEnquiry({ name: good.name, company: good.company, email: good.email, want: good.want }).ok).toBe(true);
  });

  it("says what the site says for a missing field and a bad email", () => {
    const v = validateEnquiry({ ...good, name: "", email: "sam@example" });
    expect(v).toEqual({
      ok: false,
      errors: { name: "Enter your name.", email: "Enter a valid email address, such as name@example.com." },
    });
  });

  it("counts a field that is not a string as missing", () => {
    for (const k of ["name", "company", "email", "want"] as const) {
      for (const bad of [null, 7, true, ["x"], { a: 1 }]) {
        expect(fields(validateEnquiry({ ...good, [k]: bad }))).toEqual([k]);
      }
    }
  });
});

describe("validateEnquiry: every field limit", () => {
  const atAndOver = (k: keyof typeof LIMITS, make: (n: number) => string) => {
    it(`${k}: ${LIMITS[k]} characters pass, one more fails`, () => {
      expect(validateEnquiry({ ...good, [k]: make(LIMITS[k]) }).ok).toBe(true);
      expect(fields(validateEnquiry({ ...good, [k]: make(LIMITS[k] + 1) }))).toEqual([k]);
    });
  };
  atAndOver("name", (n) => "n".repeat(n));
  atAndOver("company", (n) => "c".repeat(n));
  atAndOver("want", (n) => "w".repeat(n));
  atAndOver("budget", (n) => "b".repeat(n));
  atAndOver("email", (n) => `${"a".repeat(n - "@example.com".length)}@example.com`);

  it("counts characters the way Postgres does (code points), so an emoji is one", () => {
    expect(charLength("a😀b")).toBe(3);
    expect(validateEnquiry({ ...good, name: "😀".repeat(LIMITS.name) }).ok).toBe(true);
    expect(fields(validateEnquiry({ ...good, name: "😀".repeat(LIMITS.name + 1) }))).toEqual(["name"]);
  });

  it("counts the cleaned text, not the raw text: padding does not use up the limit", () => {
    expect(validateEnquiry({ ...good, name: `   ${"n".repeat(LIMITS.name)}   ` }).ok).toBe(true);
  });
});

describe("validateEnquiry: cleaning", () => {
  it("turns CR, LF, tab and NUL in a single-line field into one space", () => {
    const v = validateEnquiry({ ...good, name: "Sam\r\nBcc: evil@example.com", company: "A\u0000\tB", budget: "x\ny" });
    expect(v).toMatchObject({
      ok: true,
      value: { name: "Sam Bcc: evil@example.com", company: "A B", budget: "x y" },
    });
    expect(cleanLine("a\u2028b\u0085c")).toBe("a b c");
  });

  it("keeps the line breaks of a message, as LF, and drops other control characters", () => {
    expect(cleanMessage("one\r\ntwo\rthree\u2028four\u0000\u0007five\tsix")).toBe("one\ntwo\nthree\nfourfive six");
    const v = validateEnquiry({ ...good, want: "line one\r\n\r\nline two" });
    expect(v).toMatchObject({ ok: true, value: { want: "line one\n\nline two" } });
  });

  it("refuses a lone surrogate (a JSON escape Postgres cannot store) instead of failing at the database", () => {
    expect(fields(validateEnquiry({ ...good, name: "Sam \ud800" }))).toEqual(["name"]);
    expect(fields(validateEnquiry({ ...good, want: "\udc00 hello" }))).toEqual(["want"]);
    expect(fields(validateEnquiry({ ...good, email: "a\ud800@example.com" }))).toEqual(["email"]);
  });
});

describe("validateEnquiry: the email is checked, never repaired", () => {
  const bad = [
    "sam@example",
    "sam example@x.com",
    "@example.com",
    "sam@@example.com",
    "sam@example.com\r\nBcc: evil@example.com",
    "sam@example.com\nBcc: evil@example.com",
    "sam@example.com\u0000",
    "a@b.c,evil@example.org",
    "a@b.c;evil@example.org",
    "Sam <sam@example.com>",
    '"Sam" sam@example.com',
    "sam(comment)@example.com",
    "sam@[127.0.0.1]",
    "a\\b@example.com",
    "sam:x@example.com",
  ];
  for (const email of bad) {
    it(`refuses ${JSON.stringify(email)}`, () => {
      expect(fields(validateEnquiry({ ...good, email }))).toEqual(["email"]);
    });
  }

  it("accepts ordinary addresses, including plus tags and apostrophes", () => {
    for (const email of ["sam@example.com", "sam.lee+god@example.co.uk", "o'brien@example.com", "a@b.cd"]) {
      expect(validateEnquiry({ ...good, email }).ok).toBe(true);
    }
  });
});
