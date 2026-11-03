import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

test.each(['type', 'Reflect.TypeObject'])('%s accepts a result declared with either denotation domain', (domain) => {
  expect(evaluated(`function fromType(x: type): type { return x; }
    function fromReflection(x: Reflect.TypeObject): Reflect.TypeObject { return x; }
    const a: ${domain} = fromType(uint8);
    const b: ${domain} = fromReflection(string);
    String(a === uint8) + String(b === string);`)).toBe('truetrue');
});

test('Reflect.typeOf can feed a type builder without an any escape', () => {
  expect(evaluated(`function identity(T: type): type { return T; }
    function source(x: string): uint8 { return 1; }
    String(identity(Reflect.typeOf(source)) === type (string) => uint8);`)).toBe('true');
});

test('the domains are mutually assignable while their reflected records stay distinct', () => {
  expect(evaluated(`String(Reflect.isAssignable(type, Reflect.TypeObject))
    + String(Reflect.isAssignable(Reflect.TypeObject, type))
    + String(type === Reflect.TypeObject);`)).toBe('truetruefalse');
});

test.each(['type & Reflect.TypeObject', 'Reflect.TypeObject & type', 'type | Reflect.TypeObject', 'Reflect.TypeObject | type'])('the composition %s retains denotations', (composition) => {
  expect(evaluated(`type Both = ${composition}; const value: Both = uint8;
    String(value === uint8);`)).toBe('true');
});

test.each(['type', 'Reflect.TypeObject'])('%s can overlap an object contract', (domain) => {
  expect(evaluated(`type Both = ${domain} & {}; const value: Both = uint8;
    String(value === uint8);`)).toBe('true');
});

test('associated constructors survive both directions unchanged', () => {
  expect(evaluated(`class C {} function first(T: type): Reflect.TypeObject { return T; }
    function second(T: Reflect.TypeObject): type { return T; }
    String(second(first(C)) === C) + '/' + typeof second(first(C));`)).toBe('true/function');
});

test.each(['1', '"type"'])('a non-denotation %s is not admitted by equivalence', (value) => {
  expectStaticTypeError(`function f(T: type) {} f(${value});`);
});

test('a reflection node remains outside both domains', () => {
  expect(evaluated('const node = Reflect.getReflection(uint8); String(node is type) + String(node is Reflect.TypeObject);')).toBe('falsefalse');
});
