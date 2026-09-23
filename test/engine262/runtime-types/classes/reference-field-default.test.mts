import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * A bare field of a REFERENCE type was filled with a fabricated instance:
 *
 *   reference class R { x: uint8 = 1; }
 *   class H { r: R; }
 *   new H().r.x;            // 0 - an R whose constructor never ran
 *
 * A reference field is a non-null reference and a default has nothing to point
 * at, so the declaration needs an initializer. `DefaultValueOf` now answers
 * *undefined* for a reference class, which routes it to the refusal a `Span`
 * field and a `dynamic` class field already produce.
 *
 * `#sec-defaultvalueof` states the condition as "denotes A VALUE TYPE CLASS",
 * and gating on `IsValueTypeClass` is what this first tried. That predicate is
 * STRICTLY NARROWER than the phrase - `IsValueType` requires at least one typed
 * field, so an EMPTY class is not one - and `class B<W<_>> {}` lost a default it
 * has always had. Excluding the reference class is what the defect calls for.
 */

test('a bare field of a reference type needs an initializer', () => {
  expectThrown('reference class R { x: uint8 = 1; } class H { r: R; } new H();',
    'has no default value');
  expectThrown('reference class R { x: uint8 = 1; } let r: R;', 'has no default value');
});

test('the spellings that do have a default keep it', () => {
  // A nullable reference is how a program asks for the absent one.
  expect(evaluated(`reference class R { x: uint8 = 1; } class H { r: R | null; }
    const h = new H(); String(h.r === null);`)).toBe('true');
  expect(evaluated(`reference class R { x: uint8 = 1; } class H { r: R = new R(); }
    const h = new H(); String(h.r.x);`)).toBe('1');
});

test('an EMPTY class still has a default', () => {
  // The case that ruled out the narrower-looking gate: no typed fields, so
  // `IsValueType` answers false, though nothing about it lacks a zero.
  expect(evaluated('class B {} class H { b: B; } const h = new H(); typeof h.b;')).toBe('object');
  expect(evaluated('type One<A: type> = A; class B<W<_>: type> {} let b: B.<One>; "ok";')).toBe('ok');
});

test('a value class field still takes its memberwise zero', () => {
  // And still ignores the field INITIALIZER, which is correct: the instance
  // "comes into existence without its constructor running", so it holds the
  // default of each field's TYPE rather than what the declaration writes.
  // Pinned because it looks like the same defect and is not.
  expect(evaluated('class V { x: uint8 = 3; } class H { v: V; } const h = new H(); String(h.v.x);')).toBe('0');
});

test('the other defaults are untouched', () => {
  expect(evaluated(`class H { a: uint8; b: string; c: boolean; d: [2].<uint8>; }
    const h = new H(); h.a + '/' + JSON.stringify(h.b) + '/' + h.c + '/' + h.d.length;`))
    .toBe('0/""/false/2');
  expectThrown('dynamic class D { y = 1; } class H { d: D; } new H();', 'has no default value');
});
