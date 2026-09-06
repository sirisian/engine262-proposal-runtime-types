import { test, expect } from 'vitest';
import { evaluated, ok, expectStaticTypeError, expectThrownKind } from '../harness.mts';

// ---------------------------------------------------------------------------
// THE WEAK GENERICS HOLD THEIR KEY WEAKLY, SO THE KEY TYPE MUST BE HOLDABLE.
//
// README, "Weak References": `class WeakMap<K extends object | symbol, V>`,
// `class WeakSet<T extends object | symbol>`, `class WeakRef<T extends object |
// symbol>`; `FinalizationRegistry<T>` where T is the HELD value, unconstrained,
// and `register(target: object | symbol, heldValue: T, unregisterToken?:
// object | symbol)`. "Passing one is a TypeError, statically when the type is
// known and at run time otherwise."
//
// #sec-weak-references-and-typed-objects: "An instance of a typed class cannot
// be held weakly ... A class becomes ineligible exactly when it becomes a typed,
// sealed class." The run time derives "sealed" as a non-`dynamic` class with a
// typed instance field; the static check derives it the same way, so the two
// agree by construction. The clause carves out no reference form: `A | null`
// for a typed class `A` is refused with `A`. (The README's "Weak References"
// section has an `A | null` example that contradicts the clause; the clause is
// normative and is what this file asserts.)
//
// Before this nothing was refused at the type. `new WeakMap.<string, uint8>()`
// was accepted in every position and the program learned at its first `set`,
// from the run time's own TypeError, that no key could ever satisfy it.
// ---------------------------------------------------------------------------

const WEAK = ['WeakMap', 'WeakSet', 'WeakRef'] as const;
const V = (lib: string, K: string) => (lib === 'WeakMap' ? `${lib}.<${K}, uint8>` : `${lib}.<${K}>`);

const CANNOT = ['string', 'number', 'boolean', 'bigint', 'null', 'undefined', '"lit"', '1', 'uint8', 'float64', 'decimal128',
  'object | string', 'object | null', 'string | symbol'];
const CAN = ['object', '{ a: uint8 }', '[].<uint8>', '() => void', 'Map.<string, uint8>', 'symbol', 'any', 'object | symbol'];

for (const lib of WEAK) {
  test(`${lib}: a type argument that cannot be held weakly is refused at the application, in every position`, () => {
    for (const K of CANNOT) {
      const T = V(lib, K);
      const ctor = lib === 'WeakRef' ? `new ${T}({})` : `new ${T}()`;
      expectStaticTypeError(`const x = ${ctor};`);
      expectStaticTypeError(`let x: ${T} = ${ctor};`);
      expectStaticTypeError(`type M = ${T};`);
      expectStaticTypeError(`function f(m: ${T}) {}`);
      expectStaticTypeError(`function f(): ${T} { return ${ctor}; }`);
      expectStaticTypeError(`class C { m: ${T} = ${ctor}; }`);
      expectStaticTypeError(`interface I { m: ${T}; }`);
    }
  });

  test(`${lib}: a type argument that can be held weakly is accepted, and runs`, () => {
    for (const K of CAN) {
      const T = V(lib, K);
      const ctor = lib === 'WeakRef' ? `new ${T}(${K === 'symbol' ? 'Symbol("s")' : '{}'})` : `new ${T}()`;
      expect(ok(`const x = ${ctor};`)).toBe(true);
      expect(ok(`type M = ${T};`)).toBe(true);
      expect(ok(`function f(m: ${T}) {}`)).toBe(true);
    }
  });
}

test('the error names the argument, the generic, and what it holds weakly', () => {
  const msg = (src: string) => evaluated(`try { eval(${JSON.stringify(src)}); "no error"; } catch (e) { String(e.message); }`);
  expect(msg('new WeakMap.<string, uint8>();')).toBe('"string" cannot be held weakly, and "WeakMap" holds its "keys" weakly');
  expect(msg('new WeakSet.<uint8>();')).toBe('"uint.<8>" cannot be held weakly, and "WeakSet" holds its "values" weakly');
  expect(msg('type R = WeakRef.<null>;')).toBe('"null" cannot be held weakly, and "WeakRef" holds its "target" weakly');
});

