import { test, expect } from 'vitest';
import { ok, expectStaticTypeError } from '../harness.mts';

/**
 * #annex-evaluable-fragment, the LIBRARY half: "A built-in is within the
 * fragment when its result is determined by its arguments, it performs no
 * observable mutation outside values the call created, and it depends on no host
 * or ambient state." The syntactic half was enforced and this one was not, so
 * every built-in the annex names as excluded was accepted in a member default.
 *
 * That matters because an object type is INTERNED: a member default is one value
 * shared by every use of the type, so `Math.random()` there is not a
 * per-construction random number but a single number frozen at whichever program
 * first interned the type.
 *
 * Enforced on the FUNCTION rather than on the call syntax, which is how C++
 * marks `constexpr` and Rust `const fn`. A denylist over source text would see
 * `Math.random()` and miss every other way of reaching the same function - the
 * three forms below were each measured accepted before this landed.
 */

test('the built-ins the annex excludes are refused', () => {
  expect(ok('type S = { p?: any = Math.random() };')).toBe(false);
  expect(ok('type S = { p?: any = Date.now() };')).toBe(false);
  expect(ok('type S = { p?: any = new Date().getTime() };')).toBe(false);
  expect(ok('type S = { p?: any = "a".toLocaleUpperCase() };')).toBe(false);
  expect(ok('type S = { p?: any = "a".localeCompare("b") };')).toBe(false);
  expect(ok('type S = { p?: any = (1234.5).toLocaleString() };')).toBe(false);
  expect(ok('type S = { p?: any = new WeakRef({}) };')).toBe(false);
  expect(ok('type S = { p?: any = new FinalizationRegistry(() => {}) };')).toBe(false);
});

test('and cannot be reached around, which is why the rule is on the function', () => {
  expect(ok('const r = Math.random; type S = { p?: any = r() };')).toBe(false);
  expect(ok('const m = Math, k = "random"; type S = { p?: any = m[k]() };')).toBe(false);
  expect(ok('type S = { p?: any = [Math.random][0]() };')).toBe(false);
  // Through a helper, and through a built-in that calls back: the scope joins on
  // nesting, so what the evaluation REACHES is what the rule sees.
  expect(ok('function f() { return Math.random(); } type S = { p?: any = f() };')).toBe(false);
  expect(ok('type S = { p?: any = [1].map(() => Math.random())[0] };')).toBe(false);
});

test('the floor the annex guarantees is admitted', () => {
  // Not marked, so admitted by construction rather than by a second list.
  expect(ok('type S = { p?: any = Math.max(1, 2) };')).toBe(true);
  expect(ok('type S = { p?: any = "ab".toUpperCase() };')).toBe(true);
  expect(ok('type S = { p?: any = JSON.stringify({ a: 1 }) };')).toBe(true);
  expect(ok('type S = { p?: any = [3, 1, 2].sort()[0] };')).toBe(true);
  expect(ok('type S = { p?: any = new Map([[1, 2]]).get(1) };')).toBe(true);
  expect(ok('type S = { p?: any = new Set([1]).has(1) };')).toBe(true);
  expect(ok('type S = { p?: any = Symbol("s").description };')).toBe(true);
  expect(ok('type S = { p?: any = Symbol.for("k") === Symbol.for("k") };')).toBe(true);
  expect(ok('type S = { p?: any = /a(b)/.exec("ab")[1] };')).toBe(true);
  expect(ok('type S = { p?: any = (1n + 2n).toString() };')).toBe(true);
});

test('ordinary code is untouched: the rule restricts what a TYPE is computed from', () => {
  expect(ok('let x = Math.random(); let y = new Date().getTime();')).toBe(true);
  expect(ok('let d = Math.random(); type S = { p?: any = 1 };')).toBe(true);
  // ...and the scope is left behind even when the initializer throws.
  expect(ok('try { type A = { p?: any = (() => { throw new Error("x"); })() }; } catch (e) {} let z = Math.random();')).toBe(true);
});

test('an interface member is held to the same rule', () => {
  // An object type "is the inline form of an interface", so both walks apply it.
  expect(ok('interface I { p?: uint8 = 9 }')).toBe(true);
  expect(ok('interface I { p?: any = Math.random() }')).toBe(false);
});

test('a tuple element default is held to both halves', () => {
  // #sec-array-and-tuple-types states the requirement in the same words as
  // #sec-object-types states it of a member, and for the same reason: a tuple
  // type is interned, so the default is shared by every use of the type. Neither
  // half reached here, so a tuple default could call `eval` or read the clock.
  expect(ok('type T = [uint8 = 9];')).toBe(true);
  expect(ok('function f() { return 7; } type T = [uint8 = f()];')).toBe(true);
  expect(ok('type T = [uint8 = eval("5")];')).toBe(false);
  expect(ok('type T = [uint8 = Math.random()];')).toBe(false);
  expect(ok('const r = Math.random; type T = [uint8 = r()];')).toBe(false);
});

test('the syntactic half still reports its own forms', () => {
  expectStaticTypeError('type S = { p?: uint8 = eval("5") };');
});
