import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

// R2 regression floor: typed-number property keys. The proposal spec does not
// override ToPropertyKey, so a typed number keys by its numeric string, exactly
// as BigInt does: value distinctness (=== / SameValue, fixed in R1) and
// property-key coercion are orthogonal. `1n === 1` is false yet `o[1n]` and
// `o[1]` alias; the same holds for typed numbers. This file pins that
// behaviour so a future change to ToPropertyKey or ToString cannot silently
// alter it.

function run(source: string) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  return realm.evaluateScriptSkipDebugger(source);
}

function evaluated(source: string): string {
  const completion = run(source);
  expect(completion).toMatchObject({ Type: 'normal' });
  return (completion as unknown as { Value: { stringValue(): string } }).Value.stringValue();
}

test('a typed number keys by its numeric string (the BigInt precedent)', () => {
  // Distinct values, but the same property key: consistent with 1n === 1 being
  // false while o[1n] and o[1] alias.
  expect(evaluated('const n = 5; (5 := uint8) === n ? "eq" : "neq";')).toBe('neq');
  expect(evaluated('const o = {}; o[5 := uint8] = "typed"; o[5];')).toBe('typed');
  expect(evaluated('const o = { 5: "plain" }; o[5 := uint8];')).toBe('plain');
});

test('typed numbers of different types share a numeric key', () => {
  // uint8 5 and uint16 5 are distinct values but key identically, like 5 and 5n.
  expect(evaluated('const o = {}; o[5 := uint8] = "a"; o[5 := uint16] = "b"; o[5 := uint8];')).toBe('b');
});

test('typed numbers index arrays and typed arrays naturally', () => {
  expect(evaluated('const a = ["a", "b", "c"]; a[1 := uint8] + a[2 := uint8];')).toBe('bc');
  expect(evaluated('const a = []; a[0 := uint8] = "x"; String(a.length);')).toBe('1');
  expect(evaluated('const ta = new Uint8Array([10, 20, 30]); String(ta[1 := uint8]);')).toBe('20');
});

test('property-key coercion is consistent across access forms', () => {
  // A binding, an inline conversion, and a plain number all reach one slot.
  expect(evaluated('let k: uint8 = 5; const o = {}; o[k] = "a"; o[5 := uint8];')).toBe('a');
  expect(evaluated('const o = {}; o[5 := uint8] = "a"; Object.keys(o).join(",");')).toBe('5');
  expect(evaluated('const o = {}; o[5 := uint8] = "a"; (5 in o) && ((5 := uint8) in o) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('const o = { 5: "a" }; delete o[5 := uint8]; String(Object.keys(o).length);')).toBe('0');
});

test('ToString of a typed number is its decimal, without the type tag', () => {
  expect(evaluated('String(255 := uint8);')).toBe('255');
  expect(evaluated('String(0 := int8);')).toBe('0');
  expect(evaluated('"" + (42 := uint16);')).toBe('42');
});
