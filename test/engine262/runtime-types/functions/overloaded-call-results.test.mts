import { expect, test } from 'vitest';
import { evaluated, expectEarlyError } from '../harness.mts';

const declarations = 'function choose(x: uint8): uint8 { return x; } function choose(x: string): string { return x; }';

test.each([
  'const x = choose("s"); let n: uint8 = x;',
  'const x = (choose("s")); let n: uint8 = x;',
  'const x = (0, choose("s")); let n: uint8 = x;',
  'function wrapper(x: string) { return choose(x); } let n: uint8 = wrapper("s");',
])('selected return remains known through %s', (body) => {
  expectEarlyError(`${declarations} function unused() { ${body} }`, 'StaticTypeError');
  expectEarlyError(`${declarations} ${body}`, 'StaticTypeError');
});

test('a valid intermediate retains the selected result', () => {
  expect(evaluated(`${declarations} const x = choose("s"); const s: string = x; s;`)).toBe('s');
});

test('return context is reconsidered for each call', () => {
  expect(evaluated('function f(x: uint8): string { return "s"; } function f(x: uint8): uint8 { return x; } const a: string = f(1); const b: uint8 = f(1); a + String(b);')).toBe('s1');
});
