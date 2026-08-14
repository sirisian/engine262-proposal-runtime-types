import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

// sec-reflection-shape-enum: the `Enum` context reports an enum's declaration.
// The design's own example reads the enumerator count off it:
//
//   Reflect.getReflection.<Reflect.Enum, Component>().size;  // 3
//
// That threw "undefined is not a type". The type-generic dispatch names NINE
// reflection contexts of the forty-five declared - `Reflect.Type` and the eight
// `Class*` ones - so `Reflect.Enum` was one of the thirty-six that fell through.
//
// The type-level `"enum"` reflection node exists as a workaround for this gap:
// with the declaration route broken, it was the only way to read an enum's
// members. It is left in place, since removing it is a separate decision and
// doing it first would make the count unreachable.

const E = 'enum Component: uint8 { A, B, C } ';

test('the design\u2019s own example runs', () => {
  expect(evaluated(`${E}String(Reflect.getReflection.<Reflect.Enum, Component>().size);`)).toBe('3');
});

test('the enum context reports its declaration', () => {
  expect(evaluated(`${E}String(Reflect.getReflection.<Reflect.Enum, Component>().kind);`)).toBe('Enum');
  expect(evaluated(`${E}String(Reflect.getReflection.<Reflect.Enum, Component>().name);`)).toBe('Component');
  // `valueType` is the Type Object of the underlying type, so it reflects in turn.
  expect(evaluated(`${E}const v = Reflect.getReflection.<Reflect.Enum, Component>().valueType; String(Reflect.getReflection(v).kind);`)).toBe('primitive');
  // A string-based enum counts the same way.
  expect(evaluated('enum S: string { X = "a", Y = "b" } String(Reflect.getReflection.<Reflect.Enum, S>().size);')).toBe('2');
});

test('a non-enum target is refused', () => {
  expectThrown('class K { } Reflect.getReflection.<Reflect.Enum, K>();');
});

test('the routes that already worked still do', () => {
  // The class family, which was the only family implemented.
  expect(evaluated('class K { } String(Reflect.getReflection.<Reflect.Class, K>().kind);')).toBe('Class');
  expect(evaluated('class K { x: uint8 = 1; } String(typeof Reflect.getReflection.<Reflect.ClassField, K>("x"));')).toBe('object');
  // And the type-level node, the workaround this does not yet remove.
  expect(evaluated(`${E}String(Reflect.getReflection(Component).kind);`)).toBe('enum');
});
