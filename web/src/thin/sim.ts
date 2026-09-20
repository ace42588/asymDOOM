/**
 * Sim origin for thin clients. Never inferred from location.host —
 * production Pages and future Android/native all use an explicit base.
 *
 * Dev: scripts/dev.mjs sets VITE_ASYM_API to the host port.
 * Pages: GitHub Actions variable VITE_ASYM_API (required at build time).
 */
import {
  joinUrl,
  wadUrl as contractsWadUrl,
  withSessionId,
  type JoinResponse,
} from "asymdoom-contracts";

/** Resolved sim HTTP base (no trailing slash). Throws if unset. */
export function getSimBase(): string {
  const raw = import.meta.env.VITE_ASYM_API?.trim();
  if (!raw) {
    throw new Error(
      "VITE_ASYM_API is not set. For local play use `npm run dev`. " +
        "For Pages builds set the VITE_ASYM_API Actions variable to the sim origin.",
    );
  }
  return raw.replace(/\/+$/, "");
}

export function getJoinUrl(): string {
  return joinUrl(getSimBase());
}

export function getWadUrl(): string {
  return contractsWadUrl(getSimBase());
}

/** Prefer absolute wsUrl from join; attach sessionId for sticky resume. */
export function resolveWsUrl(join: JoinResponse, sessionId: string | null): string {
  return withSessionId(join.wsUrl, sessionId);
}

export type { JoinResponse };
