import { test, expect } from 'vitest';
import { Agent, Atoms, ManagedRealm, setSurroundingAgent } from '#self';

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
  // "and ~none~ otherwise" — an open universe needs a catch-all.
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
  // base". **One literal member disqualifies the whole union** — so this is not
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
