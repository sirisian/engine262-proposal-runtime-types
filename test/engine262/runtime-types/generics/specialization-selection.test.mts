import { test, expect } from 'vitest';
import {
  CompareSpecificity, SelectSpecialization, FindDuplicateCases, AnalyzeCallableGroup,
  type CallableGroupHost, type CallableDeclaration, type SpecializationCase,
} from '../../../../src/type-system/specialization-selection.mts';
import type { PatternSlotParameter } from '../../../../src/type-system/specialization-patterns.mts';
import {
  type M, app, val, uint8, uint16, uint32, str, type, param, host, list, resolve,
} from './specialization-model.mts';
import { Agent, ManagedRealm, setSurroundingAgent, Parser } from '#self';
import type { ParseNode } from '#self';

/**
 * Plan phase 4, the pure half: specificity, selection, and the callable-group
 * rules of section 3.8, driven directly over real parse nodes and the model
 * universe of specialization-model.mts. Neither the checker nor the run time
 * calls these yet; the tests pin the rules they will share.
 */

// `Tiny` admits uint8; `Small` admits uint8 and uint16.
const members: Record<string, readonly string[]> = { Tiny: ['uint8'], Small: ['uint8', 'uint16'] };
const admitted = (bound: string, m: M) => m.k === 'prim' && (members[bound] ?? []).includes(m.name);

const groupHost: CallableGroupHost<M> = {
  ...host,
  satisfiesBound: (v, bound) => admitted(bound.sourceText, v),
  boundIncludes: (wide, narrow) => (members[narrow.sourceText] ?? []).every((n) => (members[wide.sourceText] ?? []).includes(n)),
  admits: (entry, parameter) => {
    const value = resolve(entry);
    const typeSlot = parameter.Domain?.k === 'prim' && parameter.Domain.name === 'type';
    if (typeSlot !== (value.k !== 'val')) {
      return false;
    }
    const bound = (parameter as { Bound?: string }).Bound;
    return bound === undefined || admitted(bound, value);
  },
  // A structural entry here is always an application, which yields a type.
  admitsStructure: (_entry, parameter) => parameter.Domain?.k === 'prim' && parameter.Domain.name === 'type',
};

const pair = [param('A'), param('B')];
const c = (entries: string): SpecializationCase<M> => ({ List: list(entries), Label: `<${entries}>` });
const compare = (a: string, b: string, primary: PatternSlotParameter<M>[] = pair, defaults?: (q: number) => M | undefined) => CompareSpecificity(c(a), c(b), primary, groupHost, defaults);

test('section 6.1: the schematic Pair table', () => {
  expect(compare('const T, T', 'uint32, _')).toBe('incomparable');
  expect(compare('uint32, uint32', 'const T, T')).toBe('more');
  expect(compare('uint32, uint32', 'uint32, _')).toBe('more');
  expect(compare('uint32, _', '_, _')).toBe('more');
  expect(compare('const T, T', 'const L, const R')).toBe('more');
});

test('coverage is compared by binding identity, not capture names', () => {
  expect(compare('const T, T', 'const U, U')).toBe('equal');
  expect(compare('_, _', 'const X, const Y')).toBe('equal');
  expect(FindDuplicateCases([c('const T, T'), c('uint32, _'), c('const U, U')], pair, groupHost).map(([a, b]) => [a.Label, b.Label]))
    .toEqual([['<const T, T>', '<const U, U>']]);
});

test('bounds order cases only where inclusion is established', () => {
  expect(compare('const T extends Tiny, _', 'const T extends Small, _')).toBe('more');
  expect(compare('const T extends Small, _', 'const T, _')).toBe('more');
  expect(compare('uint8, _', 'const T extends Small, _')).toBe('more');
  expect(compare('uint32, _', 'const T extends Small, _')).toBe('incomparable');
});

test('nested applications, packs, and defaults', () => {
  const one = [param('T')];
  expect(compare('Map.<string, const V>', 'Map.<const K, const V>', one)).toBe('more');
  expect(compare('Map.<const K, const V>', 'const X', one)).toBe('more');
  expect(compare('Map.<const K, K>', 'Map.<string, _>', one)).toBe('incomparable');
  expect(compare('Map.<string, string>', 'Map.<const K, K>', one)).toBe('more');
  const pack = [param('Ts', { Variadic: true })];
  expect(compare('uint8, ...const R', '...const All', pack)).toBe('more');
  expect(compare('uint8, string', 'uint8, ...const R', pack)).toBe('more');
  expect(compare('...const R', 'uint8, string', pack)).toBe('less');
  // An omitted entry is the default, a fixed fact.
  const boxed = [param('T'), param('N', { Domain: uint32, HasDefault: true })];
  expect(compare('uint8', 'uint8, _', boxed, (q) => (q === 1 ? val(16) : undefined))).toBe('more');
});

