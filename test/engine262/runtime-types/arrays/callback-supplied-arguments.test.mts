import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, ok } from '../harness.mts';

// #sec-array-and-tuple-types, #sec-isfunctionsubtype
const methods = ['map', 'forEach', 'filter', 'find', 'findIndex', 'findLast', 'findLastIndex', 'some', 'every'];

test.each(methods)('%s supplies an element, index and receiver', (method) => {
  for (const callback of [
    '() => true',
    '(value: uint8) => true',
    '(value: uint8, index: uint64) => true',
    '(value: uint8, index: uint64, receiver: [].<uint8>) => true',
  ]) {
    expect(ok(`const a: [].<uint8> = [1]; a.${method}(${callback});`)).toBe(true);
  }
});

test.each(methods)('%s rejects incompatible supplied arguments and extra required parameters', (method) => {
  for (const callback of [
    '(value: string) => true',
    '(value: uint8, index: string) => true',
    '(value: uint8, index: uint64, receiver: [].<string>) => true',
    '(value: uint8, index: uint64, receiver: [].<uint8>, extra: string) => true',
  ]) {
    expectStaticTypeError(`if (false) { const a: [].<uint8> = [1]; a.${method}(${callback}); }`);
  }
});

test('a mapped index can be passed to another array method', () => {
  expect(evaluated('let a: [].<uint8> = [4, 9]; String(a.map((value: uint8, index: uint64) => a.at(index))[1]);')).toBe('9');
});
