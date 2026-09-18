/**
 * Tab-scoped sticky session identity (sessionStorage).
 * Survives page reload / HMR; a second tab starts a new player.
 */

export const SESSION_ID_KEY = "asymdoom.sessionId";

export function loadSessionId(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const id = sessionStorage.getItem(SESSION_ID_KEY);
    return id && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

export function saveSessionId(sessionId: string): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(SESSION_ID_KEY, sessionId);
  } catch {
    /* private mode / quota */
  }
}
