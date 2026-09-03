import { test, expect } from 'vitest';
import {
  evaluated, evaluatedFlagOff, ok, expectThrownKind,
} from '../harness.mts';

/**
 * THE BACKCOMPAT GUARD.
 *
 * The governing invariant of the typed-collections work: **a `Map` or `Set`
 * written without type arguments is an ordinary JavaScript `Map` or `Set` and
 * stays one.** `size` is a Number, keys and values are unconstrained, `for`-`of`
 * binds at ~any~, and nothing the typed surface adds is observable from such a
 * value.
 *
 * This is not a new rule. It is the collection reading of one the design already
 * states for arrays - "An array with no element type is untouched by any of
 * this. A plain `[1, 2, 3]` reports a `length` that is a Number, exactly as it
 * does today, and no program that does not use these types can observe the index
 * type at all." The corresponding sentence for collections did not exist in
 * either the design or the specification, which is why this file was written
 * before any of the work it guards.
 *
 * WHY THIS FILE COMES FIRST. Everything the typed surface adds changes what a
 * TYPED collection does - `size` becomes `uint64`, the iteration members acquire
 * signatures, the constructors check their seed. Each of those changes runs
 * through code an untyped collection also reaches, so each is an opportunity to
 * change untyped behaviour by accident. A baseline asserted AFTER such a change
 * records whatever the change did; a baseline asserted before it is a guard.
 *
 * EVERY ASSERTION HERE IS CURRENT ES2026 BEHAVIOUR, asserted verbatim. Nothing
 * in this file should ever need to change. If a later change makes one of these
 * fail, the change is wrong, not the test.
 *
 * The mechanism the invariant rests on is the [[TypedCollection]] stamp: a
 * collection acquires one only from a type carrying arguments, either through
 * `new Map.<K, V>()` (NewExpression) or through an annotation's boundary
 * (RequireType/ConvertValue). Where the stamp is absent the ES2026 algorithm
 * runs unmodified. These tests exercise the absence.
 *
 * Paired with `test262`'s `built-ins/Map`, `built-ins/Set`, `built-ins/WeakMap`
 * and `built-ins/WeakSet`, which are the other half of the guard and must be run
 * alongside it. NOTE that `test/test262/test262` is a git submodule and
 * is NOT checked out in a fresh clone; run
 * `git submodule update --init test/test262/test262` before relying on it.
 */

// ---------------------------------------------------------------------------
// Map - every member, with no type arguments
// ---------------------------------------------------------------------------

test('Map: get, set, has, delete, clear on an untyped map', () => {
  expect(evaluated('const m = new Map(); m.set("a", 1); String(m.get("a"));')).toBe('1');
  // `set` returns the receiver, so it chains.
  expect(evaluated('const m = new Map(); String(m.set("a", 1) === m);')).toBe('true');
  expect(evaluated('const m = new Map(); m.set("a", 1); String(m.has("a"));')).toBe('true');
  expect(evaluated('const m = new Map(); String(m.has("nope"));')).toBe('false');
  expect(evaluated('const m = new Map(); m.set("a", 1); String(m.delete("a"));')).toBe('true');
  // Deleting an absent key answers false rather than throwing.
  expect(evaluated('const m = new Map(); String(m.delete("nope"));')).toBe('false');
  expect(evaluated('const m = new Map([["a", 1], ["b", 2]]); m.clear(); String(m.size);')).toBe('0');
  // `clear` returns undefined.
  expect(evaluated('const m = new Map(); String(m.clear());')).toBe('undefined');
  // A missing key reads undefined, NOT a throw - the case a typed `get` will
  // answer `V | undefined` for, and which must keep answering plain undefined
  // here.
  expect(evaluated('const m = new Map(); String(m.get("nope"));')).toBe('undefined');
});

