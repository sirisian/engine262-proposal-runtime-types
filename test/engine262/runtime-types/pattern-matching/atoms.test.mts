import { test, expect } from 'vitest';
import {
  Agent, Atoms, AtomsOfType, ManagedRealm, setSurroundingAgent,
} from '#self';

/**
 * PLAN-discriminated-where-chains stage C: `Atoms(t)`, from
 * `sec-match-exhaustiveness`.
 *
 * The specification names seven sources; the engine implemented two, each by its
 * own path, and the other five accepted programs the specification rejects.
 * This is the operation those two were halves of.
 */

const P = (Name: string) => ({ Kind: 'primitive', Name } as never);
const L = (Value: unknown) => ({ Kind: 'literal', Value, Base: P('string') } as never);
const O = (v: string) => ({
  Kind: 'object',
  Properties: [{
    key: 'c', type: L(v), optional: false, readonly: false,
  }],
  IndexSignatures: [],
} as never);
const U = (...Members: unknown[]) => ({ Kind: 'union', Members } as never);

function atoms(t: unknown): string {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  void new ManagedRealm();
  const found = Atoms(t as never);
  return found.length > 0 ? found.map((a) => a.key).join(',') : 'none';
}

test('`boolean` has two atoms, `null` and `undefined` one each', () => {
  expect(atoms(P('boolean'))).toBe('true,false');
  expect(atoms(P('null'))).toBe('null');
  expect(atoms(P('undefined'))).toBe('undefined');
  // "and ~none~ otherwise" - an open universe needs a catch-all.
  expect(atoms(P('string'))).toBe('none');
  expect(atoms(P('uint8'))).toBe('none');
});

test('an OBJECT is its own atom, which is what makes a denoted union checkable', () => {
  expect(atoms(O('US'))).toBe('{c:"US"}');
  expect(atoms(U(O('US'), O('CA')))).toBe('{c:"US"},{c:"CA"}');
});

test('a union with a LITERAL member has atoms NONE', () => {
  // The clause states it as its own sentence, and it is the standing decision
  // restated: "a closed set of literals that wants the check is an enum over its
  // base". **One literal member disqualifies the whole union** - so this is not
  // "literals contribute nothing", it is stronger.
  expect(atoms(U(L('A'), L('B')))).toBe('none');
  expect(atoms(U(O('US'), L('A')))).toBe('none');
});

test('a union mixes sources', () => {
  expect(atoms(U(P('boolean'), O('X')))).toBe('true,false,{c:"X"}');
});

test('an INTERSECTION distributes its unions', () => {
  // "the atoms of the union formed by distributing it, one member per choice of
  // one arm from each such union intersected with the remaining members".
  expect(atoms({ Kind: 'intersection', Members: [U(O('US'), O('CA'))] })).toBe('{c:"US"},{c:"CA"}');
  // An intersection with no union member has no atoms.
  expect(atoms({ Kind: 'intersection', Members: [O('US')] })).toBe('none');
});

test('a union of fewer than two members has no atoms', () => {
  expect(atoms(U(O('US')))).toBe('none');
});

test('a DEPENDENT RECORD TYPE takes the atoms of the union its chain denotes', () => {
  // The whole plan in one assertion: `sec-match-exhaustiveness` says "for a
  // dependent record type whose predicate is a discriminating `where` chain, the
  // atoms of the union that chain denotes", and this is that path end to end -
  // record to declaration to chain to denoted union to atoms.
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const of = (source: string): string => {
    const t = (realm.evaluateScriptSkipDebugger(source) as { Value?: { TypeRecord?: unknown, Record?: unknown } }).Value;
    const found = AtomsOfType((t?.TypeRecord ?? t?.Record) as never);
    return found.length > 0 ? found.map((a) => a.key).join(' | ') : 'none';
  };
  expect(of("type A = { s: string, c: 'US'|'CA' } where if (this.c == 'US') { this is { p: string } } else { this is { p: string } }; (type A);"))
    .toBe('{s:primitive,c:"US"} | {s:primitive,c:"CA"}');
  expect(of("type B = { s: string, c: 'US'|'CA' } where match (this.c) { when 'US': this is { p: string }; when 'CA': this is { p: string }; }; (type B);"))
    .toBe('{s:primitive,c:"US"} | {s:primitive,c:"CA"}');
  // A terminal `else` covers the constants the earlier branches did not.
  expect(of("type C = { c: 'A'|'B'|'D' } where if (this.c == 'A') { this is { p: string } } else { this is { p: string } }; (type C);"))
    .toBe('{c:"A"} | {c:"B"} | {c:"D"}');
  // **Distinct keys matter.** Both branch atoms once keyed as `[object Object]`
  // - a type-record literal carries an engine Value, not a raw string - so a
  // two-member union was ONE key and coverage could not have told them apart.
  // A `match` covering only the first would have looked exhaustive.
  expect(of("type D = { c: 'A'|'B' } where if (this.c == 'A') { this is { p: string } }; (type D);")).toBe('none');
  expect(of("type E = { c: 'A'|'B' } where (this.c != null); (type E);")).toBe('none');
});
