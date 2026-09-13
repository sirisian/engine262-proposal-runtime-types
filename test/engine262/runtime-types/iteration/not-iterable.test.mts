import { expect, test } from 'vitest';
import { evaluated, expectThrown, ok } from '../harness.mts';

/**
 * Spec: #sec-iteration-types with #sec-type-errors. A value of a primitive
 * type is not iterable, `string` excepted - it iterates its characters. The run
 * time refused the rest with "1 (typed) is not iterable", and the operand's
 * type is written at its declaration, so the judgment is determinable.
 *
 * Deliberately narrow, for the reason callability is: an ~object~ or a
 * ~nominal~ may carry `Symbol.iterator`, and the structures here do not record
 * it, so "no iterator in the structure" would refuse a type that has one. Every
 * case is in a function that is never called.
 */

const dead = (source: string) => `function __never() { ${source} }`;

test('a value of a primitive type is not iterable', () => {
  expectThrown(dead('let n: uint8 = uint8(1); for (const x of n) { }'), 'is not iterable');
  expectThrown(dead('let b: boolean = true; for (const x of b) { }'), 'is not iterable');
  // Spreading one is the same rule at another syntax.
  expectThrown(dead('let n: uint8 = uint8(1); let a = [...n];'), 'is not iterable');
  expectThrown(dead('let b: boolean = true; let a = [...b];'), 'is not iterable');
});

test('a string iterates its characters', () => {
  expect(ok(dead('let s: string = "x"; for (const x of s) { }'))).toBe(true);
  expect(ok(dead('let s: string = "x"; let a = [...s];'))).toBe(true);
});

test('what the rule does not reach', () => {
  // The iterables the library and the language supply.
  expect(ok(dead('let a: [].<uint8> = []; for (const x of a) { }'))).toBe(true);
  expect(ok(dead('let t: [uint8, string] = [uint8(1), "s"]; for (const x of t) { }'))).toBe(true);
  expect(ok(dead('let m: Map.<string, uint8> = new Map(); for (const x of m) { }'))).toBe(true);
  expect(ok(dead('let s: Set.<uint8> = new Set(); for (const x of s) { }'))).toBe(true);
  expect(ok(dead('function* g() { yield uint8(1); } for (const x of g()) { }'))).toBe(true);
  expect(ok(dead('for (const x of 0..<3) { }'))).toBe(true);

  // A user type declaring the method, which is why an object or nominal
  // receiver is not judged.
  expect(ok(dead('class C { [Symbol.iterator]() { return [1][Symbol.iterator](); } }'
    + ' let c: C = new C(); for (const x of c) { }'))).toBe(true);

  // The two escapes that must stay open.
  expect(ok(dead('let a: any = [1]; for (const x of a) { }'))).toBe(true);
  expect(ok(dead('let u = [1]; for (const x of u) { }'))).toBe(true);
  expect(ok(dead('function f() { for (const x of arguments) { } }'))).toBe(true);

  // OBJECT spread and destructuring are not iteration and are untouched.
  expect(ok(dead('let o: { a: uint8 } = { a: uint8(1) }; let p = { ...o };'))).toBe(true);
  expect(ok(dead('let o: { a: uint8 } = { a: uint8(1) }; let { a } = o;'))).toBe(true);
});

test('an ARRAY PATTERN iterates its initializer', () => {
  // The same judgment at a third syntax: a pattern fills its elements by
  // iterating, so a value that cannot be iterated cannot fill one.
  expectThrown(dead('let n: uint8 = uint8(1); let [x] = n;'), 'is not iterable');
  expectThrown(dead('let b: boolean = true; let [x] = b;'), 'is not iterable');
  expectThrown(dead('let n: uint8 = uint8(1); const [x, y] = n;'), 'is not iterable');

  // An ARRAY, a string and an array literal all iterate.
  expect(ok(dead('let a: [].<uint8> = []; let [x] = a;'))).toBe(true);
  expect(ok(dead('let s: string = "x"; let [x] = s;'))).toBe(true);
  expect(ok(dead('let [x] = [1, 2];'))).toBe(true);
  // An OBJECT pattern reads properties rather than iterating.
  expect(ok(dead('let o: { x: uint8 } = { x: uint8(1) }; let { x } = o;'))).toBe(true);
  // A destructured PARAMETER is bound by the call, not by an initializer here.
  expect(ok(dead('function f([x]: [].<uint8>) { }'))).toBe(true);

  // The ASSIGNMENT form is the same pattern without a declaration. Its left
  // side arrives as an ~ArrayLiteral~, the grammar refining it to a pattern
  // only where the assignment is evaluated.
  expectThrown(dead('let x; let n: uint8 = uint8(1); [x] = n;'), 'is not iterable');
  expectThrown(dead('let x; let y; let b: boolean = true; [x, y] = b;'), 'is not iterable');
  expect(ok(dead('let x; let a: [].<uint8> = []; [x] = a;'))).toBe(true);
  expect(ok(dead('let x; let s: string = "x"; [x] = s;'))).toBe(true);
  expect(ok(dead('let x; let o: { x: uint8 } = { x: uint8(1) }; ({ x } = o);'))).toBe(true);
});

