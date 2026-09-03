import { test, expect } from 'vitest';
import { evaluated, ok, expectStaticTypeError } from '../harness.mts';

/**
 * THE SET OPERATIONS AND THE FAMILY TOP.
 *
 * THE FAMILY TOP. `Set.<any>` is a set of some element type and
 * `Map.<any, any>` a map of some key and value types, and every specialization
 * reaches its family's top. What makes `any` admissible where a general
 * covariance would not be is what makes `[].<any>` admissible for the array: a
 * store is checked against the RECEIVER's own declared types at run time - `add`
 * and `set` route through the [[TypedCollection]] stamp - so writing through the
 * wider view is refused whatever the static type permitted.
 *
 * Argument by argument, not all-or-nothing: `Map.<string, any>` is the
 * map-of-string-keys top, and a `Map.<uint8, uint8>` does not reach it. The
 * array has one argument and so never had to say this.
 *
 * THE BARE NOMINAL, FIXED. A bare library nominal used to accept its own
 * specializations - a `Set.<uint8>` was assignable to `Set` - while a bare USER
 * generic did not, so
 * `G.<uint8>` was not assignable to `G`. Two readings of one rule, and the
 * ARRAY settles which is right: a `[].<uint8>` is NOT assignable to a bare `[]`,
 * and a bare `[]` is the untyped array. Collections now agree with both. The
 * special case that produced the old answer carried no comment explaining it,
 * and removing it moved nothing across ~2,000 tests - which is the evidence that
 * it was an oversight rather than a decision, since it applied to every library
 * nominal (`Promise`, `Generator`, `Span`) and not only to collections.
 *
 * THE RESULT TYPES were already right and are asserted here anyway. A call-site
 * handler computing `Set.<T | U>` predates this work; only the BOUND on `other`
 * is new, and before it `a.union(1)` type-checked.
 */

const AB = 'let a: Set.<uint8> = new Set(); let b: Set.<string> = new Set(); ';

// ---------------------------------------------------------------------------
// The family top
// ---------------------------------------------------------------------------

test('a specialization reaches its family top', () => {
  expect(ok('function f(x: Set.<any>) {} let s: Set.<uint8> = new Set(); f(s);')).toBe(true);
  expect(ok('function f(x: Map.<any, any>) {} let m: Map.<string, uint8> = new Map(); f(m);')).toBe(true);
  expect(ok('function f(x: WeakMap.<any, any>) {} let w: WeakMap.<object, uint8> = new WeakMap(); f(w);')).toBe(true);
  expect(ok('function f(x: WeakSet.<any>) {} let w: WeakSet.<object> = new WeakSet(); f(w);')).toBe(true);
});

test('the top is argument by argument', () => {
  // `Map.<string, any>` is the map-of-string-keys top: the key must still match
  // and only the value is erased.
  expect(ok('function f(x: Map.<string, any>) {} let m: Map.<string, uint8> = new Map(); f(m);')).toBe(true);
  expectStaticTypeError('function f(x: Map.<uint8, any>) {} let m: Map.<string, uint8> = new Map(); f(m);');
  expect(ok('function f(x: Map.<any, uint8>) {} let m: Map.<string, uint8> = new Map(); f(m);')).toBe(true);
  expectStaticTypeError('function f(x: Map.<any, string>) {} let m: Map.<string, uint8> = new Map(); f(m);');
});

test('invariance is untouched for every other argument', () => {
  // The top is `any` and nothing else. A wider NUMERIC type is still refused,
  // for the reason sec-issubtype gives: the wider view would accept a Number
  // into storage typed uint8.
  expectStaticTypeError('function f(x: Set.<number>) {} let s: Set.<uint8> = new Set(); f(s);');
  expectStaticTypeError('function f(x: Map.<string, number>) {} let m: Map.<string, uint8> = new Map(); f(m);');
  // And the top does not cross families: a Set is not a Map however erased.
  expectStaticTypeError('function f(x: Map.<any, any>) {} let s: Set.<uint8> = new Set(); f(s);');
  expectStaticTypeError('function f(x: Set.<any>) {} let m: Map.<string, uint8> = new Map(); f(m);');
});