test('Map: keys, values, entries, forEach on an untyped map', () => {
  expect(evaluated('const m = new Map([["a", 1], ["b", 2]]); [...m.keys()].join(",");')).toBe('a,b');
  expect(evaluated('const m = new Map([["a", 1], ["b", 2]]); [...m.values()].join(",");')).toBe('1,2');
  expect(evaluated('const m = new Map([["a", 1]]); const e = [...m.entries()][0]; e[0] + ":" + e[1];')).toBe('a:1');
  // The callback takes (value, key, map), in that order, and `forEach` returns
  // undefined. The order is the one a typed `forEach` signature must preserve.
  expect(evaluated('const m = new Map([["a", 1]]); let out = ""; m.forEach((v, k, c) => { out = k + v + String(c === m); }); out;')).toBe('a1true');
  expect(evaluated('const m = new Map(); String(m.forEach(() => {}));')).toBe('undefined');
  // thisArg is honoured.
  expect(evaluated('const m = new Map([["a", 1]]); let out = ""; m.forEach(function () { out = this.tag; }, { tag: "t" }); out;')).toBe('t');
});

test('Map: @@iterator is entries, and for-of destructures unchecked', () => {
  expect(evaluated('const m = new Map(); String(m[Symbol.iterator] === m.entries);')).toBe('true');
  expect(evaluated('const m = new Map([["a", 1]]); let out = ""; for (const [k, v] of m) out = k + v; out;')).toBe('a1');
  // Binding the pair WITHOUT destructuring gives the array, unannotated.
  expect(evaluated('const m = new Map([["a", 1]]); let out = ""; for (const e of m) out = String(Array.isArray(e)) + e.length; out;')).toBe('true2');
});

test('Map: getOrInsert and getOrInsertComputed on an untyped map', () => {
  expect(evaluated('const m = new Map(); String(m.getOrInsert("a", 1));')).toBe('1');
  // A present key is NOT overwritten.
  expect(evaluated('const m = new Map([["a", 1]]); String(m.getOrInsert("a", 99));')).toBe('1');
  expect(evaluated('const m = new Map(); String(m.getOrInsertComputed("a", (k) => k + "!"));')).toBe('a!');
  // The callback runs only when the key is absent.
  expect(evaluated('const m = new Map([["a", 1]]); let calls = 0; m.getOrInsertComputed("a", () => { calls++; return 9; }); String(calls);')).toBe('0');
});

test('Map.groupBy on untyped input', () => {
  expect(evaluated('const g = Map.groupBy([1, 2, 3, 4], (n) => n % 2 === 0 ? "even" : "odd"); g.get("even").join(",");')).toBe('2,4');
  expect(evaluated('const g = Map.groupBy([1, 2], (n) => n); String(g.size);')).toBe('2');
});

// ---------------------------------------------------------------------------
// Set - every member, with no type arguments
// ---------------------------------------------------------------------------

test('Set: add, has, delete, clear on an untyped set', () => {
  expect(evaluated('const s = new Set(); s.add(1); String(s.has(1));')).toBe('true');
  // `add` returns the receiver.
  expect(evaluated('const s = new Set(); String(s.add(1) === s);')).toBe('true');
  // Adding a present element is a no-op rather than an error.
  expect(evaluated('const s = new Set(); s.add(1); s.add(1); String(s.size);')).toBe('1');
  expect(evaluated('const s = new Set([1]); String(s.delete(1));')).toBe('true');
  expect(evaluated('const s = new Set(); String(s.delete(1));')).toBe('false');
  expect(evaluated('const s = new Set([1, 2]); s.clear(); String(s.size);')).toBe('0');
  expect(evaluated('const s = new Set(); String(s.clear());')).toBe('undefined');
});

test('Set: keys, values, entries, forEach, @@iterator on an untyped set', () => {
  expect(evaluated('const s = new Set([1, 2]); [...s.values()].join(",");')).toBe('1,2');
  // `keys` IS `values` on a Set - the same function object, not merely the same
  // behaviour - and `@@iterator` is that function too.
  expect(evaluated('const s = new Set(); String(s.keys === s.values);')).toBe('true');
  expect(evaluated('const s = new Set(); String(s[Symbol.iterator] === s.values);')).toBe('true');
  // `entries` yields [v, v] pairs.
  expect(evaluated('const s = new Set([1]); const e = [...s.entries()][0]; String(e[0]) + String(e[1]);')).toBe('11');
  expect(evaluated('const s = new Set([1]); let out = ""; s.forEach((v, k, c) => { out = String(v) + String(k) + String(c === s); }); out;')).toBe('11true');
  expect(evaluated('const s = new Set([1, 2]); let out = ""; for (const v of s) out += v; out;')).toBe('12');
});

