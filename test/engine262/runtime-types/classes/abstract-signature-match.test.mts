import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, ok } from '../harness.mts';

/**
 * Spec: #sec-abstract-classes with #sec-type-errors.
 *
 * "An abstract method is a signature with no body, and its annotation types the
 * implementations: it is a type error if a subclass implements an inherited
 * abstract method with a signature the abstract declaration does not accept."
 *
 * A SIGNATURE - parameters and return together - and a type error, which
 * #sec-type-errors makes an Early Error.
 *
 * One sentence was answered twice. The checker recorded only the RETURN
 * annotation on each side and compared those, so it caught a changed return and
 * missed a changed parameter and a changed arity; ClassDefinitionEvaluation
 * compared full signatures and caught all three, at evaluation. The result was
 * that `m(a: uint8): string` over `m(a: uint8): uint8` was rejected before the
 * source ran and `m(a: string): uint8` over the same declaration was rejected
 * only once the class declaration executed - the same rule, two answers, two
 * timings. Both sides now compare the declared function type.
 */

test('a changed parameter type is refused, as a changed return already was', () => {
  const A = 'abstract class A { abstract m(a: uint8): uint8; } ';
  // The case the checker missed: returns agree, parameters do not.
  expectStaticTypeError(`${A}class B extends A { m(a: string): uint8 { return 1; } }`);
  // The case it caught, which must keep its timing.
  expectStaticTypeError(`${A}class B extends A { m(a: uint8): string { return 'x'; } }`);
  // A parameter narrowed rather than changed is still a change: the numeric
  // families are mutually unrelated, so no boundary admits the value.
  expectStaticTypeError('abstract class A { abstract m(a: uint16): uint8; } '
    + 'class B extends A { m(a: uint8): uint8 { return 1; } }');
});

test('an implementation taking more parameters than the declaration is refused', () => {
  // A caller reaching the member through the abstract type supplies one
  // argument, so a second required parameter could never be filled.
  expectStaticTypeError('abstract class A { abstract m(a: uint8): uint8; } '
    + 'class B extends A { m(a: uint8, b: uint8): uint8 { return 1; } }');
});

test('the rule reaches an implementation below an intervening abstract class', () => {
  // The NEAREST declaration governs, and an abstract class that declares
  // nothing passes its base's contract down unchanged.
  expectStaticTypeError('abstract class A { abstract m(a: uint8): uint8; } abstract class B extends A { } '
    + 'class C extends B { m(a: string): uint8 { return 1; } }');
});

test('the signatures an abstract declaration does accept still stand', () => {
  const A = 'abstract class A { abstract m(a: uint8): uint8; } ';
  expect(evaluated(`${A}class B extends A { m(a: uint8): uint8 { return a; } } String(new B().m(1));`)).toBe('1');
  // A covariant return, which #sec-typed-classes admits for an override.
  expect(ok('class R {} class S extends R {} abstract class A { abstract m(): R; } '
    + 'class B extends A { m(): S { return new S(); } }')).toBe(true);
  // Fewer parameters than the declaration: a function that ignores an argument
  // is a subtype of one that takes it, which is ordinary function subtyping and
  // is what JavaScript does. Both sides agreed on this before and still do.
  expect(ok('abstract class A { abstract m(a: uint8, b: uint8): uint8; } '
    + 'class B extends A { m(a: uint8): uint8 { return a; } }')).toBe(true);
  // No parameters at all on either side.
  expect(evaluated('abstract class A { abstract m(): uint8; } '
    + 'class B extends A { m(): uint8 { return 1; } } String(new B().m());')).toBe('1');
  // Optionals and rests are parameters like any other.
  expect(ok('abstract class A { abstract m(a: uint8, b?: uint8): uint8; } '
    + 'class B extends A { m(a: uint8, b?: uint8): uint8 { return a; } }')).toBe(true);
  expect(ok('abstract class A { abstract m(...r: [].<uint8>): uint8; } '
    + 'class B extends A { m(...r: [].<uint8>): uint8 { return 1; } }')).toBe(true);
  // A middle class may RE-DECLARE the member, and an implementation below it
  // keeps the middle contract rather than the root's.
  expect(ok('abstract class A { abstract m(): number; } abstract class B extends A { abstract m(): uint8; } '
    + 'class C extends B { m(): uint8 { return 1; } }')).toBe(true);
});

test('an unannotated side declares nothing and is left alone', () => {
  // The rule everywhere else in this pass: an untyped method says nothing.
  // Both sides have to honour it, and the "carries any annotation" test is what
  // decides - a method with parameter annotations and no return annotation
  // declares a signature, and one with neither does not.
  expect(ok('abstract class A { abstract m(a: uint8): uint8; } '
    + 'class B extends A { m(a) { return 1; } }')).toBe(true);
  expect(ok('abstract class A { abstract m(); } '
    + 'class B extends A { m(a: string): uint8 { return 1; } }')).toBe(true);
});

test('the unimplemented-member rule is untouched', () => {
  // A different sentence of the same clause, and it must keep its own message.
  expectStaticTypeError('abstract class A { abstract m(a: uint8): uint8; } class B extends A { }');
  // An abstract subclass need not implement.
  expect(ok('abstract class A { abstract m(a: uint8): uint8; } abstract class B extends A { } '
    + 'class C extends B { m(a: uint8): uint8 { return a; } }')).toBe(true);
});