test('a BARE nominal is not a top, for a library or a user generic', () => {
  // The array is the precedent: a typed array does not reach a bare `[]`.
  expectStaticTypeError('function f(x: []) {} let a: [].<uint8> = [1]; f(a);');
  // The array's OTHER half is not asserted, because the array disagrees with
  // itself about it: `f([1,2,3])` at a bare `[]` parameter is accepted by the
  // checker and throws at RUN TIME, "[object Array] is not assignable to []".
  // Measured on a clean build of the base commit, so it predates this work and
  // is filed rather than fixed here. The collections do not share it - see the
  // two assertions at the foot of this test - which is what makes it an array
  // defect rather than a rule the collections got wrong.
  // Collections now agree.
  expectStaticTypeError('function f(x: Set) {} let s: Set.<uint8> = new Set(); f(s);');
  expectStaticTypeError('function f(x: Map) {} let m: Map.<string, uint8> = new Map(); f(m);');
  // ...as does the user generic, which always did.
  expectStaticTypeError('class G<T> { x: uint8; } function f(a: G) {} let g: G.<uint8> = new G.<uint8>(); f(g);');
  // A bare nominal still admits the UNPARAMETERIZED value, which is what it
  // means - and is how untyped collections stay writable. Asserted UNWRAPPED,
  // so the run time answers too: the checker and the run time must agree here,
  // which is exactly what the array above fails to do.
  expect(ok('function f(x: Set) {} f(new Set());')).toBe(true);
  expect(ok('function f(x: Map) {} f(new Map());')).toBe(true);
  expect(evaluated('function f(x: Set) { return x.size; } String(f(new Set()));')).toBe('0');
});

// ---------------------------------------------------------------------------
// The set operations
// ---------------------------------------------------------------------------

test('the other operand is bound at the family top', () => {
  // The parameter was once ~any~ and every one of these type-checked.
  for (const op of ['union', 'intersection', 'difference', 'symmetricDifference',
    'isSubsetOf', 'isSupersetOf', 'isDisjointFrom']) {
    expectStaticTypeError(`${AB} a.${op}(1);`);
    expectStaticTypeError(`${AB} a.${op}("x");`);
    expect(ok(`${AB} a.${op}(b);`), op).toBe(true);
  }
});

test('the other operand may be an untyped Set or a set-like', () => {
  // ES2026 takes any set-like - an object with `size`, `has` and `keys` - and
  // the bound must not narrow that. `backcompat.test.mts` asserts the untyped
  // half; this is the same question asked from a TYPED receiver, which is where
  // a too-tight bound would have shown up.
  expect(ok('let a: Set.<uint8> = new Set(); let u = new Set(); a.union(u);')).toBe(true);
  expect(ok('let a: Set.<uint8> = new Set(); a.union({ size: 0, has: () => false, keys: () => [][Symbol.iterator]() });')).toBe(true);
  expect(evaluated('const a = new Set.<uint8>(); a.add(1); const like = { size: 1, has: (v) => v === 2, keys: () => [2][Symbol.iterator]() }; [...a.union(like)].join(",");')).toBe('1,2');
});

test('union and symmetricDifference draw from both sides', () => {
  expect(ok(`${AB} let c: Set.<uint8 | string> = a.union(b);`)).toBe(true);
  expect(ok(`${AB} let c: Set.<uint8 | string> = a.symmetricDifference(b);`)).toBe(true);
  expectStaticTypeError(`${AB} let c: Set.<uint8> = a.union(b);`);
  expectStaticTypeError(`${AB} let c: Set.<string> = a.union(b);`);
  // Where both sides agree the union does not manufacture one.
  expect(ok('let a: Set.<uint8> = new Set(); let b: Set.<uint8> = new Set(); let c: Set.<uint8> = a.union(b);')).toBe(true);
});

test('intersection and difference keep the receiver type', () => {
  // They draw only from `this`, so the other side's element type cannot reach
  // the result whatever it holds.
  expect(ok(`${AB} let c: Set.<uint8> = a.intersection(b);`)).toBe(true);
  expect(ok(`${AB} let c: Set.<uint8> = a.difference(b);`)).toBe(true);
  expectStaticTypeError(`${AB} let c: Set.<string> = a.intersection(b);`);
  expectStaticTypeError(`${AB} let c: Set.<uint8 | string> = a.difference(b);`);
});

test('the predicates answer a Boolean', () => {
  for (const op of ['isSubsetOf', 'isSupersetOf', 'isDisjointFrom']) {
    expect(ok(`${AB} let r: boolean = a.${op}(b);`), op).toBe(true);
    expectStaticTypeError(`${AB} let r: string = a.${op}(b);`);
  }
});

