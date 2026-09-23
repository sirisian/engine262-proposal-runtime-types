import { test, expect } from 'vitest';
import {
  MatchSpecializationList, MatchSpecializationPattern, ValidateSpecializationList,
  SpecializationPatternError, type SpecializationMatchHost, type NestedConstructor,
  type PatternSlotParameter, type CaptureBindingRecord,
} from '../../../../src/type-system/specialization-patterns.mts';
import { Agent, ManagedRealm, setSurroundingAgent, Parser } from '#self';
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

type M =
  | { readonly k: 'prim', readonly name: string, readonly meta?: Readonly<Record<string, M>> }
  | { readonly k: 'lit', readonly base: string, readonly value: string | number }
  | { readonly k: 'app', readonly ctor: string, readonly args: readonly M[] }
  | { readonly k: 'seq', readonly els: readonly M[] }
  | { readonly k: 'arr', readonly extent: M | 'dynamic', readonly el: M }
  | { readonly k: 'val', readonly v: number | string };

const prim = (name: string, meta?: Record<string, M>): M => ({ k: 'prim', name, meta });
const app = (ctor: string, ...args: M[]): M => ({ k: 'app', ctor, args });
const seq = (...els: M[]): M => ({ k: 'seq', els });
const arr = (extent: M | 'dynamic', el: M): M => ({ k: 'arr', extent, el });
const val = (v: number | string): M => ({ k: 'val', v });
const [uint8, uint16, uint32, uint64, str, type] = ['uint8', 'uint16', 'uint32', 'uint64', 'string', 'type'].map((n) => prim(n));

function same(a: M, b: M): boolean {
  if (a.k !== b.k) return false;
  switch (a.k) {
    case 'prim': return a.name === (b as typeof a).name;
    case 'lit': return a.base === (b as typeof a).base && Object.is(a.value, (b as typeof a).value);
    case 'val': return Object.is(a.v, (b as typeof a).v);
    case 'app': return a.ctor === (b as typeof a).ctor && a.args.length === (b as typeof a).args.length && a.args.every((x, i) => same(x, (b as typeof a).args[i]));
    case 'seq': return a.els.length === (b as typeof a).els.length && a.els.every((x, i) => same(x, (b as typeof a).els[i]));
    case 'arr': {
      const o = b as typeof a;
      return (a.extent === 'dynamic' ? o.extent === 'dynamic' : o.extent !== 'dynamic' && same(a.extent, o.extent)) && same(a.el, o.el);
    }
    default: return false;
  }
}

const show = (m: M): string => (m.k === 'prim' ? m.name : m.k === 'val' ? String(m.v) : m.k === 'seq' ? `[${m.els.map(show).join(', ')}]` : m.k === 'app' ? `${m.ctor}.<${m.args.map(show).join(', ')}>` : m.k);

const param = (Name: string, extra: Partial<PatternSlotParameter<M>> = {}): PatternSlotParameter<M> => ({
  Name, Variadic: false, HasDefault: false, Domain: type, ...extra,
});

function ctor(Name: string, Parameters: PatternSlotParameter<M>[], defaults: (M | undefined)[] = []): NestedConstructor<M> {
  return {
    Name,
    Parameters,
    argumentsOf: (s) => (s.k === 'app' && s.ctor === Name ? s.args : null),
    defaultOf: (q) => defaults[q],
  };
}

const constructors: Record<string, NestedConstructor<M>> = {
  Map: ctor('Map', [param('K'), param('V')]),
  Pair: ctor('Pair', [param('A'), param('B')]),
  Box: ctor('Box', [param('T'), param('N', { Domain: uint32, HasDefault: true })], [undefined, val(16)]),
  Tuple: ctor('Tuple', [param('Ts', { Variadic: true })]),
  Tagged: ctor('Tagged', [param('D', { Metadata: true })]),
  Apply: ctor('Apply', [param('W', { Arity: 1 }), param('T')]),
};

function resolve(node: ParseNode): M {
  const n = node as unknown as { type: string, [k: string]: unknown };
  switch (n.type) {
    case 'TypeReference': {
      const ref = node as ParseNode.TypeReference;
      const name = ref.TypeName.IdentifierReference.name;
      if (ref.TypeArguments) {
        return app(name, ...ref.TypeArguments.TypeArgumentList.map((a) => resolve(a as unknown as ParseNode)));
      }
      if (['uint8', 'uint16', 'uint32', 'uint64', 'string', 'type', 'float32'].includes(name)) return prim(name);
      throw new Error(`${name} is not defined`);
    }
    case 'LiteralType': {
      const lit = node as ParseNode.LiteralType;
      return val(lit.negated ? -(lit.value as number) : lit.value as number | string);
    }
    case 'NumericLiteral': {
      const v = n.value as number | { numberValue(): number };
      // The model universe holds plain numbers, not engine values.
      // eslint-disable-next-line @engine262/mathematical-value
      return val(typeof v === 'number' ? v : v.numberValue());
    }
    case 'TupleType':
      return seq(...(node as ParseNode.TupleType).TupleElementList.map((e) => resolve(e.Type)));
    default:
      throw new Error(`unsupported ${n.type}`);
  }
}

const host: SpecializationMatchHost<M> = {
  resolveFixed: resolve,
  sameArgument: same,
  // A literal refines its base: the relation a type-subject leaf uses.
  structuralMatch: (s, f) => same(s, f) || (s.k === 'lit' && f.k === 'prim' && s.base === f.name),
  constructorOf: (name) => constructors[name.IdentifierReference.name] ?? null,
  arrayOf: (s) => (s.k === 'arr' ? { Extent: s.extent, Element: s.el } : null),
  sequenceOf: (s) => (s.k === 'seq' ? s.els : null),
  makeSequence: (els) => seq(...els),
  metadataOf: (s, meta) => (s.k === 'prim' ? s.meta?.[meta.sourceText] ?? null : null),
  // `Wrap(T)`: a builder, run forward over captures already bound.
  evaluate: (node, env) => {
    const call = node as ParseNode.ComputedType;
    const argument = call.Arguments[0] as unknown as ParseNode.IdentifierReference;
    return app('Wrapped', env.get(argument.name)!);
  },
  // `Small` admits uint8 and uint16.
  satisfiesBound: (v, bound) => bound.sourceText !== 'Small' || same(v, uint8) || same(v, uint16),
};

/** The TypeParameters of `class X<...> {}`, ignoring the early error that selection is not supported. */
function list(entries: string): ParseNode.TypeParameters {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const pop = realm.pushTopContext();
  let script: ParseNode.Script;
  try {
    const parser = new Parser({ source: `class X<${entries}> {}` });
    script = (parser as unknown as { parseScript(): ParseNode.Script }).parseScript();
  } finally {
    pop?.();
  }
  const declaration = script.ScriptBody!.StatementList[0] as ParseNode.ClassDeclaration;
  return declaration.TypeParameters!;
}

const bindings = (r: CaptureBindingRecord<M>[] | 'no-match'): string | Record<string, string> => (r === 'no-match'
  ? r
  : Object.fromEntries(r.map((b) => [b.Capture.Name, show(b.Value)])));

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
