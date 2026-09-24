import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * Two refinements to inferring an unannotated `for`-`of` binding's type:
 *
 * - A UNION asks for its numeric member when it has exactly one.
 * - A REDECLARATION of the binding's name shadows only its own scope.
 */

const L = (body: string, pre = '', iterable = '0..<3') =>
  `${pre} let t = ''; for (const i of ${iterable}) { ${body} t = String(Reflect.typeOf(i)); } t;`;
const S = 'const s = new Set.<uint32>();';

// ---- unions ---------------------------------------------------------------

test('a union with one numeric member asks for that member', () => {
  // As a literal takes it: `let x: uint8 | string = 3` is a `uint8`.
  expect(evaluated(L('let x: uint8 | string = i;'))).toBe('uint.<8>');
  expect(evaluated(L('let x: uint8 | string | boolean = i;'))).toBe('uint.<8>');
});

test('the range is checked against that member, before the program runs', () => {
  expectStaticTypeError('for (const i of 0..<300) { let x: uint8 | string = i; }');
});

test('an out-of-range value does not fall through to the string member', () => {
  // The hazard inference avoids. At run time `uint8 | string` takes a number too
  // large for `uint8` as the STRING "300" - measured with `(300..<301).step(1)`.
  // The literal `300` there is refused before the program runs, and so is this,
  // because the binding is inferred the `uint8` member rather than converted into
  // the union at run time.
  expectStaticTypeError('for (const i of 300..<301) { let x: uint8 | string = i; }');
});

test('a union with two numeric members asks for nothing', () => {
  // The literal's choice between `uint8` and `int16` is a ranking; inferring
  // through it would be a silent pick. Refused, as before.
  expectStaticTypeError('for (const i of 0..<3) { let x: uint8 | int16 = i; }');
});

// ---- shadowing ------------------------------------------------------------

test('a redeclaration in a nested block does not hide the loop binding', () => {
  // `{ const i = 5; }` declares its own `i`; the `s.add(i)` after it is the loop
  // binding. This was refused: any redeclaration in the body turned inference off.
  expect(evaluated(L('{ const i = 5; } s.add(i);', S))).toBe('uint.<32>');
});

test('a use INSIDE the shadowing scope does not count toward the loop binding', () => {
  // The inner `let y: uint8 = i` reads the inner `i`. Counted for the loop binding,
  // it would ask for `uint8` against the outer `uint32` - a disagreement that would
  // turn inference off. It must be set aside.
  expect(evaluated(L('{ const i = 5; let y: uint8 = i; } s.add(i);', S))).toBe('uint.<32>');
});

test('parameters, catch bindings and nested loops shadow their own scope', () => {
  expect(evaluated(L('const f = (i) => { let y: uint8 = i; }; s.add(i);', S))).toBe('uint.<32>');
  expect(evaluated(L('try {} catch (i) { let y: uint8 = i; } s.add(i);', S))).toBe('uint.<32>');
  expect(evaluated(L('for (const i of [1]) { let y: uint8 = i; } s.add(i);', S))).toBe('uint.<32>');
});

test('a function declaration\'s name binds in the scope around it', () => {
  // Not inside its own body: `{ function i() {} }` shadows `i` for that block.
  expect(evaluated(L('{ function i() {} } s.add(i);', S))).toBe('uint.<32>');
});

test('a redeclaration at the top of the body shadows the whole body', () => {
  // Every `i` in the body is then the inner one, and the loop binding has no use.
  expect(evaluated('let t = \'ok\'; for (const i of 0..<3) { const i = 7; } t;')).toBe('ok');
});
