import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

// #sec-variadic-parameters: a callback contributes its complete parameter run.
test('a callback alone infers an ordered type pack', () => {
  const capture = 'function capture<...Ts: [].<type>>(cb: (...xs: Ts) => void): string { return String(Ts); } ';
  expect(evaluated(capture + 'capture((a: uint8, b: string): void => {});')).toBe('[uint.<8>, string]');
  expect(evaluated(capture + 'capture((): void => {});')).toBe('[]');
});

test('reference callback inference preserves every referent position', () => {
  const apply = 'function apply<...Ts: [].<type>>(cb: (ref ...xs: Ts) => void, ref ...xs: Ts): void { cb(...xs); } ';
  const values = 'let a: uint32 = 1; let b: float32 = 2; ';
  expect(evaluated(apply + values + 'apply((ref x: uint32, ref y: float32) => { x = 3; y = 4; }, ref a, ref b); String(a) + "/" + String(b);')).toBe('3/4');
  expectStaticTypeError(apply + values + 'apply((ref x: uint32, ref y: uint32) => {}, ref a, ref b);');
});

test('explicit packs still constrain callback parameters', () => {
  const capture = 'function capture<...Ts: [].<type>>(cb: (...xs: Ts) => void): string { return String(Ts); } ';
  expect(evaluated(capture + 'capture.<uint8, string>((a: uint8, b: string): void => {});')).toBe('[uint.<8>, string]');
  expectStaticTypeError(capture + 'capture.<uint8, string>((a: string, b: uint8): void => {});');
});
