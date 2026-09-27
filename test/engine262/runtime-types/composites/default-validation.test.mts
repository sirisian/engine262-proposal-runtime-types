import { expect, test } from 'vitest';
import { evaluated, expectEarlyError } from '../harness.mts';

test("closed defaults are checked without an instance", () => {
  expectEarlyError("type T={x?:uint8=\"bad\"};", "StaticTypeError");
  expectEarlyError("type T=[uint8=\"bad\"];", "StaticTypeError");
  expectEarlyError("type T=[uint8=300];", "StaticTypeError");
  expectEarlyError("type N=uint8;type T=[N=\"bad\"];", "StaticTypeError");
  expectEarlyError("function f(x:[uint8=\"bad\"]){}", "StaticTypeError");
  expectEarlyError("type T = { outer?: [uint8 = \"bad\"] = [] };", "StaticTypeError");
  expectEarlyError("interface I { x?: uint8 = \"bad\"; }", "StaticTypeError");
});

test("specialization closes dependent default obligations", () => {
  expectEarlyError("type T<X:type>=[X=\"bad\"];type A=T.<uint8>;", "StaticTypeError");
  expectEarlyError("type T<X: type> = { x?: X = \"bad\" }; type A = T.<uint8>;", "StaticTypeError");
});

test("valid defaults and open generic defaults remain usable", () => {
  expect(evaluated("type T=[uint8=2];let t:T=[];String(t[0]);; \"ok\";")).toBe("ok");
  expect(evaluated("type T<X: type> = [X = \"bad\"];; \"ok\";")).toBe("ok");
  expect(evaluated("type T<X: type> = [X = 2]; type A = T.<uint8>; let a: A = [];; \"ok\";")).toBe("ok");
  expect(evaluated("type T = { x?: uint8 = 2 }; let a: T = {};; \"ok\";")).toBe("ok");
});

test('closed generic default expressions use the bound type environment', () => {
  expect(evaluated('type T<X:type> = [uint8 = X(2)]; "ok";')).toBe('ok');
  expectEarlyError('type T<X:type> = [X = X("bad")]; type A = T.<uint8>;', 'StaticTypeError');
  expect(evaluated('type T<X:type> = [X = X(2)]; type A = T.<uint8>; let a:A=[]; String(a[0]);')).toBe('2');
});

test('reflection and identity use the converted closed default', () => {
  expect(evaluated('type T = { x?: uint8 = 2 }; String(Reflect.typeOf(Reflect.getReflection(T).properties[0].initial) === uint8);')).toBe('true');
  expect(evaluated('interface I { x?: uint8 = 2; } String(Reflect.typeOf(Composite.<I>({}).x) === uint8);')).toBe('true');
  expect(evaluated('type A = [uint8 = 2]; type B = [uint8 = uint8(2)]; String(A === B);')).toBe('true');
  expect(evaluated('type A = { x?: uint8 = 2 }; type B = { x?: uint8 = uint8(2) }; String(A === B);')).toBe('true');
});
