import { test, expect } from 'vitest';
import {
  Agent, ManagedRealm, runSingleJobInQueue, setSurroundingAgent, ThreadCluster,
} from '#self';

/**
 * Extension coverage - threading.md, the execution model.
 *
 * Covers #sec-threading-agent-cluster, #sec-threading-scheduling, and
 * #sec-threading-callthread as implemented in E2b: a simulated cluster whose
 * agents share one realm and take turns a job at a time.
 *
 * The point of a simulation is that it can answer WHERE something ran, which is
 * exactly what these clauses constrain. It cannot answer anything whose content is
 * a race - nothing interleaves below a job boundary here, so a torn value-type
 * copy never happens and is not tested.
 *
 * AbortSignal is WHATWG rather than 262, so #sec-thread-cancellation refers to it
 * instead of defining it. src/intrinsics/AbortController.mts supplies the minimum
 * a host needs for these rules to run: aborted state, a reason, and wakers. It is
 * not the DOM object - no EventTarget, no addEventListener, no throwIfAborted.
 *
 * Known divergences from the specification, to be closed later:
 * - The Lock and Condition wait checkpoints do not exist yet, those primitives
 *   being unimplemented. Every other checkpoint is covered below: thread start,
 *   job dequeue (which subsumes await resumption, a resumption being a job of
 *   the thread's own queue), and the Atomics wait.
 */

interface Harness {
  cluster: ThreadCluster;
  main: Agent;
  realm: ManagedRealm;
  evaluate(source: string): string;
  /** Run the cluster to idle, attributing each new log entry to the agent that produced it. */
  runAttributed(): string[];
}

function makeCluster(setup: string): Harness {
  const main = new Agent({ features: ['runtime-types'], eventLoopRunType: 'manual' });
  const cluster = new ThreadCluster(main);
  main.hostDefinedOptions.threadCluster = cluster;
  setSurroundingAgent(main);
  const realm = new ManagedRealm();

  const evaluate = (source: string) => {
    setSurroundingAgent(main);
    const completion = realm.evaluateScriptSkipDebugger(source);
    if (completion.Type === 'throw') {
      throw new Error(`evaluation threw: ${String(completion.Value)}`);
    }
    return (completion.Value as { stringValue?(): string }).stringValue?.() ?? '';
  };

  const readLog = () => {
    const joined = evaluate('log.join("\\u0001")');
    return joined === '' ? [] : joined.split('\u0001');
  };

  evaluate(`globalThis.log = [];\n${setup}`);

  const runAttributed = () => {
    const attribution: string[] = [];
    let seen = readLog().length;
    let guard = 0;
    while (cluster.hasWork) {
      guard += 1;
      expect(guard).toBeLessThan(1000);
      const before = cluster.executionOrder.length;
      cluster.runOneJob();
      const agent = cluster.executionOrder[before];
      const now = readLog();
      for (let i = seen; i < now.length; i += 1) {
        attribution.push(`${now[i]} @ ${agent === main ? 'MAIN' : 'THREAD'}`);
      }
      seen = now.length;
    }
    return attribution;
  };

  return {
    cluster, main, realm, evaluate, runAttributed,
  };
}

// -- The cluster ---------------------------------------------------------------
test('agent cluster: a spawned thread is a new agent of the cluster sharing one heap', () => {
  const h = makeCluster(`
    globalThis.shared = { count: 0 };
    function body() { shared.count += 1; return shared.count; }
    globalThis.handle = body.callThread();
  `);
  expect(h.cluster.agents.length).toBe(2);
  h.cluster.runUntilIdle();
  // The object the thread mutated is the SAME object on the main thread. Nothing
  // was copied, which is what a shared heap means.
  expect(h.evaluate('String(shared.count)')).toBe('1');
});

test('callThread: the handle resolves with the function result', () => {
  const h = makeCluster(`
    function body() { return 7; }
    body.callThread().then(v => { log.push('resolved ' + v); });
  `);
  h.cluster.runUntilIdle();
  expect(h.evaluate('log.join(",")')).toBe('resolved 7');
});

test('callThread: a throwing thread rejects the handle', () => {
  const h = makeCluster(`
    function body() { throw new TypeError('boom'); }
    body.callThread().catch(e => { log.push('rejected ' + e.message); });
  `);
  h.cluster.runUntilIdle();
  expect(h.evaluate('log.join(",")')).toBe('rejected boom');
});

