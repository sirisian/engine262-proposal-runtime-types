import { expect, test } from 'vitest';
import { evaluated, expectThrownKind, expectStaticTypeError, ok } from '../harness.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion } from '#self';

// #sec-layout-properties

test("rejects uint8.byteLength = 9;", () => {
  expectStaticTypeError("uint8.byteLength = 9;");
});

test("rejects uint8.alignment = 9;", () => {
  expectStaticTypeError("uint8.alignment = 9;");
});

test("rejects uint8.byteLength++;", () => {
  expectStaticTypeError("uint8.byteLength++;");
});

test("rejects type T = uint8; T.byteLength = 9;", () => {
  expectStaticTypeError("type T = uint8; T.byteLength = 9;");
});


test("accepts uint8.byteLength;", () => {
  expect(ok("uint8.byteLength;")).toBe(true);
});


test.each([
  ['primitive', '', 'uint8', '1'],
  ['enum', 'enum E:uint8 { A }', 'E', '1'],
  ['vector', '', 'float32x4', '16'],
  ['fixed array type', 'type A=[2].<uint8>;', 'A', '2'],
  ['fixed array constructor', '', '([2].<uint8>)', '2'],
  ['class', 'class C {x:uint8;}', 'C', '1'],
  ['generic class specialization', 'class C<T:type> {x:T;}', 'C.<uint8>', '1'],
])('%s exposes fixed own layout data', (_name, declaration, type, size) => {
  expect(evaluated(`${declaration}
    const T=${type};
    const b=Object.getOwnPropertyDescriptor(T,"byteLength");
    const a=Object.getOwnPropertyDescriptor(T,"alignment");
    const n=Object.getOwnPropertyDescriptor(T,"bitLength");
    String(b.value)+":"+String(b.writable || b.enumerable || b.configurable || a.writable || a.enumerable || a.configurable || n.writable || n.enumerable || n.configurable);
  `)).toBe(`${size}:false`);
});

test('fixed constants cannot be shadowed by a new own descriptor', () => {
  expect(evaluated('String(Reflect.defineProperty(uint8,"byteLength",{value:9}));')).toBe('false');
  expectThrownKind('Object.defineProperty(uint8,"byteLength",{value:9});', 'TypeError');
});

test('a meta-type alias retains fixed layout permissions', () => {
  expectStaticTypeError('const T:type=uint8;T.byteLength=2;');
});

test('logical assignment skips a store to an existing nonzero constant', () => {
  expect(ok('uint8.byteLength ||= 9;uint8.byteLength ??= 9;')).toBe(true);
});

test('a conflicting static declaration cannot replace layout data', () => {
  expectThrownKind('class C {x:uint8;static byteLength=7;}', 'TypeError');
});

test('a prototype setter does not intercept fixed own layout data', () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger('globalThis.changed=false;Object.defineProperty(Object.getPrototypeOf(uint8),"byteLength",{set(v){globalThis.changed=true;},configurable:true});')).Type).toBe('normal');
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger('const T:any=uint8;Reflect.set(T,"byteLength",9);')).Type).toBe('normal');
  expect((EnsureCompletion(realm.evaluateScriptSkipDebugger('String(globalThis.changed);')).Value as { stringValue(): string }).stringValue()).toBe('false');
});

test.each([
  'let ref r=uint8.byteLength;r=1;',
  '(type uint8).byteLength=1;',
  '([2].<uint8>).byteLength=1;',
  'class C{x:uint8;}C.byteLength=1;',
])('preserves fixed layout permission: %s', (source) => {
  expectStaticTypeError(source);
});
