import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

// sec-reflection-shape-object: the Object family is reached FROM AN INSTANCE,
// not from a declaration -
//
//   Reflect.getReflection.<Reflect.ObjectField>(instance, name)
//
// takes the object itself where the Class family takes the class, "because an
// object literal has no declaration a second evaluation of it would share".
//
// So it has ONE type argument, and the reflection dispatch required TWO. These
// contexts never reached it, and their error was a THIRD shape - "[object
// Object] is not a type", the instance being resolved as a type argument -
// distinct from the two the Function family showed.
//
// The target spelling differs by family, and reading the shape clause is the
// only reliable way to know it: the Class family takes a name, the Function
// family takes a TYPE (a function declaration introduces no type name), and this
// one takes a value.

const O = 'const o = { a: 1, b: "s" }; ';

test('the Object context reflects an instance', () => {
  expect(evaluated(`${O}Object.keys(Reflect.getReflection.<Reflect.Object>(o)).join(",");`)).toBe('kind,type');
});

test('ObjectField reflects a named field', () => {
  expect(evaluated(`${O}String(Reflect.getReflection.<Reflect.ObjectField>(o, "a").name);`)).toBe('a');
  expect(evaluated(`${O}String(Reflect.getReflection.<Reflect.ObjectField>(o, "b").name);`)).toBe('b');
  // The reported type is a Type Object, so it reflects in turn.
  expect(evaluated(`${O}const f = Reflect.getReflection.<Reflect.ObjectField>(o, "a"); String(Reflect.getReflection(f.type).kind);`)).toBe('primitive');
});

test('wrong targets are refused', () => {
  expectThrown(`${O}Reflect.getReflection.<Reflect.ObjectField>(o, "zz");`);
  expectThrown('Reflect.getReflection.<Reflect.Object>(42);');
});

test('the families already implemented still answer', () => {
  expect(evaluated('class K { } String(Reflect.getReflection.<Reflect.Class, K>().kind);')).toBe('Class');
  expect(evaluated('type F = (a: uint8) => uint8; String(Reflect.getReflection.<Reflect.Function, F>().kind);')).toBe('Function');
  expect(evaluated('enum E: uint8 { A } String(Reflect.getReflection.<Reflect.Enum, E>().size);')).toBe('1');
});
