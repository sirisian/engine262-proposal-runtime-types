import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

// sec-reflection-shape-function: the Function family. Three more of the contexts
// that answered nothing, found and told apart by their ERROR SHAPES:
// `Function` and `FunctionReturn` gave "undefined is not a type" - never
// dispatched - while `FunctionParameter` gave `"a" is not a type`, reaching a
// path that resolved its NAME argument as a type.
//
// The target is a function TYPE, not a function's name: a function declaration
// introduces no type name, so `let g: f = f` is itself an error. A first attempt
// passed `f` and failed for that reason rather than any fault in the branch.

const F = 'type F = (a: uint8, b: string) => uint8; ';

test('the Function context reports the type', () => {
  expect(evaluated(`${F}Object.keys(Reflect.getReflection.<Reflect.Function, F>()).join(",");`)).toBe('kind,type,signatures');
});

test('FunctionParameter reports name, index, and type', () => {
  expect(evaluated(`${F}const p = Reflect.getReflection.<Reflect.FunctionParameter, F>("a"); String(p.name) + "/" + String(p.index);`)).toBe('a/0');
  expect(evaluated(`${F}const p = Reflect.getReflection.<Reflect.FunctionParameter, F>("b"); String(p.name) + "/" + String(p.index);`)).toBe('b/1');
  // The reported type is a Type Object, so it reflects in turn.
  expect(evaluated(`${F}const p = Reflect.getReflection.<Reflect.FunctionParameter, F>("b"); String(Reflect.getReflection(p.type).kind);`)).toBe('primitive');
});

test('FunctionReturn reports the return type', () => {
  expect(evaluated(`${F}const r = Reflect.getReflection.<Reflect.FunctionReturn, F>(); String(Reflect.getReflection(r.type).kind);`)).toBe('primitive');
});

test('wrong targets are refused rather than answering nothing', () => {
  expectThrown(`${F}Reflect.getReflection.<Reflect.FunctionParameter, F>("zz");`);
  expectThrown('class K { } Reflect.getReflection.<Reflect.Function, K>();');
});

test('the contexts already implemented still answer', () => {
  expect(evaluated('class K { } String(Reflect.getReflection.<Reflect.Class, K>().kind);')).toBe('Class');
  expect(evaluated('enum E: uint8 { A } String(Reflect.getReflection.<Reflect.Enum, E>().size);')).toBe('1');
});
