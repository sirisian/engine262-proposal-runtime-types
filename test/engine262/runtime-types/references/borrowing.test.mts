import { test, expect } from 'vitest';
import {
  evaluated, ok, bool, expectThrown, expectError, expectThrownKind, expectStaticTypeError,
  expectThrownFlagOff, runFlagOff,
} from '../harness.mts';

/**
 * Spec: #sec-references-and-borrowing (References and Borrowing). Design:
 * references.md.
 *
 * A `ref` is a borrow: a handle to a storage location - a variable, an object
 * property, or an array element - that reads and writes through to the original
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

// -- #sec-reference-syntax: arrow ref parameters (the zip callback idiom) ------
test('a plain arrow takes ref parameters, so the zip callback idiom works', () => {
  // references.md "Reference callback parameters": the container passes
  // `ref a[i], ref b[i]` and the arrow mutates both arrays in place.
  expect(evaluated(
    'function zip(a, b, cb) { for (let i = 0; i < a.length; i++) cb(ref a[i], ref b[i]); }'
    + ' let t = [1, 2], v = [10, 20];'
    + ' zip(t, v, (ref x, ref y) => { x = x + y; });'
    + ' String(t[0]) + "," + String(t[1]);',
  )).toBe('11,22');
});

test('an annotated arrow ref parameter checks the referent without converting', () => {
  expect(evaluated('const f = (ref a: int32) => { a++; }; let x: int32 = (7 := int32); f(ref x); String(x);')).toBe('8');
  // a plain number is `number`, not `int32`; the borrow checks, it does not convert
  expectThrown('const f = (ref a: int32) => { a++; }; let x = 5; f(ref x);');
});

test('an async arrow takes ref parameters through the call cover', () => {
  expect(evaluated('let x = 0; const f = async (ref a) => { a++; }; f(ref x); String(x);')).toBe('1');
});

test('a parenthesized `(ref a)` without an arrow is not an expression', () => {
  // the cover is arrow-only once a ref parameter is claimed
  expectError('let ref = 1, a = 2; let y = (ref a); "ran";');
  // while `(ref)` and `(ref, x)` keep the identifier
  expect(evaluated('let ref = 3; let y = (ref); let z = (ref, 9); String(y) + "," + String(z);')).toBe('3,9');
});

// -- #sec-reference-syntax: forms the grammar refuses --------------------------
test('a ref parameter may not have a default value', () => {
  // a default runs when NO argument was passed, and a callee-built value has
  // no caller-side location to borrow, so the combination can never bind
  expectError('function f(ref a = 1) { } "ran";');
  expectError('const f = (ref a = 1) => { }; "ran";');
});

test('a ref parameter must be a single name, not a pattern', () => {
  // destructuring a borrow is the pattern's own `{ (ref a) }` member form,
  // which is a deferred extension; `ref` before a whole pattern is refused
  expectError('function f(ref { a }) { } "ran";');
  expectError('function f(ref [a]) { } "ran";');
});

test('a ref binding takes a type annotation, not a typed initializer', () => {
  // `:=` infers a type from a VALUE; a ref initializer is a LOCATION
  expectError('let a = [5]; let ref b := a[0]; "ran";');
});

test('a ref binding requires a for-of loop, not for-in or for await', () => {
  expectError('let o = { a: 1 }; for (const ref p in o) { } "ran";');
  expectError('async function g() { for await (const ref p of [1]) { } } "ran";');
});

test('a ref binding may not appear in a for statement initializer', () => {
  // the per-iteration environment copies head bindings by value, which would
  // silently decay the alias; refused until those semantics are specified
  expectError('let a = [5]; for (let ref b = a[0]; false;) { } "ran";');
});

test('a var head never claims ref', () => {
  // ref bindings are lexical; `var ref p` keeps its base meaning and fails
  expectError('let a = [1]; for (var ref p of a) { } "ran";');
});

// -- #sec-reference-values: the decay channels --------------------------------
test('a returned reference decays at the call boundary wherever it is consumed', () => {
  const first = 'function first(a) { return ref a[0]; } ';
  // typeof sees the referent, never the reference
  expect(evaluated(`${first}let a = [7]; String(typeof first(a));`)).toBe('number');
  // the base of a member access consumes a value, so the access lands on the
  // decayed referent - for an object element that is the object itself
  expect(evaluated(`${first}let a = [{ x: 1 }]; String(first(a).x);`)).toBe('1');
  expect(evaluated(`${first}let a = [{ x: 1 }]; first(a).x = 5; String(a[0].x);`)).toBe('5');
  expect(evaluated(`${first}let a = [{ x: 1 }]; first(a)["x"] = 6; String(a[0].x);`)).toBe('6');
  expect(evaluated(`${first}let a = [{ x: 1 }]; String(first(a)?.x);`)).toBe('1');
  // a call whose callee is a returned reference calls the referent
  expect(evaluated('function g() { let v = () => 7; return ref v; } String(g()());')).toBe('7');
});

test('a rest parameter gathers each ref argument as its decayed value', () => {
  expect(evaluated('function f(...r) { return typeof r[0]; } let x = 1; String(f(ref x));')).toBe('number');
  expect(evaluated('function f(...r) { return String(r[0] === 1); } let x = 1; f(ref x);')).toBe('true');
  expect(evaluated('function f(a, ...r) { return String(r[0] === 2 && r[1] === 3); } let x = 2, y = 3; f(0, ref x, ref y);')).toBe('true');
});

test('a parameter that is not declared ref consumes the argument as a value', () => {
  expect(evaluated('function f(a) { return typeof a; } let x = 1; String(f(ref x));')).toBe('number');
  // a destructuring pattern parameter takes the referent apart, not the reference
  expect(evaluated('function f({ v }) { return v; } let o = { v: 3 }; String(f(ref o));')).toBe('3');
});

test('the arguments object holds decayed values and never aliases the caller', () => {
  // strict: unmapped entries are the decayed values
  expect(evaluated('"use strict"; function f(ref a) { return typeof arguments[0]; } let x = 1; f(ref x);')).toBe('number');
  expect(evaluated('"use strict"; function f(ref a) { return String(arguments[0] === 1); } let x = 1; f(ref x);')).toBe('true');
  // sloppy: a ref parameter makes the list non-simple, so arguments is
  // unmapped and a store to it cannot reach the caller's variable
  expect(evaluated('let x = 1; function f(ref a) { arguments[0] = 7; } f(ref x); String(x);')).toBe('1');
  expect(evaluated('function f(ref a) { return String(arguments[0] === 1); } let x = 1; f(ref x);')).toBe('true');
  // a ref argument to a plain function decays into mapped extras as well
  expect(evaluated('function g(a) { return typeof arguments[1]; } let x = 1; String(g(0, ref x));')).toBe('number');
});

test('a ref parameter is non-simple, as a default or a pattern is', () => {
  expectError('function f(ref a) { "use strict"; } "ran";');
  // sloppy duplicate parameter names require a simple list
  expectError('function f(ref a, a) { } "ran";');
});

test('a built-in function boundary decays, which covers the reflective calls', () => {
  expect(evaluated('let x = 41; String(Math.max(ref x, 1));')).toBe('41');
  // %Function.prototype.call% decays on entry, so the list it forwards
  // carries values and a ref parameter downstream refuses them
  expectThrown('function f(ref a) { } let x = 1; f.call(null, ref x);');
  // bind stores [[BoundArguments]] as values; a later write to x is unseen
  expect(evaluated('function f(a) { return String(a === 5); } let x = 5; let b = f.bind(null, ref x); x = 9; b();')).toBe('true');
});

// -- #sec-reference-liveness: the two-tier model ------------------------------
const soa = 'class P { a: uint8; b: float32; } const s = new SoA.<P>(); s.push({ a: 1, b: 1.5 }); ';

test('the loop rule refuses a length change at the operation', () => {
  // every container a ref loop can iterate, refused where it happens
  expectThrownKind('let a = [1, 2]; for (let ref p of a) { a.push(9); }', 'TypeError');
  expectThrownKind('let a = [1, 2]; for (let ref p of a) { a.shift(); }', 'TypeError');
  expectThrownKind('let a = [1, 2]; for (let ref p of a) { a.length = 1; }', 'TypeError');
  expectThrownKind('const a: [].<uint32> = [1, 2]; for (let ref p of a) { a.push(3); }', 'TypeError');
  expectThrownKind(`${soa} for (const ref p of s) { s.push({ a: 9, b: 9 }); }`, 'TypeError');
  expectThrownKind(`${soa} s.push({ a: 2, b: 2 }); for (const ref p of s) { s.pop(); }`, 'TypeError');
  // and releases the moment the loop is over, however it ended
  expect(evaluated('let a = [1, 2]; for (let ref p of a) { } a.push(3); String(a.length);')).toBe('3');
  expect(evaluated('let a = [1, 2]; for (let ref p of a) { break; } a.push(3); String(a.length);')).toBe('3');
});

test('a standalone reference survives growth that does not relocate', () => {
  // The push fit in the existing allocation, so nothing moved
  expect(evaluated(`${soa} const ref e = s[0]; s.push({ a: 2, b: 2.5 }); String(e.a);`)).toBe('1');
  // and a capacity reserved up front is exactly how a program avoids the move
  expect(evaluated('class P { a: uint8; } const s = SoA.withCapacity.<P>(8); s.push({ a: 1 }); const ref e = s[0]; s.push({ a: 2 }); String(e.a);')).toBe('1');
});

test('relocation invalidates a standalone reference, caught at the next use', () => {
  // Growth past the allocation moves every column; the read is refused
  expectThrownKind(`${soa} const ref e = s[0]; for (let i = 0; i < 8; i++) s.push({ a: 2, b: 2.5 }); e.a;`, 'TypeError');
  // A write through the stale reference is refused too
  expectThrownKind(`${soa} const ref e = s[0]; for (let i = 0; i < 8; i++) s.push({ a: 2, b: 2.5 }); e.a = 7;`, 'TypeError');
  // the capacity operations participate, which is the case no length rule sees
  expectThrownKind(`${soa} const ref e = s[0]; s.reserve(64); e.a;`, 'TypeError');
  expectThrownKind('class P { a: uint8; } const s = SoA.withCapacity.<P>(2); s.push({ a: 1 }); const ref e = s[0]; for (let i = 0; i < 8; i++) s.push({ a: 2 }); e.a;', 'TypeError');
  // a reserve inside a loop is not a length change, so the loop rule does not
  // fire - the relocation rule refuses the loop's own reference at its next use
  expectThrownKind(`${soa} s.push({ a: 2, b: 2 }); for (const ref p of s) { s.reserve(64); p.a; }`, 'TypeError');
});

test('a reference to an element that has been removed is invalidated', () => {
  // a shrink moves nothing, so only the index test can see this
  expectThrownKind(`${soa} s.push({ a: 42, b: 2 }); const ref e = s[1]; s.pop(); e.a;`, 'TypeError');
  expectThrownKind(`${soa} s.push({ a: 42, b: 2 }); const ref e = s[1]; s.pop(); e.a = 99;`, 'TypeError');
  // an element still within the length is untouched by the shrink
  expect(evaluated(`${soa} s.push({ a: 42, b: 2 }); const ref e = s[0]; s.pop(); String(e.a);`)).toBe('1');
});

test('a reference to an ordinary property is a slot alias and never relocates', () => {
  // outside a loop, a plain array carries no restriction: slots do not move
  expect(evaluated('let a = [1]; let ref b = a[0]; a.push(9); b = 5; String(a[0]) + "," + String(a.length);')).toBe('5,2');
  // and the reference keeps denoting a[0], whose value a shift has changed -
  // the same thing the expression a[0] has always meant
  expect(evaluated('let a = [1, 2]; let ref b = a[0]; a.shift(); String(b);')).toBe('2');
});

// -- #sec-location-consuming-contexts ----------------------------------------
const first = 'function first(a) { return ref a[0]; } ';

test('a returned reference is consumed as a location by ++ and --', () => {
  // references.md: `first(a)++` post-increments the element in place
  expect(evaluated(`${first}let a = [7]; first(a)++; String(a[0]);`)).toBe('8');
  // postfix yields the OLD value, as it does for any target
  expect(evaluated(`${first}let a = [7]; String(first(a)++) + "/" + String(a[0]);`)).toBe('7/8');
  expect(evaluated(`${first}let a = [7]; String(--first(a)) + "/" + String(a[0]);`)).toBe('6/6');
  expect(evaluated(`${first}let a = [7]; first(a)--; String(a[0]);`)).toBe('6');
  // and it reaches an object property or a typed element the same way
  expect(evaluated('function fx(o) { return ref o.x; } let o = { x: 1 }; fx(o)++; String(o.x);')).toBe('2');
  expect(evaluated('function f(t) { return ref t[0]; } const a: [].<uint32> = [5]; f(a)++; String(a[0]);')).toBe('6');
});

test('a ref argument re-borrows the location a call returned', () => {
  expect(evaluated(`${first}function g(ref p) { p = p + 100; } let a = [7]; g(ref first(a)); String(a[0]);`)).toBe('107');
});

test('everywhere else a returned reference still decays', () => {
  expect(evaluated(`${first}let a = [7]; String(typeof first(a));`)).toBe('number');
  expect(evaluated(`${first}let a = [7]; let v = first(a); v = 99; String(a[0]);`)).toBe('7');
});

test('a call that returns no reference has no location to consume', () => {
  // deferred to run time, since these callees have no known return type
  expectThrownKind('function plain(a) { return a[0]; } let a = [7]; plain(a)++;', 'TypeError');
  expectThrownKind('function plain(a) { return a[0]; } function g(ref p) { } let a = [7]; g(ref plain(a));', 'TypeError');
  // and refused before running where the return type says so
  expectStaticTypeError('function plain(a): uint32 { return a[0]; } const a: [].<uint32> = [7]; plain(a)++;');
  // a declared ref return is accepted, and writes through
  expect(evaluated('function fr(a): ref uint32 { return ref a[0]; } const a: [].<uint32> = [7]; fr(a)++; String(a[0]);')).toBe('8');
});

test('a ref return may name a local, whose environment outlives the call', () => {
  // The collector owns the lifetime, as it does for a closure
  expect(evaluated('function localRef() { let v = 3; return ref v; } String(localRef());')).toBe('3');
  expect(ok('function localRef() { let v = 3; return ref v; } localRef()++;')).toBe(true);
});

test('a reference value satisfies a ref type through its referent', () => {
  // a function declared `: ref uint32` returning a borrow passes its own
  // return check; the membership test reads through to what is borrowed
  expect(evaluated('function fr(a): ref uint32 { return ref a[0]; } const a: [].<uint32> = [7]; String(fr(a));')).toBe('7');
  // and a borrow of storage holding the wrong type does not satisfy it
  expectThrownKind('function fr(a): ref uint32 { return ref a[0]; } let b = ["x"]; fr(b);', 'TypeError');
});

// -- What a destructuring ref member will mean -------------------------------
// The `{ (ref a) }` member form waits on the parenthesized typed own-property
// pattern, which the specification does not yet state. What it will MEAN is
// settled, and the part of that meaning reachable today is pinned here: a
// borrow of a property's location on an object the callee already has.
test('a property of a by-value object parameter is borrowable', () => {
  // this is `{ (ref a) }` written out longhand, and it writes through
  expect(evaluated('function g(o) { let ref a = o.a; a++; } let o = { a: 1 }; g(o); String(o.a);')).toBe('2');
  // through a nesting, as a nested pattern would reach
  expect(evaluated('function g(o) { let ref x = o.inner.x; x = 42; } let o = { inner: { x: 1 } }; g(o); String(o.inner.x);')).toBe('42');
});

test('borrowing a member does not require borrowing the object', () => {
  // `g(o)` and `g(ref o)` reach the same property location
  expect(evaluated('function g(o) { let ref a = o.a; a++; } let o = { a: 1 }; g(o); String(o.a);')).toBe('2');
  expect(evaluated('function g(ref o) { let ref a = o.a; a++; } let o = { a: 1 }; g(ref o); String(o.a);')).toBe('2');
  // what `ref o` adds is unrelated: it lends the caller's BINDING, so the
  // callee can rewrite which object the caller's variable names
  expect(evaluated('function g(o) { o = { a: 99 }; } let o = { a: 1 }; g(o); String(o.a);')).toBe('1');
  expect(evaluated('function g(ref o) { o = { a: 99 }; } let o = { a: 1 }; g(ref o); String(o.a);')).toBe('99');
  // and a pattern parameter decays a ref argument, so `ref` could not reach a
  // pattern even if it were written
  expect(evaluated('function g({ a }) { return a; } let o = { a: 1 }; String(g(ref o));')).toBe('1');
});

// -- #sec-soa-references: one borrow representation --------------------------
const soaP = 'class P { a: uint8; b: float32; } const s = new SoA.<P>(); s.push({ a: 1, b: 1.5 }); ';

test('a borrow of an SoA element is a reference like any other', () => {
  // the ref ARGUMENT form, which previously refused an SoA element outright
  expect(evaluated(`${soaP} function f(ref p) { p.a = 9; } f(ref s[0]); String(s[0].a);`)).toBe('9');
  expect(evaluated(`${soaP} function f(ref p) { return p.a; } String(f(ref s[0]));`)).toBe('1');
  // and the binding form, which is now the same borrow rather than a handle
  expect(evaluated(`${soaP} const ref e = s[0]; e.a = 7; String(s[0].a);`)).toBe('7');
  // a whole-element store writes every column at the index
  expect(evaluated(`${soaP} function f(ref p) { p = { a: 4, b: 4.5 }; } f(ref s[0]); String(s[0].a);`)).toBe('4');
});

test('the callback idiom composes over an SoA', () => {
  // references.md's zip, over the container the value-type story exists for
  expect(evaluated(
    'class P { x: uint8; } const s1 = new SoA.<P>(); s1.push({ x: 1 });'
    + ' const s2 = new SoA.<P>(); s2.push({ x: 10 });'
    + ' function zip(a, b, cb) { for (let i = 0; i < a.length; i++) cb(ref a[i], ref b[i]); }'
    + ' zip(s1, s2, (ref p, ref q) => { p.x = p.x + q.x; }); String(s1[0].x);',
  )).toBe('11');
});

test('an SoA borrow decays to a gathered copy at a value boundary', () => {
  // a non-ref parameter consumes a VALUE, so the callee gets a detached copy
  expect(evaluated(`${soaP} function h(v) { v.a = 42; } h(ref s[0]); String(s[0].a);`)).toBe('1');
  // while a parameter ANNOTATED as a reference type receives the borrow, which
  // is what makes one function work over either storage layout
  expect(evaluated(
    'class P { x: float32; } function move(p: ref P) { p.x = Number(p.x) + 1; }'
    + ' const s = new SoA.<P, 1>(); const seed = new P(); seed.x = 10; s[0] = seed;'
    + ' move(ref s[0]); String(Number(s[0].x));',
  )).toBe('11');
});

test('the liveness rules apply to an SoA borrow however it was taken', () => {
  expectThrownKind(`${soaP} const ref e = s[0]; for (let i = 0; i < 8; i++) s.push({ a: 2, b: 2 }); e.a;`, 'TypeError');
  expectThrownKind(`${soaP} s.push({ a: 5, b: 5 }); const ref e = s[1]; s.pop(); e.a;`, 'TypeError');
  expectThrownKind(`${soaP} for (const ref p of s) { s.push({ a: 9, b: 9 }); }`, 'TypeError');
});

// -- a typed array satisfies its own type, so a boundary checks not copies ----
test('a typed array passes a typed boundary without being copied', () => {
  // a typed array reports a TYPED length, and membership used to reject it for
  // that alone - so every typed boundary rebuilt the array instead of passing
  // it through, and a parameter silently received a copy
  expect(evaluated('const a: [].<uint32> = [7]; String(a is [].<uint32>);')).toBe('true');
  expect(evaluated('const a: [].<uint32> = []; String(a is [].<uint32>);')).toBe('true');
  expect(evaluated('function h(x: [].<uint32>) { return x === a; } const a: [].<uint32> = [7]; String(h(a));')).toBe('true');
  expect(evaluated('function h(x: [].<uint32>) { x[0] = 42; } const a: [].<uint32> = [7]; h(a); String(a[0]);')).toBe('42');
  expect(evaluated('function h(x: [2].<uint32>) { return x === a; } const a: [2].<uint32> = [1, 2]; String(h(a));')).toBe('true');
});

test('a borrow through a typed array parameter writes to the caller\'s array', () => {
  // the reference-facing symptom of the same defect: the callee borrowed an
  // element of a COPY, so the write reached nothing the caller could see
  expect(evaluated('function h(x: [].<uint32>) { let ref e = x[0]; e = 9; } const a: [].<uint32> = [7]; h(a); String(a[0]);')).toBe('9');
  expect(evaluated('function fr(x: [].<uint32>) { return ref x[0]; } const a: [].<uint32> = [7]; fr(a)++; String(a[0]);')).toBe('8');
});

test('a plain array still propagates into a new typed array', () => {
  // the case the conversion exists for is unchanged: elements are converted
  // into a NEW array, and the caller's plain array is untouched
  expect(evaluated('function h(x: [].<uint8>) { return x[0] is uint8; } let p = [1, 2]; String(h(p));')).toBe('true');
  expect(evaluated('function h(x: [].<uint8>) { x[0] = 5; } let p = [1]; h(p); String(p[0] is uint8);')).toBe('false');
  // and the empty-array stamp still carries the element type
  expect(evaluated('const a: [].<uint8> = []; a.push(65); String(a[0] is uint8);')).toBe('true');
});

// -- #sec-typed-destructuring: the parenthesized member -----------------------
test('an object pattern member may carry a type in parentheses', () => {
  // `{ a: uint8 }` already means rename-to-uint8, so the annotation goes in
  // parentheses and the rename colon stays free
  expect(evaluated('let { (a: uint8) } = { a: 2 }; String(a);')).toBe('2');
  expect(evaluated('let { (a: uint8) } = { a: 2 }; String(a is uint8);')).toBe('true');
  expect(evaluated('let { (a: uint8): b } = { a: 2 }; String(b);')).toBe('2');
  expect(evaluated('let { (a: uint8) = 1 } = { }; String(a);')).toBe('1');
  expect(evaluated('let { (a: uint8): b = 1 } = { }; String(b);')).toBe('1');
  expect(evaluated('function f({ (a: uint8) }) { return a; } String(f({ a: 5 }));')).toBe('5');
  // the member's type is enforced at the binding boundary
  expectThrown('let { (a: uint8) } = { a: 300 };');
  // and the plain forms are untouched
  expect(evaluated('let { a: b } = { a: 3 }; String(b);')).toBe('3');
  expect(evaluated('let { x, y } = { x: 1, y: 2 }; String(x + y);')).toBe('3');
});

test('a ref member borrows the property location on the destructured object', () => {
  // references.md's own example: `g(o)`, not `g(ref o)`
  expect(evaluated('const o = { a: (0 := int32) }; function g({ (ref a: int32) }) { a++; } g(o); g(o); String(o.a);')).toBe('2');
  expect(evaluated('let o = { a: 1 }; function g({ (ref a) }) { a++; } g(o); String(o.a);')).toBe('2');
  // and the binding form borrows the same location
  expect(evaluated('let o = { a: 1 }; let { (ref a) } = o; a = 42; String(o.a);')).toBe('42');
  // a ref member has no default, for the reason a ref parameter has none
  expectError('function g({ (ref a) = 1 }) { } "ran";');
  // an annotation on a ref member checks the referent without converting it
  expectThrown('let o = { a: 1 }; function g({ (ref a: int32) }) { } g(o);');
});

// -- #sec-reference-liveness: relocation for a growable [].<T> ---------------
test('a growable typed array has a capacity that reserve can grow', () => {
  expect(evaluated('const a: [].<uint32> = [1, 2]; String(a.capacity >= 2);')).toBe('true');
  expect(evaluated('const a: [].<uint32> = [1]; a.reserve(64); String(a.capacity >= 64);')).toBe('true');
  // the operations belong to a typed array, which is what has an allocation
  expectThrownKind('let a = [1]; a.reserve(4);', 'TypeError');
});

test('growth relocates the allocation and so invalidates a live borrow', () => {
  // the case no length comparison could see: reserve changes capacity alone
  expectThrownKind('const a: [].<uint32> = [1]; let ref b = a[0]; a.reserve(64); b;', 'TypeError');
  // and growth past the capacity relocates for the same reason
  expectThrownKind('const a: [].<uint32> = [1]; let ref b = a[0]; for (let i = 0; i < 20; i++) a.push(i); b;', 'TypeError');
  // reserving room up front is how a program keeps its borrows valid
  expect(evaluated('const a: [].<uint32> = [1]; a.reserve(64); let ref b = a[0]; a.push(2); String(b);')).toBe('1');
  expect(evaluated('const a: [].<uint32> = [1]; a.reserve(64); let ref b = a[0]; b = 9; String(a[0]);')).toBe('9');
  // a reserve that asks for less than the capacity moves nothing
  expect(evaluated('const a: [].<uint32> = [1]; a.reserve(64); let ref b = a[0]; a.reserve(2); String(b);')).toBe('1');
});

test('an ordinary array keeps slot semantics, since nothing relocates', () => {
  expect(evaluated('let a = [1]; let ref b = a[0]; a.push(9); b = 5; String(a[0]);')).toBe('5');
});

// -- #sec-location-consuming-contexts: a call as an assignment target ---------
const FA = 'function first(a) { return ref a[0]; } ';

test('a call that returns a borrow may be assigned to', () => {
  expect(evaluated(`${FA}let a = [1]; first(a) = 5; String(a[0]);`)).toBe('5');
  // the assignment's value is the value stored, as for any target
  expect(evaluated(`${FA}let a = [1]; let r = (first(a) = 5); String(r);`)).toBe('5');
  expect(evaluated(`${FA}let a = [1], b = [2]; first(a) = first(b) = 5; String(a[0]) + "/" + String(b[0]);`)).toBe('5/5');
});

test('every compound and logical form stores through the location', () => {
  expect(evaluated(`${FA}let a = [1]; first(a) += 5; String(a[0]);`)).toBe('6');
  expect(evaluated(`${FA}let a = [3]; first(a) *= 2; String(a[0]);`)).toBe('6');
  expect(evaluated(`${FA}let a = [10]; first(a) -= 2; first(a) /= 2; first(a) %= 3; first(a) **= 2; String(a[0]);`)).toBe('1');
  expect(evaluated(`${FA}let a = [5]; first(a) |= 2; String(a[0]);`)).toBe('7');
  expect(evaluated(`${FA}let a = [12]; first(a) &= 10; first(a) ^= 3; first(a) <<= 2; first(a) >>= 1; first(a) >>>= 1; String(a[0]);`)).toBe('11');
  expect(evaluated(`${FA}let a = [0]; first(a) ||= 9; String(a[0]);`)).toBe('9');
  expect(evaluated(`${FA}let a = [1]; first(a) &&= 7; String(a[0]);`)).toBe('7');
  expect(evaluated(`${FA}let a = [0]; first(a) &&= 7; String(a[0]);`)).toBe('0');
  // a logical form that short-circuits performs no store
  expect(evaluated(`${FA}let a = [1]; first(a) ??= 9; String(a[0]);`)).toBe('1');
  // and the target is evaluated exactly once
  expect(evaluated(`${FA}let a = [1]; let n = 0; function counted(x) { n += 1; return ref x[0]; } counted(a) += 1; String(n);`)).toBe('1');
});

test('a call is a target in every destructuring position and both loop heads', () => {
  expect(evaluated(`${FA}let a = [1]; [first(a)] = [5]; String(a[0]);`)).toBe('5');
  expect(evaluated(`${FA}let a = [1]; [first(a) = 9] = []; String(a[0]);`)).toBe('9');
  expect(evaluated(`${FA}let a = [1]; ({ x: first(a) } = { x: 5 }); String(a[0]);`)).toBe('5');
  expect(evaluated(`${FA}let a = [1]; [[first(a)]] = [[5]]; String(a[0]);`)).toBe('5');
  expect(evaluated(`${FA}let a = [0]; for (first(a) of [1, 2, 3]) ; String(a[0]);`)).toBe('3');
  expect(evaluated(`${FA}let a = [0]; for (first(a) in { b: 1 }) ; String(a[0]);`)).toBe('b');
});

test('any callee shape that returns a borrow may be assigned through', () => {
  expect(evaluated('const o = { first(a) { return ref a[0]; } }; let a = [1]; o.first(a) = 5; String(a[0]);')).toBe('5');
  expect(evaluated('class C { first(a) { return ref a[0]; } } let a = [1]; new C().first(a) = 5; String(a[0]);')).toBe('5');
  expect(evaluated('class C { static first(a) { return ref a[0]; } } let a = [1]; C.first(a) = 5; String(a[0]);')).toBe('5');
  expect(evaluated('class C { #first(a) { return ref a[0]; } go(a) { this.#first(a) = 5; } } let a = [1]; new C().go(a); String(a[0]);')).toBe('5');
  expect(evaluated('class B { first(a) { return ref a[0]; } } class C extends B { go(a) { super.first(a) = 5; } } let a = [1]; new C().go(a); String(a[0]);')).toBe('5');
  expect(evaluated('const fe = function (a) { return ref a[0]; }; let a = [1]; fe(a) = 5; String(a[0]);')).toBe('5');
  expect(evaluated('const fb = (a) => { return ref a[0]; }; let a = [1]; fb(a) = 5; String(a[0]);')).toBe('5');
  expect(evaluated('function outer() { return function (a) { return ref a[0]; }; } let a = [1]; outer()(a) = 5; String(a[0]);')).toBe('5');
  expect(evaluated('function getObj() { return { first(a) { return ref a[0]; } }; } let a = [1]; getObj().first(a) = 5; String(a[0]);')).toBe('5');
  // a borrow of the callee's own local: the environment outlives the call
  expect(ok('function localRef() { let v = 3; return ref v; } localRef() = 9;')).toBe(true);
  expect(evaluated('let x = 1; (function () { return ref x; })() = 5; String(x);')).toBe('5');
  // a property borrow, a typed element, and a whole SoA element
  expect(evaluated('function fx(o) { return ref o.x; } let o = { x: 1 }; fx(o) = 5; String(o.x);')).toBe('5');
  expect(evaluated('function ft(t) { return ref t[0]; } const a: [].<uint32> = [1]; ft(a) = 9; String(a[0]);')).toBe('9');
  expect(evaluated('class P { a: uint8; b: float32; } const s = new SoA.<P>(); s.push({ a: 1, b: 1.5 });'
    + ' function elem(c) { return ref c[0]; } elem(s) = { a: 4, b: 4.5 }; String(s[0].a);')).toBe('4');
});

test('a target that cannot denote a location is refused', () => {
  // the base language's own refusals stand: these are not calls that return a
  // borrow, they are positions with no assignment target at all
  expectError('const o = { f(a) { return ref a[0]; } }; let a = [1]; o.f?.(a) = 5;');
  expectError('function first(a) { return ref a[0]; } let a = [1]; first`x` = 5;');
  expectError('class C {} new C() = 5;');
  // `ref` has no expression form in a concise arrow body, so this returns a
  // VALUE and there is nothing to assign through
  expectError('const fc = (a) => ref a[0]; let a = [1]; fc(a) = 5;');
  // a generator call yields a Generator object, which the checker settles
  expectError('function* gen(a) { return 1; } let a = [1]; gen(a) = 5;');
  // a non-ref call is refused inside a pattern as it is on its own
  expectThrownKind('function plain(a) { return a[0]; } let a = [1]; [plain(a)] = [5];', 'TypeError');
  // and the whole form is inert with the feature off
  expectThrownFlagOff('function f() { return 1; } f() = 1;');
  // a call that returns a value has no location to store into
  expectThrownKind('function plain(a) { return a[0]; } let a = [1]; plain(a) = 5;', 'TypeError');
  expectThrownKind('async function af(a) { return 1; } let a = [1]; af(a) = 5;', 'TypeError');
  // refused before running where the callee's return type settles it
  expectStaticTypeError('function plain(a): uint32 { return a[0]; } const a: [].<uint32> = [7]; plain(a) = 5;');
  expect(evaluated('function fr(a): ref uint32 { return ref a[0]; } const a: [].<uint32> = [7]; fr(a) = 5; String(a[0]);')).toBe('5');
});

test('assigning through a call obeys the liveness and store rules', () => {
  // the store is checked against the referent's type
  expectThrown('function ft(t) { return ref t[0]; } const a: [].<uint8> = [1]; ft(a) = 300;');
  // and an invalidated borrow refuses the store
  expectThrownKind('class P { a: uint8; b: float32; } const s = new SoA.<P>(); s.push({ a: 1, b: 1.5 });'
    + ' const ref e = s[0]; for (let i = 0; i < 8; i++) s.push({ a: 2, b: 2 }); e.a = 1;', 'TypeError');
  expectThrownKind('const a: [].<uint32> = [1]; let ref b = a[0]; a.reserve(64); b = 5;', 'TypeError');
  // a borrow of an element that has been removed refuses the store
  expectThrownKind('class P { a: uint8; b: float32; } const s = new SoA.<P>(); s.push({ a: 1, b: 1.5 });'
    + ' s.push({ a: 5, b: 5 }); const ref e = s[1]; s.pop(); e.a = 3;', 'TypeError');
  // and the loop rule still fires when the body resizes the container
  expectThrownKind('class P { a: uint8; b: float32; } const s = new SoA.<P>(); s.push({ a: 1, b: 1.5 });'
    + ' function elem(c) { return ref c[0]; }'
    + ' for (const ref p of s) { elem(s) = { a: 2, b: 2 }; s.push({ a: 9, b: 9 }); }', 'TypeError');
});

test('a rest target receives an array, which the location must accept', () => {
  // the rest element builds an Array and stores it through the location
  expect(evaluated(`${FA}let a = [1]; [...first(a)] = [1, 2]; String(a[0]);`)).toBe('1,2');
  // so a location whose type forbids an Array refuses it
  expectThrownKind('function ft(t) { return ref t[0]; } const a: [].<uint32> = [1]; [...ft(a)] = [1, 2];', 'TypeError');
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

// -- The ref TYPE ----------------------------------------------------------------

/**
 * Extension coverage - references.md (the `ref` type and borrowing runtime).
 *
 * The `ref` TYPE is wired at the type level: `ref T` parses, resolves to a
 * reference Type Record, interns, is invariant in its target, and reflects. The
 * borrowing RUNTIME is implemented too: the call-site `ref` argument
 * and `ref` return, `ref` parameter aliasing, the `let ref` / `const ref`
 * lexical binding and rebinding, the index-based `for (const ref p of a)` loop,
 * decay to the referent at value boundaries, and the two liveness rules. The
 * fuller borrowing surface (location-consuming returns such as `first(a)++`,
 * destructuring `ref` members, and the SoA/typed-buffer substrate) is exercised
 * in extensions/borrowing.test.mts and noted there as deferred.
 */

