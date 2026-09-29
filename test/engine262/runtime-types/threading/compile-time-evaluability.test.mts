import { test } from 'vitest';
import { expectStaticTypeError } from '../harness.mts';

/**
 * Spec: #sec-threading-synchronization (Lock, Condition and ThreadLocal),
 * #sec-threading-parallel-iteration (`Thread.parallelFor` and
 * `Thread.parallelReduce`), and #sec-compile-time-evaluability.
 *
 * None of these is compile-time evaluable. A Lock and a Condition are shared
 * mutable state, a ThreadLocal answers a question about which thread is asking,
 * and the parallel operations run work on other threads, so none of them survives
 * being answered while a type is being checked. A builder that names one is
 * therefore refused where a type position calls it, as a builder naming any other
 * ambient state is (`Atomics` is the neighbouring case, refused as cross-agent
 * state).
 */

test('a builder naming Atomics is refused where a type position calls it', () => {
  expectStaticTypeError('function b() { Atomics.notify; return uint8; } type T = b();');
});

// Pinned as `test.fails`: the engine's evaluability check is a list of names a
// builder may not use, and that list holds `Atomics` but not `Lock`, `Condition`,
// `ThreadLocal` or `Thread`, so a builder using them is accepted. Each flips to
// `test` when the name is refused.
test.fails('a builder using a Lock is refused', () => {
  expectStaticTypeError('function b() { const l = new Lock(); l.hold(() => 1); return uint8; } type T = b();');
});

test.fails('a builder using a Condition is refused', () => {
  expectStaticTypeError('function b() { const c = new Condition(); c.notify(); return uint8; } type T = b();');
});

test.fails('a builder reading a ThreadLocal is refused', () => {
  expectStaticTypeError('function b() { const t = new ThreadLocal.<uint8>(); const v = t.value; return uint8; } type T = b();');
});

test.fails('a builder calling a parallel operation is refused', () => {
  expectStaticTypeError('function b() { Thread.parallelFor(0, 1, () => {}); return uint8; } type T = b();');
  expectStaticTypeError('function b() { Thread.parallelReduce(0, 1, 0, (a, i) => a, (x, y) => x); return uint8; } type T = b();');
});
