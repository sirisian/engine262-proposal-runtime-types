import { test, expect } from 'vitest';
import {
  evaluated, ok, expectThrown, runFlagOff,
} from '../readme/harness.mts';

/**
 * Capability O — references and borrowing (references.md).
 *
 * A `ref` is a borrow: a handle to a storage location — a variable, an object
 * property, or an array element — that reads and writes through to the original
 * rather than a copy. It has no observable identity, so `typeof` and the like
 * see the referent, and a reference value decays to the referent at any boundary
 * that consumes a value. The borrowing forms are the call-site `ref` argument
 * and `ref` return, the `ref` parameter, the `let ref` / `const ref` lexical
 * binding and its rebinding, and the index-based `for (const ref p of a)` loop.
 * A `let ref` may be written through and rebound; a `const ref` may not. Two
 * liveness rules hold: a reference may not be taken of a non-location, and an
 * array may not be resized while a reference into it is live.
 *
 * Deferred by design (noted where relevant): a location-consuming return such as
 * `first(a)++` (needs a relaxed AssignmentTargetType), destructuring `ref`
 * members `f({ (ref a) })` (needs the typed-own-property form), a user-defined
 * iterator yielding references (the `...` yield type is a value type), and the
 * SoA/typed-buffer substrate (a reference denotes a column set and an index).
 */

// -- ref parameter: write-through ---------------------------------------------
test('a ref parameter writes through to a caller variable', () => {
  expect(evaluated('function f(ref a) { a++; } let a = 0; f(ref a); String(a);')).toBe('1');
});

test('a ref parameter writes through to an object property', () => {
  expect(evaluated('const o = { a: 0 }; function f(ref a) { a++; } f(ref o.a); String(o.a);')).toBe('1');
});

test('a ref parameter writes through to an array element', () => {
  expect(evaluated('let arr = [41]; function f(ref a) { a++; } f(ref arr[0]); String(arr[0]);')).toBe('42');
});

test('a callee reads through a ref to a caller mutation', () => {
  // the referent is mutated by another alias during the call; the ref sees it
  expect(evaluated('let x = 1; function bump() { x = 99; } function f(ref a, g) { g(); return a; } String(f(ref x, bump));')).toBe('99');
});

// -- ref parameter: no observable identity ------------------------------------
test('typeof through a ref sees the referent, not the reference', () => {
  expect(evaluated('let a = 5; function f(ref x) { return typeof x; } f(ref a);')).toBe('number');
});

// -- ref parameter: the borrow requires a location ----------------------------
test('a plain argument to a ref parameter is a TypeError', () => {
  expectThrown('function f(ref a) { a++; } f(5);');
});

test('a ref argument to a non-ref parameter decays to the value', () => {
  // the callee gets the value and cannot write through; the caller is unchanged
  expect(evaluated('let x = 1; function id(v) { v = 9; return v; } let r = id(ref x); String(x) + "," + String(r);')).toBe('1,9');
});

// -- ref parameter: the annotation is checked, never converted ----------------
test('a typed ref parameter accepts a referent of that type', () => {
  expect(evaluated('function f(ref a: int32) { a++; } let a: int32 = (7 := int32); f(ref a); String(a);')).toBe('8');
});

test('a typed ref parameter rejects a referent of another type without converting', () => {
  // a plain number is `number`, not `int32`; a borrow checks, it does not convert
  expectThrown('function f(ref a: int32) { a++; } let a = 5; f(ref a);');
});

// -- ref return: decay at the call boundary -----------------------------------
test('a ref return decays to the referent value at an ordinary call', () => {
  expect(evaluated('function first(a) { return ref a[0]; } let arr = [7, 8]; String(first(arr));')).toBe('7');
});

// -- let ref lexical binding: write-through and read-through -------------------
test('a let ref binding writes through to an array element', () => {
  expect(evaluated('let a = [5]; let ref b = a[0]; b = 10; String(a[0]);')).toBe('10');
});

test('a let ref binding reads through a later write to the element', () => {
  expect(evaluated('let a = [5]; let ref b = a[0]; a[0] = 42; String(b);')).toBe('42');
});

test('a let ref binding writes through to a variable', () => {
  expect(evaluated('let x = 1; let ref b = x; b = 99; String(x);')).toBe('99');
});

// -- const ref lexical binding ------------------------------------------------
test('a const ref binding permits member writes through the referent', () => {
  expect(evaluated('let c = [{ a: 1 }]; const ref d = c[0]; d.a = 10; String(c[0].a);')).toBe('10');
});

test('a const ref binding rejects reassignment of the binding', () => {
  expectThrown('let a = [5]; const ref b = a[0]; b = 10; String(a[0]);');
});

// -- let ref rebinding --------------------------------------------------------
test('reassigning a let ref rebinds it to a different location', () => {
  // ref b = a[1] rebinds; a[0] is untouched, and a write now lands in a[1]
  expect(evaluated('let a = [5, 6]; let ref b = a[0]; ref b = a[1]; b = 10; a[0] + "," + a[1];')).toBe('5,10');
});

