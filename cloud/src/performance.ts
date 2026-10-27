import { Repository, Unit } from './model';

/** Opt-in numeric timings. Never record request data, identifiers or credentials. */
export class RequestTimings {
  private started = Date.now();
  private steps: Record<string, { count: number; ms: number; failed: number }> = {};
  async time<T>(name: string, work: () => Promise<T>): Promise<T> {
    const start = Date.now(); let failed = false;
    try { return await work(); } catch (error) { failed = true; throw error; }
    finally { const row = this.steps[name] ||= { count: 0, ms: 0, failed: 0 }; row.count++; row.ms += Date.now() - start; row.failed += Number(failed); }
  }
  snapshot() { return { totalMs: Date.now() - this.started, steps: this.steps }; }
}
export function measureRepository(repo: Repository, timings: RequestTimings): Repository {
  const unit = (source: Unit): Unit => ({
    get: (collection, id) => timings.time(`db.get.${collection}`, () => source.get(collection, id)),
    put: (collection, document) => timings.time(`db.put.${collection}`, () => source.put(collection, document)),
  });
  return { ...unit(repo), list: (collection, filter, options) => timings.time(`db.list.${collection}`, () => repo.list(collection, filter, options)),
    transaction: work => timings.time('db.transaction', () => repo.transaction(tx => work(unit(tx)))) };
}
