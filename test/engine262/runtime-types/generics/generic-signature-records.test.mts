// PLAN-variadic-and-named-generic-arguments.md Phase 0.1: SignatureRecord
// carries its declared type parameters as Type Parameter Records - name, kind
// (type vs value, F166), variance, arity, constraint and default NODES - and
// the checker's string-list side field is retired. The records are what
// identity up to renaming, subtyping, overload viability, and reflection read
// in the later phases; this file pins what works today and what Phase 5.2
// still owes.
import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

test('a generic method signature in an interface keeps its type parameters (the 0.1 fix)', () => {
  // functionRecordFromSignature was called WITHOUT the member's TypeParameters,
  // so `T` in the parameter types had nothing to resolve to; it now resolves
  // under a frame of ~parameter~ records and the signature record carries them.
  expect(evaluated("interface I { map<T>(x: T): T; } let a: I = { map(x) { return x; } }; 'ok';")).toBe('ok');
  expect(evaluated("interface Bus { on<T extends Event>(name: string, h: (e: T) => void): void; } 'declared';")).toBe('declared');
});

test('explicit named type arguments bind through the records at a call (C1 regression guard)', () => {
  expect(evaluated('function fill<T = uint8, N: uint32 = 4>(): uint32 { return N; } String(fill.<N: 8>());')).toBe('8');
});

// F-G, closed by Phase 5.2 (overload sets with a generic member):
test('a CONCRETE call on a mixed overload set resolves to the concrete member (F-G)', () => {
  // Was: '"T" is not defined' - the declared-overload runtime path resolved
  // the generic member's parameter types with no frame, so even the call that
  // never needed the generic member crashed. The member now resolves under a
  // frame of ~parameter~ records and ranks at the Generic tier, below concrete.
  expect(evaluated("function r(e: uint8): string { return 'u8'; } function r<T>(e: T): string { return 'g'; } String(r(1));")).toBe('u8');
});

test('a generic member is viable where no concrete member accepts (F-G)', () => {
  // Was: 'no declared signature accepts an argument of type "string"' - the
  // generic member was never viable. Its type parameter admits the argument at
  // the Generic tier; the call that selects it binds T from the argument.
  expect(evaluated("function r(e: uint8): string { return 'u8'; } function r<T>(e: T): string { return 'g'; } String(r('s'));")).toBe('g');
});
