import { test, expect } from 'vitest';
import { evaluated, ok, expectStaticTypeError } from '../harness.mts';

/**
 * `structuredClone(value)` and its typed signature `structuredClone<T>(value: T): T`.
 *
 * Unspecified: it is defined by HTML rather than by ECMAScript, and the specification does not state
 * it. A typed signature is a claim that the function EXISTS, so the engine provides it: a structured
 * clone is HOW a program moves a typed value across a boundary, and the identity signature exists so
 * the type survives the crossing. Scoped to the ECMAScript-shaped subset: HTML's transferables and
 * `SharedArrayBuffer` mean nothing in a bare engine.
 */

test('the clone is deep, and independent of its source', () => {
  expect(evaluated('const a = { x: 1 }; const b = structuredClone(a); b.x = 9; String(a.x);')).toBe('1');
  expect(evaluated('const a = { n: { y: 2 } }; const b = structuredClone(a); b.n.y = 9; String(a.n.y);')).toBe('2');
  expect(evaluated('const a = [1, 2]; const b = structuredClone(a); b[0] = 9; String(a[0]);')).toBe('1');
  expect(evaluated('const mp = new Map(); mp.set("k", 1); const b = structuredClone(mp); String(b.get("k"));')).toBe('1');
  expect(evaluated('const s = new Set([1, 2]); const b = structuredClone(s); String(b.size);')).toBe('2');
});

test('a CYCLE terminates and SHARING is preserved', () => {
  // The memo is what makes both true. A naive recursion loses its termination
  // on the first and its sharing on the second: two references to one object in
  // the source must be two references to ONE object in the clone.
  expect(evaluated('const a = { x: 1 }; a.self = a; const b = structuredClone(a); String(b.self === b);')).toBe('true');
  expect(evaluated('const sh = { v: 1 }; const a = { p: sh, q: sh }; const b = structuredClone(a); String(b.p === b.q);')).toBe('true');
});

test('what cannot be cloned is REFUSED', () => {
  // HTML raises a *DataCloneError*, a DOM exception this engine does not define,
  // so a *TypeError* is raised instead - refusing with a catchable error is the
  // behaviour that matters, and inventing a DOM exception hierarchy to carry one
  // name would be a larger change than this signature is worth.
  expect(evaluated('try { structuredClone(() => 1); "no"; } catch (e) { "caught"; }')).toBe('caught');
  expect(evaluated('try { structuredClone(Symbol("x")); "no"; } catch (e) { "caught"; }')).toBe('caught');
});

test('the clone KEEPS its type, which is what the signature is for', () => {
  // A value type class instance clones by the copy #sec-value-type-copying
  // already defines, so it carries its type, its private state and its sealing -
  // giving a structured clone different semantics from an assignment, for one
  // kind of value, would have been the alternative.
  const V = 'value class P { x: uint8 = 0; } ';
  expect(evaluated(`${V} const a = new P(); const b = structuredClone(a); String(Reflect.typeOf(b) === (type P));`)).toBe('true');
  expect(evaluated(`${V} const a = new P(); a.x = 1; const b = structuredClone(a); b.x = 9; String(a.x);`)).toBe('1');
  expect(evaluated('const a: [].<uint8> = [1, 2]; const b = structuredClone(a); String(b.length);')).toBe('2');
});

test('the SIGNATURE is an identity, not a fixed result', () => {
  expect(ok('const a: [].<uint8> = [1]; let n: [].<uint8> = structuredClone(a);')).toBe(true);
  expectStaticTypeError('const a: [].<uint8> = [1]; let n: string = structuredClone(a);');
  expect(ok('value class P { x: uint8 = 0; } const a: P = new P(); let n: P = structuredClone(a);')).toBe(true);
  expectStaticTypeError('value class P { x: uint8 = 0; } const a: P = new P(); let n: string = structuredClone(a);');
  // An untyped argument yields an untyped result, and a program that shadows the
  // name gets its own function.
  expect(ok('if (false) { const u = { x: 1 }; let n: uint8 = structuredClone(u); } 1;')).toBe(true);
  expect(ok('if (false) { function structuredClone(x) { return x; } const a: [].<uint8> = [1]; let n: string = structuredClone(a); } 1;')).toBe(true);
});

/**
 * Question AR, AR2: a typed class instance keeps its class; anything else follows HTML, and the
 * call's type is `T` only where the clone is a `T`.
 */

test('a typed class instance clones to an instance of its class', () => {
  const V = 'class V { x: uint8 = 1; #p: uint8 = 2; o = { n: 3 }; getP() { return this.#p; } } ';
  expect(evaluated(`${V} const v = new V(); const w = structuredClone(v);
    [w instanceof V, w.x, w.getP(), Object.isSealed(w), w.o === v.o, w.o.n].join(" ");`)).toBe('true 1 2 true false 3');
  // No constructor runs, and the fields are the source's.
  expect(evaluated(`let runs = 0; class V { x: uint8 = 1; constructor() { runs += 1; } } const v = new V(); v.x = 7;
    const w = structuredClone(v); [runs, w.x, Reflect.typeOf(w) === (type V)].join(" ");`)).toBe('1 7 true');
  // A field still checks its type, and the seal refuses a member the class does not declare.
  expect(evaluated('class V { x: uint8 = 1; } const w = structuredClone(new V()); function g(o) { try { o.x = 300; } catch (e) { return e.constructor.name; } } g(w);')).toBe('RangeError');
  expect(evaluated('class V { x: uint8 = 1; } const w = structuredClone(new V()); function g(o) { try { o.extra = 1; } catch (e) { return e.constructor.name; } } g(w);')).toBe('TypeError');
});

