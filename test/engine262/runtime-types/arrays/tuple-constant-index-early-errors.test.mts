import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, ok } from '../harness.mts';

test.each([
  'function unused(t: [uint8], i: 0) { t[i](); }',
  'function unused(t: [uint8]) { const i = 0; t[i](); }',
  'function unused(t: [uint8]) { const i = 1 - 1; t[i] = "bad"; }',
  'function unused(t: [uint8]) { const i = 0; let s: string = t[(i)]; }',
  'function unused(t: [uint8]) { const i = 0; let ref p = t[i]; p = "bad"; }',
  'type Fn = (x: uint8) => void; function unused(t: [Fn], i: 0) { t[i]("bad"); }',
  'function unused(t: [uint8]) { const i = 1; t[i]; }',
  'function unused(t: [uint8], i: 1) { t[i]; }',
  'function unused(t: [uint8]) { const i = -1; t[i]; }',
  'function unused(t: [uint8], i: 0.5) { t[i]; }',
  'function unused(t: [uint8]) { const i = 0.5; t[i]; }',
  'function unused(t: [uint8], i: 18446744073709551615n) { t[i]; }',
  'function unused(t: [uint8]) { const i = 18446744073709551615; t[i]; }',
  'function unused(t: [uint8, ...[].<string>], i: 0) { t[i](); }',
])('a proven tuple key retains its position contract: %s', expectStaticTypeError);

test('valid updates and callable positions execute through constant keys', () => {
  expect(evaluated('function f(t: [uint8]) { const i = 0; t[i]++; return String(t[i]); } f([1]);')).toBe('2');
  expect(evaluated('function f(t: [() => uint8], i: 0) { return String(t[i]()); } f([() => uint8(1)], 0);')).toBe('1');
});

test('shadowing and explicit any do not inherit a constant key fact', () => {
  expect(ok('function f(t: [uint8]) { const i = 0; { let i: any = "toString"; t[i](); } } f([1]);')).toBe(true);
  expect(ok('function unused(t: [uint8]) { const i: any = 0; t[i](); }')).toBe(true);
  expect(ok('const i = 0; function unused(t: [uint8]) { { t[i](); let i: any = "toString"; } }')).toBe(true);
  expect(ok('function unused(t: [uint8], i: uint64) { t[i](); }')).toBe(true);
});

test('uncertain default/rest positions and general runtime indexing remain deferred', () => {
  expect(ok('function unused(t: [uint8 = 0], i: 0) { t[i](); }')).toBe(true);
  expect(ok('function unused(t: [uint8, ...[].<string>], i: 1) { t[i](); }')).toBe(true);
  expect(evaluated('function f(t: [uint8], i: uint64) { return String(t[i]); } f([1], 1);')).toBe('undefined');
});
