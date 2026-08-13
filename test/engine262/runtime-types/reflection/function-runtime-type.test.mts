import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * Spec: #sec-runtimetypeof. "If _value_ is callable and has declared
 * signatures, return the ~function~ Type Record whose [[Signatures]] are those
 * signatures."
 *
 * The operation enumerated class instances, Arrays, and then everything else as
 * an object type, with no callable step - so a function value's runtime type
 * was an object type unrelated to the function type `f is F` already answered
 * true for. Two mechanisms disagreed about one value.
 *
 * The step sits where the Array step does and for the same reason: an operation
 * that RANKS types sees only what this returns, so a callable reporting an
 * object type could not be ranked against a function type.
 */

const F = "type F = (uint8) => string; function f(a: uint8): string { return ''; } ";

test('function runtime type: an annotated function reports its function type', () => {
  expect(evaluated(`${F}String(Reflect.getReflection(Reflect.typeOf(f)).kind);`)).toBe('function');
  // and it is the SAME interned type the program wrote
  expect(evaluated(`${F}String(Reflect.typeOf(f) === F);`)).toBe('true');
  expect(evaluated(`${F}String(Reflect.typeOf(f).family);`)).toBe('function');
  // membership answered this all along; now reflection agrees
  expect(evaluated(`${F}String(f is F);`)).toBe('true');
  // an arrow declares the same way
  expect(evaluated("const k = (a: uint8): string => '';"
    + ' String(Reflect.getReflection(Reflect.typeOf(k)).kind);')).toBe('function');
});

test('function runtime type: an overloaded function reports every arm', () => {
  expect(evaluated('function h(a: uint8) {} function h(a: string) {}'
    + ' String(Reflect.getReflection(Reflect.typeOf(h)).signatures.length);')).toBe('2');
});

test('function runtime type: a function that declares nothing is unchanged', () => {
  // "has declared signatures" means a type was WRITTEN, not that parameters
  // exist - `g(a)` has a parameter and declares nothing. Reporting a function
  // type for it would synthesise the all-`any` signature the unannotated rule
  // refuses, the same rule that leaves an unannotated member without
  // `signatures`.
  expect(evaluated('function g(a) {} String(Reflect.getReflection(Reflect.typeOf(g)).kind);')).toBe('object');
  expect(evaluated('function g() {} String(Reflect.getReflection(Reflect.typeOf(g)).kind);')).toBe('object');
});

test('function runtime type: the cases the step sits between are unaffected', () => {
  // a class instance is still nominal, an Array still an array type, a plain
  // object still an object type - the three arms the callable step neighbours
  expect(evaluated('class C {} String(Reflect.getReflection(Reflect.typeOf(new C())).kind);')).toBe('primitive');
  expect(evaluated('String(Reflect.getReflection(Reflect.typeOf([1, 2])).kind);')).toBe('array');
  expect(evaluated('String(Reflect.getReflection(Reflect.typeOf({ a: 1 })).kind);')).toBe('object');
});

// -- A signature's [[ThisType]] (#sec-this-adoption) ---------------------------
//
// "It is contravariant, as a parameter is, so a signature with a [[ThisType]] is
// usable where one requiring a NARROWER `this` is required and never the
// reverse. A signature with none supplies no `this` rather than accepting any."
//
// The field was already constructible and reflected - the entry that reported it
// absent measured a SOURCE-written type, which has no spelling for it - so what
// this covers is the rule that gives it meaning.

const mkThis = (t: string) => `Reflect.makeType({ kind: "function", signatures: [{ parameters: [], return: { type: uint8 }${t ? `, this: ${t}` : ''} }] })`;

test('a signature carries and reflects its expected this type', () => {
  expect(evaluated(`type S = { x: uint8 }; const F = ${mkThis('S')};`
    + ' Object.keys(Reflect.getReflection(F).signatures[0]).join(",");')).toBe('parameters,return,this');
  // Part of identity: the same signature with and without one are two types.
  expect(evaluated(`type S = { x: uint8 }; String(${mkThis('S')} !== ${mkThis('')});`)).toBe('true');
});

