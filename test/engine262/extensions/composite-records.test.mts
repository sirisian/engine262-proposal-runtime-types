import { test, expect } from 'vitest';
import { evaluated } from '../readme/harness.mts';

/**
 * PLAN-composites.md phase two: record composites and the registry.
 *
 * `sec-composites`: a composite is a frozen, null-prototyped object that is
 * INTERNED, so two creations from the same contents are the same object.
 * Equality of contents is therefore identity, and `===`, `Map`, `Set` and
 * `Array.prototype.includes` compare composites structurally with NO CHANGE to
 * any of them - the comparison each already performs finds one object where the
 * contents are one. That is the whole of the collections integration, and the
 * reason it needs no specification text.
 *
 * This is the design's TYPED composites. Upstream is the base it layers on;
 * every rule below follows the clause.
 */

const outcome = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);

test('equal contents are ONE object, in whatever order they were written', () => {
  // Keys are stored sorted, so a composite is a canonical form independent of
  // the source's enumeration order.
  expect(evaluated('String(Composite({ x: 1, y: 4 }) === Composite({ y: 4, x: 1 }));')).toBe('true');
  expect(evaluated('String(Composite({ x: 1 }) === Composite({ x: 2 }));')).toBe('false');
  expect(evaluated('String(Composite({ x: 1 }) === Composite({ x: 1, y: 1 }));')).toBe('false');
});

test('the collections integration needs no code, which is the point', () => {
  expect(evaluated('String(new Set([Composite({ x: 1, y: 4 }), Composite({ y: 4, x: 1 })]).size);')).toBe('1');
  expect(evaluated('const m = new Map([[Composite({ x: 1, y: 4 }), "ship"]]); String(m.get(Composite({ x: 1, y: 4 })));')).toBe('ship');
  expect(evaluated('String([Composite({ x: 1 })].includes(Composite({ x: 1 })));')).toBe('true');
});

test('INTERNING IS TYPE-SENSITIVE, the design\'s central deviation', () => {
  // "a `uint8` field and a Number field of the same mathematical value are
  // different keys, so the value read back is the value that was stored, at its
  // type, however many creation sites produced the object". The alternative
  // fails on determinism: if the two interned together, what `.x` reads would
  // depend on which call ran first anywhere in the agent.
  expect(evaluated('String(Composite({ x: uint8(1) }) === Composite({ x: 1 }));')).toBe('false');
  expect(evaluated('String(Composite({ x: uint8(1) }) === Composite({ x: uint8(1) }));')).toBe('true');
  // TWO TYPED WIDTHS, which is the case a registry key built from a type's
  // NAME got wrong: every typed number produced one string, so `uint8(1)` and
  // `uint16(1)` interned together while SameValueZero told them apart. The key
  // is the type system's own canonical order key now, so the two agree.
  expect(evaluated('String(Composite({ x: uint8(1) }) === Composite({ x: uint16(1) }));')).toBe('false');
  // And the value read back is the one stored, AT ITS TYPE - asserted by type
  // identity, since type objects are interned.
  expect(evaluated('String(Reflect.typeOf(Composite({ x: uint8(1) }).x) === (type uint8));')).toBe('true');
});

test('a field holding an OBJECT compares by identity, not by contents', () => {
  // "an object field compares by identity, so `Composite({ v: {} }) !==
  // Composite({ v: {} })` while two mentions of the SAME object are one key."
  // Both halves, because either alone is consistent with the wrong rule.
  expect(evaluated('String(Composite({ v: {} }) === Composite({ v: {} }));')).toBe('false');
  expect(evaluated('const o = {}; String(Composite({ v: o }) === Composite({ v: o }));')).toBe('true');
  // A NESTED composite keys correctly through the same identity rule, because
  // interning has already made equal contents one object.
  expect(evaluated('String(Composite({ v: Composite({ x: 1 }) }) === Composite({ v: Composite({ x: 1 }) }));')).toBe('true');
});

