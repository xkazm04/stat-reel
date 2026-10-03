/**
 * The single-worker lease (ADR 010): one row, `worker_lease(id='generation')`. Only the holder runs
 * jobs, which is what keeps the queue to one job at a time across processes. A lease is taken over
 * when its heartbeat is stale, or when its pid is dead on this host (a restarted worker must not
 * wait a minute for its own predecessor).
 */
import { hostname } from "node:os";
import { type Db, now } from "../db";
import { isAlive } from "../proc";

export const LEASE_ID = "generation";
export const LEASE_STALE_MS = 60_000;

export type LeaseOptions = { pid?: number; host?: string; clock?: () => number; isAlive?: (pid: number) => boolean; staleMs?: number };
type LeaseRow = { pid: number; host: string; heartbeat_at: string };

const iso = (ms: number) => new Date(ms).toISOString();

export function acquireLease(db: Db, o: LeaseOptions = {}): { ok: true } | { ok: false; pid: number; heartbeat_at: string } {
  const c = db.$client;
  const pid = o.pid ?? process.pid;
  const host = o.host ?? hostname();
  const clock = o.clock ?? Date.now;
  const alive = o.isAlive ?? isAlive;
  const stale = o.staleMs ?? LEASE_STALE_MS;
  const tx = c.transaction((): { ok: true } | { ok: false; pid: number; heartbeat_at: string } => {
    const row = c.prepare("select pid, host, heartbeat_at from worker_lease where id = ?").get(LEASE_ID) as LeaseRow | undefined;
    const hb = iso(clock());
    if (!row) {
      c.prepare("insert into worker_lease (id, pid, host, heartbeat_at) values (?,?,?,?)").run(LEASE_ID, pid, host, hb);
      return { ok: true };
    }
    const mine = row.pid === pid && row.host === host;
    const isStale = Date.parse(row.heartbeat_at) < clock() - stale;
    const deadHere = row.host === host && !alive(row.pid);
    if (mine || isStale || deadHere) {
      c.prepare("update worker_lease set pid = ?, host = ?, heartbeat_at = ? where id = ?").run(pid, host, hb, LEASE_ID);
      return { ok: true };
    }
    return { ok: false, pid: row.pid, heartbeat_at: row.heartbeat_at };
  });
  return tx.immediate();
}

/** Returns false when this process no longer holds the lease (someone took it over). */
export function heartbeatLease(db: Db, o: LeaseOptions = {}): boolean {
  const pid = o.pid ?? process.pid;
  const host = o.host ?? hostname();
  const hb = o.clock ? iso(o.clock()) : now();
  return db.$client.prepare("update worker_lease set heartbeat_at = ? where id = ? and pid = ? and host = ?").run(hb, LEASE_ID, pid, host).changes === 1;
}

export function releaseLease(db: Db, o: LeaseOptions = {}): void {
  db.$client.prepare("delete from worker_lease where id = ? and pid = ? and host = ?").run(LEASE_ID, o.pid ?? process.pid, o.host ?? hostname());
}

export type WorkerStatus = { online: boolean; pid: number | null; heartbeat_at: string | null };
export function leaseStatus(db: Db, o: { clock?: () => number; staleMs?: number; host?: string; isAlive?: (pid: number) => boolean } = {}): WorkerStatus {
  const row = db.$client.prepare("select pid, host, heartbeat_at from worker_lease where id = ?").get(LEASE_ID) as LeaseRow | undefined;
  if (!row) return { online: false, pid: null, heartbeat_at: null };
  const fresh = Date.parse(row.heartbeat_at) >= (o.clock ?? Date.now)() - (o.staleMs ?? LEASE_STALE_MS);
  const here = row.host === (o.host ?? hostname());
  return { online: fresh && (!here || (o.isAlive ?? isAlive)(row.pid)), pid: row.pid, heartbeat_at: row.heartbeat_at };
}