test('the expected this type is contravariant', () => {
  const setup = 'type Narrow = { x: uint8, y: uint8 }; type Wide = { x: uint8 }; ';
  // A body demanding LESS than the position promises is usable; one demanding
  // more is not.
  expect(evaluated(`${setup} String(Reflect.isAssignable(${mkThis('Wide')}, ${mkThis('Narrow')}));`)).toBe('true');
  expect(evaluated(`${setup} String(Reflect.isAssignable(${mkThis('Narrow')}, ${mkThis('Wide')}));`)).toBe('false');
});

test('none is an absence rather than a wildcard', () => {
  const setup = 'type S = { x: uint8 }; ';
  // "usable nowhere a `this` is required at all"
  expect(evaluated(`${setup} String(Reflect.isAssignable(${mkThis('')}, ${mkThis('S')}));`)).toBe('false');
  // And the other half, which is the EXTRACTION case: a signature that has one
  // is usable nowhere a `this` is absent, so taking a method out of its class
  // and putting it where a free function is expected is refused at the boundary
  // that took it rather than failing inside the body.
  expect(evaluated(`${setup} String(Reflect.isAssignable(${mkThis('S')}, ${mkThis('')}));`)).toBe('false');
  // Where NEITHER has one - every ordinary function - nothing changes.
  expect(evaluated(`String(Reflect.isAssignable(${mkThis('')}, ${mkThis('')}));`)).toBe('true');
  expect(evaluated('String(Reflect.isAssignable(type (x: uint8) => boolean, type (x: uint8) => boolean));')).toBe('true');
});

// -- A signature's [[Narrows]] (#sec-declared-narrowing) -----------------------
//
// "A Narrowing Record has a [[Target]], a String naming a parameter of the
// signature or "this", and a [[Type]], a Type Record. A signature's [[Narrows]]
// is a List of them, and it says what a call establishes."

const guard = 'Reflect.makeType({ kind: "function", signatures: [{ parameters: [{ name: "v", type: any }],'
  + ' return: { type: boolean }, narrows: [{ target: "v", type: uint8 }] }] })';
const plain = 'Reflect.makeType({ kind: "function", signatures: [{ parameters: [{ name: "v", type: any }],'
  + ' return: { type: boolean } }] })';

test('a signature carries and reflects its declared narrowings', () => {
  expect(evaluated(`const G = ${guard};`
    + ' Object.keys(Reflect.getReflection(G).signatures[0]).join(",");')).toBe('parameters,return,narrows');
  expect(evaluated(`const G = ${guard};`
    + ' const n = Reflect.getReflection(G).signatures[0].narrows;'
    + ' `${n.length}:${n[0].target}`;')).toBe('1:v');
});

test('what a signature establishes is part of what it is', () => {
  // Two signatures that establish different things are different types, so a
  // program selects the behaviour by annotating with the one it wants. The
  // interning compares types with SameType rather than by the order key, so
  // both had to learn the field or the two collapsed into one record.
  expect(evaluated(`String(${guard} !== ${plain});`)).toBe('true');
  expect(evaluated(`String(${guard} === ${guard});`)).toBe('true');
});

test('a narrowing is refused where nothing could consume it', () => {
  // "Where the [[Return]] is any other type, a non-empty [[Narrows]] is a type
  // error: nothing would consume it." Only `boolean` and ~void~ have a reading.
  expect(evaluated('let m = "accepted";'
    + ' try { Reflect.makeType({ kind: "function", signatures: [{ parameters: [{ name: "v", type: any }],'
    + ' return: { type: uint8 }, narrows: [{ target: "v", type: uint8 }] }] }); }'
    + ' catch (e) { m = e.constructor.name; } m;')).toBe('TypeError');
  // A ~void~ return is the other admitted form: "the call establishes its
  // narrowings by returning at all".
  expect(evaluated('const A = Reflect.makeType({ kind: "function", signatures: [{ parameters: [{ name: "v", type: any }],'
    + ' narrows: [{ target: "v", type: uint8 }] }] });'
    + ' String(Reflect.getReflection(A).signatures[0].narrows.length);')).toBe('1');
});