test('Set: the seven set-algebra methods on untyped sets', () => {
  expect(evaluated('const a = new Set([1, 2]); const b = new Set([2, 3]); [...a.union(b)].join(",");')).toBe('1,2,3');
  expect(evaluated('const a = new Set([1, 2]); const b = new Set([2, 3]); [...a.intersection(b)].join(",");')).toBe('2');
  expect(evaluated('const a = new Set([1, 2]); const b = new Set([2, 3]); [...a.difference(b)].join(",");')).toBe('1');
  expect(evaluated('const a = new Set([1, 2]); const b = new Set([2, 3]); [...a.symmetricDifference(b)].join(",");')).toBe('1,3');
  expect(evaluated('const a = new Set([1]); const b = new Set([1, 2]); String(a.isSubsetOf(b));')).toBe('true');
  expect(evaluated('const a = new Set([1, 2]); const b = new Set([1]); String(a.isSupersetOf(b));')).toBe('true');
  expect(evaluated('const a = new Set([1]); const b = new Set([2]); String(a.isDisjointFrom(b));')).toBe('true');
  // Each returns a NEW Set, never the receiver.
  expect(evaluated('const a = new Set([1]); const b = new Set([2]); String(a.union(b) === a);')).toBe('false');
});

test('Set: the set-algebra methods accept a SET-LIKE, not only a Set', () => {
  // This is the GetSetRecord path, which reads `size`, `has` and `keys` off an
  // arbitrary object. GetSetRecord is modified for the typed `size`, so this
  // row is the guard for that change: an ordinary set-like must keep
  // working, and its `size` is an ordinary Number.
  const setLike = 'const like = { size: 2, has: (v) => v === 2 || v === 3, keys: () => [2, 3][Symbol.iterator]() }; ';
  expect(evaluated(`${setLike} const a = new Set([1, 2]); [...a.union(like)].join(",");`)).toBe('1,2,3');
  expect(evaluated(`${setLike} const a = new Set([1, 2]); [...a.intersection(like)].join(",");`)).toBe('2');
  expect(evaluated(`${setLike} const a = new Set([1, 2]); String(a.isDisjointFrom(like));`)).toBe('false');
  // A set-like whose `size` is absent is a TypeError (it converts to NaN), and
  // a negative one is a RangeError. Both are the existing spec behaviour.
  expectThrownKind('const a = new Set([1]); a.union({ has: () => true, keys: () => [][Symbol.iterator]() });', 'TypeError');
  expectThrownKind('const a = new Set([1]); a.union({ size: -1, has: () => true, keys: () => [][Symbol.iterator]() });', 'RangeError');
});

// ---------------------------------------------------------------------------
// WeakMap and WeakSet - every member, with no type arguments
// ---------------------------------------------------------------------------

test('WeakMap: every member on an untyped weak map', () => {
  const k = 'const k = {}; ';
  expect(evaluated(`${k} const w = new WeakMap(); w.set(k, 1); String(w.get(k));`)).toBe('1');
  expect(evaluated(`${k} const w = new WeakMap(); String(w.set(k, 1) === w);`)).toBe('true');
  expect(evaluated(`${k} const w = new WeakMap([[k, 1]]); String(w.has(k));`)).toBe('true');
  expect(evaluated(`${k} const w = new WeakMap([[k, 1]]); String(w.delete(k));`)).toBe('true');
  expect(evaluated(`${k} const w = new WeakMap(); String(w.get(k));`)).toBe('undefined');
  expect(evaluated(`${k} const w = new WeakMap(); String(w.getOrInsert(k, 5));`)).toBe('5');
  expect(evaluated(`${k} const w = new WeakMap(); String(w.getOrInsertComputed(k, () => 6));`)).toBe('6');
  // A WeakMap has no `size`, no iteration, and no `clear`. Reading an absent
  // member gives undefined rather than an error - the ordinary object rule.
  expect(evaluated('const w = new WeakMap(); String(w.size);')).toBe('undefined');
  expect(evaluated('const w = new WeakMap(); String(w.clear);')).toBe('undefined');
  expect(evaluated('const w = new WeakMap(); String(w[Symbol.iterator]);')).toBe('undefined');
  // A primitive key is a TypeError, as it is today.
  expectThrownKind('new WeakMap().set(1, 1);', 'TypeError');
});

