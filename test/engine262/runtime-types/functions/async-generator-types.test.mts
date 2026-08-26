import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * PLAN-async-generator-types.md. Annotations on an `async` function or a
 * generator are not enforced; this suite grows as each phase lands.
 */

test('F187: a typed async arrow reports rather than crashing', () => {
  // `async (a: uint8) => a` is first parsed as a CALL, and inside a call
  // `a: uint8` is a NAMED ARGUMENT. Refining the cover to an AsyncArrowHead has
  // to turn that back into an annotated parameter and does not, so the node
  // reached `getDeclarations`, which has no case for it, and the engine threw
  // `OutOfRange.nonExhaustive` - a RangeError from an internal exhaustiveness
  // check rather than any diagnostic.
  //
  // Now a Syntax Error. The same programs are rejected - the crash was a
  // rejection too - but it says why. The form is legal per
  // sec-function-annotations, so this is an interim.
  expectThrown('const g = async (a: uint8) => a;');
});

test('F187: the neighbouring forms are unaffected', () => {
  // The crash needed `async` AND an arrow AND a typed parameter. All three
  // neighbours worked and must keep working.
  expect(evaluated('const g = async (a) => a; String(1);')).toBe('1');
  expect(evaluated('const g = (a: uint8) => a; String(g((1 := uint8)));')).toBe('1');
  expect(evaluated('async function f(a: uint8) { return a; } String(1);')).toBe('1');
});
