import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * Spec: #sec-enums and #sec-compile-time-evaluation.
 *
 * `enum E: uint8 { A = 1, B = A + 1 }` was a *ReferenceError* - "A is not
 * defined" - though every neighbouring form worked: literals, arithmetic over
 * literals, auto-increment, an outer `const`, and a fragment call like
 * `Math.max(1, 2)`.
 *
 * The clause already SEQUENCES enumerators: "a later enumerator with no
 * initializer takes the result of applying the underlying type's prefix
 * increment operator `operator++` to THE PREVIOUS ENUMERATOR'S VALUE", and the
 * function-of-two-parameters form persists "until an initializer replaces it".
 * Each is evaluated in order with the previous value in hand. What was missing
 * is that an earlier enumerator's NAME was not in scope for a later
 * initializer: the dependency existed and the spelling for it did not, though
 * `B = A + 1` is the ordinary idiom of C, C#, Java and TypeScript alike.
 *
 * The clause also promises the fragment - "every initializer is evaluated in
 * the compile-time evaluable fragment, since an enumerator is a constant of the
 * program" - and `IsCompileTimeEvaluable`'s three binding cases admit none of
 * these names, so the operation is narrower than the clause it serves. That
 * half is a specification change; this engine has no such operation to amend.
 */

test('an initializer may name an enumerator declared before it', () => {
  expect(evaluated('enum E: uint8 { A = 1, B = A + 1 } String(E.B);')).toBe('2');
  // Any earlier one, not only the immediately previous.
  expect(evaluated('enum E: uint8 { A = 1, B = 2, C = A + B } String(E.C);')).toBe('3');
  // And inside a fragment call, which was already reachable for literals.
  expect(evaluated('enum E: uint8 { A = 2, B = Math.max(A, 1) } String(E.B);')).toBe('2');
});

test('naming itself or a later enumerator is refused', () => {
  // "Parameters bind left to right" is the shape #sec-computed-constraints uses
  // for the same question about type parameters. #sec-enums states it as a
  // TYPE ERROR - "it is a type error for it to name the enumerator it belongs
  // to or one declared later" - so it is refused before the program runs, not
  // at the first evaluation of the declaration as a ReferenceError.
  expectStaticTypeError('enum E: uint8 { A = A + 1 } "accepted";');
  expectStaticTypeError('enum E: uint8 { A = B + 1, B = 1 } "accepted";');
  // A later enumerator's name is reserved within the enum even where an outer
  // binding of that name exists, and inside a nested function as well.
  expectStaticTypeError('const B = 5; enum E: uint8 { A = B, B = 2 } "accepted";');
  expectStaticTypeError('enum E: uint8 { A = ((i, n) => B), B = 3 } "accepted";');
});

test("the enum's own name stays in its temporal dead zone", () => {
  // Binding the MEMBERS does not bind the enum, so the qualified spelling is
  // not a second way to write the above. #sec-enums: "the enum's own name is
  // not in scope there, being uninitialized until the declaration completes".
  expectStaticTypeError('enum E: uint8 { A = 1, B = E.A + 1 } "accepted";');
});

test('a name bound inside the initializer is its own binding', () => {
  expect(evaluated('enum S: string { A = (i, name) => name, B } String(S.B);')).toBe('B');
});

test('every form that already worked still does', () => {
  expect(evaluated('enum E: uint8 { A = 1, B = 2 } String(E.B);')).toBe('2');
  expect(evaluated('enum E: uint8 { A = 1, B = 1 + 1 } String(E.B);')).toBe('2');
  expect(evaluated('enum E: uint8 { A, B } String(E.A) + "," + String(E.B);')).toBe('0,1');
  // Auto-increment resumes from an explicit initializer, which is the
  // sequencing this change rides on.
  expect(evaluated('enum E: uint8 { A = 5, B } String(E.A) + "," + String(E.B);')).toBe('5,6');
  expect(evaluated('const K = 1; enum E: uint8 { A = K } String(E.A);')).toBe('1');
  expect(evaluated('enum E: uint8 { A = Math.max(1, 2) } String(E.A);')).toBe('2');
  // The function form and its persistence across following enumerators.
  expect(evaluated('enum Count: float32 { Zero = (index, name) => index * 100, One, Two } String(Count.Two);'))
    .toBe('200');
});

test('the checking pass now evaluates these instead of deferring them', () => {
  // A free reference used to make the pass SKIP the enum, so a bad value
  // reached the run time. The pass grows its available set as it walks the
  // member list, so an initializer that overflows its underlying type is
  // refused at the declaration.
  expectStaticTypeError('enum E: uint8 { A = 1, B = A + 300 }');
  // And the errors it already caught are unchanged.
  expectStaticTypeError('enum E: uint8 { A = 1, A = 2 }');
});
