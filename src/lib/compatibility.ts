/**
 * Which versions work together. Each release carries two numbers (compatibility.json, set by
 * the maintainer): the oldest manager that can manage its server, and the oldest server its
 * manager can manage.
 */

/** This interface's version (the server's, or the desktop manager's own pages). */
export const THIS_VERSION = __APP_VERSION__;
export const OLDEST_MANAGER = __COMPATIBILITY__.oldest_manager;
export const OLDEST_SERVER = __COMPATIBILITY__.oldest_server;

function parts(version: string): number[] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  return m ? m.slice(1, 4).map(Number) : null;
}

/** Whether `version` comes before `than` (unknown versions never do). */
export function isOlder(version: string, than: string): boolean {
  const a = parts(version);
  const b = parts(than);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

export interface ManagerVersion {
  version: string;
  /** The oldest server it manages. */
  oldestServer?: string;
}

export interface ServerVersion {
  version: string;
  /** The oldest manager that manages it (older servers don't say). */
  oldestManager?: string;
}

export interface CompatibilityProblem {
  /** Which one to update. */
  update: "manager" | "server";
  message: string;
}

/** What keeps a manager and a server from working together, or null when they do. */
export function compatibilityProblem(manager: ManagerVersion, server: ServerVersion): CompatibilityProblem | null {
  if (server.oldestManager && isOlder(manager.version, server.oldestManager))
    return { update: "manager", message: `This server needs OpenPres ${server.oldestManager} or newer on the manager: update the manager (it has ${manager.version}).` };
  if (manager.oldestServer && isOlder(server.version, manager.oldestServer))
    return { update: "server", message: `This manager needs a server with OpenPres ${manager.oldestServer} or newer: update the server (it has ${server.version}).` };
  return null;
}
