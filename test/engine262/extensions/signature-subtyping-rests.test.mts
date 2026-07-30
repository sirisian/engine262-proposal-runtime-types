import { test, expect } from 'vitest';
import { evaluated } from '../readme/harness.mts';

/**
 * PLAN-rest-parameters.md phase 5: signature subtyping, per
 * #sec-issignaturesubtype.
 *
 * Two defects were LIVE before any of the rest-parameter feature landed, and
 * neither needed a rest to be declarable to bite, because a function TYPE could
 * always carry one:
 *
 * 1. A rest was compared by its own type. A rest's [[Type]] is what it
 *    COLLECTS - `...args: [].<uint32>` has the ARRAY type - so the comparison
 *    ran `IsSubtype(uint32, [].<uint32>)`, which is false. The consequence was
 *    that a signature carrying a rest was assignable to NOTHING that took its
 *    element type: every callback type written with a rest was unusable.
 * 2. Arity was a parameter COUNT on both sides. A source whose trailing
 *    parameters are optional requires fewer arguments than it declares, and a
 *    target carrying a rest may supply more than it declares, so counting
 *    rejected pairs that relate.
 *
 * A third, quieter one: the positional walk ran over the SOURCE's parameters,
 * so a target position past the source's length was never checked. It runs over
 * the target's now - the arguments that will actually arrive.
 *
 * Each assertion below is annotated with what it answered before the fix.
 */

test('a rest parameter relates by its ELEMENT type', () => {
  // Was false. This is the bug: the function accepts any number of uint32s, so
  // it is usable wherever one uint32 is supplied.
  expect(evaluated(`
    type S = (...[].<uint32>) => void;
    type T = (uint32) => void;
    String(Reflect.isAssignable(S, T));
  `)).toBe('true');

  // Was false. A rest absorbs as many as the target supplies.
  expect(evaluated(`
    type S = (...[].<uint32>) => void;
    type T = (uint32, uint32) => void;
    String(Reflect.isAssignable(S, T));
  `)).toBe('true');
});

test('a rest still refuses an element type it cannot take', () => {
  // Was false, and correctly so: the fix must not turn a rest into a wildcard.
  expect(evaluated(`
    type S = (...[].<uint32>) => void;
    type T = (string) => void;
    String(Reflect.isAssignable(S, T));
  `)).toBe('false');
});

test('arity is what a signature REQUIRES against what the target may supply', () => {
  // Was false. `b` is optional, so S requires one argument, which T supplies.
  expect(evaluated(`
    type S = (a: uint8, b?: string) => void;
    type T = (uint8) => void;
    String(Reflect.isAssignable(S, T));
  `)).toBe('true');

  // A rest makes the same difference: S requires none, T supplies one.
  expect(evaluated(`
    type S = (...[].<uint32>) => void;
    type T = () => void;
    String(Reflect.isAssignable(S, T));
  `)).toBe('true');
});

/**
 * A gap found while writing this file, and OUTSIDE phase 5.
 *
 * `Reflect.typeOf` of a DECLARED function does not produce a signature that
 * relates to a written function type: `function f(a: uint8) {}` is not
 * assignable to `(uint8) => void`, and is not `any` either. Every assertion in
 * this file therefore goes through function TYPES, where the relation is the
 * one phase 5 fixes and is demonstrably right.
 *
 * The declaration route is what PLAN-rest-parameters.md phases 1 and 4 build
 * on, so it has to be reached before a rest can be DECLARED rather than only
 * written in a type. Recorded here rather than asserted, since asserting the
 * current answer would pin a defect as a requirement.
 */

test('the admissions and refusals that were already right stay right', () => {
  // #sec-issignaturesubtype: "A function that accepts fewer arguments than the
  // target supplies is admitted, since ECMAScript already ignores extra
  // arguments." Unchanged by the fix.
  expect(evaluated(`
    type S = (a: uint8) => void;
    type T = (uint8, string) => void;
    String(Reflect.isAssignable(S, T));
  `)).toBe('true');

  // A source REQUIRING more than the target supplies is refused. Unchanged.
  expect(evaluated(`
    type S = (a: uint8, b: string) => void;
    type T = (uint8) => void;
    String(Reflect.isAssignable(S, T));
  `)).toBe('false');

  // Parameters are contravariant and the return covariant, which the rewrite
  // must not have disturbed. The pair has to be one that genuinely relates: a
  // literal type is a subtype of its base, while `uint8` and `uint32` are
  // distinct value types with no widening between them.
  expect(evaluated(`
    type S = (a: uint8) => 'a';
    type T = (a: uint8) => string;
    String(Reflect.isAssignable(S, T));
  `)).toBe('true');
});

test('a list with several rests relates to nothing until it can be assigned', () => {
  // PLAN-rest-parameters.md phase 2 brings SequenceAssignment, which is what
  // determines which rest receives which position. Until then a multi-rest list
  // has no position mapping, and this refuses rather than guessing one. The
  // assertion is a MARKER: when phase 2 lands it should become 'true', and a
  // reader finding it should change it rather than read it as a requirement.
  expect(evaluated(`
    type S = (...[].<uint32>, ...[].<string>) => void;
    type T = (uint32, string) => void;
    String(Reflect.isAssignable(S, T));
  `)).toBe('false');
});
