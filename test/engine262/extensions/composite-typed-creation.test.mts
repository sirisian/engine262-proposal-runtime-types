import { test, expect } from 'vitest';
import { evaluated } from '../readme/harness.mts';

/**
 * PLAN-composites.md phase four: `Composite.<T>(source)`.
 *
 * `sec-composite-typeobject-call`: "Calling the Type Object of a composite type
 * over a shape S ... returns the result of CompositeFromShape(S, source). This
 * is the CONSTRUCTION BOUNDARY of the composite types, as calling any
 * parameterized Type Object is its type's." Each supplied value is CONVERTED to
 * its member's type, a required absence throws, an undeclared property throws,
 * and an optional member's declared default is FILLED - all before
 * canonicalization and interning.
 */

const outcome = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);

test('the type argument TYPES the fields, which is the whole point', () => {
  expect(evaluated('interface I { x: uint8 } String(Reflect.typeOf(Composite.<I>({ x: 1 }).x) === (type uint8));')).toBe('true');
  // THE ASSERTION THAT MATTERS is the pair: the typed creation interns with the
  // explicitly-typed bare call and NOT with the untyped one. Either alone would
  // pass with the type argument ignored.
  expect(evaluated('interface I { x: uint8 } String(Composite.<I>({ x: 1 }) === Composite({ x: uint8(1) }));')).toBe('true');
  expect(evaluated('interface I { x: uint8 } String(Composite.<I>({ x: 1 }) === Composite({ x: 1 }));')).toBe('false');
});

test('the design\'s CACHE KEY example, which is what the boundary is for', () => {
  // "A typed producer and an untyped consumer do not meet ... the mitigation is
  // that the boundary is exactly where this proposal already puts annotations:
  // give the key a named shape and create it through that shape on both sides."
  const decl = 'interface CacheKey { id: uint32; page: uint8 } const cache = new Map(); ';
  expect(evaluated(`${decl} cache.set(Composite.<CacheKey>({ id: 7, page: 2 }), "results"); `
    + 'String(cache.get(Composite.<CacheKey>({ id: 7, page: 2 })));')).toBe('results');
  // And the SILENT MISS the design names, pinned so the hazard is documented
  // rather than only its fix.
  expect(evaluated(`${decl} cache.set(Composite.<CacheKey>({ id: 7, page: 2 }), "results"); `
    + 'String(cache.get(Composite({ id: 7, page: 2 })));')).toBe('undefined');
});

test('an optional member\'s default is filled AT CREATION', () => {
  // "A default belongs to construction ... For a composite the default is
  // written BEFORE FREEZING, so it is part of the contents that intern, and the
  // two spellings of one key stay together."
  const K = 'interface K { id: uint32; page?: uint8 = 0 } ';
  expect(evaluated(`${K} String(Composite.<K>({ id: 7 }).page);`)).toBe('0');
  expect(evaluated(`${K} String(Composite.<K>({ id: 7 }) === Composite.<K>({ id: 7, page: 0 }));`)).toBe('true');
  // The default is CONVERTED to the member's type like any supplied value -
  // filling the raw default stored a Number where the explicit spelling stored
  // a `uint8`, so the two did not intern, which is the property the design's
  // own example asserts.
  expect(evaluated(`${K} String(Reflect.typeOf(Composite.<K>({ id: 7 }).page) === (type uint8));`)).toBe('true');
  expect(evaluated(`${K} String(Composite.<K>({ id: 7, page: 5 }).page);`)).toBe('5');
  // An optional member with NO default stays absent - "an optional member is
  // optional", and a check of a value that exists writes nothing.
  expect(evaluated('interface K2 { id: uint32; page?: uint8 } String("page" in Composite.<K2>({ id: 7 }));')).toBe('false');
});

test('a required absence and an undeclared property throw', () => {
  expect(outcome('interface I { x: uint8 } Composite.<I>({});')).toBe('TypeError');
  expect(outcome('interface I { x: uint8 } Composite.<I>({ x: 1, y: 2 });')).toBe('TypeError');
  expect(outcome('interface I { x: uint8 } Composite.<I>(1);')).toBe('TypeError');
});

test('PINNED: the TUPLE half of typed creation waits for the tuple kind', () => {
  // `CompositeFromShape` branches on the shape's kind, and the tuple branch
  // needs `FindOrCreateTupleComposite` - phase five.
  expect(outcome('type T = [uint8, uint8]; Composite.<T>([1, 2]);')).toBe('TypeError');
});
