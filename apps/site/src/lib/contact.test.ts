import { describe, expect, it, vi } from "vitest";
import {
  buildPayload,
  EMAIL_INVALID_MESSAGE,
  submitContact,
  validateContact,
  type ContactInput,
} from "./contact";

const good: ContactInput = {
  name: "Sam Lee",
  company: "Harbour & Bean",
  email: "sam@example.com",
  want: "Where do our customers live?",
  budget: "",
  website: "",
};

describe("validateContact", () => {
  it("accepts a complete enquiry", () => {
    expect(validateContact(good)).toEqual({ ok: true, errors: {}, summary: "" });
  });

  it("lists every missing required field, in page order, and points at the first", () => {
    const v = validateContact({ ...good, company: "", want: "   " });
    expect(v.ok).toBe(false);
    expect(v.summary).toBe("Please fill in company, what you want to know.");
    expect(v.first).toBe("company");
    expect(Object.keys(v.errors)).toEqual(["company", "want"]);
  });

  it("treats whitespace as empty", () => {
    expect(validateContact({ ...good, name: "  \t" }).first).toBe("name");
  });

  it("rejects a malformed email once the rest is filled in", () => {
    const v = validateContact({ ...good, email: "sam@example" });
    expect(v.ok).toBe(false);
    expect(v.first).toBe("email");
    expect(v.summary).toBe("Please enter a valid email address.");
    expect(v.errors.email).toBe(EMAIL_INVALID_MESSAGE);
  });

  it("does not require the budget", () => {
    expect(validateContact({ ...good, budget: "" }).ok).toBe(true);
  });
});

describe("buildPayload", () => {
  it("trims text and keeps the honeypot as it came", () => {
    const p = buildPayload({ ...good, name: "  Sam  ", website: "spam" });
    expect(p.name).toBe("Sam");
    expect(p.website).toBe("spam");
  });
});

describe("submitContact", () => {
  it("does not send, and says so, when no endpoint is set", async () => {
    const fetchImpl = vi.fn();
    expect(await submitContact("", good, fetchImpl as unknown as typeof fetch)).toBe(
      "not-configured",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts JSON and reports sent only for a 2xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    expect(
      await submitContact(
        "https://forms.example.com/in",
        good,
        fetchImpl as unknown as typeof fetch,
      ),
    ).toBe("sent");
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://forms.example.com/in");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toMatchObject({
      email: "sam@example.com",
      website: "",
    });
  });

  it.each([301, 400, 404, 500])("reports failed for status %i", async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status }));
    expect(
      await submitContact("https://x.example/in", good, fetchImpl as unknown as typeof fetch),
    ).toBe("failed");
  });

  it("reports failed when the network throws", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("offline"));
    expect(
      await submitContact("https://x.example/in", good, fetchImpl as unknown as typeof fetch),
    ).toBe("failed");
  });
});