test('the object a composite is: frozen, null-prototyped, not constructible', () => {
  expect(evaluated('String(Object.isFrozen(Composite({ x: 1 })));')).toBe('true');
  expect(evaluated('String(Object.getPrototypeOf(Composite({ x: 1 })));')).toBe('null');
  expect(evaluated('String(typeof Composite({ x: 1 }));')).toBe('object');
  expect(outcome('new Composite({});')).toBe('TypeError');
  expect(outcome('Composite(null);')).toBe('TypeError');
  expect(outcome('Composite(1);')).toBe('TypeError');
  // Own data properties, enumerable, in sorted order.
  expect(evaluated('Object.keys(Composite({ y: 1, x: 2, 2: 3, 1: 4 })).join(",");')).toBe('1,2,x,y');
  expect(evaluated('String(Composite.isComposite(Composite({ x: 1 }))) + "/" + String(Composite.isComposite({}));')).toBe('true/false');
});

test('the source supplies values and is never converted', () => {
  // Own ENUMERABLE STRING keys only: inherited and non-enumerable are ignored,
  // and an own enumerable Symbol key is a TypeError - a Symbol remains fine as
  // a VALUE.
  expect(evaluated('const base = { inherited: 1 }; const o = Object.create(base); o.own = 2; '
    + 'Object.keys(Composite(o)).join(",");')).toBe('own');
  expect(evaluated('const o = {}; Object.defineProperty(o, "hidden", { value: 1, enumerable: false }); '
    + 'o.shown = 2; Object.keys(Composite(o)).join(",");')).toBe('shown');
  expect(outcome('Composite({ [Symbol("s")]: 1 });')).toBe('TypeError');
  expect(evaluated('const s = Symbol("v"); String(Composite({ k: s }).k === s);')).toBe('true');
  // Getters run EAGERLY and exactly once each.
  expect(evaluated('let calls = 0; const o = { get g() { calls += 1; return 5; } }; '
    + 'const c = Composite(o); String(calls) + "/" + String(c.g);')).toBe('1/5');
  // `Composite` is IDEMPOTENT: on a composite it reads the entries and interns
  // back to the same object.
  expect(evaluated('const c = Composite({ x: 1 }); String(Composite(c) === c);')).toBe('true');
});

test('CANONICALIZATION: a stored zero is the class representative', () => {
  // `sec-canonicalizecompositevalue`. A zero stores as `+0` at every float
  // width, so two sources differing only in the sign of a zero are one object
  // and the stored value does not depend on which created it.
  expect(evaluated('String(Object.is(Composite({ v: -0 }).v, 0));')).toBe('true');
  expect(evaluated('String(Composite({ v: -0 }) === Composite({ v: 0 }));')).toBe('true');
  expect(evaluated('String(Composite({ v: float32(-0) }) === Composite({ v: float32(0) }));')).toBe('true');
  // The typed zero stores at its own TYPE, not as a plain Number - a composite
  // stores the value at its type, and the two are not interchangeable.
  expect(evaluated('String(Reflect.typeOf(Composite({ v: float32(-0) }).v) === (type float32));')).toBe('true');
});

test('PINNED: what phase two does not do', () => {
  // The TUPLE kind landed in phase five, and the reason it was refused rather
  // than answered as a record is now assertable: the intern key includes the
  // KIND, so the two never collide. composite-tuples.test.mts owns it.
  expect(evaluated('String(Composite([1, 2]) === Composite({ 0: 1, 1: 2 }));')).toBe('false');
  // Composite TYPES landed in phase three; the TYPED CREATION form
  // `Composite.<T>({...})` is phase four, so a shape can be NAMED but not yet
  // CREATED at.
  expect(outcome('type K = { x: uint8 }; let c: Composite.<K>;')).toBe('ACCEPTED');
  // The weak-position refusal and the custom matcher are phase five.
  expect(outcome('new WeakSet().add(Composite({ x: 1 }));')).toBe('ACCEPTED');
  expect(evaluated('String(typeof Symbol.customMatcher);')).toBe('undefined');
});
