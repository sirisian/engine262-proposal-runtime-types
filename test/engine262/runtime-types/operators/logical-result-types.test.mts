import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * Spec: #sec-static-type-of-an-expression, #sec-type-propagation-to-literals,
 * #sec-relational-operators, #sec-equality-operators, #sec-vector-lanes.
 *
 * `&&`, `||`, and `??` evaluate to one of their OPERANDS rather than to a
 * boolean, so the type of one of these is the part of the left that
 * short-circuits joined with the right's type. The checker had no case for any
 * of the three, nor for a comparison, so all of them were ~any~. Two
 * consequences, and the second is why this lands before return-type inference:
 *
 *   1. `const b: boolean = x && x < 10` passed the checker while the value on
 *      a falsy left is a `uint32` zero. Nothing caught it, because nothing had
 *      typed the expression at all.
 *   2. A function returning one of these forms could not be inferred: an ~any~
 *      contribution poisons a join, so `function f(a: uint32) { return a || 1; }`
 *      would publish nothing.
 *
 * The parts are stated per kind, and where a falsy value of a kind exists but
 * its literal type cannot be written - a `uint32` zero is a typed number, not a
 * Number literal - the whole member stands in for it, which is the widening
 * direction the inference clause already licenses.
 */

function run(source: string) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  return realm.evaluateScriptSkipDebugger(source);
}

function expectOk(source: string) {
  expect(run(source)).toMatchObject({ Type: 'normal' });
}

function expectTypeError(source: string) {
  expect(run(source)).toMatchObject({ Type: 'throw' });
}

/** The completion value of _source_, as a string. */
function value(source: string): string {
  const completion = run(source) as unknown as { Type: string, Value: { stringValue(): string } };
  if (completion.Type !== 'normal') {
    throw new Error(`expected a normal completion, got ${completion.Type}`);
  }
  return completion.Value.stringValue();
}

test('&& is the falsy part of the left joined with the right', () => {
  // The headline: a `uint32` zero is a value this expression can produce, so
  // the type says so and the boolean annotation is refused.
  expectTypeError('let x: uint32 = 5; const b: boolean = x && x < 10;');
  // `!!` is the one-token spelling of what the annotation claimed.
  expectOk('let x: uint32 = 5; const b: boolean = !!(x && x < 10);');
  expect(value('let a: boolean = true; let b: boolean = false; `${a && b}`;')).toBe('false');
});

test('&& drops an arm that cannot be falsy', () => {
  // Every object value is truthy, so the left contributes nothing.
  expectOk('let o: { m: string } = { m: "a" }; function f(): uint32 { return 5; } const r: uint32 = o && f();');
});

test('|| is the truthy part of the left joined with the right', () => {
  // The default idiom: a `string` left contributes its truthy part, the right
  // is a string, and the whole is a plain `string`.
  expect(value('let s: string = ""; const d: string = s || "anon"; d;')).toBe('anon');
  // An optional left drops the absent arm entirely.
  expect(value('let x: uint32 | undefined = undefined; const c: uint32 = x || 10; `${c}`;')).toBe('10');
  expectTypeError('let x: uint32 = 5; const s: string = x || 10;');
});

test('?? is the non-nullish part of the left joined with the right', () => {
  expect(value('let x: uint32 | undefined = undefined; const c: uint32 = x ?? 10; `${c}`;')).toBe('10');
  expect(value('let x: uint32 | undefined = 5; const c: uint32 = x ?? 10; `${c}`;')).toBe('5');
  expectTypeError('let x: uint32 | undefined = 5; const s: string = x ?? 10;');
});

test('a literal operand takes the position\'s type', () => {
  // #sec-type-propagation-to-literals: `const c: uint32 = x || 10` means the
  // `10` is a `uint32`, exactly as `const c: uint32 = 10` does. Typed in
  // isolation the result read `a literal type of number | uint.<32>` and the
  // program was refused at its own annotation.
  expect(value('let x: uint32 = 0; const c: uint32 = x || 10; `${c}`;')).toBe('10');
  expect(value('const c: uint32 = 0 || 10; `${c}`;')).toBe('10');
  expect(value('let x: uint8 | undefined = 0; const c: uint8 = x ?? 7; `${c}`;')).toBe('0');
});

test('an unknown operand keeps the expression unknown', () => {
  // An ~any~ operand must not manufacture a diagnostic.
  expectOk('function g() { return 5; } const s: string = g() && "x";');
  expectOk('function g() { return 5; } const s: string = g() ?? "x";');
});

test('a comparison is a boolean', () => {
  expectOk('let x: uint32 = 5; const b: boolean = x < 10;');
  expectOk('let x: uint32 = 5; const b: boolean = x === 5;');
  expectTypeError('let x: uint32 = 5; const s: string = x < 10;');
  expectTypeError('let s: string = "a"; const n: number = s === "a";');
});

test('a comparison over vectors is a lane-wise mask, not a boolean', () => {
  // #sec-vector-lanes: the operator applies lane-wise and the result is a mask
  // vector. Claiming `boolean` here broke the annotation this test names, so an
  // operand that is a vector - or whose type is not known, since a call could
  // return one - yields no static type rather than a wrong one.
  expectOk('const m: boolean32x4 = int32x4(1, 1, 9, 9) < int32x4(5, 5, 0, 0);');
  expectOk('const m: boolean32x4 = int32x4(0, 1, 2, 3) == int32x4(0, 1, 3, 2);');
});

test('the short-circuit forms are usable in a return position', () => {
  // What the inference cycle needs from this: these expressions now have types
  // to contribute instead of poisoning a join with ~any~.
  expectOk('function f(a: uint32): uint32 { return a || 1; }');
  expectOk('function f(a: uint32 | undefined): uint32 { return a ?? 1; }');
  expectOk('function f(a: string): string { return a || "d"; }');
  expectTypeError('function f(a: uint32): boolean { return a && a < 10; }');
});

test('a part that cannot occur contributes nothing, in both directions', () => {
  // The left never short-circuits, so it contributes nothing: every object
  // value is truthy.
  expectOk('class C {} let c: C = new C(); function f(): uint32 { return 5; } const r: uint32 = c && f();');
  // The dual: the left ALWAYS short-circuits, so the right is never evaluated
  // and contributes nothing.
  expectOk('let u: undefined = undefined; const r: undefined = u && 7;');
  expect(value('let u: undefined = undefined; const r: uint32 = u || 7; `${r}`;')).toBe('7');
});

test('boolean contributes its literal true and false parts', () => {
  expectOk('let b: boolean = false; function f(): uint32 { return 5; } const r: false | uint32 = b && f();');
  expectOk('let b: boolean = false; function f(): uint32 { return 5; } const r: true | uint32 = b || f();');
});