test('a typed (sealed) class is refused, its nullable union with it, as the clause says', () => {
  const A = 'class A { a: uint8 = 0; } ';
  expectStaticTypeError(`${A} const m = new WeakMap.<A, uint8>();`);
  expectStaticTypeError(`${A} const m = new WeakMap.<A | null, uint8>();`);
  expectStaticTypeError(`${A} const s = new WeakSet.<A>();`);
  expectStaticTypeError(`${A} type R = WeakRef.<A>;`);
  // ...and at the ARGUMENT, where the type is known: "statically when the type
  // is known and at run time otherwise".
  expectStaticTypeError(`${A} const b = new A(); new WeakRef(b);`);
  expectStaticTypeError(`${A} let e: A | null = new A(); new WeakRef(e);`);
  expectStaticTypeError('let a: uint8 = 0; new WeakRef(a);');
  // The boundary is the run time's exactly: a class with NO typed field is a
  // reference class; a `dynamic` typed class is not sealed. Both hold.
  expect(ok('class R { x = 1; } new WeakRef(new R());')).toBe(true);
  expect(ok('dynamic class D { a: uint8 = 0; } new WeakRef(new D());')).toBe(true);
  // A typed ARRAY is an object (README: "a typed array is an object").
  expect(ok('const d: [10].<uint8> = new [10].<uint8>(); new WeakRef(d);')).toBe(true);
  // And the run time agrees where the type was not known statically.
  expectThrownKind(`${A} function f(x) { return new WeakRef(x); } f(new A());`, 'TypeError');
});

test('symbols: the type is accepted; a registered symbol is the run time\'s to refuse', () => {
  expect(evaluated('const m = new WeakMap.<symbol, uint8>(); m.set(Symbol("s"), 1); "ok";')).toBe('ok');
  expectThrownKind('const m = new WeakMap.<symbol, uint8>(); m.set(Symbol.for("s"), 1);', 'TypeError');
  expect(evaluated('const r = new WeakRef.<symbol>(Symbol("s")); "ok";')).toBe('ok');
});

test('the set and add arguments are checked by the same constraint', () => {
  expectStaticTypeError('const m = new WeakMap.<object, uint8>(); m.set("k", 1);');
  expectStaticTypeError('const s = new WeakSet.<object>(); s.add(5);');
  expect(evaluated('const m = new WeakMap.<object, uint8>(); const k = {}; m.set(k, 1); String(m.get(k));')).toBe('1');
});

test('FinalizationRegistry: the held value is unconstrained; the target and token are not', () => {
  // README: "FinalizationRegistry's held value is unconstrained, so it can be a
  // value type. This is the common case."
  expect(ok('const r = new FinalizationRegistry.<uint32>((h) => {});')).toBe(true);
  expect(ok('const r = new FinalizationRegistry.<string>((h) => {});')).toBe(true);
  expect(ok('const r = new FinalizationRegistry.<uint32>((h) => {}); const t = {}; r.register(t, 1);')).toBe(true);
  expect(ok('const r = new FinalizationRegistry.<uint32>((h) => {}); r.register(new Map(), 1);')).toBe(true);
  expect(ok('const r = new FinalizationRegistry.<uint32>((h) => {}); r.register(Symbol("s"), 1);')).toBe(true);
  // The target must be weakly referenceable, and is checked statically.
  expectStaticTypeError('const r = new FinalizationRegistry.<uint32>((h) => {}); r.register("s", 1);');
  expectStaticTypeError('const r = new FinalizationRegistry.<uint32>((h) => {}); r.unregister("s");');
  // The held value takes T.
  expectStaticTypeError('const r = new FinalizationRegistry.<uint32>((h) => {}); r.register({}, "not a uint32");');
});

