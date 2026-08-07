import { expect, test } from 'vitest';
import {
  Agent, ManagedRealm, ObjectValue, performDevtoolsEval, runSingleJobInQueue,
  setSurroundingAgent, skipDebugger, Value,
  AbruptCompletion, EnsureCompletion,
} from '#self';
import { Inspector } from '#self/inspector';

/**
 * The console evaluation path, src/host-defined/devtoolsEval.mts.
 *
 * It parses the source as a Script and, if that fails, re-parses it under
 * `{ await: true }` and evaluates the body under AsyncBlockStart - which is how
 * top-level await already works in the console. These tests cover what such an
 * evaluation ANSWERS, the completion value having been discarded before.
 */

function makeConsole() {
  const agent = new Agent({ features: ['runtime-types'], eventLoopRunType: 'manual' });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  const drain = () => {
    let guard = 0;
    while (agent.jobQueue.length > 0) {
      guard += 1;
      expect(guard).toBeLessThan(1000);
      setSurroundingAgent(agent);
      runSingleJobInQueue(agent.jobQueue.shift()!, () => {}, () => {});
    }
  };
  /** Evaluate, drain, and answer the settled value however it was produced. */
  const evaluate = (source: string) => {
    const completion = EnsureCompletion(skipDebugger(performDevtoolsEval(source, realm, false, true)));
    drain();
    if (completion instanceof AbruptCompletion) {
      return { thrown: true, value: completion.Value as Value };
    }
    const value = completion.Value as Value;
    if (value instanceof ObjectValue && 'PromiseState' in value) {
      const promise = value as ObjectValue & { PromiseState: string, PromiseResult: Value };
      return { thrown: promise.PromiseState === 'rejected', value: promise.PromiseResult, wasPromise: true };
    }
    return { thrown: false, value, wasPromise: false };
  };
  const numberOf = (v: Value) => (v as unknown as { numberValue(): number }).numberValue();
  const stringOf = (v: Value) => (v as unknown as { stringValue(): string }).stringValue();
  return { evaluate, numberOf, stringOf };
}

test('devtools eval: a synchronous body answers its completion value', () => {
  const c = makeConsole();
  const r = c.evaluate('7;');
  expect(r.wasPromise).toBe(false);
  expect(c.numberOf(r.value)).toBe(7);
});

test('devtools eval: an async body answers its completion value, not undefined', () => {
  // AsyncBlockStart resolves a NORMAL completion with undefined and a RETURN
  // completion with its value, which is right for an async function body -
  // falling off the end of one produces undefined. A REPL body is not that: its
  // completion value is the point. Before the body was handed over as a return
  // completion, every one of these answered undefined.
  const c = makeConsole();
  const trailing = c.evaluate('await 1; 42;');
  expect(trailing.wasPromise).toBe(true);
  expect(c.numberOf(trailing.value)).toBe(42);

  const bare = c.evaluate('await 42;');
  expect(c.numberOf(bare.value)).toBe(42);

  const str = c.evaluate('await 1; "hi";');
  expect(c.stringOf(str.value)).toBe('hi');
});

test('devtools eval: a declaration still has no completion value', () => {
  // A var declaration produces an empty completion, which becomes undefined -
  // the same answer the synchronous path gives, and not something the fix above
  // should have changed.
  const c = makeConsole();
  expect(c.evaluate('var declared = await 5;').value).toBe(Value.undefined);
  expect(c.evaluate('var plain = 5;').value).toBe(Value.undefined);
});

test('devtools eval: bindings survive an await into the next evaluation', () => {
  const c = makeConsole();
  expect(c.numberOf(c.evaluate('let bound = await 1; bound;').value)).toBe(1);
  expect(c.numberOf(c.evaluate('bound;').value)).toBe(1);
  expect(c.numberOf(c.evaluate('var v = await 5; 0;').value)).toBe(0);
  expect(c.numberOf(c.evaluate('v;').value)).toBe(5);
});

test('devtools eval: a rejected await rejects the answering promise', () => {
  const c = makeConsole();
  const r = c.evaluate('await Promise.reject(new TypeError("boom"));');
  expect(r.thrown).toBe(true);
});

