import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

/**
 * Spec: #sec-vector-comparisons with #sec-type-errors.
 *
 * "A comparison between two vectors of one shape yields one lane per input lane,
 * and what it yields for each is decided by the expected type, since the
 * comparison is overloaded on its return type ... Left with no expected type the
 * expression is ambiguous among them and is a type error, so the result's type
 * is written."
 *
 * The clause calls the ambiguity load-bearing rather than pedantic: the three
 * forms are three instructions, and "an unannotated `a < b` has no defensible
 * default among three ... a coin flip here is a performance cliff a program
 * cannot see".
 *
 * This is the first rule moved into the checking pass that is decidable only
 * from the POSITION rather than from the operands, and it needed a different
 * shape because of it. The relational arm deliberately answers nothing for a
 * vector comparison, and diagnosing THERE refuses the annotated cases: a
 * declarator does pass its annotation through `staticTypeIn`, but the walk has
 * already typed the initializer by then. So candidates are collected during
 * inference and drained after the walk, once every contextual position has been
 * visited - which is how `operatorFailures` beside it already works.
 */

const AB = 'let a: float32x4 = float32x4(1, 2, 3, 4); let b: float32x4 = float32x4(4, 3, 2, 1); ';

test('a comparison with no expected result type is refused', () => {
  expectStaticTypeError(`${AB}let r = a < b;`);
  expectStaticTypeError(`${AB}a < b;`);
  expectStaticTypeError(`${AB}if (a < b) { }`);
  // Every comparison operator the clause covers, not just the ordering ones.
  expectStaticTypeError(`${AB}let r = a == b;`);
  expectStaticTypeError(`${AB}let r = a != b;`);
  expectStaticTypeError(`${AB}let r = a >= b;`);
  // Integer lanes are the same rule.
  expectStaticTypeError('let a: int32x4 = int32x4(1, 2, 3, 4); let b: int32x4 = int32x4(4, 3, 2, 1); let r = a < b;');
});

test('the refusal does not wait for the comparison to run', () => {
  expectStaticTypeError('function f(a: float32x4, b: float32x4) { let r = a < b; }');
});

test('every position that supplies an expected type still selects a form', () => {
  // The three forms the clause defines, each reached by writing it.
  expect(evaluated(`${AB}let r: boolean32x4 = a < b; String(r is boolean32x4);`)).toBe('true');
  expect(evaluated(`${AB}let r: vector.<uint.<1>, 4> = a < b; String(r is vector.<uint.<1>, 4>);`)).toBe('true');
  expect(evaluated(`${AB}let r: float32x4 = a < b; String(r is float32x4);`)).toBe('true');
  // And the positions other than a `let` annotation, each of which had to be
  // reached by the deferred drain rather than by the arm.
  expect(ok(`${AB}const r: boolean32x4 = a < b;`)).toBe(true);
  expect(ok('function f(a: float32x4, b: float32x4): boolean32x4 { return a < b; }')).toBe(true);
  expect(ok(`function g(m: boolean32x4) { return m; } ${AB}g(a < b);`)).toBe(true);
  expect(ok(`class C { m: boolean32x4 | null = null; } ${AB}let c: C = new C(); c.m = a < b;`)).toBe(true);
});

test('the message names the three forms as types a program can write', () => {
  // Its worth is in the spellings: `boolean32x4`, not the same type expanded to
  // `vector.<vector.<uint.<1>, 32>, 4>`, which is useless as a thing to write.
  // Moving a diagnostic earlier must not cost what it said, so the run time's
  // own naming helper is used here too.
  expect(evaluated(`try { eval(${JSON.stringify(`${AB}a < b;`)}); 'no error'; } catch (e) { e.message; }`))
    .toContain('"boolean32x4" (the wide mask), "vector.<uint.<1>, 4>" (the compact mask), or "float32x4" (the compared type)');
});

test('comparisons that are not between two vectors are untouched', () => {
  expect(evaluated('let a: float32 = 1; let b: float32 = 2; String(a < b);')).toBe('true');
  expect(evaluated('let a: uint8 = 1; let b: uint8 = 2; String(a == b);')).toBe('false');
  expect(evaluated("let a = 'x'; let b = 'y'; String(a < b);")).toBe('true');
  // Two vectors of DIFFERENT shape are a different rule, and keep it.
  expectStaticTypeError('let a: float32x4 = float32x4(1, 2, 3, 4); '
    + 'let b: int32x4 = int32x4(1, 2, 3, 4); let r = a < b;');
});

test('a comparison the checker cannot decide defers', () => {
  // A vector mentioning a type parameter is not one shape yet, so the forms are
  // not known - the deferral #sec-evaluatetotypeobject draws.
  expect(ok('function f<T>(a: vector.<T, 4>, b: vector.<T, 4>) { let r = a < b; }')).toBe(true);
  // An `any` operand is the boundary #sec-type-errors reserves a thrown error
  // for, and the run time's own refusal answers it there.
  expectThrownKind('let a: any = float32x4(1, 2, 3, 4); '
    + 'let b: float32x4 = float32x4(4, 3, 2, 1); let r = a < b;', 'TypeError');
});

test.each(['==', '!='])('discarded SIMD equality requires an expected result: %s', (operator) => {
  for (const body of [`a ${operator} b;`, `throw a ${operator} b;`, `for (a ${operator} b; false;) {}`, `for (; false; a ${operator} b) {}`]) {
    expectStaticTypeError(`function unused(a: int32x4, b: int32x4) { ${body} }`);
  }
  for (const result of ['boolean32x4', 'vector.<uint.<1>, 4>', 'int32x4']) {
    expect(ok(`function valid(a: int32x4, b: int32x4) { const result: ${result} = a ${operator} b; }`)).toBe(true);
  }
  expect(ok(`function unknown(a: any, b: any) { a ${operator} b; }`)).toBe(true);
  expect(ok(`function generic<T>(a: vector.<T, 4>, b: vector.<T, 4>) { a ${operator} b; }`)).toBe(true);
});

test('discarded strict scalar equality keeps its existing policy', () => {
  expect(ok('function unused(a: string, b: boolean) { a === b; a !== b; }')).toBe(true);
});
