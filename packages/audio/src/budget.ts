/**
 * Per-run generation budget (DESIGN §6.4 as amended by ADR 003): ≤ 75 s TTS + ≤ 75 s music.
 * Reserve before calling the provider, settle to the measured value after. Cache hits never
 * reserve, so they cost nothing.
 */
import { BudgetExceeded } from "./errors";

export type BudgetKind = "tts" | "music";

/** Characters per second used to estimate TTS length before the call. */
export const TTS_CHARS_PER_S = 15;

export const estimateTtsSeconds = (text: string) => text.length / TTS_CHARS_PER_S;

export interface Reservation {
  readonly id: number;
  readonly kind: BudgetKind;
  readonly seconds: number;
}

export interface BudgetOptions {
  ttsSeconds?: number;
  musicSeconds?: number;
}

const EPS = 1e-9;

export class Budget {
  private readonly limits: Record<BudgetKind, number>;
  private readonly usedS: Record<BudgetKind, number> = { tts: 0, music: 0 };
  private readonly generations: Record<BudgetKind, number> = { tts: 0, music: 0 };
  private readonly open = new Map<number, Reservation>();
  private nextId = 1;

  constructor(opts: BudgetOptions = {}) {
    this.limits = { tts: opts.ttsSeconds ?? 75, music: opts.musicSeconds ?? 75 };
  }

  limit(kind: BudgetKind) {
    return this.limits[kind];
  }
  used(kind: BudgetKind) {
    return round(this.usedS[kind]);
  }
  remaining(kind: BudgetKind) {
    return round(Math.max(0, this.limits[kind] - this.usedS[kind]));
  }

  /** Throws BudgetExceeded (a refusal) when the reservation would exceed the limit. */
  reserve(kind: BudgetKind, seconds: number): Reservation {
    assertSeconds(seconds);
    if (this.usedS[kind] + seconds > this.limits[kind] + EPS)
      throw new BudgetExceeded(kind, seconds, this.used(kind), this.limits[kind]);
    const r: Reservation = { id: this.nextId++, kind, seconds };
    this.usedS[kind] += seconds;
    this.open.set(r.id, r);
    return r;
  }

  /** Replace the estimate with the measured seconds (may overshoot; later reserves then refuse). */
  settle(r: Reservation, actualSeconds: number) {
    assertSeconds(actualSeconds);
    this.take(r);
    this.usedS[r.kind] += actualSeconds - r.seconds;
    this.generations[r.kind]++;
  }

  /** Give the reservation back (the provider produced nothing billable). */
  release(r: Reservation) {
    this.take(r);
    this.usedS[r.kind] -= r.seconds;
  }

  snapshot() {
    const one = (k: BudgetKind) => ({ used: this.used(k), limit: this.limits[k], generations: this.generations[k] });
    return { tts: one("tts"), music: one("music") };
  }

  private take(r: Reservation) {
    if (!this.open.delete(r.id)) throw new Error(`reservation ${r.id} already settled or released`);
  }
}

function assertSeconds(s: number) {
  if (!Number.isFinite(s) || s < 0) throw new RangeError(`seconds must be a finite number ≥ 0, got ${s}`);
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