test('a rebound let ref reads through its new location', () => {
  expect(evaluated('let a = [5, 6]; let ref b = a[0]; ref b = a[1]; String(b);')).toBe('6');
});

test('a const ref cannot be rebound', () => {
  expectThrown('let a = [5, 6]; const ref b = a[0]; ref b = a[1]; String(b);');
});

test('rebinding a name that is not a ref binding is a TypeError', () => {
  expectThrown('let b = 1; let a = [5]; ref b = a[0]; String(b);');
});

// -- the borrow requires a location -------------------------------------------
test('a ref binding of a plain value is a TypeError', () => {
  expectThrown('let ref b = 5; String(b);');
});

test('a ref binding of a computed value is a TypeError', () => {
  expectThrown('let a = [5]; let ref b = a[0] + 1; String(b);');
});

test('a ref declaration without an initializer is a SyntaxError', () => {
  expectThrown('let ref b; String(b);');
});

// -- for (const ref p of a): index-based, writes in place ----------------------
test('a for-of ref loop writes through to each element', () => {
  expect(evaluated('let a = [1, 2, 3]; for (let ref p of a) { p = p * 10; } a[0] + "," + a[1] + "," + a[2];')).toBe('10,20,30');
});

test('a const ref loop permits member writes but not reassignment', () => {
  expect(evaluated('let a = [{ v: 1 }, { v: 2 }]; for (const ref p of a) { p.v = p.v + 100; } a[0].v + "," + a[1].v;')).toBe('101,102');
  expectThrown('let a = [1, 2]; for (const ref p of a) { p = 9; } "done";');
});

test('a for-of ref loop reads through each element', () => {
  expect(evaluated('let a = [5, 6]; let s = 0; for (const ref p of a) { s = s + p; } String(s);')).toBe('11');
});

test('break and continue work in a ref loop', () => {
  expect(evaluated('let a = [1, 2, 3, 4]; let c = 0; for (const ref p of a) { c++; if (p === 2) break; } String(c);')).toBe('2');
  expect(evaluated('let a = [1, 2, 3, 4]; let s = 0; for (let ref p of a) { if (p === 2) continue; s += p; } String(s);')).toBe('8');
});

// -- for (const ref p of a): the two liveness rules -----------------------------
test('a ref loop over a non-array is a TypeError', () => {
  expectThrown('let s = new Set([1, 2]); for (const ref p of s) { } "ok";');
  expectThrown('for (const ref p of "abc") { } "ok";');
});

test('resizing the array while a ref loop is live is a TypeError', () => {
  // push, pop, and assigning length each change the length while a ref is live
  expectThrown('let a = [1, 2, 3]; for (let ref p of a) { a.push(9); p = 0; } "ok";');
  expectThrown('let a = [1, 2, 3]; for (let ref p of a) { a.pop(); } "ok";');
  expectThrown('let a = [1, 2, 3]; for (let ref p of a) { a.length = 1; } "ok";');
});

// -- `ref` remains a valid identifier where it is not a borrow -----------------
test('ref is still usable as an ordinary identifier', () => {
  // a variable, a call, and a plain for-of binding all named ref
  expect(evaluated('let ref = 5; String(ref);')).toBe('5');
  expect(evaluated('function ref(x) { return x * 2; } String(ref(21));')).toBe('42');
  expect(evaluated('let ref = [8]; let out = 0; for (const x of ref) { out = x; } String(out);')).toBe('8');
  // `for (const ref of a)` binds an identifier named ref, not a ref loop
  expect(ok('let a = [1]; for (const ref of a) { } "ok";')).toBe(true);
});

test('a bare ref call and a ref assignment are not borrow forms', () => {
  // f(ref) and f(ref, x) pass an identifier; `ref = v` is ordinary assignment
  expect(evaluated('function f(a) { return a; } let ref = 7; String(f(ref));')).toBe('7');
  expect(evaluated('function f(a, b) { return b; } let ref = 1; String(f(ref, 9));')).toBe('9');
  expect(evaluated('let ref = 1; ref = 5; String(ref);')).toBe('5');
});

// -- feature gating ------------------------------------------------------------
test('the borrowing forms are inert with the feature off', () => {
  // with the flag off, `ref` is only ever an identifier; `f(ref a)` is a syntax
  // error (two expressions), and a ref loop head does not parse
  expect((runFlagOff('function f(a) { } let x = 0; f(ref x); "ok";') as { Type: string }).Type).toBe('throw');
  expect((runFlagOff('let a = [1]; for (let ref p of a) { } "ok";') as { Type: string }).Type).toBe('throw');
  // but `ref` as a plain identifier still works with the flag off
  expect((runFlagOff('let ref = 3; ref;') as { Type: string }).Type).toBe('normal');
});
