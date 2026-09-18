import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrown } from '../harness.mts';

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

/**
 * The BRAND CHECK narrows for the same reason and was missing for the same
 * reason. The README puts the three together: "the brand check `#a in value`
 * narrows the static type of `value` to the class in the true branch, joining
 * `instanceof` and the structural `is` operator as a narrowing form."
 *
 * Its subject is the RIGHT operand - the left is a private name, not an
 * expression - and the type it narrows to is the class declaring that name.
 */

test('a brand check narrows the branch it guards, and subtracts in the other', () => {
  const src = (arg: string) => `class Other { y: uint8 = 3; }
    class Tagged { #tag: uint8 = 1; x: uint8 = 2;
      static pick(v: Tagged | Other): uint8 { if (#tag in v) { return v.x; } return v.y; } }
    String(Tagged.pick(${arg}));`;
  expect(evaluated(src('new Tagged()'))).toBe('2');
  expect(evaluated(src('new Other()'))).toBe('3');
});

test('a negated brand check narrows the other way', () => {
  expect(evaluated(`class Other { y: uint8 = 3; }
    class Tagged { #tag: uint8 = 1; x: uint8 = 2;
      static pick(v: Tagged | Other): uint8 { if (!(#tag in v)) { return v.y; } return v.x; } }
    String(Tagged.pick(new Other()));`)).toBe('3');
});

test('an ambiguous private name narrows nothing rather than guessing', () => {
  // A private name is lexically scoped to its class, but the enclosing class is
  // not tracked where this is decided, so the declaring class is found by
  // scanning. Two classes declaring the same name make that scan ambiguous, and
  // narrowing to the wrong one would be unsound where narrowing to none is not.
  expectStaticTypeError(`class Other { #tag: uint8 = 9; y: uint8 = 3; }
    class Tagged { #tag: uint8 = 1; x: uint8 = 2;
      static pick(v: Tagged | Other): uint8 { if (#tag in v) { return v.x; } return v.y; } }
    Tagged.pick(new Tagged());`);
});

test('the other relational forms are untouched', () => {
  expect(evaluated(`const o = { a: 1 }; ('a' in o) ? 'yes' : 'no';`)).toBe('yes');
  expect(evaluated(`let n: uint8 = 3; (n < 5) ? 'lt' : 'ge';`)).toBe('lt');
});

/**
 * A DISCARDED ternary narrows its arms too. `validateDiscardedExpression` is a
 * separate descent from `walkGuarded`, and its arithmetic case calls
 * `staticType` directly, so an arm that happened to be an additive expression
 * was typed with no narrowing in scope.
 *
 * The shape of the bug is why it survived: the same arm narrowed correctly when
 * bare, in parentheses, as a call argument, or anywhere the ternary's value was
 * used. Only `(v is A) ? ('' + v.x) : 'no';` as a statement reached the path
 * that skipped the fact.
 */

test('a discarded ternary narrows an additive arm', () => {
  const H = 'class A { x: uint8 = 1; } let v: A | null = new A(); ';
  expect(evaluated(`${H}(v is A) ? ('' + v.x) : 'no';`)).toBe('1');
  expect(evaluated(`${H}(v instanceof A) ? (1 + v.x) : 0;`)).toBe('2');
  expect(evaluated(`${H}(v !== null) ? (1 + v.x) : 0;`)).toBe('2');
});

test('both arms of a discarded ternary are narrowed, and negation flips them', () => {
  expect(evaluated(`class A { x: uint8 = 1; } class B { y: uint8 = 2; }
    let v: A | B = new B();
    (v is A) ? (1 + v.x) : (1 + v.y);`)).toBe('3');
  expect(evaluated(`class A { x: uint8 = 1; } let v: A | null = new A();
    (!(v is A)) ? 0 : (1 + v.x);`)).toBe('2');
});

test('the positions that already narrowed still do', () => {
  const H = 'class A { x: uint8 = 1; } let v: A | null = new A(); ';
  expect(evaluated(`${H}(v is A) ? v.x : 0;`)).toBe('1');
  expect(evaluated(`${H}const r: string = (v is A) ? ('' + v.x) : 'no'; r;`)).toBe('1');
  expect(evaluated(`${H}if (v is A) { '' + v.x; } else { 'no'; }`)).toBe('1');
});

test('a discarded expression is still checked', () => {
  // The case that added the arithmetic branch in the first place: a statement
  // never calls `staticType`, so these checks run from there or not at all.
  expectThrown('const a: [2].<uint8>; a[9];', 'is not an index of');
  expectThrown(`class A { x: uint8 = 1; } let v: A | null = new A(); '' + v.x;`,
    'is not declared by every member');
  expect(evaluated('let n: uint8 = 3; (n > 1) ? (1 + n) : 0;')).toBe('4');
});
