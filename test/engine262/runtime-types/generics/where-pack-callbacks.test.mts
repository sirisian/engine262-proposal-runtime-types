import { expect, test } from 'vitest';
import { evaluated, expectThrown, observeScript } from '../harness.mts';

/**
 * #sec-generic-where: a clause over a value pack, `I.some(i => i > 300)` or
 * `I.every(i => i > 300)`, reads the fragment's `some` and `every`
 * (#sec-fragment-library), so one no element of the pack's domain can
 * satisfy is judged at the declaration; and a specialization made at run
 * time evaluates its clause within the fragment, where a built-in's name
 * reaches the original and a replacement is a TypeError.
 */
const messageOf = (observed: ReturnType<typeof observeScript>): string => {
  const value = observed.completion.Value as { properties?: Iterable<[{ stringValue?(): string }, { Value?: { stringValue?(): string } }]> } | undefined;
  for (const [key, descriptor] of value?.properties ?? []) if (key?.stringValue?.() === 'message') return descriptor?.Value?.stringValue?.() ?? '';
  return '';
};
const impossible = (source: string, verdict: 'never succeed' | 'never fail' = 'never succeed'): void => {
  const observed = observeScript(source);
  expect(observed).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-impossible-test' } });
  expect(messageOf(observed)).toContain(`can ${verdict}`);
};
const accepted = (source: string): void => {
  expect(observeScript(source)).toMatchObject({ completion: { Type: 'normal' } });
};

test('some over a pack no element can satisfy never succeeds, and every over an established non-empty pack likewise', () => {
  impossible('function f<...I: [].<uint8>>() where I.some((i) => i > 300) { return 1; }');
  impossible('function f<...I: [].<uint8>>() where I.some((i) => 300 < i) { return 1; }');
  impossible('function f<...I: [].<uint8>>() where I.length > 0 where I.every((i) => i > 300) { return 1; }');
  accepted('function f<...I: [].<uint8>>() where I.some((i) => i > 200) { return 1; }');
  expect(evaluated('function f<...I: [].<uint8>>() where I.some((i) => i > 200) { return 1; } String(f.<1, 250>());')).toBe('1');
});

test('every over a possibly empty pack is vacuous, and a test every element passes never fails', () => {
  accepted('function f<...I: [].<uint8>>() where I.every((i) => i > 300) { return 1; }');
  expect(evaluated('function f<...I: [].<uint8>>() where I.every((i) => i > 300) { return 1; } String(f());')).toBe('1');
  impossible('function f<...I: [].<uint8>>() where I.every((i) => i >= 0) { return 1; }', 'never fail');
  accepted('function f<...I: [].<uint8>>() where I.some((i) => i >= 0) { return 1; }');
  impossible('function f<...I: [].<uint8>>() where I.length > 0 where I.some((i) => i >= 0) { return 1; }', 'never fail');
});

test('a specialization made at run time evaluates its clause within the fragment', () => {
  const some = 'function f<...I: [].<uint8>>() where I.some((i) => i > 200) { return 1; } function h<...J: [].<uint8>>() { return f.<...J>(); }';
  expectThrown(`${some} Array.prototype.some = function () { return true; }; h.<1, 2>();`, 'a built-in the program replaced');
  expectThrown('function g<N: uint8>() where Math.max(N, 400) < 300 { return 1; } function h<M: uint8>() { return g.<M>(); } Math.max = function () { return 0; }; h.<5>();', 'a built-in the program replaced');
  expectThrown('function h2<M: uint8>() where Object.is(M, 5) { return 1; } function k<P: uint8>() { return h2.<P>(); } Object.is = () => true; k.<200>();', 'a built-in the program replaced');
  expect(evaluated('function g<N: uint8>() where Math.max(N, 4) < 200 { return 1; } function h<M: uint8>() { return g.<M>(); } String(h.<5>());')).toBe('1');
});
