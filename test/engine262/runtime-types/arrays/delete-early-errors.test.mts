import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind } from '../harness.mts';

// #sec-typed-storage and #sec-type-errors. Declared protected index domains
// are decided here; properties and the bounds of a read are separate rules.
test.each(['[2].<uint8>', '[uint8, string]'])('deleting a guaranteed position of %s rejects before execution', (type) => {
  for (const key of ['0', '(0)', '"0"']) {
    expectStaticTypeError(`function unused(a: ${type}) { delete (a[${key}]); }`);
  }
  expectStaticTypeError(`function unused(a: ${type}) { delete a?.[0]; }`);
});

test('ordinary properties and tuple nonpositions remain deletable', () => {
  expect(evaluated('let a: [2].<uint8> = [1, 2]; a.extra = 1; String(delete a.extra);')).toBe('true');
  expect(evaluated('let a: [uint8] = [1]; String(delete a[9]);')).toBe('true');
  expect(evaluated('let a: [uint8] = [1]; a["01"] = 2; String(delete a["01"]);')).toBe('true');
  expect(evaluated('let a = [1]; String(delete a[0]);')).toBe('true');
});

test('dynamic bases and unknown keys still fail at runtime', () => {
  expectThrownKind('function remove(a: any) { delete a[0]; } let a: [2].<uint8> = [1, 2]; remove(a);', 'TypeError');
  expectThrownKind('function remove(a: any) { delete a[0]; } let a: [uint8] = [1]; remove(a);', 'TypeError');
  expectThrownKind('function remove(a: [2].<uint8>, key: string) { delete a[key]; } let a: [2].<uint8> = [1, 2]; remove(a, "0");', 'TypeError');
});

test('growable arrays and tuple rest or default positions reject before evaluation', () => {
  expectStaticTypeError('function unused(a: [].<uint8>) { delete a[0]; }');
  expectStaticTypeError('function unused(a: [uint8, ...[].<uint8>]) { delete a[2]; }');
  expectStaticTypeError('function unused(a: [uint8 = 1]) { delete a[0]; }');
});