test('selection picks the unique most specific applicable case, whatever the order', () => {
  const cases = [c('const T, T'), c('uint32, _'), c('uint32, uint32')];
  const pick = (a: M, b: M, list: SpecializationCase<M>[] = cases) => {
    const r = SelectSpecialization(list, pair, [a, b], groupHost);
    return r.Kind === 'selected' ? r.Case.Label : r.Kind === 'ambiguous' ? `ambiguous ${r.Cases.map((x) => x.Label).join(' ')}` : r.Kind;
  };
  expect(pick(uint32, uint32)).toBe('<uint32, uint32>');
  expect(pick(uint8, uint8)).toBe('<const T, T>');
  expect(pick(uint32, str)).toBe('<uint32, _>');
  expect(pick(str, uint8)).toBe('none');
  expect(pick(uint32, uint32, [...cases].reverse())).toBe('<uint32, uint32>');
  // Without the intersection, the two incomparable survivors are reported.
  expect(pick(uint32, uint32, cases.slice(0, 2))).toBe('ambiguous <const T, T> <uint32, _>');
  const selected = SelectSpecialization(cases, pair, [uint16, uint16], groupHost);
  expect(selected.Kind === 'selected' && selected.Bindings.map((b) => b.Capture.Name)).toEqual(['T']);
  expect(pick(app('Map', str, uint8), uint8, [c('Map.<string, const V>, V')])).toBe('<Map.<string, const V>, V>');
});

/** The function declarations of _source_, parsed, grouped by name, ignoring early errors. */
function group(source: string): CallableDeclaration<M>[] {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const pop = realm.pushTopContext();
  try {
    const script = (new Parser({ source }) as unknown as { parseScript(): ParseNode.Script }).parseScript();
    return script.ScriptBody!.StatementList.map((s) => {
      const f = s as ParseNode.FunctionDeclaration;
      const tps = f.TypeParameters ?? null;
      const Parameters = tps?.ListKind === 'parameters'
        ? tps.TypeParameterList.map((p) => ({
          ...param(p.BindingIdentifier.name, { Variadic: p.IsVariadic, Domain: p.IsValueParameter ? uint32 : type }),
          Bound: p.IsValueParameter ? undefined : p.TypeParameterConstraint?.sourceText,
        }))
        : undefined;
      return { Node: f as unknown as ParseNode, List: tps, Label: `${f.BindingIdentifier!.name}${tps?.sourceText ?? ''}`, Parameters };
    });
  } finally {
    pop?.();
  }
}

const analyze = (source: string) => {
  const g = AnalyzeCallableGroup(group(source), groupHost, (d) => (d.k === 'prim' ? d.name : '?'));
  return {
    attached: g.Attached.map((a) => `${a.Case.Label} -> ${a.Owner.Label}`),
    standalone: g.Standalone.map((s) => s.Label),
    errors: g.Diagnostics.map((d) => d.kind),
  };
};

test('section 3.8: pattern-only cases attach to the unique accepting owner', () => {
  expect(analyze('function read<T: type>() {} function read<uint8>() {} function read<Box.<const E>>() {} function read<float32, maximum: float32>() {}')).toEqual({
    attached: ['read<uint8> -> read<T: type>', 'read<Box.<const E>> -> read<T: type>'],
    standalone: ['read<float32, maximum: float32>'],
    errors: [],
  });
});

test('section 3.8: acceptance reads each slot\'s kind, so like-shaped owners are told apart', () => {
  expect(analyze('function f<T: type>() {} function f<N: uint32>() {} function f<uint8>() {} function f<8>() {}').attached)
    .toEqual(['f<uint8> -> f<T: type>', 'f<8> -> f<N: uint32>']);
  expect(analyze('function f<T: type>() {} function f<U: type>() {} function f<uint8>() {}').errors).toEqual(['two-owners']);
});

test('an owner accepts only cases its contract admits; the rest are standalone', () => {
  expect(analyze('function f<T: type extends Small>() {} function f<uint16>() {} function f<string>() {}')).toEqual({
    attached: ['f<uint16> -> f<T: type extends Small>'],
    standalone: ['f<string>'],
    errors: [],
  });
});

test('D4: a standalone capture has no slot domain to inherit; D9 against the owner', () => {
  expect(analyze('function f<const T>() {}').errors).toEqual(['no-slot-domain']);
  expect(analyze('function f<const T: type>() {}').errors).toEqual([]);
  expect(analyze('function g<T: type>() {} function g<const T>() {}').errors).toEqual([]);
  expect(analyze('function h<N: uint32>() {} function h<const N: type>() {}').errors).toEqual(['domain']);
});

test('duplicates under one owner are refused, and a mixed list never attaches', () => {
  expect(analyze('function f<A: type, B: type>() {} function f<const T, T>() {} function f<const U, U>() {}').errors).toEqual(['duplicate']);
  expect(analyze('function f<A: type, B: type>() {} function f<uint8, B: type>() {}').standalone).toEqual(['f<uint8, B: type>']);
});