test('a typed class over a built-in clones its built-in part, and fails where HTML fails', () => {
  expect(evaluated('class E extends Error { code: uint8 = 3; } const w = structuredClone(new E("m")); [w instanceof E, w.code, w.message, Error.isError(w)].join(" ");')).toBe('true 3 m true');
  expect(evaluated('class M extends Map { n: uint8 = 3; } const m = new M(); m.set(1, { a: 2 }); const w = structuredClone(m); [w instanceof M, w.n, w.get(1).a, w.get(1) === m.get(1)].join(" ");')).toBe('true 3 2 false');
  for (const base of ['Promise', 'WeakMap']) {
    const make = base === 'Promise' ? 'new P(() => {})' : 'new P()';
    expect(evaluated(`class P extends ${base} { n: uint8 = 3; } try { structuredClone(${make}); "cloned"; } catch (e) { e.constructor.name; }`)).toBe('TypeError');
  }
});

test('an instance of a class that is not typed comes back a plain object, and the call is untyped', () => {
  expect(evaluated('class U { x = 1; } const w = structuredClone(new U()); [w instanceof U, w.x, Object.getPrototypeOf(w) === Object.prototype].join(" ");')).toBe('false 1 true');
  expect(evaluated('class U { x = 1; } const w = structuredClone([new U()]); String(w[0] instanceof U);')).toBe('false');
  expect(ok('class U { x = 1; } const w = structuredClone(new U()); let n: number = w.x;')).toBe(true);
  // A typed class keeps its type, so the call's type is the argument's.
  expectStaticTypeError('class V { x: uint8 = 1; } const w = structuredClone(new V()); let s: string = w;');
});

test('the built-ins HTML clones keep what makes them one', () => {
  expect(evaluated('const w = structuredClone(new Date(5)); [w instanceof Date, w.getTime()].join(" ");')).toBe('true 5');
  expect(evaluated('const r = /a+/gi; r.lastIndex = 2; const w = structuredClone(r); [w instanceof RegExp, w.source, w.flags, w.lastIndex, w === r].join(" ");')).toBe('true a+ gi 0 false');
  // An Error by its name, one HTML does not know becoming "Error"; its message, and not its cause.
  expect(evaluated('const w = structuredClone(new RangeError("m", { cause: 1 })); [w instanceof RangeError, w.message, "cause" in w, typeof w.stack].join(" ");')).toBe('true m false string');
  expect(evaluated('const e = new Error("m"); e.name = "Custom"; const w = structuredClone(e); [w.name, Object.getPrototypeOf(w) === Error.prototype].join(" ");')).toBe('Error true');
  expect(evaluated('const b = new ArrayBuffer(4); new Uint8Array(b)[1] = 7; const w = structuredClone(b); [w instanceof ArrayBuffer, w.byteLength, new Uint8Array(w)[1], w === b].join(" ");')).toBe('true 4 7 false');
  expect(evaluated('const b = new ArrayBuffer(4, { maxByteLength: 8 }); const w = structuredClone(b); [w.resizable, w.maxByteLength].join(" ");')).toBe('true 8');
  expect(evaluated('const a = new Uint8Array([1, 2, 3]); const w = structuredClone(a); [w instanceof Uint8Array, w[2], w.buffer === a.buffer].join(" ");')).toBe('true 3 false');
  // Two views of one buffer are two views of one clone.
  expect(evaluated('const b = new ArrayBuffer(8); const o = { x: new Uint8Array(b), y: new DataView(b, 4) }; const w = structuredClone(o); [w.x.buffer === w.y.buffer, w.y.byteOffset, w.y instanceof DataView].join(" ");')).toBe('true 4 true');
  expect(evaluated('[structuredClone(new Boolean(true)).valueOf(), structuredClone(new Number(2)).valueOf(), structuredClone(new String("ab")).length, typeof structuredClone(Object(1n)).valueOf()].join(" ");')).toBe('true 2 2 bigint');
});

test('what HTML refuses is refused, and an array keeps its holes and its other properties', () => {
  for (const source of ['Promise.resolve(1)', 'new WeakMap()', 'new WeakSet()', 'new Proxy({}, {})', 'Object(Symbol())', '(function* () {})()']) {
    expect(evaluated(`try { structuredClone(${source}); "cloned"; } catch (e) { e.constructor.name; }`)).toBe('TypeError');
  }
  expect(evaluated('const a = [1, , 3]; a.foo = 4; const w = structuredClone(a); [1 in w, w.length, w.foo, Array.isArray(w)].join(" ");')).toBe('false 3 4 true');
});

test('a typed array keeps its element type, and an immutable value is its own clone', () => {
  expect(evaluated('const a: [].<uint8> = [1, 2]; const w = structuredClone(a); String(Reflect.typeOf(w));')).toBe('[].<uint.<8>>');
  expect(evaluated('const a: [].<uint8> = [1, 2]; const w = structuredClone(a); function g(x) { try { x.push(300); } catch (e) { return e.constructor.name; } } g(w);')).toBe('RangeError');
  expect(evaluated('const d: decimal64 = 1.50; const w = structuredClone(d); String(w) + " " + String(Reflect.typeOf(w));')).toBe('1.50 decimal64');
  expect(evaluated('const r = 0..<3; String(structuredClone(r) === r);')).toBe('true');
  expect(evaluated('const c = Composite({ a: 1 }); String(structuredClone(c) === c);')).toBe('true');
});
