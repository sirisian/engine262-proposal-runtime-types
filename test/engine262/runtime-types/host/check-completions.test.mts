import { expect, test } from 'vitest';
import { expectEarlyError, expectStaticTypeError, ok, settledAfterJobs } from '../harness.mts';

test.each([
  'function f(): uint8 { return; }',
  'async function f(): Promise.<uint8, Error> { return; }',
  'function* f(): Generator.<uint8, uint8, void> { return; }',
  'async function* f(): AsyncGenerator.<uint8, uint8, void> { return; }',
  'class C { get x(): uint8 { return; } }',
  'function* f(): uint8 { yield "s"; }',
  'async function* f(): uint8 { yield "s"; }',
  'function* g(): string { yield "s"; } function* f(): uint8 { yield* g(); }',
  'class C { operator+(rhs: C): uint8 { return "s"; } }',
  'class C { operator+(rhs: uint8): uint8 { let s: string = rhs; return 1; } }',
])('checks the effective outward value: %s', (source) => {
  expectStaticTypeError(source);
});

test.each([
  'function f(): uint8 {}',
  'async function f(): Promise.<uint8, Error> {}',
  'function* f(): Generator.<uint8, uint8, void> {}',
  'async function* f(): AsyncGenerator.<uint8, uint8, void> {}',
])('uses the specified SyntaxError for fallthrough: %s', (source) => {
  expectEarlyError(source, 'SyntaxError');
});

test.each([
  'function f(): void { return; }',
  'function f(): uint8 | undefined { return; }',
  'async function f(): Promise.<undefined, Error> {}',
  'async function f(): Promise.<void, Error> {}',
  'function* f(): uint8 { yield 1; }',
  'function* f(): Generator.<uint8, string, void> { yield 1; return "s"; }',
  'class C { operator+(rhs: C): uint8 { return 1; } }',
  'async function f(): Promise.<uint8, Error> { throw new Error(); }',
])('accepts a compatible completion: %s', (source) => {
  expect(ok(source)).toBe(true);
});

test('an async numeric return constructs the resolution type', () => {
  expect(settledAfterJobs('async function f(): Promise.<uint8, Error> { return 1; }'
    + ' f().then(v => { globalThis.settled = String(Reflect.typeOf(v) === uint8); });')).toBe('true');
});

test.each([
  'async function f(): Promise.<uint8, Error> { return Promise.resolve((1 := uint8)); }',
  'async function* f(): uint8 { yield Promise.resolve((1 := uint8)); }',
  'async function* f(): AsyncGenerator.<uint8, uint8, void> { return Promise.resolve((1 := uint8)); }',
  'class C { x: uint8; m() { async function f() { this.x = "s"; } } }',
  'class C { x: uint8; m() { function* f() { this.x = "s"; } } }',
])('uses the effective async value and ordinary function context: %s', (source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  'async function f(): Promise.<uint8, Error> { return Promise.resolve("s"); }',
  'async function* f(): uint8 { yield Promise.resolve("s"); }',
  'class C { x: uint8; m() { const f = async () => { this.x = "s"; }; } }',
])('keeps checks at async boundaries and lexical this: %s', expectStaticTypeError);

test('an async generator checks the value after awaiting a yield', () => {
  expect(settledAfterJobs('async function* f(): uint8 { yield Promise.resolve((1 := uint8)); }'
    + ' f().next().then(r => { globalThis.settled = String(Reflect.typeOf(r.value) === uint8); });')).toBe('true');
});
