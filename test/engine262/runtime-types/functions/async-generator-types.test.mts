import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * PLAN-async-generator-types.md. Annotations on an `async` function or a
 * generator are not enforced; this suite grows as each phase lands.
 */

test('F187: a typed async arrow parses and runs', () => {
  // `async (a: uint8) => a` is first parsed as a CALL, and inside a call
  // `a: uint8` is a NAMED ARGUMENT. Refining the cover to an AsyncArrowHead has
  // to turn that back into an annotated parameter and did not, so the node
  // reached `getDeclarations`, which has no case for it, and the engine threw
  // `OutOfRange.nonExhaustive` - a RangeError from an internal exhaustiveness
  // check rather than any diagnostic.
  //
  // The annotation is now read as a TYPE at the call-argument site, behind a
  // lexer checkpoint, and carried on the NamedArgument for the refinement to
  // pick up. By then only an expression would be left - `uint8 | string` having
  // become a bitwise-or - so the type has to be read while the text is still in
  // front of the lexer.
  expect(evaluated('const g = async (a: uint8) => a; String(1);')).toBe('1');
});

test('F187: the neighbouring forms are unaffected', () => {
  // The crash needed `async` AND an arrow AND a typed parameter. All three
  // neighbours worked and must keep working.
  expect(evaluated('const g = async (a) => a; String(1);')).toBe('1');
  expect(evaluated('const g = (a: uint8) => a; String(g((1 := uint8)));')).toBe('1');
  expect(evaluated('async function f(a: uint8) { return a; } String(1);')).toBe('1');
});
