import { expect, test } from 'vitest';
import {
  Agent, ManagedRealm, ObjectValue, performDevtoolsEval, runSingleJobInQueue,
  setSurroundingAgent, skipDebugger, Value,
  AbruptCompletion, EnsureCompletion,
} from '#self';

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
