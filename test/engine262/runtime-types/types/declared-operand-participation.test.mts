import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, observeScript } from '../harness.mts';

/**
 * Spec: #sec-proved-library-operations, #sec-checking-state.
 *
 * The judgments over "a participating operand" read the operand's Static
 * Type, and a binding's annotation is that contract whatever its initializer
 * and whether the binding is `let` or `const`: "a narrower current value never
 * changes a declared store contract". The boundary-origin pass admitted an
 * operand only as a top-level `const` with a literal initializer, so an
 * annotated `let` reached the ToString stage, the prototype argument of
 * `Object.create` and `Object.setPrototypeOf`, and `Object.is`, only at run
 * time.
 */

const S = 'let s: symbol = Symbol(); ';

test.each([
  `${S}'abc'.startsWith(s);`,
  `${S}'abc'.includes(s);`,
  `${S}'abc'.indexOf(s);`,
  `${S}'x'.concat('a', s);`,
  `${S}'x'.padStart(3, s);`,
  `${S}[1, 2].join(s);`,
  `${S}parseInt(s);`,
  `${S}encodeURIComponent(s);`,
])('an annotated let at an established ToString stage is refused: %s', expectStaticTypeError);

test('an annotated let as a prototype argument is refused', () => {
  expectStaticTypeError('let p: string = "x"; Object.create(p);');
  expectStaticTypeError('let p: uint8 = 1; Object.setPrototypeOf({}, p);');
});

test('Object.is over disjoint annotated lets is refused', () => {
  expect(observeScript('let a: uint8 = 1; let b: string = "s"; Object.is(a, b);')).toMatchObject({
    bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-disjoint-comparison' },
  });
  expectStaticTypeError('let a: uint8 = 1; Object.is(a, "x");');
});

test('a viable alternative, any, and a non-literal untyped binding keep the runtime check', () => {
  expect(evaluated('let a: uint8 = 1; let b: uint8 = 1; String(Object.is(a, b));')).toBe('true');
  expect(evaluated('let s: symbol | string = "b"; String("abc".includes(s));')).toBe('true');
  expect(evaluated('let s: any = "b"; String("abc".startsWith(s));')).toBe('false');
  expect(evaluated('let p: object | null = null; String(Object.create(p) !== null);')).toBe('true');
});