test('callThread: arguments are forwarded', () => {
  const h = makeCluster(`
    function body(a, b) { return a + b; }
    body.callThread(2, 3).then(v => { log.push('sum ' + v); });
  `);
  h.cluster.runUntilIdle();
  expect(h.evaluate('log.join(",")')).toBe('sum 5');
});

// -- D1: a reaction runs on the thread that created it --------------------------
test('D1 scheduling: a reaction created on main runs on main, though a thread settles it', () => {
  // This is the decision the whole scheduling clause turns on. The spawned thread
  // settles both promises; neither reaction may run there.
  const h = makeCluster(`
    globalThis.res = null;
    globalThis.p = new Promise(r => { globalThis.res = r; });
    p.then(() => { log.push('bare-then reaction'); });
    function body() { log.push('thread body'); res(1); return 'done'; }
    body.callThread().then(() => { log.push('handle reaction'); });
  `);
  expect(h.runAttributed()).toEqual([
    'thread body @ THREAD',
    'bare-then reaction @ MAIN',
    'handle reaction @ MAIN',
  ]);
});

test('D1 scheduling: the callThread handle is not a special case', () => {
  // The handle settles on the spawning thread for the same reason every other
  // promise does - its reactions were created there - so the clause needs no
  // carve-out for it. Attaching to the same handle from the thread would run
  // there; there is one rule, not two.
  const h = makeCluster(`
    function body() { return 1; }
    globalThis.handle = body.callThread();
    handle.then(() => { log.push('attached on main'); });
  `);
  const attributed = h.runAttributed();
  expect(attributed).toContain('attached on main @ MAIN');
});

// -- D6: lifetime ---------------------------------------------------------------
test('D6 lifetime: a thread drains its own microtasks before its result is observed', () => {
  // #sec-createthread drains the thread's queue before posting the settlement, so
  // everything the thread did - trailing microtasks included - happens-before the
  // spawner observes the result.
  const h = makeCluster(`
    function body() {
      Promise.resolve().then(() => { log.push('thread microtask'); });
      return 'result';
    }
    body.callThread().then(() => { log.push('spawner observes result'); });
  `);
  const attributed = h.runAttributed();
  expect(attributed.indexOf('thread microtask @ THREAD'))
    .toBeLessThan(attributed.indexOf('spawner observes result @ MAIN'));
});

test('D6 lifetime: the thread is removed from the cluster when it ends', () => {
  const h = makeCluster(`
    function body() { return 1; }
    body.callThread();
  `);
  expect(h.cluster.agents.length).toBe(2);
  h.cluster.runUntilIdle();
  expect(h.cluster.agents.length).toBe(1);
});

// -- D6: an async thread function -----------------------------------------------
test('D6 lifetime: an async thread function runs past its first await', () => {
  // #sec-createthread adopts a thenable result. Without the adoption the handle
  // settles with the PROMISE the async function returned the moment it suspended,
  // and the thread is removed while still holding work - so the body past the
  // await never runs and the handle resolves with a promise rather than a result.
  const h = makeCluster(`
    async function body() { log.push('before await'); await null; log.push('after await'); return 42; }
    body.callThread().then(v => { log.push('handle ' + v); });
  `);
  h.cluster.runUntilIdle();
  expect(h.evaluate('log.join(",")')).toBe('before await,after await,handle 42');
});

test('D6 lifetime: an async thread function that throws after an await rejects the handle', () => {
  const h = makeCluster(`
    async function body() { await null; throw new TypeError('boom'); }
    body.callThread().catch(e => { log.push('rejected ' + e.message); });
  `);
  h.cluster.runUntilIdle();
  expect(h.evaluate('log.join(",")')).toBe('rejected boom');
});

test('D6 lifetime: a plain thenable result is adopted too', () => {
  // Not only async functions: the clause says a thenable, and a hand-rolled one
  // is a thenable.
  const h = makeCluster(`
    function body() { return { then(resolve) { resolve('adopted'); } }; }
    body.callThread().then(v => { log.push('got ' + v); });
  `);
  h.cluster.runUntilIdle();
  expect(h.evaluate('log.join(",")')).toBe('got adopted');
});

test('D6 lifetime: the thread is still removed once an adopted result settles', () => {
  const h = makeCluster(`
    async function body() { await null; return 1; }
    body.callThread();
  `);
  expect(h.cluster.agents.length).toBe(2);
  h.cluster.runUntilIdle();
  expect(h.cluster.agents.length).toBe(1);
});

