import { test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';
import { expect } from 'vitest';

/**
 * `#sec-issignaturesubtype`, the catch-all step:
 * "If a.[[Untyped]] is true and a.[[InferredReturn]] is ~none~, return true."
 *
 * The step was absent, and its absence was not cosmetic: the arity step it precedes refused an untyped
 * `function f(x, y, z) {}` at `(x: number) => number` for requiring more
 * arguments than the position supplies. An untyped callback naming parameters
 * its caller does not pass is the ordinary shape of existing ECMAScript, which
 * is what making such a function a catch-all is for.
 */
const okSrc = (s: string) => expect(ok(s), `expected accepted: ${s}`).toBe(true);

test('an untyped signature is a catch-all in every position', () => {
  okSrc('function f(x) {} const a: (x: number) => number = f;');
  // The arity rows are the ones the missing step refused.
  okSrc('function f(x, y, z) {} const a: (x: number) => number = f;');
  okSrc('function f(x, y) {} const a: (x: number) => void = f;');
  okSrc('function f() {} const a: (x: number) => number = f;');
});

test('a TYPED signature is still judged on arity', () => {
  // The catch-all must not be reached by declaring anything at all: this
  // signature declares parameter types, so [[Untyped]] is false.
  expectStaticTypeError('function f(x: number, y: number, z: number) {} const a: (x: number) => void = f;');
});

test('untyped does not mean unjudged where the function PUBLISHES a return', () => {
  // [[Untyped]] is syntactic, so it is true of a function declaring neither -
  // but such a function still participates in inference when a contribution of
  // it is anchored, and then it publishes. Reading [[Untyped]] alone would
  // return before the published type could be read.
  expectStaticTypeError(`function f(): uint32 { return 5; }
    function g() { return f(); }
    let cb: () => string = g;`);
  // The same function where the position matches what it publishes.
  okSrc(`function f(): uint32 { return 5; }
    function g() { return f(); }
    let cb: () => uint32 = g;`);
  // And one that publishes nothing keeps the catch-all.
  okSrc('function g() { return 5; } let cb: () => string = g;');
});
