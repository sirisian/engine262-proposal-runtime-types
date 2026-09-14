import { expect, test } from 'vitest';
import { evaluated, expectEarlyError, settledAfterJobs } from '../harness.mts';

test.each([
  'm(x: uint8): uint8 { return x; }',
  '*m(x: uint8): uint8 { yield x; }',
  'async m(x: uint8): Promise.<uint8, any> { return x; }',
  'async *m(x: uint8): uint8 { yield x; }',
])('all method forms expose declared arguments: %s', (method) => {
  expectEarlyError(`class C { ${method} } function unused(c: C) { c.m("s"); }`, 'StaticTypeError');
  expectEarlyError(`function unused() { ({ ${method} }).m("s"); }`, 'StaticTypeError');
  expect(evaluated(`const c = { ${method} }; c.m(1); "ok";`)).toBe('ok');
  expect(evaluated(`class C { ${method} } const c: C = new C(); c.m(1); "ok";`)).toBe('ok');
});

test('static and private resumable methods expose signatures', () => {
  expectEarlyError('class C { static *m(x: uint8): uint8 { yield x; } } function unused() { C.m("s"); }', 'StaticTypeError');
  expectEarlyError('class C { *#m(x: uint8): uint8 { yield x; } f() { this.#m("s"); } }', 'StaticTypeError');
  expectEarlyError('class C { *m(): uint8 { yield 1; } } function unused(c: C) { const x: string = c.m(); }', 'StaticTypeError');
});

test.each([
  'let c: {m: () => string} = {m(): uint8 { return 1; }};',
  'let c: {m: (x: uint8) => uint8} = {m(x: string): uint8 { return 1; }};',
])('context cannot replace an explicit method signature: %s', (source) => {
  expectEarlyError(source, 'StaticTypeError');
  expectEarlyError(`function unused() { ${source} }`, 'StaticTypeError');
});

test('context types only unannotated method positions', () => {
  expect(evaluated('let c: {m: (x: uint8) => uint8} = {m(x) { return x; }}; String(c.m(1));')).toBe('1');
  expect(evaluated('let c: {m: (x: uint8) => uint8} = {m(x: uint8): uint8 { return x; }}; String(c.m(1));')).toBe('1');
  expectEarlyError('let c: {m: () => uint8} = {m() { return "s"; }};', 'StaticTypeError');
});

test('inferred generator methods preserve their completed result', () => {
  for (const owner of ['const c = { *m(x: uint8) { yield x; return "done"; } };',
    'class C { *m(x: uint8) { yield x; return "done"; } } const c: C = new C();']) {
    expect(evaluated(`${owner} const g = c.m(1); g.next(); g.next().value;`)).toBe('done');
  }
  expect(settledAfterJobs('globalThis.settled = "pending"; const c = { async *m(x: uint8) { yield x; return "done"; } }; const g = c.m(1); g.next().then(() => g.next()).then(r => { globalThis.settled = r.value; }, e => { globalThis.settled = String(e); });')).toBe('done');
});