/**
 * The Runtime.evaluate routing, lib-src/inspector/methods.mts.
 *
 * The devtools console sets `replMode: true` on every evaluation it makes and
 * does no rewriting of its own - it relies on the backend to accept top-level
 * await. Confirmed by reading the frontend the playground pins,
 * chrome-devtools-frontend@1.0.1656291: ConsoleModel.evaluateCommandInConsole
 * builds its options with `replMode: true` and passes `awaitPromise` false, and
 * the only rewriting anywhere is JavaScriptREPL.wrapObjectLiteral, which
 * parenthesizes object literals and returns everything else untouched.
 */

class TestInspector extends Inspector {
  readonly sent: { id?: number, method?: string, result?: unknown, params?: { context?: { uniqueId?: string } } }[] = [];

  protected send(data: object): void {
    this.sent.push(data);
  }

  request(id: number, method: string, params: unknown): void {
    this.onMessage(id, method, params);
  }
}

function makeInspector() {
  const agent = new Agent({ features: ['runtime-types'], eventLoopRunType: 'manual' });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  const inspector = new TestInspector();
  inspector.attachAgent(agent, [realm]);
  inspector.request(0, 'Runtime.enable', {});
  inspector.request(0, 'Debugger.enable', {});
  const uniqueContextId = inspector.sent
    .find((m) => m.method === 'Runtime.executionContextCreated')?.params?.context?.uniqueId;
  expect(uniqueContextId).toBeDefined();

  const drain = () => {
    let guard = 0;
    while (agent.jobQueue.length > 0) {
      guard += 1;
      expect(guard).toBeLessThan(1000);
      setSurroundingAgent(agent);
      runSingleJobInQueue(agent.jobQueue.shift()!, () => {}, () => {});
    }
  };
  const evaluate = async (expression: string, extra: object = {}) => {
    inspector.sent.length = 0;
    inspector.request(1, 'Runtime.evaluate', { expression, uniqueContextId, ...extra });
    // The reply is delivered from a host promise that may itself await another,
    // so drain the agent and yield to the host loop until it appears.
    for (let turn = 0; turn < 50; turn += 1) {
      drain();
      const reply = inspector.sent.find((m) => m.id === 1);
      if (reply) {
        return reply.result as { result?: { type?: string, subtype?: string, value?: unknown }, exceptionDetails?: unknown };
      }
      await new Promise((resolve) => { setTimeout(resolve, 0); });
    }
    return undefined;
  };
  return { evaluate };
}

test('Runtime.evaluate: without replMode, top-level await is still a syntax error', () => makeInspector().evaluate('await 1;').then((r) => {
  expect(r?.exceptionDetails).toBeDefined();
}));

test('Runtime.evaluate: replMode accepts top-level await', () => makeInspector().evaluate('await 1;', { replMode: true }).then((r) => {
  // That it EVALUATED rather than refusing. What it answers is pinned by the
  // settling tests below.
  expect(r?.exceptionDetails).toBeUndefined();
  expect(r?.result).toBeDefined();
}));

test('Runtime.evaluate: replMode leaves synchronous input alone', () => makeInspector().evaluate('6*7;', { replMode: true }).then((r) => {
  expect(r?.result?.type).toBe('number');
  expect(r?.result?.value).toBe(42);
}));

test('Runtime.evaluate: bindings from a replMode await persist to the next evaluation', async () => {
  const { evaluate } = makeInspector();
  await evaluate('let persisted = await 5; 0;', { replMode: true });
  const second = await evaluate('persisted;', { replMode: true });
  expect(second?.result?.value).toBe(5);
});

test('Runtime.evaluate: an async body is settled before the reply', async () => {
  // The frontend does not unwrap what the backend returns, so this is the
  // difference between `await 1;` reading as 1 and as `Promise {}`.
  const { evaluate } = makeInspector();
  const one = await evaluate('await 1;', { replMode: true });
  expect(one?.result?.type).toBe('number');
  expect(one?.result?.value).toBe(1);

  const chained = await evaluate('await Promise.resolve(7);', { replMode: true });
  expect(chained?.result?.value).toBe(7);
});

test('Runtime.evaluate: a synchronous body whose value is a promise stays a promise', async () => {
  // `Promise.resolve(1)` never awaited anything, and the user asked to see the
  // promise. Settling it because it happens to be one would answer 1 for an
  // expression that did not await - which is why the settling keys off whether
  // the BODY was async rather than off the shape of its value.
  const { evaluate } = makeInspector();
  const r = await evaluate('Promise.resolve(1);', { replMode: true });
  expect(r?.result?.subtype).toBe('promise');
});

