import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion } from '#self';

// #sec-function-types

test("rejects new uint8(1);", () => {
  expectStaticTypeError("new uint8(1);");
});

test("rejects type T = uint8; new T(1);", () => {
  expectStaticTypeError("type T = uint8; new T(1);");
});

test("rejects new Composite.<[uint8]>([1]);", () => {
  expectStaticTypeError("new Composite.<[uint8]>([1]);");
});

test("rejects Reflect.construct(uint8, [1]);", () => {
  expectStaticTypeError("Reflect.construct(uint8, [1]);");
});

test("accepts uint8(1);", () => {
  expect(ok("uint8(1);")).toBe(true);
});

test("accepts class C {} new C();", () => {
  expect(ok("class C {} new C();")).toBe(true);
});

test("accepts class C {} const T = C; new T();", () => {
  expect(ok("class C {} const T = C; new T();")).toBe(true);
});

test("accepts function f(T: any) { new T(1); }", () => {
  expect(ok("function f(T: any) { new T(1); }")).toBe(true);
});

test("accepts class C {} const T: type = C; new T();", () => {
  expect(ok("class C {} const T: type = C; new T();")).toBe(true);
});


test('a meta-type alias preserves a known conversion-only origin', () => {
  expectStaticTypeError('const T:type=uint8;new T(1);');
});

test('an earlier script may replace a builtin type name with a class', () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger('globalThis.uint8=class {};')).Type).toBe('normal');
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger('new uint8();')).Type).toBe('normal');
});

test('explicit array constructors keep construction capability', () => {
  expect(ok('new [2].<uint8>();')).toBe(true);
});

test('a replaced reflective helper can change a later constructor lookup', () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger('Reflect.construct=function(){globalThis.uint8=class {};};')).Type).toBe('normal');
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger('Reflect.construct(uint8,[]);new uint8();')).Type).toBe('normal');
});