test('D2 cancellation: an abort wakes a wait parked inside an async thread', () => {
  // The last checkpoint of #sec-thread-cancellation, and the one that needed both
  // the adoption above (so the thread is still alive to be woken) and the
  // ordering that lets a delivered abort unwind rather than abandoning the
  // thread. The reason is thrown FROM the wait, so the catch runs.
  const h = makeCluster(`
    globalThis.c = new AbortController();
    let a: shared int32 = 0;
    async function park() {
      log.push('parking');
      try { await Atomics.waitAsync(ref a, 0); log.push('woke normally'); }
      catch (e) { log.push('woken by abort: ' + e); }
    }
    park.callThread({ signal: c.signal });
  `);
  // Let the thread reach the park, then abort.
  h.cluster.runOneJob();
  h.evaluate('c.abort("cancelled");');
  h.cluster.runUntilIdle();
  expect(h.evaluate('log.join(" | ")')).toBe('parking | woken by abort: cancelled');
});

test('callThread works in a host that configured no cluster', () => {
  // The devtools case. Every agent is an agent of a cluster, possibly of one, so
  // a host that has configured none is not a host without threads - it is one
  // that has not been asked yet. A cluster created on demand drives itself from
  // the spawning agent's own job queue, one job per pump, so the threads are
  // interleaved by the host's existing event loop and callThread works in an
  // embedder that has done nothing to enable it.
  const agent = new Agent({ features: ['runtime-types'], eventLoopRunType: 'manual' });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  const evaluate = (source: string) => {
    setSurroundingAgent(agent);
    return (realm.evaluateScriptSkipDebugger(source).Value as { stringValue?(): string }).stringValue?.() ?? '';
  };
  evaluate(`
    globalThis.out = 'pending';
    function body() { return 7; }
    body.callThread().then((v) => { out = 'resolved ' + v; });
    "";
  `);
  // Drive only the HOST's queue, as an embedder does.
  let guard = 0;
  while (agent.jobQueue.length > 0) {
    guard += 1;
    expect(guard).toBeLessThan(500);
    setSurroundingAgent(agent);
    runSingleJobInQueue(agent.jobQueue.shift()!, () => {}, () => {});
  }
  expect(evaluate('String(out)')).toBe('resolved 7');
});

// -- D8: the options bag --------------------------------------------------------
test('D8 options: an ordinary first argument is forwarded, not read as a bag', () => {
  const h = makeCluster(`
    function body(o) { return o.value; }
    body.callThread({ value: 9 }).then(v => { log.push('got ' + v); });
  `);
  h.cluster.runUntilIdle();
  expect(h.evaluate('log.join(",")')).toBe('got 9');
});

test('D8 options: an empty object is taken as an explicit bag', () => {
  const h = makeCluster(`
    function body(...args) { return args.length; }
    body.callThread({}).then(v => { log.push('args ' + v); });
  `);
  h.cluster.runUntilIdle();
  expect(h.evaluate('log.join(",")')).toBe('args 0');
});

test('D8 options: a declared first parameter that admits the object wins over the bag rule', () => {
  // #sec-classifythreadarguments step 4, and the distinctive step of the whole
  // rule: the ambiguity untyped JavaScript cannot resolve, a signature resolves.
  const h = makeCluster(`
    function body(o: { value: uint8 }) { return o.value; }
    body.callThread({ value: 3 }).then(v => { log.push('got ' + v); });
  `);
  h.cluster.runUntilIdle();
  expect(h.evaluate('log.join(",")')).toBe('got 3');
});

test('D8 options: the signature overrides even the empty-object bag', () => {
  // Step 4 precedes step 5, so a callee that asks for an object gets the empty
  // object as its argument rather than losing it to an explicit empty bag.
  const h = makeCluster(`
    function body(o: object) { return 'received-object'; }
    body.callThread({}).then(v => { log.push(v); });
  `);
  h.cluster.runUntilIdle();
  expect(h.evaluate('log.join(",")')).toBe('received-object');
});

test('D8 options: a declared first parameter that refuses the object leaves it a bag', () => {
  const h = makeCluster(`
    function body(n: uint8 = 0) { return n; }
    body.callThread({}).then(v => { log.push('n=' + v); });
  `);
  h.cluster.runUntilIdle();
  expect(h.evaluate('log.join(",")')).toBe('n=0');
});

