import { expect, test } from 'vitest';
import { evaluated, expectEarlyError, expectThrownKind } from './harness.mts';

test.each([
  'function f(v: string | uint8) { return match all (v) { when string: 0; when let x: { let n: uint8 = x; n; } }; }',
  'function f(v: string | uint8) { return match all (v) { when string: 0; when string: { let n: uint8 = v; n; } }; }',
  'let x: [].<uint8> = match all (1) { when _: "s"; };',
  'let x: uint8 = match all (1) { when _: 1; };',
  'let x: [].<uint8> = match all (1) { when _: 300; };',
  'let x: [].<uint8> = match all (1) { when _: { 300; } };',
])('known match-all mismatch rejects before execution: %s', (source) => {
  expectEarlyError(source, 'StaticTypeError');
  expectEarlyError(`function unused() { ${source} }`, 'StaticTypeError');
});

test('collection context reaches expression and block completion values', () => {
  expect(evaluated('const xs: [].<uint8> = match all (1) { when _: 1; when _: { 2; } }; JSON.stringify(xs);')).toBe('[1,2]');
  expect(evaluated('function f(v: string | uint8) { return match all (v) { when string: 0; when let x: { let n: string | uint8 = x; n; } }; } JSON.stringify(f("s"));')).toBe('[0,"s"]');
});

test('collection context selects return overloads through block completions', () => {
  const overloads = 'function f(): uint8 { return 1; } function f(): string { return "s"; }';
  for (const arm of ['f();', '{ f(); }', '{ if (true) { f(); } else { 2; } }']) {
    expect(evaluated(`${overloads} const xs: [].<uint8> = match all (1) { when _: ${arm} }; String(xs[0]);`)).toBe('1');
  }
});

test('unknown elements keep runtime admission without losing the array result', () => {
  const fn = 'function f(v: any) { const xs: [].<uint8> = match all (1) { when _: v; }; return xs; }';
  expect(evaluated(`${fn} String(f(1));`)).toBe('1');
  expectThrownKind(`${fn} f("s");`, 'TypeError');
  expectEarlyError('function f(v: any) { const x: uint8 = match all (1) { when _: v; }; }', 'StaticTypeError');
  expectEarlyError('function f(xs: [].<any>) { const ys: [].<uint8> = xs; }', 'StaticTypeError');
  expectThrownKind('let v: any = 1; const xs: [].<uint8> = match all (1) { when _: v; }; const alias: any = xs; alias[0] = "s";', 'TypeError');
});

test('all has no exhaustiveness obligation and a dynamic result length', () => {
  expect(evaluated('enum E { A, B } const e: E = E.B; JSON.stringify(match all (e) { when E.A: 1; });')).toBe('[]');
  expectEarlyError('enum E { A, B } const e: E = E.B; match (e) { when E.A: 1; };', 'StaticTypeError');
  expectEarlyError('const xs: [2].<uint8> = match all (1) { when _: (1 := uint8); when _: (2 := uint8); };', 'StaticTypeError');
});
