// SignatureRecord carries its declared type parameters as Type Parameter
// Records - name, kind (type vs value), variance, arity, constraint and
// default NODES - and the checker's string-list side field is retired. The
// records are what identity up to renaming, subtyping, overload viability, and
// reflection read; this file pins what works today and what is still owed.
import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

test('a generic method signature in an interface keeps its type parameters', () => {
  // functionRecordFromSignature was called WITHOUT the member's TypeParameters,
  // so `T` in the parameter types had nothing to resolve to; it now resolves
  // under a frame of ~parameter~ records and the signature record carries them.
  expect(evaluated("interface I { map<T: type>(x: T): T; } let a: I = { map(x) { return x; } }; 'ok';")).toBe('ok');
  expect(evaluated("class Event {} interface Bus { on<T: type extends Event>(name: string, h: (e: T) => void): void; } 'declared';")).toBe('declared');
});

test('explicit named type arguments bind through the records at a call', () => {
  expect(evaluated('function fill<T: type = uint8, N: uint32 = 4>(): uint32 { return N; } String(fill.<N: 8>());')).toBe('8');
});

// Overload sets with a generic member:
test('a CONCRETE call on a mixed overload set resolves to the concrete member', () => {
  // Was: '"T" is not defined' - the declared-overload runtime path resolved
  // the generic member's parameter types with no frame, so even the call that
  // never needed the generic member crashed. The member now resolves under a
  // frame of ~parameter~ records and ranks at the Generic tier, below concrete.
  expect(evaluated("function r(e: uint8): string { return 'u8'; } function r<T: type>(e: T): string { return 'g'; } String(r(1));")).toBe('u8');
});

test('a generic member is viable where no concrete member accepts', () => {
  // Was: 'no declared signature accepts an argument of type "string"' - the
  // generic member was never viable. Its type parameter admits the argument at
  // the Generic tier; the call that selects it binds T from the argument.
  expect(evaluated("function r(e: uint8): string { return 'u8'; } function r<T: type>(e: T): string { return 'g'; } String(r('s'));")).toBe('g');
});

test('a literal that adopts a generic contextual signature is a generic value', () => {
  // #sec-annotations-on-the-remaining-function-forms: "a method keeps its
  // declarations; context supplies only positions without annotations". The
  // type-parameter list of an untyped literal method is such a position, and
  // the checker's signature for it is the contextual `<T>(x: T) => T`. The VALUE
  // the literal creates is that too - or the boundary check's promise, that a
  // value entering a typed position IS of that type, was broken for exactly one
  // kind of value: the program passed the check and `o.map.<uint8>(x)` was
  // refused at run time as a non-generic callable. TypeScript's contextual
  // signature instantiation is the same commitment. See open-questions-round-2, Q3.
  expect(evaluated('interface J { map<T: type>(x: T): T; } let o: J = { map(x) { return x; } }; String(o.map.<uint8>((1 := uint8)));')).toBe('1');
  expect(evaluated("type I = { map<T: type>(x: T): T }; let o: I = { map(x) { return x; } }; String(o.map.<string>('s'));")).toBe('s');
  // A method that declares its own keeps its own.
  expect(evaluated('interface J { map<T: type>(x: T): T; } let o: J = { map<U: type>(x: U): U { return x; } }; String(o.map.<uint8>((2 := uint8)));')).toBe('2');
  // No contextual signature, nothing to adopt: still refused, as
  // #sec-type-arguments-and-placement-new-in-expression-position says.
  expect(evaluated('const o = { m() { return 1; } }; try { o.m.<uint8>(); "ran"; } catch (e) { e.constructor.name; }')).toBe('TypeError');
});

test('an interface method signature carries its type parameters at run time', () => {
  // The run-time interface builder computed the method's type parameters for
  // its frame and then did not pass them to the signature record, so `map<T>`
  // was `(x: T) => T` at run time - the same drop the checker's object-type
  // path had, on the other path and the other side.
  expect(evaluated('interface J { map<T: type>(x: T): T; } interface K { map<U: type>(x: U): U; } String((type J) === (type K));')).toBe('false');
  expect(evaluated('interface J { map<T: type>(x: T): T; } function take(j: J) { return j.map.<uint8>((3 := uint8)); } String(take({ map(x) { return x; } }));')).toBe('3');
});
