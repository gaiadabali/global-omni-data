import { describe, expect, it } from "vitest";
import { createEnquiryLimiter, ENQUIRY_GLOBAL, ENQUIRY_PER_PREFIX, ENQUIRY_WINDOW_MS } from "./rate-limit";

const T0 = 1_000_000;

describe("enquiry rate limiter", () => {
  it("defaults to 5 an hour per prefix and 100 an hour in total", () => {
    expect([ENQUIRY_PER_PREFIX, ENQUIRY_GLOBAL, ENQUIRY_WINDOW_MS]).toEqual([5, 100, 3_600_000]);
  });

  it("refuses the request after the limit, and says how long to wait", () => {
    const l = createEnquiryLimiter({ perPrefix: 2, windowMs: 60_000 });
    expect(l.take("a", T0)).toEqual({ ok: true });
    expect(l.take("a", T0 + 10_000)).toEqual({ ok: true });
    expect(l.take("a", T0 + 20_000)).toEqual({ ok: false, scope: "prefix", retryAfterSeconds: 40 });
    expect(l.take("b", T0 + 20_000)).toEqual({ ok: true });
  });

  it("a refused request does not extend the wait", () => {
    const l = createEnquiryLimiter({ perPrefix: 1, windowMs: 60_000 });
    l.take("a", T0);
    for (let i = 1; i < 20; i++) l.take("a", T0 + i * 1000);
    expect(l.take("a", T0 + 60_000)).toEqual({ ok: true });
  });

  it("only requests that pass the prefix limit count against the global one", () => {
    const l = createEnquiryLimiter({ perPrefix: 1, global: 3, windowMs: 60_000 });
    l.take("noisy", T0);
    for (let i = 0; i < 50; i++) expect(l.take("noisy", T0 + i).ok).toBe(false);
    expect(l.take("x", T0).ok).toBe(true);
    expect(l.take("y", T0).ok).toBe(true);
    expect(l.take("z", T0)).toMatchObject({ ok: false, scope: "global" });
  });

  it("forgets idle prefixes, so the map does not grow without bound", () => {
    const l = createEnquiryLimiter({ perPrefix: 1, windowMs: 1_000 });
    for (let i = 0; i < 5_000; i++) l.take(`p${i}`, T0);
    // Much later every old prefix is free again.
    for (let i = 0; i < 5_000; i += 997) expect(l.take(`p${i}`, T0 + 5_000).ok).toBe(true);
  });
});
