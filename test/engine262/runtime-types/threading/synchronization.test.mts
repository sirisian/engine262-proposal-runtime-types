import { test, expect } from 'vitest';
import {
  Agent, ManagedRealm, setSurroundingAgent, ThreadCluster,
} from '#self';

/**
 * Extension coverage - threading.md, #sec-threading-synchronization.
 *
 * WHAT IS SIMULATED. An agent of the simulated cluster does not block: a job runs
 * to completion before the driver runs anything else, so a blocking acquire would
 * stop the cluster rather than one thread of it. The BLOCKING forms therefore
 * throw whenever they would have to wait - hold and acquire on a held Lock, and
 * Condition.wait always - which is a divergence of the simulation and not of the
 * clause. The uncontended fast paths of hold and acquire do run, since they never
 * wait, and the async forms run in full.
 *
 */

function makeCluster(setup: string) {
  const main = new Agent({ features: ['runtime-types'], eventLoopRunType: 'manual' });
  const cluster = new ThreadCluster(main);
  main.hostDefinedOptions.threadCluster = cluster;
  setSurroundingAgent(main);
  const realm = new ManagedRealm();
  const evaluate = (source: string) => {
    setSurroundingAgent(main);
    const completion = realm.evaluateScriptSkipDebugger(source) as unknown as { Type: string, Value: unknown };
    if (completion.Type === 'throw') {
      throw new Error('evaluation threw');
    }
    return (completion.Value as { stringValue?(): string }).stringValue?.() ?? '';
  };
  evaluate(`globalThis.log = [];\n${setup}`);
  return {
    cluster, main, evaluate, log: () => evaluate('log.join(" | ")'),
  };
}

// -- Lock: the uncontended paths ------------------------------------------------
test('Lock: hold returns the callback result', () => {
  const h = makeCluster('var l = new Lock(); log.push(l.hold(() => 42));');
  expect(h.log()).toBe('42');
});

test('Lock: hold releases whether the callback returns or throws', () => {
  // "the release has the force of a finally"
  const h = makeCluster(`
    var l = new Lock();
    try { l.hold(() => { throw new Error('x'); }); } catch (e) { log.push('propagated'); }
    log.push(l.hold(() => 'reacquired'));
  `);
  expect(h.log()).toBe('propagated | reacquired');
});

test('Lock: acquiring a Lock the agent already holds is a TypeError', () => {
  // A blocking self-acquire is a CERTAIN deadlock - the agent that would have to
  // release is the agent now parked - so it throws rather than hanging.
  const h = makeCluster(`
    var l = new Lock();
    l.hold(() => {
      try { l.hold(() => {}); } catch (e) { log.push('hold: ' + (e instanceof TypeError)); }
      try { l.acquire(); } catch (e) { log.push('acquire: ' + (e instanceof TypeError)); }
    });
  `);
  expect(h.log()).toBe('hold: true | acquire: true');
});

// -- Lock: the disposable guard -------------------------------------------------
test('Lock: acquire returns a guard that using releases', () => {
  const h = makeCluster(`
    var l = new Lock();
    { using g = l.acquire(); log.push('held'); }
    log.push(l.hold(() => 'free again'));
  `);
  expect(h.log()).toBe('held | free again');
});

test('Lock: disposing a guard twice is a TypeError', () => {
  const h = makeCluster(`
    var l = new Lock();
    var g = l.acquire();
    g[Symbol.dispose]();
    try { g[Symbol.dispose](); } catch (e) { log.push('second: ' + (e instanceof TypeError)); }
  `);
  expect(h.log()).toBe('second: true');
});

// -- Lock: the async form -------------------------------------------------------
test('Lock: asyncHold queues, and each waiter runs its own critical section', () => {
  const h = makeCluster(`
    var l = new Lock();
    (async () => { const rel = await l.asyncHold(); log.push('A holds'); rel(); })();
    (async () => { const rel = await l.asyncHold(); log.push('B holds'); rel(); })();
  `);
  h.cluster.runUntilIdle();
  expect(h.log()).toBe('A holds | B holds');
});

test('Lock: asyncHold while holding queues rather than throwing', () => {
  // Not a deadlock: the acquisition queues, and the holder may release from a
  // later job before anything awaits the pending promise.
  const h = makeCluster(`
    var l = new Lock();
    (async () => {
      const rel = await l.asyncHold();
      const pending = l.asyncHold();
      log.push('queued while holding');
      rel();
      const rel2 = await pending;
      log.push('granted later');
      rel2();
    })();
  `);
  h.cluster.runUntilIdle();
  expect(h.log()).toBe('queued while holding | granted later');
});

test('Lock: a release function may be called once', () => {
  const h = makeCluster(`
    var l = new Lock();
    globalThis.rel = null;
    (async () => { rel = await l.asyncHold(); })();
  `);
  h.cluster.runUntilIdle();
  h.evaluate('rel(); try { rel(); } catch (e) { log.push("second: " + (e instanceof TypeError)); }');
  expect(h.log()).toBe('second: true');
});

