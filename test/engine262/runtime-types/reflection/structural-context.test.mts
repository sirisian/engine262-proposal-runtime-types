import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

// sec-reflection-contexts, the Structural family: `Tuple` and `Record` reflect
// "a tuple or record declaration", so they take the TYPE as the second type
// argument - the Class family's spelling, not the Object family's instance one.
//
// Both name a set of members, and the clause says such a context "has two
// signatures: one taking no name, returning an object keyed by name" - the same
// pair `EnumEnumerator` has. That sentence is the general rule those two
// contexts were the first instances of.

const T = 'type T = [uint8, string]; ';
const R = 'type R = { a: uint8, b: string }; ';

test('Tuple reflects its elements, keyed by index', () => {
  expect(evaluated(`${T}Object.keys(Reflect.getReflection.<Reflect.Tuple, T>()).join(",");`)).toBe('0,1');
  expect(evaluated(`${T}const m = Reflect.getReflection.<Reflect.Tuple, T>("1"); String(m.index);`)).toBe('1');
  // The reported type is a Type Object and reflects in turn.
  expect(evaluated(`${T}const m = Reflect.getReflection.<Reflect.Tuple, T>("1"); String(Reflect.getReflection(m.type).kind);`)).toBe('primitive');
});

test('Record reflects its properties, keyed by name', () => {
  expect(evaluated(`${R}Object.keys(Reflect.getReflection.<Reflect.Record, R>()).join(",");`)).toBe('a,b');
  expect(evaluated(`${R}const m = Reflect.getReflection.<Reflect.Record, R>("b"); String(m.name) + "/" + String(m.index);`)).toBe('b/1');
  expect(evaluated(`${R}const m = Reflect.getReflection.<Reflect.Record, R>("a"); String(Reflect.getReflection(m.type).kind);`)).toBe('primitive');
});

test('the wrong member or the wrong kind is refused', () => {
  expectThrown(`${R}Reflect.getReflection.<Reflect.Record, R>("zz");`);
  // A tuple asked for as a record must fail rather than answer about its
  // elements - the discriminating case, since both are "a set of members".
  expectThrown(`${T}Reflect.getReflection.<Reflect.Record, T>();`);
});
