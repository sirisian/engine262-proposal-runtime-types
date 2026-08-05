import {
  Agent,
  Assert,
  type Job,
  runSingleJobInQueue,
  setSurroundingAgent,
  surroundingAgent,
  type Value,
} from '#self';

/**
 * proposal-runtime-types #sec-threading-agent-cluster: the threads of one program
 * are the agents of one agent cluster that share a heap - one realm, one global
 * object, one already-executed module graph, one intern table. Nothing is copied
 * between them.
 *
 * This is a SIMULATED cluster. Agents take turns rather than running at once, and
 * a turn is one job, so an interleaving is deterministic and reproducible. What
 * that buys is the ability to test the rules that say WHERE something runs - which
 * agent's queue a promise reaction lands on, which agent a continuation resumes on
 * - since those rules are observable in a simulation and are the rules the
 * specification actually states. What it cannot test is anything whose content is
 * a race: a torn multi-field copy never happens here, because nothing interleaves
 * below a job boundary.
 */
export class ThreadCluster {
  /** The agent that evaluated the program. It is a thread like the others. */
  readonly mainAgent: Agent;

  #threads: Agent[] = [];

  #order: Agent[] = [];

  constructor(mainAgent: Agent) {
    this.mainAgent = mainAgent;
  }

  /** Every agent of the cluster, main thread first, in creation order. */
  get agents(): readonly Agent[] {
    return [this.mainAgent, ...this.#threads];
  }

  addThread(agent: Agent): void {
    this.#threads.push(agent);
  }

  removeThread(agent: Agent): void {
    const i = this.#threads.indexOf(agent);
    if (i >= 0) {
      this.#threads.splice(i, 1);
    }
  }

  /** Whether any agent of the cluster has a job waiting. */
  get hasWork(): boolean {
    return this.agents.some((a) => a.jobQueue.length > 0);
  }

  /**
   * Run one job, on the agent whose turn it is. Round-robin over the agents that
   * have work, so a thread that is busy cannot starve one that is not, and the
   * order a job runs in is a function of the program rather than of the host.
   *
   * Returns false when no agent had work.
   */
  runOneJob(): boolean {
    const ready = this.agents.filter((a) => a.jobQueue.length > 0);
    if (ready.length === 0) {
      return false;
    }
    // Continue past whoever ran last, so the turn moves on even when the agent
    // that just ran queued more work for itself.
    const last = this.#order[this.#order.length - 1];
    const startAt = last === undefined ? 0 : (ready.indexOf(last) + 1) % ready.length;
    const agent = ready[startAt === -1 ? 0 : startAt];
    this.#order.push(agent);
    runJobOn(agent, agent.jobQueue.shift()!);
    return true;
  }

  /**
   * Run jobs until every agent of the cluster is idle. `limit` bounds the run so a
   * program that schedules forever fails a test rather than hanging it.
   */
  runUntilIdle(limit = 100_000): void {
    let n = 0;
    while (this.hasWork) {
      n += 1;
      Assert(n <= limit);
      this.runOneJob();
    }
  }

  /** The order jobs ran in, by agent, for a test that asserts on interleaving. */
  get executionOrder(): readonly Agent[] {
    return this.#order;
  }
}

/**
 * Run one job with `agent` installed as the surrounding agent, and restore
 * whatever was surrounding before. This is the whole of what a thread is here: an
 * agent holding its own execution context stack and its own queue, executed one
 * job at a time by whoever is driving.
 */
export function runJobOn(agent: Agent, job: Job): void {
  const previous = surroundingAgent;
  setSurroundingAgent(agent);
  try {
    runSingleJobInQueue(job, (error: Value) => {
      agent.hostDefinedOptions.uncaughtExceptionTrackers?.forEach((tracker) => tracker(error));
    }, () => {});
  } finally {
    setSurroundingAgent(previous);
  }
}
