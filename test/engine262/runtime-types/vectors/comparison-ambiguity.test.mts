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
  expect(ok(`value class C { m: boolean32x4 | null = null; } ${AB}let c: C = new C(); c.m = a < b;`)).toBe(true);
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
  expect(ok('function f<T: type>(a: vector.<T, 4>, b: vector.<T, 4>) { let r = a < b; }')).toBe(true);
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
  expect(ok(`function generic<T: type>(a: vector.<T, 4>, b: vector.<T, 4>) { a ${operator} b; }`)).toBe(true);
});

test.each(['===', '!=='])('discarded disjoint strict equality is an operator error: %s', (operator) => {
  // #sec-narrowfrom applies the disjoint comparison obligation even when the
  // result is discarded. Compatible and unknown operands remain permitted.
  expectStaticTypeError(`function unused(a: string, b: boolean) { a ${operator} b; }`);
  expect(ok(`function compatible(a: string, b: string) { a ${operator} b; }`)).toBe(true);
  expect(ok(`function unknown(a: any, b: any) { a ${operator} b; }`)).toBe(true);
});

/**
 * Question AF, direction AF2. operatoroverloading.md's `Vector4` writes
 * `return (this.v == rhs.v).all();`, which was refused as ambiguous. `all`,
 * `any` and `select` are members of both masks, each giving the same type and
 * value on either, and of neither all-ones vector, so the form cannot change
 * what such a call answers. The comparison there is the wide mask, the form a
 * comparison instruction produces.
 */
test('the receiver of all, any or select is the wide mask', () => {
  const ab = 'const a = float32x4(1, 2, 3, 4); const b = float32x4(1, 2, 0, 4); ';
  expect(evaluated(`${ab}[(a == b).all(), (a == b).any(), (a < b).any(), (a != b).any()].join();`)).toBe('false,true,false,true');
  expect(evaluated(`${ab}String(((a == b)).all());`)).toBe('false');
  expect(evaluated(`${ab}String((a == b).select(int32x4(1, 1, 1, 1), int32x4(0, 0, 0, 0)));`)).toBe('(1, 1, 0, 1)');
  // The answer is the one the written forms give.
  expect(evaluated(`${ab}const w: boolean32x4 = a == b; const c: vector.<uint.<1>, 4> = a == b; [w.all(), c.all(), w.any(), c.any()].join();`))
    .toBe('false,false,true,true');
  expect(evaluated('const a = int32x4(1, 2, 3, 4); String((a == a).all()) + String((a != a).any());')).toBe('truefalse');
  // The design's example.
  expect(evaluated('value class V4 { v: float32x4 = float32x4(0, 0, 0, 0); operator==(rhs: V4): boolean { return (this.v == rhs.v).all(); } } '
    + 'const p = new V4(); const q = new V4(); String(p == q);')).toBe('true');
  // Where the checker cannot see the operands, the run time reads the position the same way.
  expect(evaluated('const a: any = float32x4(1, 2, 3, 4); String((a == a).all());')).toBe('true');
});

test('any other use of an unannotated comparison is still ambiguous', () => {
  const ab = 'const a = float32x4(1, 2, 3, 4); const b = float32x4(1, 2, 0, 4); ';
  // A member the forms do not share, or answer alike, and the method read without a call.
  for (const use of ['(a == b).sum();', '(a == b)[0];', '(a == b).all;', '(a == b)?.all();', 'const m = a == b; m.all();']) {
    expectStaticTypeError(`${ab}${use}`);
  }
  expectThrownKind('const a: any = float32x4(1, 2, 3, 4); (a == a).sum();', 'TypeError');
});