test('WeakSet: every member on an untyped weak set', () => {
  const v = 'const v = {}; ';
  expect(evaluated(`${v} const w = new WeakSet(); w.add(v); String(w.has(v));`)).toBe('true');
  expect(evaluated(`${v} const w = new WeakSet(); String(w.add(v) === w);`)).toBe('true');
  expect(evaluated(`${v} const w = new WeakSet([v]); String(w.delete(v));`)).toBe('true');
  expect(evaluated(`${v} const w = new WeakSet(); String(w.delete(v));`)).toBe('false');
  expect(evaluated('const w = new WeakSet(); String(w.size);')).toBe('undefined');
  expectThrownKind('new WeakSet().add(1);', 'TypeError');
  // A registered symbol is refused; an unregistered one is accepted. Unchanged.
  expectThrownKind('new WeakSet().add(Symbol.for("x"));', 'TypeError');
  expect(evaluated('const s = Symbol(); const w = new WeakSet(); w.add(s); String(w.has(s));')).toBe('true');
});

// ---------------------------------------------------------------------------
// `size` is a Number - the single most important row in this file
// ---------------------------------------------------------------------------

test('size on an untyped collection is a plain Number', () => {
  expect(evaluated('const m = new Map([["a", 1]]); typeof m.size;')).toBe('number');
  expect(evaluated('const s = new Set([1]); typeof s.size;')).toBe('number');
  expect(evaluated('const m = new Map([["a", 1]]); String(Reflect.typeOf(m.size) === (type number));')).toBe('true');
  expect(evaluated('const s = new Set([1]); String(Reflect.typeOf(s.size) === (type number));')).toBe('true');
});

test('an untyped size participates in untyped arithmetic and comparison', () => {
  // A TYPED collection's `size` has the index type, at which point it stops
  // mixing with a Number. None of that may reach here: these are the
  // expressions ordinary JavaScript is written in, and each must keep working.
  expect(evaluated('const m = new Map([["a", 1]]); String(m.size + 1);')).toBe('2');
  expect(evaluated('const s = new Set([1, 2]); String(s.size * 2);')).toBe('4');
  expect(evaluated('const s = new Set([1]); String(s.size === 1);')).toBe('true');
  expect(evaluated('const s = new Set([1]); String(s.size < [1, 2].length);')).toBe('true');
  expect(evaluated('const s = new Set([1]); String(s.size > 0 ? "yes" : "no");')).toBe('yes');
  // The idiom a `for` loop over a count is written in.
  expect(evaluated('const s = new Set([1, 2, 3]); let n = 0; for (let i = 0; i < s.size; i++) n++; String(n);')).toBe('3');
  // And the one an emptiness test is written in.
  expect(evaluated('const m = new Map(); String(!m.size);')).toBe('true');
});

test('size is an accessor with no setter, and is not own', () => {
  expect(evaluated('const m = new Map(); String(Object.getOwnPropertyDescriptor(m, "size"));')).toBe('undefined');
  expect(evaluated('const d = Object.getOwnPropertyDescriptor(Map.prototype, "size"); String(typeof d.get) + String(d.set);')).toBe('functionundefined');
  expect(evaluated('const d = Object.getOwnPropertyDescriptor(Set.prototype, "size"); String(typeof d.get) + String(d.set);')).toBe('functionundefined');
});

// ---------------------------------------------------------------------------
// Contents are unconstrained
// ---------------------------------------------------------------------------

test('an untyped collection holds heterogeneous contents', () => {
  expect(evaluated('const s = new Set(); s.add(1); s.add("a"); s.add({}); s.add(Symbol()); s.add(null); s.add(undefined); s.add(() => {}); String(s.size);')).toBe('7');
  expect(evaluated('const m = new Map(); m.set(1, "a"); m.set("a", 1); m.set({}, null); m.set(null, {}); String(m.size);')).toBe('4');
  // Values a typed collection would refuse for range are ordinary here.
  expect(evaluated('const s = new Set(); s.add(300); s.add(-1); s.add(1e300); String(s.size);')).toBe('3');
  expect(evaluated('const m = new Map(); m.set("a", 300); String(m.get("a"));')).toBe('300');
});

