// spec.emu reflection: a generic signature reflects its type parameters - the declared data of the
// Type Parameter Record, in declaration order - and displays its list.
import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

test('a generic function type reflects name, kind, variadic, variance, arity (K1, K2)', () => {
  const F = 'type F = <T, out U, ...I: [].<uint32>>(x: T) => T;';
  expect(evaluated(`${F} String(Reflect.getReflection(F).signatures[0].typeParameters.map((t) => t.name + ":" + t.kind + ":" + t.variadic + ":" + t.variance).join(","));`))
    .toBe('T:type:false:invariant,U:type:false:covariant,I:value:true:invariant');
  expect(evaluated(`${F} String(Reflect.getReflection(F).signatures[0].typeParameters[2].arity);`)).toBe('0');
});

test('a concrete signature reflects no typeParameters property (K3)', () => {
  expect(evaluated('type G = (x: uint8) => uint8; String(Reflect.getReflection(G).signatures[0].typeParameters);')).toBe('undefined');
});

test('displayType prints the type parameter list and the pack marker', () => {
  expect(evaluated('type Id = <T>(x: T) => T; String(Id);')).toBe('<T>(x: T) => T');
  expect(evaluated('function count<...Ts>(...xs: Ts): uint32 { return 1; } String(Reflect.typeOf(count));')).toBe('<...Ts>(...xs: Ts) => uint.<32>');
  expect(evaluated('function id<T>(x: T): T { return x; } String(Reflect.typeOf(id));')).toBe('<T>(x: T) => T');
});
