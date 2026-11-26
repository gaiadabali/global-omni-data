/**
 * The dev sign-in guard. Dev sign-in is on only when GOD_DEV_AUTH=1 AND GOD_DEPLOYMENT=dev.
 * GOD_DEV_AUTH=1 with any other GOD_DEPLOYMENT is a misconfiguration: the server refuses to start
 * (src/instrumentation.ts calls assertDevAuthSafe).
 */
export type DevAuthState = "off" | "on" | "refuse";

type Env = Record<string, string | undefined>;

export function devAuthState(env: Env = process.env): DevAuthState {
  if (env.GOD_DEV_AUTH !== "1") return "off";
  return env.GOD_DEPLOYMENT === "dev" ? "on" : "refuse";
}

/** True only for GOD_DEV_AUTH=1 with GOD_DEPLOYMENT=dev. */
export function isDevAuthEnabled(env: Env = process.env): boolean {
  return devAuthState(env) === "on";
}

export class DevAuthRefusedError extends Error {
  constructor(deployment: string | undefined) {
    super(
      `Refusing to start: GOD_DEV_AUTH=1 but GOD_DEPLOYMENT is ${
        deployment === undefined ? "not set" : JSON.stringify(deployment)
      }. Dev sign-in is allowed only with GOD_DEPLOYMENT=dev. Unset GOD_DEV_AUTH on staging and production.`,
    );
    this.name = "DevAuthRefusedError";
  }
}

/** Throws when dev sign-in is switched on outside a dev deployment. */
export function assertDevAuthSafe(env: Env = process.env): void {
  if (devAuthState(env) === "refuse") throw new DevAuthRefusedError(env.GOD_DEPLOYMENT);
}
