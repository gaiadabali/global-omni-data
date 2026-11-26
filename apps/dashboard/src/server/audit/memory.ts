import { dayRange } from "@/lib/dates";
import { isAuditAction, type AuditEvent, type AuditFilter, type AuditInput, type AuditLog } from "./types";

/** An event from synthetic history: like an input, with a time. Used only to seed the dev log. */
export interface SeedEvent extends AuditInput {
  when: string;
}

/**
 * The dev implementation: in memory, append-only. The object has exactly two methods, `append` and `list`, and is
 * frozen; every event is frozen; `list` hands out copies. Nothing can change or remove an event once it is in.
 * `seed` is synthetic history, loaded once at creation (it is not an append). `now` is injectable for tests.
 */
export function createMemoryAuditLog(opts: { seed?: readonly SeedEvent[]; now?: () => number } = {}): AuditLog {
  const now = opts.now ?? Date.now;
  const events: AuditEvent[] = [];
  let seq = 0;

  const make = (input: AuditInput, when: string): AuditEvent => {
    seq += 1;
    return Object.freeze({
      id: `ev-${seq}`,
      seq,
      when,
      who: input.who,
      action: input.action,
      target: input.target,
      reason: input.reason ?? "",
      outcome: input.outcome ?? "done",
    });
  };

  const seeded = [...(opts.seed ?? [])].sort((a, b) => Date.parse(a.when) - Date.parse(b.when));
  for (const s of seeded) events.push(make(s, new Date(Date.parse(s.when)).toISOString()));

  const log: AuditLog = {
    async append(input) {
      if (!input.who.trim()) throw new RangeError("audit: who is required");
      if (!input.target.trim()) throw new RangeError("audit: target is required");
      if (!isAuditAction(input.action)) throw new RangeError(`audit: unknown action ${String(input.action)}`);
      const ev = make(input, new Date(now()).toISOString());
      events.push(ev);
      return ev;
    },
    async list(filter: AuditFilter = {}) {
      const from = filter.from ? dayRange(filter.from)?.start : undefined;
      const to = filter.to ? dayRange(filter.to)?.end : undefined;
      const out = events
        .filter((e) => {
          if (filter.who && e.who !== filter.who) return false;
          if (filter.action && e.action !== filter.action) return false;
          if (filter.target && e.target !== filter.target) return false;
          if (filter.outcome && e.outcome !== filter.outcome) return false;
          const t = Date.parse(e.when);
          if (from !== undefined && t < from) return false;
          if (to !== undefined && t > to) return false;
          return true;
        })
        .sort((a, b) => Date.parse(b.when) - Date.parse(a.when) || b.seq - a.seq);
      return Object.freeze(filter.limit && filter.limit > 0 ? out.slice(0, filter.limit) : out);
    },
  };
  return Object.freeze(log);
}