// ---------------------------------------------------------------------------
// THE ARGUMENT SITES: "statically when the type is known".
//
// The element-taking methods were checked by ASSIGNABILITY of the argument to
// the element type. That is right for `s.add(5)` at a `WeakSet.<object>` - `5`
// is not an object - and wrong for an instance of a typed class, which IS
// assignable to `object` and is not holdable: `s.add(new A())` passed the
// checker and was refused at run time, one step later than `new WeakRef(new A())`
// beside it. The constructor's iterable argument was not checked at all.
// ---------------------------------------------------------------------------

test('a typed-class instance passed to add/set/has/delete is refused statically, not at run time', () => {
  const A = 'class A { a: uint8 = 0; } ';
  expectStaticTypeError(`${A} const s = new WeakSet.<object>(); s.add(new A());`);
  expectStaticTypeError(`${A} const s = new WeakSet.<object>(); s.has(new A());`);
  expectStaticTypeError(`${A} const s = new WeakSet.<object>(); s.delete(new A());`);
  expectStaticTypeError(`${A} const m = new WeakMap.<object, uint8>(); m.set(new A(), 1);`);
  expectStaticTypeError(`${A} const m = new WeakMap.<object, uint8>(); m.get(new A());`);
  expectStaticTypeError(`${A} const b = new A(); const s = new WeakSet.<object>(); s.add(b);`);
  // A value type through a binding, likewise.
  expectStaticTypeError('let v: uint8 = 3; const s = new WeakSet.<object>(); s.add(v);');
  // Holdable arguments run - an object, a reference class, a dynamic typed class.
  expect(ok('const s = new WeakSet.<object>(); s.add({});')).toBe(true);
  expect(ok('class R { x = 1; } const s = new WeakSet.<object>(); s.add(new R());')).toBe(true);
  expect(ok('dynamic class D { a: uint8 = 0; } const s = new WeakSet.<object>(); s.add(new D());')).toBe(true);
  // An `any` argument is the run time's, as before.
  expectThrownKind('function f(x) { const s = new WeakSet.<object>(); s.add(x); } f(5);', 'TypeError');
});

test('FinalizationRegistry.register and unregister check their target and token the same way', () => {
  const A = 'class A { a: uint8 = 0; } const r = new FinalizationRegistry.<uint32>((h) => {}); ';
  expectStaticTypeError(`${A} r.register(new A(), 1);`);
  expectStaticTypeError(`${A} r.register({}, 1, new A());`);
  expectStaticTypeError(`${A} r.unregister(new A());`);
});

test('the constructor\'s iterable argument is checked where its element type is known', () => {
  const A = 'class A { a: uint8 = 0; } ';
  expectStaticTypeError('new WeakSet.<object>([5]);');
  expectStaticTypeError('new WeakSet.<object>(["x", "y"]);');
  expectStaticTypeError(`${A} new WeakSet.<object>([new A()]);`);
  expect(ok('new WeakSet.<object>([{}, {}]);')).toBe(true);
  expect(ok('const a: [].<object> = [{}]; new WeakSet.<object>(a);')).toBe(true);
  // A WeakMap's pair separates its KEY only as a TUPLE. A typed tuple source is
  // checked; a pair LITERAL is inferred as an array with a joined element type
  // (`[{}, 1]` is `[].<{} | number>`), so the key is not separable and the check
  // abstains to the run time rather than refuse on the join.
  expectStaticTypeError('const pairs: [].<[uint8, uint8]> = [[1, 2]]; new WeakMap.<object, uint8>(pairs);');
  expect(ok('const pairs: [].<[object, uint8]> = [[{}, 1]]; new WeakMap.<object, uint8>(pairs);')).toBe(true);
  expect(ok('new WeakMap.<object, uint8>([[{}, 1]]);')).toBe(true);
  expectThrownKind('new WeakMap.<object, uint8>([[5, 1]]);', 'TypeError');
  // An UNTYPED constructor is plain JavaScript and stays a run-time TypeError.
  expectThrownKind('new WeakSet([5]);', 'TypeError');
});
