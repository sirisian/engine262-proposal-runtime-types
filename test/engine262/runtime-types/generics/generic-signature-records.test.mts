// SignatureRecord carries its declared type parameters as Type Parameter
// Records - name, kind (type vs value, F166), variance, arity, constraint and
// default NODES - and the checker's string-list side field is retired. The
// records are what identity up to renaming, subtyping, overload viability, and
// reflection read; this file pins what works today and what is still owed.
import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

test('a generic method signature in an interface keeps its type parameters', () => {
  // functionRecordFromSignature was called WITHOUT the member's TypeParameters,
  // so `T` in the parameter types had nothing to resolve to; it now resolves
  // under a frame of ~parameter~ records and the signature record carries them.
  expect(evaluated("interface I { map<T>(x: T): T; } let a: I = { map(x) { return x; } }; 'ok';")).toBe('ok');
  expect(evaluated("interface Bus { on<T extends Event>(name: string, h: (e: T) => void): void; } 'declared';")).toBe('declared');
});

test('explicit named type arguments bind through the records at a call', () => {
  expect(evaluated('function fill<T = uint8, N: uint32 = 4>(): uint32 { return N; } String(fill.<N: 8>());')).toBe('8');
});

// Overload sets with a generic member:
test('a CONCRETE call on a mixed overload set resolves to the concrete member', () => {
  // Was: '"T" is not defined' - the declared-overload runtime path resolved
  // the generic member's parameter types with no frame, so even the call that
  // never needed the generic member crashed. The member now resolves under a
  // frame of ~parameter~ records and ranks at the Generic tier, below concrete.
  expect(evaluated("function r(e: uint8): string { return 'u8'; } function r<T>(e: T): string { return 'g'; } String(r(1));")).toBe('u8');
});

test('a generic member is viable where no concrete member accepts', () => {
  // Was: 'no declared signature accepts an argument of type "string"' - the
  // generic member was never viable. Its type parameter admits the argument at
  // the Generic tier; the call that selects it binds T from the argument.
  expect(evaluated("function r(e: uint8): string { return 'u8'; } function r<T>(e: T): string { return 'g'; } String(r('s'));")).toBe('g');
});
