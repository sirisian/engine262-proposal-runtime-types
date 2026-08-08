import { test, expect } from 'vitest';
import { evaluated, ok } from '../harness.mts';

/**
 * PLAN-rest-parameters.md phase 0: a signature's parameters are RECORDS.
 *
 * #sec-signature-records: "A Parameter Record has a [[Name]], a [[Type]], an
 * [[Optional]] field, a [[Rest]] field, an [[Initial]] field, and a
 * [[Reference]] field." The engine's `SignatureRecord.Parameters` was a bare
 * `TypeRecord[]`, so the half of the engine that interns, relates, and reflects
 * types could not say a parameter was a rest, was optional, or had a name.
 *
 * The information lived in two other places instead, in neither of which the
 * type system could see it: `OverloadParameter` carried Type/Optional/Rest for
 * resolution, and the checker carried a PARALLEL `Shapes` array beside each
 * signature's type list. Three representations of one thing, which is how they
 * came to disagree. Phase 0 collapses them into one.
 *
 * The consequence this file pins is IDENTITY. Types are interned by a canonical
 * order key, and that key was built from the parameter TYPES alone - so two
 * signatures differing only in a rest, or only in an optional marker, produced
 * the same key and interned as ONE Type Object. Every later phase of the plan
 * would have been built on a model that could not tell its own cases apart.
 */

test('a rest parameter is part of a function type\'s IDENTITY', () => {
  // The whole point: these are different types, and were one Type Object.
  expect(evaluated(`
    type A = (...[].<uint8>) => void;
    type B = ([].<uint8>) => void;
    String(A === B);
  `)).toBe('false');

  // Interning still works: the same shape written twice is one object, which is
  // what makes the assertion above a distinction rather than a broken key.
  expect(evaluated(`
    type A = (...[].<uint8>) => void;
    type B = (...[].<uint8>) => void;
    String(A === B);
  `)).toBe('true');
});

test('an optional marker is part of a function type\'s identity', () => {
  expect(evaluated(`
    type A = (a?: uint8) => void;
    type B = (a: uint8) => void;
    String(A === B);
  `)).toBe('false');
});

test('a rest parameter in a function type keeps its declared type', () => {
  // A rest is the UNNAMED parameter form, storing its type in [[Type]] rather
  // than behind a [[TypeAnnotation]]. Reading only the annotation left the type
  // `any`, which made every typed rest in a function type indistinguishable
  // from every other - a second way for two types to collapse into one.
  expect(evaluated(`
    type A = (...[].<uint8>) => void;
    type B = (...[].<string>) => void;
    String(A === B);
  `)).toBe('false');
});

test('a parameter\'s name does not affect identity', () => {
  // #sec-signature-records: "A parameter's name is carried because the design's
  // named arguments select by it, and is not part of the signature's identity."
  // The record now carries [[Name]], so this is worth pinning: carrying it must
  // not have made two spellings of one signature into two types.
  expect(evaluated(`
    type A = (a: uint8) => void;
    type B = (b: uint8) => void;
    String(A === B);
  `)).toBe('true');
});

test('existing signature behaviour is unchanged by the model change', () => {
  // Phase 0 has no behaviour of its own; these are the surfaces that read a
  // parameter list, asserted so a regression in the refactor shows up here
  // rather than in a later phase's failure.
  expect(ok('function f(a: uint8) { return a; } f(1);')).toBe(true);
  expect(ok('function f(a: uint8, b: string = "b") { return b; } f(1);')).toBe(true);
  expect(ok('function f(a?: uint8) { return a; } f();')).toBe(true);
  expect(evaluated('function f(a: uint8, b: uint8) { return a + b; } String(f(1, 2));')).toBe('3');

  // Overload resolution reads the same records now; both rows must still be
  // reachable, which is what tells us the Shapes sidecar was removed without
  // losing what it carried.
  expect(evaluated(`
    function g(a: uint8): string { return "int"; }
    function g(a: string): string { return "str"; }
    g(1) + g("x");
  `)).toBe('intstr');

  // A defaulted parameter is an OPTIONAL one now (HasDefault was folded into
  // Optional per the clause), so a signature's minimum arity must not have
  // changed: the call below supplies neither optional argument.
  expect(evaluated(`
    function h(a: uint8, b: uint8 = 2, c?: uint8): uint8 { return a + b; }
    String(h(1));
  `)).toBe('3');
});

test('a rest parameter is reported by reflection', () => {
  // typeprogramming.md R1 asks for `rest` on a parameter record; phase 0 is
  // what gives the reflection write path something to report it from.
  expect(evaluated(`
    type A = (...[].<uint8>) => void;
    const node = Reflect.getReflection.<Reflect.Type>(A);
    String(node.signatures[0].parameters[0].rest);
  `)).toBe('true');
  expect(evaluated(`
    type A = ([].<uint8>) => void;
    const node = Reflect.getReflection.<Reflect.Type>(A);
    String(node.signatures[0].parameters[0].rest);
  `)).toBe('false');
});
