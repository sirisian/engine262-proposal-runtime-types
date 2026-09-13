import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

const CUSTOM = 'let xs: [string] = ["s"]; xs[Symbol.iterator] = function*(): uint8 { yield 1; };';
for (const target of ['[].<uint8>', '[uint8]', '[1].<uint8>']) {
  test(`a spread follows a custom iterator into ${target}`, () => {
    expect(evaluated(`${CUSTOM} const result: ${target} = [...xs]; String(result[0]);`)).toBe('1');
  });
}

test('a call spread follows the custom iterator and its actual length', () => {
  expect(evaluated(`${CUSTOM} function take(x: uint8): uint8 { return x; } String(take(...xs));`)).toBe('1');
  expect(evaluated('let xs: [uint8] = [1]; xs[Symbol.iterator] = function*(): uint8 { yield 2; yield 3; }; function take(x: uint8, y: uint8): uint8 { return x + y; } String(take(...xs));')).toBe('5');
});

for (const target of ['[].<string>', '[string]', '[2].<string>']) {
  test(`a declared iterator item type is checked at ${target}`, () => {
    expectStaticTypeError(`function unused(xs: Iterable.<uint8>) { const result: ${target} = [...xs]; }`);
  });
}

test('iterator item types and following arguments reach homogeneous rest parameters', () => {
  expectStaticTypeError('function take(...xs: [].<string>) {} function unused(xs: Iterable.<uint8>) { take(...xs); }');
  expectStaticTypeError('function take(...xs: [].<uint8>) {} function unused(xs: Iterable.<uint8>) { take(...xs, "s"); }');
});

test('an immutable composite tuple supplies precise positions and arity', () => {
  const values = 'const xs: Composite.<[uint8, string]> = Composite.<[uint8, string]>([1, "s"]);';
  expectStaticTypeError(`${values} function take(x: string, y: uint8) {} function unused() { take(...xs); }`);
  expectStaticTypeError(`${values} function unused() { const result: [uint8] = [...xs]; }`);
  expectStaticTypeError(`${values} function take(x: uint8, y: string, z: uint8) {} function unused() { take(...xs); }`);
  expect(evaluated(`${values} function take(x: uint8, y: string): string { return String(x) + y; } take(...xs);`)).toBe('1s');
});

test('known composite positions preserve arguments following a spread', () => {
  expectStaticTypeError('const xs: Composite.<[uint8]> = Composite.<[uint8]>([1]); function take(x: uint8, y: string) {} function unused() { take(...xs, (2 := uint8)); }');
  expect(evaluated('const xs: Composite.<[uint8]> = Composite.<[uint8]>([1]); const result: [uint8, string] = [...xs, "s"]; String(result[0]) + result[1];')).toBe('1s');
});

test('a typed iterator retains runtime iteration effects', () => {
  expect(evaluated('let effects = 0; function* gen(): uint8 { effects++; yield 2; effects++; } function collect(xs: Iterable.<uint8>): [].<uint8> { return [...xs]; } const result = collect(gen()); String(result[0]) + ":" + String(effects);')).toBe('2:2');
});
