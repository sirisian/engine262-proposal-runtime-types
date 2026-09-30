import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

// #sec-bindtypearguments: each default reads the preceding completed bindings.
const prefix = 'function d<...I: [].<uint32>, M: uint32 = I.length, N: uint32 = M>(): uint32 { return N; } ';

test('stored applications finish chained pack-dependent defaults independently', () => {
  expect(evaluated(prefix + 'const a = d.<0, 1>; const b = d.<4>; String(a()) + "/" + String(b());')).toBe('2/1');
  expect(evaluated(prefix + 'const empty = d.<>; String(empty());')).toBe('0');
});

test('defaulted and explicit complete bindings identify one specialization', () => {
  expect(evaluated(prefix + 'String(d.<0, 1> === d.<I: 0, 1, M: 2, N: 2>);')).toBe('true');
});

test('an evaluated later default is still checked against its domain', () => {
  expectStaticTypeError('function d<...I: [].<uint32>, M: uint32 = I.length, N: uint8 = M>(): uint8 { return N; } const s = d.<M: 300>;');
});
