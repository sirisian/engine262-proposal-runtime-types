import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

for (const type of ['[2].<uint8>', '[uint8, string]']) {
  for (const target of ['a.length', 'a["length"]', '(a.length)']) {
    for (const expression of [`${target}++`, `++${target}`, `${target}--`, `--${target}`, `${target} += 1`, `${target} -= 1`]) {
      test(`${type}: ${expression} violates the known length before execution`, () => {
        expectStaticTypeError(`function unused(a: ${type}) { ${expression}; }`);
      });
    }
  }
}

test('length updates use exact uint64 arithmetic, including underflow', () => {
  expectStaticTypeError('function unused(a: [0].<uint8>) { --a.length; }');
  expectStaticTypeError('function unused(a: [2].<uint8>) { a.length -= 3; }');
  expectStaticTypeError('function unused(a: [2].<uint8>) { a.length += 18446744073709551615; }');
  expectStaticTypeError('const delta = 1; function unused(a: [2].<uint8>) { a.length += delta; }');
});

test('fixed length permits no-op writes and retains its count type', () => {
  expect(evaluated('let a: [2].<uint8> = [1, 2]; a.length = 2; a.length += 0; a.length -= 0; let n: uint64 = a.length; String(n);')).toBe('2');
  expect(evaluated('let a: [uint8, string] = [1, "s"]; a.length += 0; String(a.length);')).toBe('2');
});

test('unknown lengths and counts are not guessed', () => {
  expect(ok('function unused(a: [].<uint8>) { a.length++; }')).toBe(true);
  expect(ok('function unused(a: [uint8, ...[].<uint8>]) { a.length--; }')).toBe(true);
  expect(ok('function unused(a: [uint8, uint8 = 0]) { a.length--; }')).toBe(true);
  expect(ok('function unused(a: [2].<uint8>, n: uint64) { a.length += n; }')).toBe(true);
  expect(evaluated('let a = [1, 2]; a.length++; String(a.length);')).toBe('3');
});

test('a dynamic length mutation still enforces storage and reference liveness', () => {
  expectThrownKind('function run(a: [2].<uint8>, n: uint64) { a.length += n; } run([1, 2], 1);', 'TypeError');
  expectThrownKind('let a: [].<uint8> = [1, 2]; let ref p = a[1]; a.length -= 1; String(p);', 'TypeError');
  expectThrownKind('let a: [].<uint8> = [1, 2]; for (const ref p of a) { --a.length; }', 'TypeError');
});
