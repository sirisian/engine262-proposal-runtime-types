import { test, expect } from 'vitest';
import { evaluated, ok, expectThrownKind } from '../harness.mts';

/**
 * PLAN-typed-collections.md sec 6.6 - CONSTRUCTION (Phase 4, OQ5 and D8).
 *
 * THE SEED IS CHECKED. `new Set.<uint8>(["a"])` built a `Set.<uint8>` holding
 * the String "a": the stamp lands on the RESULT of Construct, and the
 * constructor has consumed its seed by then, so every seeded entry went
 * unchecked while every added one was checked.
 *
 * OQ5 RECOMMENDED STAMPING EARLIER, AND THAT IS NOT AVAILABLE. There is no
 * object to stamp until the construction produces one, so the type arguments
 * would have to be threaded INTO construction through a channel that does not
 * exist. The stamp instead VALIDATES what it finds, which reaches further than
 * the recommended fix would have: it also covers the annotation path,
 * `let s: Set.<uint8> = new Set(["a"])`, where the construction carries no type
 * arguments at all and there would have been nothing to thread; and it gives
 * Phase 3's ADOPTION rule its missing half, since a collection should adopt a
 * target's arguments only where its contents support the claim.
 *
 * The rule stated once: a collection is of `Map.<K, V>` when every entry it
 * holds is, so acquiring the type IS the check that it already was.
 *
 * The CONVERTED value is written back rather than merely checked, because a
 * boundary converts - so a seeded element and an added one are the same type
 * afterwards rather than differing by how they arrived.
 *
 * D8 - A SUBCLASS OF A SPECIALIZATION. `class M extends Map.<string, uint8> {}`
 * reached neither stamping path: the construction is a plain identifier, so the
 * type-arguments branch does not fire, and there is no annotation whose boundary
 * would adopt it. The heritage's arguments are now recorded on the class
 * constructor and read back at construction, walking the constructor's
 * [[Prototype]] chain so a subclass of a subclass inherits them.
 */

// ---------------------------------------------------------------------------
// The seed is checked
// ---------------------------------------------------------------------------

test('a constructor seed is checked against the element type', () => {
  expect(ok('const s = new Set.<uint8>(["a"]);')).toBe(false);
  expect(ok('const s = new Set.<uint8>([300]);')).toBe(false);
  expect(ok('const s = new Set.<uint8>([1, 2, "three"]);')).toBe(false);
  // A seed that fits is accepted and lands.
  expect(evaluated('const s = new Set.<uint8>([1, 2]); String(s.size);')).toBe('2');
  expect(evaluated('const s = new Set.<uint8>([1, 1]); String(s.size);')).toBe('1');
  expect(evaluated('const s = new Set.<uint8>(); String(s.size);')).toBe('0');
});

test('a Map seed is checked in both positions', () => {
  expect(ok('const m = new Map.<string, uint8>([["a", 300]]);')).toBe(false);
  expect(ok('const m = new Map.<string, uint8>([["a", "b"]]);')).toBe(false);
  expect(evaluated('const m = new Map.<string, uint8>([["a", 1], ["b", 2]]); String(m.size);')).toBe('2');
  expect(evaluated('const m = new Map.<string, uint8>([["a", 1]]); String(m.get("a"));')).toBe('1');
});

test('the ANNOTATION path checks its seed too', () => {
  // The construction here carries no type arguments; the binding's boundary is
  // what adopts, and it now refuses a seed the target cannot hold.
  expect(ok('let s: Set.<uint8> = new Set(["a"]);')).toBe(false);
  expect(ok('let m: Map.<string, uint8> = new Map([["a", 300]]);')).toBe(false);
  expect(evaluated('let s: Set.<uint8> = new Set([1, 2]); String(s.size);')).toBe('2');
});

test('an existing collection does not adopt a type its contents deny', () => {
  // Phase 3 established that only an UNSTAMPED collection adopts. This is the
  // other half: adopting is conditional on the contents fitting, so a populated
  // untyped collection cannot be re-labelled by annotating it.
  expect(ok('const u = new Set(); u.add("a"); let s: Set.<uint8> = u;')).toBe(false);
  expect(ok('const u = new Map(); u.set("a", "b"); let m: Map.<string, uint8> = u;')).toBe(false);
  // ...and one whose contents DO fit may be adopted.
  expect(evaluated('const u = new Set(); u.add(1); let s: Set.<uint8> = u; String(s.size);')).toBe('1');
});

test('a seeded entry is CONVERTED, not merely checked', () => {
  // A boundary converts, so a seeded element and an added one must be the same
  // type afterwards. Before the write-back, `[...s][0]` was a plain Number while
  // `s.add(1)` stored a uint8 - one collection holding two representations of
  // one element type.
  expect(evaluated('const s = new Set.<uint8>([1]); String(Reflect.typeOf([...s][0]) === (type uint8));')).toBe('true');
  expect(evaluated('const m = new Map.<string, uint8>([["a", 1]]); String(Reflect.typeOf(m.get("a")) === (type uint8));')).toBe('true');
  // The added element agrees, which is the comparison that matters.
  expect(evaluated('const s = new Set.<uint8>([1]); s.add(2); const t = [...s].map((v) => Reflect.typeOf(v) === (type uint8)); String(t[0]) + String(t[1]);')).toBe('truetrue');
});