test('a UNION cannot be iterated when no member can', () => {
  // The four syntaxes share one predicate now, so each learned the union at
  // once rather than needing its own condition.
  expectThrown(dead('let u: uint8 | int32 = uint8(1); for (const x of u) { }'), 'is not iterable');
  expectThrown(dead('let u: uint8 | int32 = uint8(1); let a = [...u];'), 'is not iterable');
  expectThrown(dead('let u: uint8 | int32 = uint8(1); let [x] = u;'), 'is not iterable');
  expectThrown(dead('let u: uint8 | boolean = uint8(1); let y; [y] = u;'), 'is not iterable');

  // A union with an ITERABLE member is left alone: iterating it is unsound, but
  // narrowing is the escape, and refusing it would refuse the program that
  // narrows first - the line the callability rule draws too.
  expect(ok(dead('let u: uint8 | [].<uint8> = uint8(1); for (const x of u) { }'))).toBe(true);
  expect(ok(dead('let u: uint8 | string = "x"; for (const x of u) { }'))).toBe(true);
});

test('a SPREAD ARGUMENT iterates, as a spread in an array literal does', () => {
  expectThrown(dead('let n: uint8 = uint8(1); function f() { } f(...n);'), 'is not iterable');
  expectThrown(dead('let b: boolean = true; function f() { } f(...b);'), 'is not iterable');
  expect(ok(dead('let a: [].<uint8> = []; function f() { } f(...a);'))).toBe(true);
  expect(ok(dead('let s: string = "x"; function f() { } f(...s);'))).toBe(true);
});

test('every iteration syntax reaches the rule', () => {
  // One operand through every syntax that iterates, which is the sweep that
  // found the spread argument, `yield*` and `for await`. All of them decide it.
  const N = 'let n: uint8 = uint8(1); ';
  expectThrown(dead(`${N}for (const x of n) { }`), 'is not iterable');
  expectThrown(dead(`${N}let a = [...n];`), 'is not iterable');
  expectThrown(dead(`${N}let [x] = n;`), 'is not iterable');
  expectThrown(dead(`${N}let x; [x] = n;`), 'is not iterable');
  expectThrown(dead(`${N}function f() { } f(...n);`), 'is not iterable');
  expectThrown(dead(`${N}function* g() { yield* n; }`), 'is not iterable');
  expectThrown(dead(`${N}async function g() { for await (const y of n) { } }`), 'is not iterable');
});

test('`for await` takes an async iterable or a sync one', () => {
  // The same statement as `for`-`of` with the same fields and a different node
  // name, which is why it was reached by nothing: a ~ForAwaitStatement~
  // appeared nowhere in check.mts.
  expect(ok(dead('async function* h() { yield uint8(1); }'
    + ' async function g() { for await (const x of h()) { } }'))).toBe(true);
  expect(ok(dead('let a: [].<uint8> = []; async function g() { for await (const x of a) { } }'))).toBe(true);
  expect(ok(dead('let s: string = "x"; async function g() { for await (const x of s) { } }'))).toBe(true);
  expect(ok(dead('let a: any = []; async function g() { for await (const x of a) { } }'))).toBe(true);
});

test('an OBJECT spread is correctly untouched', () => {
  // It copies properties rather than iterating, and `{ ...1 }` is ordinary
  // JavaScript.
  expect(ok(dead('let n: uint8 = uint8(1); let o = { ...n };'))).toBe(true);
});

test('`yield*` delegates to an iterable', () => {
  // `YieldExpression` had an arm in `staticType` and none in the walk, which is
  // the shape the pipeline body had: the judgments live in the walk, and a node
  // it does not name is reached only by the generic descent, which asks nothing.
  expectThrown(dead('let n: uint8 = uint8(1); function* g() { yield* n; }'), 'is not iterable');
  expectThrown(dead('let b: boolean = true; function* g() { yield* b; }'), 'is not iterable');

  // What delegation legitimately takes.
  expect(ok(dead('let a: [].<uint8> = []; function* g() { yield* a; }'))).toBe(true);
  expect(ok(dead('let s: string = "x"; function* g() { yield* s; }'))).toBe(true);
  expect(ok(dead('function* h() { yield uint8(1); } function* g() { yield* h(); }'))).toBe(true);
  expect(ok(dead('let a: [].<uint8> = []; async function* g() { yield* a; }'))).toBe(true);

  // A PLAIN yield hands over one value and iterates nothing.
  expect(ok(dead('let n: uint8 = uint8(1); function* g() { yield n; }'))).toBe(true);
  expect(ok(dead('function* g() { yield; }'))).toBe(true);

  // Delegation still works at run time.
  expect(evaluated('function* h() { yield 1; yield 2; } function* g() { yield* h(); }'
    + ' String([...g()]);')).toBe('1,2');
});
