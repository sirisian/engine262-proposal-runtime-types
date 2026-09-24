import { test, expect } from 'vitest';
import {
  MatchSpecializationList, MatchSpecializationPattern, ValidateSpecializationList,
  SpecializationPatternError, type PatternSlotParameter,
} from '../../../../src/type-system/specialization-patterns.mts';
import {
  type M, prim, app, seq, arr, val, uint8, uint16, uint32, uint64, str, show, param, host, list, bindings,
} from './specialization-model.mts';
import type { ParseNode } from '#self';

/**
 * proposal-runtime-types #sec-matching-specialization-lists, exercised
 * directly (plan phase 3, C04-C08, C16). Selection is not implemented, so no
 * program can reach the matcher yet; these tests drive its entry points over
 * patterns the real parser produced and subjects of a small model universe.
 *
 * The universe is deliberately not the engine's Type Records: what is under
 * test is the matcher's own part - which positions are structural, the order
 * of checks, repeated captures, packs, defaults, and that a failed match binds
 * nothing - and every relation it delegates is the host's to supply.
 */

const pairPrimary = [param('A'), param('B')];
const storePrimary = [param('T')];

test('C03: equivalent nested spellings normalize to one pattern', () => {
  const spellings = [
    'Map.<string, const E>',
    'Map.<K: string, V: const E>',
    'Map.<V: const E, K: string>',
    'Map.<string, V: const E: type>',
  ];
  for (const s of spellings) {
    const l = list(s);
    expect(bindings(MatchSpecializationList(l, storePrimary, [app('Map', str, uint8)], host)), s).toEqual({ E: 'uint8' });
    expect(bindings(MatchSpecializationList(l, storePrimary, [app('Map', uint32, uint8)], host)), s).toBe('no-match');
    expect(bindings(MatchSpecializationList(l, storePrimary, [app('Pair', str, uint8)], host)), s).toBe('no-match');
  }
});

test('C04: a repeated capture is an equality, SameType for types', () => {
  const l = list('const T, T');
  expect(bindings(MatchSpecializationList(l, pairPrimary, [uint8, uint8], host))).toEqual({ T: 'uint8' });
  expect(bindings(MatchSpecializationList(l, pairPrimary, [uint8, uint16], host))).toBe('no-match');
  // Two independently named captures impose nothing.
  expect(bindings(MatchSpecializationList(list('const L, const R'), pairPrimary, [uint8, uint16], host))).toEqual({ L: 'uint8', R: 'uint16' });
});

test('C06: a repeated value capture compares by SameValue', () => {
  const dims = [param('R', { Domain: uint32 }), param('C', { Domain: uint32 })];
  const l = list('const N, N');
  expect(bindings(MatchSpecializationList(l, dims, [val(4), val(4)], host))).toEqual({ N: '4' });
  expect(bindings(MatchSpecializationList(l, dims, [val(4), val(3)], host))).toBe('no-match');
  expect(bindings(MatchSpecializationList(l, dims, [val(NaN), val(NaN)], host))).toEqual({ N: 'NaN' });
  expect(bindings(MatchSpecializationList(l, dims, [val(0), val(-0)], host))).toBe('no-match');
});

test('C05: a use may precede its declaration, in text and in parameter order', () => {
  // K is matched first, so E is bound there and V compared against it.
  const l = list('Map.<V: E, K: const E>');
  expect(bindings(MatchSpecializationList(l, storePrimary, [app('Map', uint8, uint8)], host))).toEqual({ E: 'uint8' });
  expect(bindings(MatchSpecializationList(l, storePrimary, [app('Map', uint8, uint16)], host))).toBe('no-match');
  const outer = list('T, const T');
  expect(bindings(MatchSpecializationList(outer, pairPrimary, [str, str], host))).toEqual({ T: 'string' });
});

test('a failed candidate leaks no binding into the next', () => {
  const subject = [uint16, uint8];
  // Binds T to uint16 and then fails at the second position...
  expect(MatchSpecializationList(list('const T, T'), pairPrimary, subject, host)).toBe('no-match');
  // ...and the next candidate's T starts unbound.
  expect(bindings(MatchSpecializationList(list('_, const T'), pairPrimary, subject, host))).toEqual({ T: 'uint8' });
  // The same pattern node matched twice starts empty each time.
  const pattern = list('Map.<const K, K>');
  expect(bindings(MatchSpecializationList(pattern, storePrimary, [app('Map', uint8, uint16)], host))).toBe('no-match');
  expect(bindings(MatchSpecializationList(pattern, storePrimary, [app('Map', uint16, uint16)], host))).toEqual({ K: 'uint16' });
});