test('where the other element type is unknown the result carries none', () => {
  // "Where the other operand's element type is not known, the result's is not
  // either, and the result carries none: a union with an unconstrained set is
  // unconstrained, and answering Set.<T> would state more than the values
  // support."
  expect(ok('let a: Set.<uint8> = new Set(); let u = new Set(); let c: Set.<uint8> = a.union(u);')).toBe(true);
  expect(ok('let a: Set.<uint8> = new Set(); let u = new Set(); let c: Set.<string> = a.union(u);')).toBe(true);
});

// ---------------------------------------------------------------------------
// The results are right at run time too
// ---------------------------------------------------------------------------

test('the operations carry their element types at run time', () => {
  // The runtime rule predates this work and is asserted so the two halves stay
  // in step - a checker and a run time disagreeing about a result type is the
  // shape this suite has been bitten by before.
  const a = 'const a = new Set.<uint8>(); a.add(1); ';
  const b = 'const b = new Set.<uint8>(); b.add(2); ';
  expect(evaluated(`${a}${b} String(Reflect.typeOf(a.union(b)) === (type Set.<uint8>));`)).toBe('true');
  expect(evaluated(`${a}${b} String(Reflect.typeOf(a.intersection(b)) === (type Set.<uint8>));`)).toBe('true');
  expect(evaluated(`${a}${b} String(Reflect.typeOf(a.difference(b)) === (type Set.<uint8>));`)).toBe('true');
  expect(evaluated(`${a}${b} [...a.union(b)].join(",");`)).toBe('1,2');
  // A result carrying the element type is still CHECKED on a later store, which
  // is what makes the family top safe.
  expect(ok(`${a}${b} const u = a.union(b); const bad = (300 := any); u.add(bad);`)).toBe(false);
});

test('the constant-fold holds in BOTH directions', () => {
  // The design's claim is symmetric - "distinct value types share no values" -
  // and before this it was not. A set operation walks the SMALLER operand and
  // probes the larger, and the probe ran through the converting path: a uint8
  // needle stringified into a `Set.<string>` and answered false, while a String
  // needle at a `Set.<uint8>` threw. So the fold worked or threw depending on
  // which operand happened to be smaller, and the test that covered it happened
  // to pick the working order.
  const a = 'const a = new Set.<uint8>(); a.add(1); ';
  const b = 'const b = new Set.<string>(); b.add("x"); ';
  expect(evaluated(`${a}${b} String(a.intersection(b).size);`)).toBe('0');
  expect(evaluated(`${a}${b} String(b.intersection(a).size);`)).toBe('0');
  expect(evaluated(`${a}${b} String(a.isDisjointFrom(b));`)).toBe('true');
  expect(evaluated(`${a}${b} String(b.isDisjointFrom(a));`)).toBe('true');
  expect(evaluated(`${a}${b} String(a.isSubsetOf(b));`)).toBe('false');
  expect(evaluated(`${a}${b} String(b.isSubsetOf(a));`)).toBe('false');
  // The operations that draw from both sides still carry both.
  expect(evaluated(`${a}${b} String(a.union(b).size);`)).toBe('2');
  expect(evaluated(`${a}${b} String(a.difference(b).size);`)).toBe('1');
});

test('a genuine error from the other operand still propagates', () => {
  // Only this operation's OWN type test is inspected. A `has` that throws for
  // any other reason is a failure rather than an answer, and swallowing it would
  // turn a broken set-like into a silently empty intersection.
  expect(evaluated('const a = new Set.<uint8>([1]); const bad = { size: 1, has: () => { throw new RangeError("boom"); }, keys: () => [1][Symbol.iterator]() }; try { a.intersection(bad); "no"; } catch (e) { e.constructor.name; }')).toBe('RangeError');
});

test('the constant-fold case the design names', () => {
  // "When T and U are unrelated value types the compiler can constant-fold the
  // answer: an intersection of a Set.<uint8> and a Set.<string> is empty
  // without iterating, and isDisjointFrom is true."
  expect(evaluated('const a = new Set.<uint8>(); a.add(1); const b = new Set.<string>(); b.add("x"); String(a.intersection(b).size);')).toBe('0');
  expect(evaluated('const a = new Set.<uint8>(); a.add(1); const b = new Set.<string>(); b.add("x"); String(a.isDisjointFrom(b));')).toBe('true');
});