test('the seed forms the language accepts are all covered', () => {
  expect(evaluated('function* g() { yield 1; yield 2; } const s = new Set.<uint8>(g()); String(s.size);')).toBe('2');
  expect(evaluated('const a = new Set.<uint8>([1]); const b = new Set.<uint8>(a); String(b.size);')).toBe('1');
  expect(evaluated('const s = new Set.<uint8>(null); String(s.size);')).toBe('0');
  expect(evaluated('const s = new Set.<uint8>(undefined); String(s.size);')).toBe('0');
  // A generator yielding something the element type cannot hold is refused, so
  // the check does not depend on the seed being an array literal.
  expect(ok('function* g() { yield "a"; } const s = new Set.<uint8>(g());')).toBe(false);
  const k = 'const k = {}; ';
  expect(evaluated(`${k} const w = new WeakMap.<object, uint8>([[k, 1]]); String(w.get(k));`)).toBe('1');
  expect(ok(`${k} const w = new WeakMap.<object, uint8>([[k, 300]]);`)).toBe(false);
});

// ---------------------------------------------------------------------------
// D8 - subclassing a specialization
// ---------------------------------------------------------------------------

test('D8: a subclass of a specialization carries its type arguments', () => {
  const M = 'class M extends Map.<string, uint8> {} ';
  const S = 'class S extends Set.<uint8> {} ';
  // The bad value goes through `any` so the run time is what answers.
  expect(ok(`${M} const m = new M(); const bad = (300 := any); m.set("a", bad);`)).toBe(false);
  expect(ok(`${S} const s = new S(); const bad = (300 := any); s.add(bad);`)).toBe(false);
  expect(evaluated(`${M} const m = new M(); m.set("a", 1); String(m.get("a"));`)).toBe('1');
  // The typed surface follows: `size` reads at the index type and membership
  // discriminates.
  expect(evaluated(`${M} const m = new M(); String(Reflect.typeOf(m.size) === (type uint64));`)).toBe('true');
  expect(evaluated(`${M} const m = new M(); String(m is Map.<string, uint8>);`)).toBe('true');
  expect(evaluated(`${M} const m = new M(); String(m is Map.<string, string>);`)).toBe('false');
});

test('D8: a subclass of a subclass inherits them', () => {
  // Walked up the constructor chain. These are internal fields rather than
  // JS-visible properties, so nothing inherits them without being asked to -
  // an earlier attempt relied on ordinary property lookup and the grandchild
  // came back untyped.
  const M = 'class M extends Map.<string, uint8> {} class N extends M {} ';
  expect(evaluated(`${M} const n = new N(); String(n is Map.<string, uint8>);`)).toBe('true');
  expect(ok(`${M} const n = new N(); const bad = (300 := any); n.set("a", bad);`)).toBe(false);
  expect(evaluated(`${M} const n = new N(); n.set("a", 1); String(n.size);`)).toBe('1');
});

test('D8: a subclass of a BARE collection is untouched', () => {
  // sec 0's invariant reaches subclasses: `class P extends Map {}` names no type
  // arguments, so its instances are ordinary Maps.
  expect(evaluated('class P extends Map {} const p = new P(); p.set(1, 2); p.set("a", "b"); String(p.size);')).toBe('2');
  expect(evaluated('class P extends Map {} const p = new P(); typeof p.size;')).toBe('number');
  expect(evaluated('class P extends Set {} const p = new P(); p.add("anything"); String(p.size);')).toBe('1');
  // A subclass may add its own state alongside, as it could before.
  expect(evaluated('class P extends Map { constructor() { super(); this.tag = "t"; } } const p = new P(); p.set("a", 1); p.tag + String(p.size);')).toBe('t1');
});

// ---------------------------------------------------------------------------
// Nothing here changes the untyped constructors
// ---------------------------------------------------------------------------

test('an untyped constructor is unaffected', () => {
  // The guard suite covers these; repeated here because this phase is the one
  // that touched the construction path.
  expect(evaluated('const s = new Set(["a", 300, {}]); String(s.size);')).toBe('3');
  expect(evaluated('const m = new Map([[1, "a"], ["b", 2]]); String(m.size);')).toBe('2');
  expectThrownKind('new Set(1);', 'TypeError');
  expectThrownKind('new Map([1]);', 'TypeError');
  expectThrownKind('Map();', 'TypeError');
});

test('a collection type still has no default value', () => {
  // Unchanged by this phase, and asserted because the construction path is where
  // a default would have had to come from.
  // The rule fires at the DECLARATION for a binding, and at INSTANTIATION for a
  // field - declaring the class is fine, constructing it is not, since that is
  // where the field would have to be given a value.
  expect(ok('let m: Map.<string, uint8>;')).toBe(false);
  expect(ok('class C { m: Map.<string, uint8>; } new C();')).toBe(false);
  expect(ok('class C { m: Map.<string, uint8>; }')).toBe(true);
  expect(evaluated('class C { m: Map.<string, uint8> = new Map(); } const c = new C(); String(c.m.size);')).toBe('0');
});