// -- Condition ------------------------------------------------------------------
test('Condition: a waiter parks, and notify wakes it holding the Lock again', () => {
  const h = makeCluster(`
    globalThis.l = new Lock();
    globalThis.c = new Condition();
    (async () => {
      const rel = await l.asyncHold();
      log.push('waiter holds');
      await c.asyncWait(l);
      log.push('woken');
      rel();
    })();
  `);
  h.cluster.runUntilIdle();
  // Parked: the waiter has not been woken and has released the Lock.
  expect(h.log()).toBe('waiter holds');
  h.evaluate('log.push("notify woke " + c.notify());');
  h.cluster.runUntilIdle();
  expect(h.log()).toBe('waiter holds | notify woke 1 | woken');
});

test('Condition: waiting on a Lock the caller does not hold is a TypeError', () => {
  const h = makeCluster('globalThis.l = new Lock(); globalThis.c = new Condition();');
  expect(() => h.evaluate('c.asyncWait(l)')).toThrow();
});

test('Condition: notifyAll wakes every waiter', () => {
  const h = makeCluster(`
    globalThis.l = new Lock();
    globalThis.c = new Condition();
    for (const name of ['A', 'B']) {
      (async () => { const rel = await l.asyncHold(); await c.asyncWait(l); log.push('woke ' + name); rel(); })();
    }
  `);
  h.cluster.runUntilIdle();
  expect(h.log()).toBe('');
  h.evaluate('log.push("woke " + c.notifyAll() + " waiters");');
  h.cluster.runUntilIdle();
  expect(h.log()).toContain('woke 2 waiters');
});

// -- The blocking forms where an agent cannot block ------------------------------
test('the blocking forms throw rather than becoming their async counterparts', () => {
  // "an operation returning T on one thread and Promise.<T> on another would have
  // a return type that depends on which thread is running it, which is not a
  // thing a typed language can say".
  const h = makeCluster(`
    var l = new Lock();
    var c = new Condition();
    log.push(l.hold(() => {
      try { c.wait(l); return 'no-throw'; } catch (e) { return 'wait: ' + (e instanceof TypeError); }
    }));
  `);
  expect(h.log()).toBe('wait: true');
});

// -- ThreadLocal ----------------------------------------------------------------
test('ThreadLocal: reads the default until written, then the agent\'s own value', () => {
  const h = makeCluster('var t = new ThreadLocal(7); log.push(t.value); t.value = 9; log.push(t.value);');
  expect(h.log()).toBe('7 | 9');
});

test('ThreadLocal: the default comes from T', () => {
  // #sec-threadlocal-objects: "An agent that has not written the storage reads
  // DefaultValueOf(_T_)." Written through the type rather than an explicit
  // initial value, which is what this file's header used to say was impossible.
  const h = makeCluster('var t = new ThreadLocal.<uint32>(); log.push(t.value); log.push(t.value is uint32);');
  expect(h.log()).toBe('0 | true');
  // Not only the numerics: the default is DefaultValueOf(T) for every T, so it
  // has to go through that operation rather than write a zero.
  expect(makeCluster('log.push(JSON.stringify(new ThreadLocal.<string>().value));').log()).toBe('""');
  expect(makeCluster('log.push(new ThreadLocal.<boolean>().value);').log()).toBe('false');
});

test('ThreadLocal: a write crosses the storage\'s type', () => {
  // The storage has a type, so a write is checked against it as a write to any
  // other typed storage is - a propagated literal converts, and a value the
  // type forbids is refused.
  const h = makeCluster('var t = new ThreadLocal.<uint32>(); t.value = 5; log.push(t.value is uint32);');
  expect(h.log()).toBe('true');
  const bad = makeCluster('var t = new ThreadLocal.<uint32>(); try { t.value = "s"; log.push("accepted"); } catch (e) { log.push(e.constructor.name); }');
  expect(bad.log()).toBe('TypeError');
});

test('ThreadLocal: a type with no default constructs, and the unwritten READ is the error', () => {
  // The clause says only what an unwritten agent reads. An agent that writes
  // before it reads uses the storage exactly as intended, so refusing the
  // construction would refuse a program the clause permits.
  const ok = makeCluster('var t = new ThreadLocal.<() => uint8>(); t.value = () => (1 := uint8); log.push(t.value());');
  expect(ok.log()).toBe('1');
  const unwritten = makeCluster('var t = new ThreadLocal.<() => uint8>(); try { log.push(t.value); } catch (e) { log.push(e.constructor.name); }');
  expect(unwritten.log()).toBe('TypeError');
});

test('ThreadLocal: the untyped form is unchanged', () => {
  expect(makeCluster('log.push(new ThreadLocal(7).value); log.push(String(new ThreadLocal().value));').log())
    .toBe('7 | undefined');
});

test('ThreadLocal: two threads do not see one another\'s value', () => {
  // The primitive is only coherent because a reaction runs on the thread that
  // created it (#sec-threading-scheduling). This is the observation that makes
  // "per agent" mean something.
  const h = makeCluster(`
    globalThis.t = new ThreadLocal('main');
    function body() { const before = t.value; t.value = 'thread'; return before + '/' + t.value; }
    body.callThread().then(v => { log.push('thread saw ' + v); log.push('main still ' + t.value); });
  `);
  h.cluster.runUntilIdle();
  expect(h.log()).toBe('thread saw main/thread | main still main');
});