test('an omitted entry stands for the default, and `_` for anything', () => {
  const primary = [param('T'), param('N', { Domain: uint32, HasDefault: true })];
  const defaults = (q: number) => (q === 1 ? val(16) : undefined);
  expect(bindings(MatchSpecializationList(list('uint8'), primary, [uint8, val(16)], host, defaults))).toEqual({});
  expect(bindings(MatchSpecializationList(list('uint8'), primary, [uint8, val(8)], host, defaults))).toBe('no-match');
  expect(bindings(MatchSpecializationList(list('uint8, _'), primary, [uint8, val(8)], host, defaults))).toEqual({});
  // Nested too: Box.<const T> omits N, whose default is 16.
  expect(bindings(MatchSpecializationList(list('Box.<const T>'), storePrimary, [app('Box', uint8, val(16))], host))).toEqual({ T: 'uint8' });
  expect(bindings(MatchSpecializationList(list('Box.<const T>'), storePrimary, [app('Box', uint8, val(8))], host))).toBe('no-match');
  expect(bindings(MatchSpecializationList(list('Box.<const T, _>'), storePrimary, [app('Box', uint8, val(8))], host))).toEqual({ T: 'uint8' });
});

test('C06: packs capture runs, and a repeated pack compares length and elements', () => {
  const tuples = [app('Tuple', seq(uint8, str)), app('Tuple', seq(uint8, str))];
  const append = list('Tuple.<...const Ts>, Tuple.<...Ts>');
  expect(bindings(MatchSpecializationList(append, pairPrimary, tuples, host))).toEqual({ Ts: '[uint8, string]' });
  expect(bindings(MatchSpecializationList(append, pairPrimary, [tuples[0], app('Tuple', seq(uint8))], host))).toBe('no-match');
  expect(bindings(MatchSpecializationList(append, pairPrimary, [app('Tuple', seq()), app('Tuple', seq())], host))).toEqual({ Ts: '[]' });
  // A fixed prefix and suffix around the run.
  const ends = list('Tuple.<const A, ...const Mid, const Z>');
  expect(bindings(MatchSpecializationList(ends, storePrimary, [app('Tuple', seq(uint8, str, uint16, uint32))], host)))
    .toEqual({ A: 'uint8', Mid: '[string, uint16]', Z: 'uint32' });
  expect(bindings(MatchSpecializationList(ends, storePrimary, [app('Tuple', seq(uint8))], host))).toBe('no-match');
  // The primary's own pack takes a run of top-level entries.
  const variadic = [param('Ts', { Variadic: true })];
  expect(bindings(MatchSpecializationList(list('uint8, ...const Rest'), variadic, [seq(uint8, str, uint16)], host))).toEqual({ Rest: '[string, uint16]' });
  expect(bindings(MatchSpecializationList(list('uint8, ...const Rest'), variadic, [seq(str)], host))).toBe('no-match');
  // Two spreads in one run have no boundary: an error in the pattern, not a failed match.
  expect(() => MatchSpecializationList(list('Tuple.<...const A, ...const B>'), storePrimary, [app('Tuple', seq(uint8))], host))
    .toThrow(SpecializationPatternError);
});

test('C08: arrays expose extent and element, and keep fixed apart from dynamic', () => {
  const fixed = list('[const N].<const E>');
  expect(bindings(MatchSpecializationList(fixed, storePrimary, [arr(val(4), uint8)], host))).toEqual({ N: '4', E: 'uint8' });
  expect(bindings(MatchSpecializationList(fixed, storePrimary, [arr('dynamic', uint8)], host))).toBe('no-match');
  const dynamic = list('[].<const E>');
  expect(bindings(MatchSpecializationList(dynamic, storePrimary, [arr('dynamic', uint8)], host))).toEqual({ E: 'uint8' });
  expect(bindings(MatchSpecializationList(dynamic, storePrimary, [arr(val(4), uint8)], host))).toBe('no-match');
  expect(bindings(MatchSpecializationList(list('[4].<const E>'), storePrimary, [arr(val(4), uint16)], host))).toEqual({ E: 'uint16' });
  const tuple = list('[const Head, ...const Tail]');
  expect(bindings(MatchSpecializationList(tuple, storePrimary, [seq(uint8, str, uint16)], host))).toEqual({ Head: 'uint8', Tail: '[string, uint16]' });
});