test('an untyped collection keys with SameValueZero, unchanged', () => {
  // -0 and +0 are ONE key.
  expect(evaluated('const s = new Set(); s.add(-0); s.add(0); String(s.size);')).toBe('1');
  // ...and the stored element is +0, per SetData's normalisation.
  expect(evaluated('const s = new Set(); s.add(-0); String(Object.is([...s][0], 0));')).toBe('true');
  // NaN is one key and is findable, which `===` could not do.
  expect(evaluated('const s = new Set(); s.add(NaN); s.add(NaN); String(s.size);')).toBe('1');
  expect(evaluated('const s = new Set([NaN]); String(s.has(NaN));')).toBe('true');
  expect(evaluated('const m = new Map(); m.set(NaN, 1); String(m.get(NaN));')).toBe('1');
  // 1 and "1" are two keys - no coercion between them.
  expect(evaluated('const m = new Map(); m.set(1, "num"); m.set("1", "str"); String(m.size) + m.get(1) + m.get("1");')).toBe('2numstr');
  // An object key is identity, so two empty literals are two keys.
  expect(evaluated('const m = new Map(); m.set({}, 1); m.set({}, 2); String(m.size);')).toBe('2');
});

test('iteration order is insertion order, and delete then re-add moves an entry to the end', () => {
  expect(evaluated('const m = new Map([["a", 1], ["b", 2], ["c", 3]]); [...m.keys()].join(",");')).toBe('a,b,c');
  expect(evaluated('const m = new Map([["a", 1], ["b", 2]]); m.delete("a"); m.set("a", 1); [...m.keys()].join(",");')).toBe('b,a');
  // Re-setting a PRESENT key keeps its position.
  expect(evaluated('const m = new Map([["a", 1], ["b", 2]]); m.set("a", 9); [...m.keys()].join(",");')).toBe('a,b');
  expect(evaluated('const s = new Set([1, 2]); s.delete(1); s.add(1); [...s].join(",");')).toBe('2,1');
});

// ---------------------------------------------------------------------------
// The rest of the object surface
// ---------------------------------------------------------------------------

test('an untyped collection has no own enumerable properties and stringifies as {}', () => {
  expect(evaluated('const m = new Map([["a", 1]]); JSON.stringify(m);')).toBe('{}');
  expect(evaluated('const s = new Set([1]); JSON.stringify(s);')).toBe('{}');
  expect(evaluated('const m = new Map([["a", 1]]); String(Object.keys(m).length);')).toBe('0');
  expect(evaluated('const m = new Map(); Object.prototype.toString.call(m);')).toBe('[object Map]');
  expect(evaluated('const s = new Set(); Object.prototype.toString.call(s);')).toBe('[object Set]');
  expect(evaluated('const m = new Map(); m[Symbol.toStringTag];')).toBe('Map');
});

test('an untyped collection subclasses, and species is the constructor', () => {
  expect(evaluated('class M extends Map {} const m = new M(); m.set("a", 1); String(m.get("a"));')).toBe('1');
  expect(evaluated('class M extends Map {} const m = new M(); String(m instanceof Map);')).toBe('true');
  expect(evaluated('class S extends Set {} const s = new S(); s.add(1); String(s.size);')).toBe('1');
  expect(evaluated('String(Map[Symbol.species] === Map);')).toBe('true');
  expect(evaluated('String(Set[Symbol.species] === Set);')).toBe('true');
  // A subclass may add state alongside the collection's own.
  expect(evaluated('class M extends Map { constructor() { super(); this.tag = "t"; } } const m = new M(); m.set("a", 1); m.tag + String(m.size);')).toBe('t1');
});

test('the constructors accept the iterables they accept today', () => {
  expect(evaluated('String(new Map().size);')).toBe('0');
  expect(evaluated('String(new Map(null).size);')).toBe('0');
  expect(evaluated('String(new Map(undefined).size);')).toBe('0');
  expect(evaluated('String(new Map([["a", 1]]).size);')).toBe('1');
  expect(evaluated('String(new Set("abc").size);')).toBe('3');
  expect(evaluated('function* g() { yield 1; yield 2; } String(new Set(g()).size);')).toBe('2');
  expect(evaluated('const a = new Set([1, 2]); String(new Set(a).size);')).toBe('2');
  // Calling without `new` is a TypeError, unchanged.
  expectThrownKind('Map();', 'TypeError');
  expectThrownKind('Set();', 'TypeError');
  // A non-iterable seed is a TypeError; a Map seed whose entry is not an object
  // likewise.
  expectThrownKind('new Set(1);', 'TypeError');
  expectThrownKind('new Map([1]);', 'TypeError');
});

