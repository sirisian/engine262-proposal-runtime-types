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

// The accessor and method members of the same family. They read the same
// instance the field member does, differing in WHICH property they expect and
// what they report of it: an accessor's `type` is its function type, which the
// shape clause calls "the getter's function type".

const A = 'const o = { get g() { return 1; }, set s(v) { }, m(a) { return a; }, f: 1 }; ';

test('accessors and methods reflect', () => {
  expect(evaluated(`${A}const r = Reflect.getReflection.<Reflect.ObjectGetter>(o, "g"); String(r.kind) + "/" + String(r.name);`)).toBe('ObjectGetter/g');
  expect(evaluated(`${A}const r = Reflect.getReflection.<Reflect.ObjectSetter>(o, "s"); String(r.kind) + "/" + String(r.name);`)).toBe('ObjectSetter/s');
  expect(evaluated(`${A}String(Reflect.getReflection.<Reflect.ObjectMethod>(o, "m").kind);`)).toBe('ObjectMethod');
  expect(evaluated(`${A}String(Reflect.getReflection.<Reflect.ObjectGetterReturn>(o, "g").kind);`)).toBe('ObjectGetterReturn');
  // The reported type is a Type Object and reflects in turn.
  expect(evaluated(`${A}const r = Reflect.getReflection.<Reflect.ObjectGetter>(o, "g"); String(Reflect.getReflection(r.type).kind);`)).toBe('object');
});

test('a member of the wrong kind is refused', () => {
  // The discriminating case: `f` exists but is a data property, so asking for it
  // as a getter must fail rather than answering about the value.
  expectThrown(`${A}Reflect.getReflection.<Reflect.ObjectGetter>(o, "f");`);
  expectThrown(`${A}Reflect.getReflection.<Reflect.ObjectSetter>(o, "zz");`);
});