test('D8 options: any signature of an overloaded callee suffices', () => {
  // "a signature whose first parameter admits first" - one is enough. An
  // overloaded callee that can receive the object in at least one of its shapes
  // is a callee the program meant to hand it to; picking among the shapes is
  // overload resolution's job at the call, not this operation's.
  const h = makeCluster(`
    function body(n: uint8): string { return 'num'; }
    function body(x: any): string { return x === undefined ? 'no-arg' : 'got-object'; }
    body.callThread({}).then(v => { log.push(v); });
  `);
  h.cluster.runUntilIdle();
  expect(h.evaluate('log.join(",")')).toBe('got-object');
});

// -- D2: cancellation -----------------------------------------------------------
test('D2 cancellation: an already-aborted signal rejects without spawning a thread', () => {
  const h = makeCluster(`
    globalThis.c = new AbortController();
    c.abort('too late');
    function body() { log.push('body ran'); }
    body.callThread({ signal: c.signal }).catch(e => { log.push('rejected: ' + e); });
  `);
  // No thread was created at all - the cluster is just the main agent.
  expect(h.cluster.agents.length).toBe(1);
  h.cluster.runUntilIdle();
  expect(h.evaluate('log.join(",")')).toBe('rejected: too late');
});

test('D2 cancellation: aborting before the thread runs abandons its work and rejects', () => {
  const h = makeCluster(`
    globalThis.c = new AbortController();
    function body() { log.push('body ran'); }
    body.callThread({ signal: c.signal }).catch(e => { log.push('rejected: ' + e); });
    c.abort('stop');
  `);
  h.cluster.runUntilIdle();
  // Taking a job from the queue is a checkpoint, so the body never runs.
  expect(h.evaluate('log.join(",")')).toBe('rejected: stop');
});

test('D2 cancellation: a signal that is never aborted changes nothing', () => {
  const h = makeCluster(`
    globalThis.c = new AbortController();
    function body() { log.push('body ran'); return 1; }
    body.callThread({ signal: c.signal }).then(v => { log.push('resolved ' + v); });
  `);
  h.cluster.runUntilIdle();
  expect(h.evaluate('log.join(",")')).toBe('body ran,resolved 1');
});

test('D2 cancellation: aborted state is readable from another thread', () => {
  // "A computation with no suspension point is cancelled cooperatively, by reading
  // the signal's aborted state, which crosses threads because the signal is an
  // object of the shared heap." The thread reads the same object main aborted.
  const h = makeCluster(`
    globalThis.c = new AbortController();
    function body() { log.push('sees aborted=' + c.signal.aborted); return 1; }
    body.callThread().then(v => { log.push('resolved ' + v); });
    c.abort('x');
  `);
  h.cluster.runUntilIdle();
  expect(h.evaluate('log.join(",")')).toBe('sees aborted=true,resolved 1');
});

test('D8/D2: an object whose `signal` is not an AbortSignal is an argument, not a bag', () => {
  // Step 6 of #sec-classifythreadarguments tests the BRAND, so an object carrying
  // something else under `signal` is not a bag at all. It is forwarded.
  const h = makeCluster(`
    function body(o) { return 'arg:' + typeof o; }
    body.callThread({ signal: {} }).then(v => { log.push(v); });
  `);
  h.cluster.runUntilIdle();
  expect(h.evaluate('log.join(",")')).toBe('arg:object');
});

test('D2 cancellation: an inherited non-AbortSignal `signal` is a TypeError', () => {
  // The one path that reaches callThread's validation step. Classification counts
  // OWN keys, so an object with none is an explicit empty bag; extraction then
  // uses Get, which walks the prototype chain and finds the inherited value. An
  // inherited REAL signal is used; an inherited non-signal throws here rather
  // than being silently ignored.
  const h = makeCluster('globalThis.body = function () { return 1; };');
  expect(() => h.evaluate('body.callThread(Object.create({ signal: 5 }))')).toThrow();
});

// -- Determinism ----------------------------------------------------------------
test('the interleaving is deterministic across runs', () => {
  const script = `
    globalThis.res = null;
    globalThis.p = new Promise(r => { globalThis.res = r; });
    p.then(() => { log.push('B'); });
    function body() { log.push('A'); res(1); return 1; }
    body.callThread().then(() => { log.push('C'); });
  `;
  const first = makeCluster(script).runAttributed();
  const second = makeCluster(script).runAttributed();
  expect(second).toEqual(first);
});