test('Runtime.evaluate: a rejected await is reported as an exception', async () => {
  const { evaluate } = makeInspector();
  const r = await evaluate('await Promise.reject(new TypeError("boom"));', { replMode: true });
  expect(r?.exceptionDetails).toBeDefined();
  expect(r?.result?.subtype).not.toBe('promise');
});

test('Runtime.evaluate: the reported callThread example reads back its value', async () => {
  const { evaluate } = makeInspector();
  await evaluate('let a: uint32 = 0; function A() { Atomics.add(ref a, 5); } 0;', { replMode: true });
  const awaited = await evaluate('await A.callThread();', { replMode: true });
  expect(awaited?.exceptionDetails).toBeUndefined();
  const read = await evaluate('a;', { replMode: true });
  expect(read?.result?.value).toBe(5);
});

// -- Phase 4: the edges ---------------------------------------------------------
test('Runtime.evaluate: awaitPromise settles a promise result', async () => {
  // Distinct from the async-body settling above: here the body is synchronous
  // and its VALUE is a promise, which the caller has explicitly asked to have
  // settled. Before this the flag was refused outright with `unsupported`.
  const { evaluate } = makeInspector();
  const r = await evaluate('Promise.resolve(3);', { replMode: true, awaitPromise: true });
  expect(r?.result?.type).toBe('number');
  expect(r?.result?.value).toBe(3);
});

test('Runtime.evaluate: awaitPromise passes a non-promise straight through', async () => {
  // So a caller can set the flag unconditionally and never have two shapes of
  // response to reason about.
  const { evaluate } = makeInspector();
  const r = await evaluate('1;', { replMode: true, awaitPromise: true });
  expect(r?.result?.value).toBe(1);
});

test('Runtime.evaluate: awaitPromise reports a rejection as an exception', async () => {
  const { evaluate } = makeInspector();
  const r = await evaluate('Promise.reject(new TypeError("r"));', { replMode: true, awaitPromise: true });
  expect(r?.exceptionDetails).toBeDefined();
});

test('Runtime.evaluate: without awaitPromise a promise result is still a promise', async () => {
  const { evaluate } = makeInspector();
  const r = await evaluate('Promise.resolve(3);', { replMode: true });
  expect(r?.result?.subtype).toBe('promise');
});

test('Runtime.evaluate: a preview does not leak the side effects of an awaited body', async () => {
  // A preview runs while the user is still typing, so it must not be observable.
  // It is already run under debugger_scopePreview, where promise jobs are not
  // enqueued and effects do not escape - which is why previews are left to
  // evaluate rather than made to refuse `await`: refusing would remove a working
  // preview to solve a problem the preview machinery already solves.
  const { evaluate } = makeInspector();
  await evaluate('globalThis.leaked = 1; await 1;', { replMode: true, throwOnSideEffect: true });
  const observed = await evaluate('String(globalThis.leaked);', { replMode: true });
  expect(observed?.result?.value).toBe('undefined');
});

// -- The static checker on the console path -------------------------------------
test('devtools eval: the static checker runs, as it does for a script', () => {
  // This path is a copy of PerformEval and had neither its check nor
  // ParseScript's, so nothing typed in the console was checked at all. A lexical
  // binding has no run-time typed-storage boundary to catch it afterwards, so
  // the omission did not soften the diagnosis - it removed it.
  const c = makeConsole();
  expect(c.evaluate("type Direction = 'north' | 'south' | 'east' | 'west';\nlet d: Direction = 'north';\nd = 0;").thrown).toBe(true);
  expect(c.evaluate('let a: uint8 = 0; a = 300;').thrown).toBe(true);
  expect(c.evaluate('let s: string = 1;').thrown).toBe(true);
});

test('devtools eval: a well-typed program is untouched', () => {
  const c = makeConsole();
  const r = c.evaluate("type D = 'n' | 's'; let d: D = 'n'; d = 's'; d;");
  expect(r.thrown).toBe(false);
  expect(c.stringOf(r.value)).toBe('s');
});
