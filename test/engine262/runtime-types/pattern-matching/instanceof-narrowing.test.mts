import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * `instanceof` is a narrowing form. The README says so where it introduces the
 * operator - "a successful check narrows the static type in that branch, the
 * nominal counterpart to the structural `is` operator" - and again where `#a in
 * value` is described as "joining `instanceof` and the structural `is` operator
 * as a narrowing form".
 *
 * It narrowed nothing. The test was typed and reported on and never turned into
 * a fact, so the run time answered correctly while the checker refused every
 * member access the branch had just made safe.
 *
 * The right operand resolves through `classTypeOf` before `typeDenotedBy`:
 * `typeDenotedBy` answers aliases and built-ins and declines a class on purpose,
 * which is right for the impossible-test report it was written for and backwards
 * here, a class being the common right operand of `instanceof`.
 */

test('a successful instanceof narrows the branch it guards', () => {
  expect(evaluated(`class A { x: uint8 = 1; }
    let v: A | null = new A();
    if (v instanceof A) { String(v.x); } else { 'no'; }`)).toBe('1');
});

test('the false branch subtracts the type', () => {
  expect(evaluated(`class A { x: uint8 = 1; } class B { y: uint8 = 2; }
    let v: A | B = new B();
    if (v instanceof A) { String(v.x); } else { String(v.y); }`)).toBe('2');
});

test('a negated test narrows the other way', () => {
  expect(evaluated(`class A { x: uint8 = 1; } class B { y: uint8 = 2; }
    let v: A | B = new A();
    if (!(v instanceof B)) { String(v.x); } else { String(v.y); }`)).toBe('1');
});

test('it narrows a parameter and the right operand of &&', () => {
  expect(evaluated(`class A { x: uint8 = 1; } class B { y: uint8 = 2; }
    function f(v: A | B): uint8 { if (v instanceof A) { return v.x; } return v.y; }
    String(f(new A()));`)).toBe('1');
  expect(evaluated(`class A { x: uint8 = 1; }
    let v: A | null = new A();
    ((v instanceof A) && v.x === 1) ? 'yes' : 'no';`)).toBe('yes');
});

test('a sealed hierarchy dispatches through it', () => {
  expect(evaluated(`sealed abstract class Shape { }
    class Circle extends Shape { r: float32 = 1; }
    class Square extends Shape { s: float32 = 2; }
    function area(sh: Shape): float32 {
      if (sh instanceof Circle) { return sh.r; }
      if (sh instanceof Square) { return sh.s; }
      return 0;
    }
    String(area(new Square()));`)).toBe('2');
});

test('the other narrowing forms are unaffected', () => {
  expect(evaluated(`class A { x: uint8 = 1; } let v: A | null = new A();
    if (v is A) { String(v.x); } else { 'no'; }`)).toBe('1');
  expect(evaluated(`class A { x: uint8 = 1; } let v: A | null = new A();
    if (v !== null) { String(v.x); } else { 'no'; }`)).toBe('1');
  expect(evaluated(`let v: string | uint8 = "hi";
    if (typeof v === "string") { String(v.length); } else { String(v); }`)).toBe('2');
});

test('a member expression is still not narrowed by any form', () => {
  // The remaining half of the gap, and a different problem: facts are keyed on a
  // binding NAME, so an expression with no name cannot produce one. Pinned so
  // that closing it is a deliberate change rather than an accident.
  expectStaticTypeError(`class A { x: uint8 = 1; } class B { a: A | null = null; }
    const b = new B(); b.a = new A();
    if (b.a instanceof A) { String(b.a.x); }`);
});