test('C08/C09: forward computations run after structural positions; bounds last', () => {
  // `Wrap(T)` reads T, which a LATER position binds.
  const l = list('Wrap(T), const T');
  expect(bindings(MatchSpecializationList(l, pairPrimary, [app('Wrapped', uint8), uint8], host))).toEqual({ T: 'uint8' });
  expect(bindings(MatchSpecializationList(l, pairPrimary, [app('Wrapped', uint16), uint8], host))).toBe('no-match');
  const bounded = list('const T extends Small, _');
  expect(bindings(MatchSpecializationList(bounded, pairPrimary, [uint16, str], host))).toEqual({ T: 'uint16' });
  expect(bindings(MatchSpecializationList(bounded, pairPrimary, [uint32, str], host))).toBe('no-match');
});

test('C16: a metadata position binds the metadata of the written meta type', () => {
  const l = list('Tagged.<const D: Dim>');
  const tagged = app('Tagged', prim('float32', { Dim: val(3) }));
  expect(bindings(MatchSpecializationList(l, storePrimary, [tagged], host))).toEqual({ D: '3' });
  expect(bindings(MatchSpecializationList(l, storePrimary, [app('Tagged', prim('float32'))], host))).toBe('no-match');
});

test('C16/D5: one matcher, two relations for a fixed leaf', () => {
  const pattern = list('Map.<string, const V>').SpecializationEntryList![0].Pattern as unknown as ParseNode;
  const captures = list('Map.<string, const V>').Captures!;
  const literalKey = app('Map', { k: 'lit', base: 'string', value: 'a' }, uint8);
  // A specialization compares a fixed leaf by identity...
  expect(bindings(MatchSpecializationPattern(pattern, captures, literalKey, host, 'specialization'))).toBe('no-match');
  // ...and a type-subject pattern structurally, where a literal refines its base.
  expect(bindings(MatchSpecializationPattern(pattern, captures, literalKey, host, 'type-subject'))).toEqual({ V: 'uint8' });
});

test('C01/D9: a written capture domain must restate its slot\'s', () => {
  const check = (entries: string, primary?: PatternSlotParameter<M>[]) => ValidateSpecializationList(list(entries), host, primary, show, uint64).map((d) => d.kind);
  expect(check('Map.<K: string, V: const E>')).toEqual([]);
  expect(check('Map.<K: string, V: const E: type>')).toEqual([]);
  expect(check('Map.<K: string, V: const E: uint32>')).toEqual(['domain']);
  // An array extent's domain is the index type.
  expect(check('[const N: uint64].<uint8>')).toEqual([]);
  expect(check('[const N: uint32].<uint8>')).toEqual(['domain']);
  // A metadata position selects the meta type instead.
  expect(check('Tagged.<const D: Dim>')).toEqual([]);
  // The top-level entries are judged against the primary, where it is known.
  expect(check('const T: uint32, _', pairPrimary)).toEqual(['domain']);
  expect(check('const N: uint32', [param('N', { Domain: uint32 })])).toEqual([]);
  const message = ValidateSpecializationList(list('Map.<K: string, V: const E: uint32>'), host, undefined, show)[0].message;
  expect(message).toContain('`E` occupies `V` of Map, whose domain is `type`');
});

test('declaration errors in a pattern are found without a subject', () => {
  const check = (entries: string) => ValidateSpecializationList(list(entries), host, undefined, show).map((d) => d.kind);
  expect(check('Map.<Q: const E>')).toEqual(['unknown-name']);
  expect(check('Map.<K: const E, K: string>')).toEqual(['supplied-twice']);
  // `Make` is no constructor: nothing exposes its arguments.
  expect(check('Make.<const T>')).toEqual(['no-component']);
  // A constructor capture needs a constructor slot of its arity.
  expect(check('Apply.<const W<_>, const T>')).toEqual([]);
  expect(check('Apply.<const W, const T>')).toEqual(['arity']);
  expect(check('Map.<const W<_>, string>')).toEqual(['arity']);
});

test('a repeated capture in a metadata position compares the metadata', () => {
  // The second use projected nothing and compared the whole subject against
  // the bound metadata, so it could never match.
  const pair = [param('A'), param('B')];
  const l = list('Tagged.<const D: Dim>, Tagged.<D>');
  const tagged = (m: number) => app('Tagged', prim('float32', { Dim: val(m) }));
  expect(bindings(MatchSpecializationList(l, pair, [tagged(3), tagged(3)], host))).toEqual({ D: '3' });
  expect(bindings(MatchSpecializationList(l, pair, [tagged(3), tagged(4)], host))).toBe('no-match');
});
