import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

// #sec-specialization-lists: interface specializations. An interface CASE is a
// declaration-level REFINEMENT of its family's contract: it keeps every member
// the primary declares, after substitution, and may add guarantees, which an
// application selecting it requires.

const I = 'interface Store<T: type> { get(): T; } interface Store<boolean> { get(): boolean; bits(): uint8; } ';

test('implementing an application whose case matches means meeting the refined contract', () => {
  expect(evaluated(`${I} class P implements Store.<boolean> { get(): boolean { return true; } bits(): uint8 { return (1 := uint8); } } String(new P().bits());`)).toBe('1');
  expectThrown(`${I} class P implements Store.<boolean> { get(): boolean { return true; } }`, 'declares no member bits');
  // Another application keeps the primary's contract.
  expect(evaluated(`${I} class Q implements Store.<uint8> { get(): uint8 { return (1 := uint8); } } String(new Q().get());`)).toBe('1');
});

test('a case must refine the primary: every member, at an assignable type', () => {
  expectThrown('interface Store<T: type> { get(): T; } interface Store<boolean> { bits(): uint8; }', '`Store<boolean>` does not refine `Store`: it has no `get`');
  expectThrown('interface Store<T: type> { get(): T; } interface Store<boolean> { get(): string; }', 'does not refine `Store`: its `get` is');
});

test('an interface case belongs to an interface primary in its own statement list', () => {
  expectThrown('interface Store<boolean> { get(): boolean; }', 'no `interface Store<...>` in this statement list declares the family it would specialize');
  // A case declares no name of its own, so it is no redeclaration.
  expect(evaluated(`${I} "ok";`)).toBe('ok');
});

test('in a type position, the selected application carries the refined members', () => {
  // An application in a type position selects its case as `implements` does:
  // `Store.<boolean>` has `bits(): uint8`. (The binding path for aliases and
  // interfaces once returned the primary before any case was selected.)
  expectThrown(`${I} function g(s: Store.<boolean>): string { return s.bits(); }`, '"uint.<8>" is not assignable to "string"');
});
