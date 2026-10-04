/**
 * The board <-> queue transitions of SPEC D.2, each in ONE SQLite transaction with the decision itself:
 *   1  accept a case            -> enqueue visual_options (idempotent)
 *   2  reject an accepted case  -> cancel its jobs
 *   3  accept a variant of an accepted case -> gate, then enqueue generate_video
 *   5  accept a variant         -> archive its pending siblings (undo restores them)
 */
import type { GenerationJob } from "@statreel/schemas";
import type { BoardItem, BoardService, Decision } from "../board";
import type { CaseDecision, CaseIdea, CaseIdeas } from "../library";
import type { Db } from "../db";
import { type GenerationQueue, QueueConflict } from "./queue";

export type GateVerdict = { ok: true } | { ok: false; reason: string };
export type Gate = (req: { case_id: string; board_item_id: string }) => GateVerdict;

export type CaseDecided = { idea: CaseIdea; job?: GenerationJob; existing?: boolean };
export type ItemDecided = { item: BoardItem; archived_ids?: string[]; restored_ids?: string[]; job?: GenerationJob; gate?: GateVerdict };

const ACTIVE = ["queued", "running"];

export class GenerationFlow {
  constructor(private readonly d: { db: Db; board: BoardService; cases: CaseIdeas; queue: GenerationQueue; gate: Gate }) {}

  private tx<T>(fn: () => T): T {
    return this.d.db.$client.transaction(fn)();
  }

  /**
   * Filter by status in SQL, like queueGuard: the newest 500 rows of ALL statuses miss an active job once 500 rows
   * are newer than it - and `retry` re-queues an old row with its original created_at (job rows are never pruned).
   */
  private cancelActive(filter: (j: GenerationJob) => boolean): void {
    for (const status of ACTIVE) for (const j of this.d.queue.list({ status, limit: 500 })) if (filter(j)) this.d.queue.cancel(j.id);
  }

  /** Enqueue, or hand back the job that already exists (active, or done: no second set without `force`). */
  private enqueue(req: Parameters<GenerationQueue["enqueue"]>[0]): { job: GenerationJob; existing: boolean } {
    try {
      return this.d.queue.enqueue(req);
    } catch (e) {
      if (e instanceof QueueConflict && e.job) return { job: e.job, existing: true };
      throw e;
    }
  }

  decideCase(id: string, decision: CaseDecision, note?: string): CaseDecided {
    return this.tx(() => {
      const idea = this.d.cases.decide(id, decision, note);
      if (decision === "accept") {
        const { job, existing } = this.enqueue({ type: "visual_options", case_id: id });
        return { idea, job, existing };
      }
      this.cancelActive((j) => j.case_id === id);
      return { idea };
    });
  }

  decideItem(id: string, decision: Decision, note?: string): ItemDecided {
    return this.tx(() => {
      const before = this.d.board.get(id);
      const item = this.d.board.decide(id, decision, note);
      if (decision === "accept") {
        const archived_ids = this.d.board.supersedeSiblings(id);
        const out: ItemDecided = { item, ...(archived_ids.length ? { archived_ids } : {}) };
        const idea = item.case_idea_id ? this.d.cases.get(item.case_idea_id) : undefined;
        if (idea?.status === "accepted") {
          const verdict = this.d.gate({ case_id: idea.id, board_item_id: id });
          if (verdict.ok) out.job = this.enqueue({ type: "generate_video", case_id: idea.id, board_item_id: id }).job;
          else out.gate = verdict;
        }
        return out;
      }
      // a variant that was accepted and is now rejected: its siblings come back, its video job is cancelled
      if (before?.status === "accepted") {
        const restored_ids = this.d.board.restoreSiblings(id);
        this.cancelActive((j) => j.board_item_id === id);
        return { item, ...(restored_ids.length ? { restored_ids } : {}) };
      }
      return { item };
    });
  }
}