// -- The ref type at the type level --------------------------------------------
test('ref type: `ref T` resolves and reflects as a reference to its target', () => {
  expect(evaluated('type R = ref int32; Reflect.getReflection(R).kind;')).toBe('reference');
  // the target leaf is the target type object
  expect(ok('type R = ref int32; Reflect.getReflection(R).target === int32;')).toBe(true);
});

test('ref type: reference types intern by their target', () => {
  expect(ok('type A = ref int32; type B = ref int32; A === B;')).toBe(true);
  // distinct targets are distinct references
  expect(bool('type A = ref int32; type B = ref uint32; String(A === B);')).toBe(false);
});

test('ref type: a reference is invariant in its target', () => {
  // assignable to itself
  expect(ok('type A = ref int32; type B = ref int32; Reflect.isAssignable(A, B);')).toBe(true);
  // not assignable across different targets (invariant)
  expect(bool('type A = ref int32; type B = ref uint32; String(Reflect.isAssignable(A, B));')).toBe(false);
});

test('ref type: a ref over an object type resolves', () => {
  expect(evaluated('type R = ref { a: uint8 }; Reflect.getReflection(R).kind;')).toBe('reference');
});

// -- The ref parameter declaration parses --------------------------------------
test('ref parameter: a `ref` parameter declaration parses', () => {
  expect(evaluated('function f(ref a: int32) { return a; } typeof f;')).toBe('function');
  // a ref parameter with a body referencing it parses
  expect(evaluated('function f(ref a: int32) { let b = a; return b; } typeof f;')).toBe('function');
});

// -- The borrowing runtime ----------------------------------------------------
test('ref runtime: the call-site `ref` argument passes the caller location', () => {
  // Target (references.md): `f(ref a)` passes the caller's location, so a write
  // in the callee is a write in the caller.
  expect(evaluated('function f(ref a) { a++; } let x = 0; f(ref x); String(x);')).toBe('1');
});

test('ref runtime: the `for (const ref p of a)` form binds each element by reference', () => {
  // Target (references.md): a ref loop binds each element by reference, so the
  // body writes into the array in place.
  expect(evaluated('let a = [1, 2, 3]; for (let ref p of a) { p = p * 10; } a[0] + "," + a[1] + "," + a[2];')).toBe('10,20,30');
});
