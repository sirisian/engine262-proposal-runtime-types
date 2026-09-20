import { expect, test } from 'vitest';
import { expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test.each([
  'function unused(o: { x: uint8, a: string } | { x: uint8, b: string }) { delete o.x; }',
  'class A { x: uint8 = 1; a: string = "a"; } class B { x: uint8 = 1; b: string = "b"; } function unused(o: A | B) { delete o.x; }',
  'function unused(o: { [Symbol.dispose]: uint8, a: string } | { [Symbol.dispose]: uint8, b: string }) { delete o[Symbol.dispose]; }',
  'function unused(o: [2].<uint8> | [3].<uint8>) { delete o[0]; }',
  'function unused(o: [uint8] | [uint8, string]) { delete o[(0)]; }',
  'const K = "0"; function unused(o: [2].<uint8> | [3].<uint8>) { delete (o[K]); }',
  'function unused(o: { x: uint8, a: string } | { x: uint8, b: string } | null) { delete o?.x; }',
  'function unused(o: { x?: uint8, a: string } | { x?: uint8, b: string }) { delete o.x; }',
])('rejects a union whose executing arms all protect the storage: %s', expectStaticTypeError);

test.each([
  'function unused(o: { a: string } | { b: string }) { delete o.absent; }',
  'function unused(o: [2].<uint8> | [3].<uint8>) { delete o[5]; }',
  'function unused(o: [2].<uint8> | [3].<uint8>, k: any) { delete o[k]; }',
  'function unused(o: [2].<uint8> | [].<uint8>) { delete o[0]; }',
  'function unused(o: any) { delete o.x; }',
])('retains a dynamic or non-position deletion: %s', (source) => expect(ok(source)).toBe(true));

test('dynamic receivers still fail at protected storage', () => {
  expectThrownKind('class C { x: uint8 = 1; } function f(o: any) { delete o.x; } f(new C());', 'TypeError');
  expectThrownKind('let a: [2].<uint8>; function f(o: any) { delete o[0]; } f(a);', 'TypeError');
});