test('brand checks still refuse a foreign receiver', () => {
  expectThrownKind('Map.prototype.get.call({}, "a");', 'TypeError');
  expectThrownKind('Set.prototype.add.call({}, 1);', 'TypeError');
  expectThrownKind('Object.getOwnPropertyDescriptor(Map.prototype, "size").get.call(new Set());', 'TypeError');
  expectThrownKind('Object.getOwnPropertyDescriptor(Set.prototype, "size").get.call(new Map());', 'TypeError');
});

// ---------------------------------------------------------------------------
// The typed and untyped surfaces coexist
// ---------------------------------------------------------------------------

test('a typed collection in the same program does not change an untyped one', () => {
  // The two must be independent: a stamp on one value is not a change to the
  // constructor, the prototype, or any other instance.
  expect(evaluated('const t = new Set.<uint8>(); const u = new Set(); u.add("anything"); String(u.size);')).toBe('1');
  expect(evaluated('const t = new Map.<string, uint8>(); const u = new Map(); u.set(1, 2); String(u.get(1));')).toBe('2');
  expect(evaluated('const t = new Set.<uint8>(); const u = new Set([1]); typeof u.size;')).toBe('number');
  // And a specialization does not alter the shared prototype.
  expect(evaluated('const t = new Set.<uint8>(); String(Object.getPrototypeOf(t) === Set.prototype);')).toBe('true');
});

test('the [[TypedCollection]] stamp travels with the VALUE, not the binding', () => {
  // Measured and recorded here, because it is the one thing the invariant needs
  // that is not simply "nothing happens": an untyped
  // BINDING of a typed VALUE keeps the typed behaviour. Otherwise the carve-out
  // would be a hole - a program could launder a typed collection through `let u
  // = s` and write anything into it.
  //
  // The bad value goes through `any` so that the CHECKER cannot see it and the
  // run time is what answers.
  const hide = 'const bad = (300 := any); ';
  expect(ok(`const s = new Set.<uint8>(); const u = s; ${hide} u.add(bad);`)).toBe(false);
  expect(ok(`let s: Set.<uint8> = new Set(); const u = s; ${hide} u.add(bad);`)).toBe(false);
  // Including through an untyped function parameter, which is the general form.
  expect(ok('function g(x) { x.add(300); } const s = new Set.<uint8>(); g(s);')).toBe(false);
  expect(ok('function g(x) { x.add(300); } let s: Set.<uint8> = new Set(); g(s);')).toBe(false);
  // The control: the same laundering on an UNTYPED set is accepted.
  expect(evaluated('function g(x) { x.add(300); } const s = new Set(); g(s); String(s.size);')).toBe('1');
});

// ---------------------------------------------------------------------------
// Feature-off parity
// ---------------------------------------------------------------------------

test('untyped collection behaviour is identical with the feature off', () => {
  // The invariant says an untyped collection is unaffected BY THE PROPOSAL. The
  // sharpest way to assert that is to run the same source both ways and compare,
  // rather than to assert a literal twice.
  const programs = [
    'const m = new Map([["a", 1]]); typeof m.size;',
    'const m = new Map([["a", 1]]); String(m.size + 1);',
    'const s = new Set(); s.add(-0); s.add(0); s.add(NaN); s.add(NaN); String(s.size);',
    'const m = new Map(); m.set(1, "num"); m.set("1", "str"); String(m.size);',
    'const m = new Map([["a", 1], ["b", 2]]); m.delete("a"); m.set("a", 1); [...m.keys()].join(",");',
    'const a = new Set([1, 2]); const b = new Set([2, 3]); [...a.symmetricDifference(b)].join(",");',
    'const m = new Map([["a", 1]]); JSON.stringify(m);',
    'class M extends Map {} const m = new M(); m.set("a", 1); String(m.get("a"));',
    'const m = new Map(); String(m.getOrInsert("a", 1));',
    'const g = Map.groupBy([1, 2, 3, 4], (n) => n % 2 === 0 ? "even" : "odd"); g.get("even").join(",");',
  ];
  for (const source of programs) {
    expect(evaluated(source), `feature-on/off divergence for: ${source}`).toBe(evaluatedFlagOff(source));
  }
});
