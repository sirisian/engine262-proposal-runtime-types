import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';
import {
  Agent, Atoms, AtomsOfType, ManagedRealm, setSurroundingAgent,
} from '#self';

/**
 * Spec: #sec-match-exhaustiveness (Match Exhaustiveness).
 *
 * #sec-match-exhaustiveness: "A `match` over an enum-typed or
 * sealed-class-typed subject is exhaustive under the same rules a `switch` is,
 * and this clause adds no new ones - it SHARES them."
 *
 * So this extends `check.mts`'s `SwitchStatement` machinery and reads the same
 * enum-name table the `EnumDeclaration` case already builds, rather than
 * building a second one that could disagree with it.
 */

const outcome = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);
const E = 'enum E { A, B } ';

test('a match covering every enumerator needs NO default', () => {
  expect(outcome(`${E} function f(e: E) { return match (e) { when E.A: 1; when E.B: 2; }; } f(E.A);`)).toBe('ACCEPTED');
});

test('a match MISSING an enumerator and lacking a default is refused', () => {
  // The assertion that says the check is doing work rather than passing
  // everything - and the one the first version of this pin failed to make,
  // because it only tested the covered case.
  expect(outcome(`${E} function f(e: E) { return match (e) { when E.A: 1; }; } f(E.A);`)).toBe('TypeError');
  expect(outcome(`${E} function f(e: E) { return match (e) { when E.A: 1; default: 0; }; } f(E.A);`)).toBe('ACCEPTED');
});

test('A GUARDED ARM PROVES NOTHING', () => {
  // "Since the checker does not evaluate guards." A guarded clause does not
  // count towards coverage however exhaustive its pattern looks - which is what
  // keeps exhaustiveness a STATIC claim rather than an optimistic one.
  expect(outcome(`${E} function f(e: E) { return match (e) { when E.A: 1; when E.B if (true): 2; }; } f(E.A);`)).toBe('TypeError');
  // The same clauses with the guard removed are exhaustive.
  expect(outcome(`${E} function f(e: E) { return match (e) { when E.A: 1; when E.B: 2; }; } f(E.A);`)).toBe('ACCEPTED');
});

test('the SWITCH machinery it extends is unchanged', () => {
  // Both forms read one enum-name table, so they cannot disagree about what an
  // enum's members are.
  expect(outcome(`${E} function f(e: E) { switch (e) { case E.A: return 1; case E.B: return 2; } } f(E.A);`)).toBe('ACCEPTED');
  expect(outcome(`${E} function f(e: E) { switch (e) { case E.A: return 1; } } f(E.A);`)).toBe('TypeError');
});

test('the shapes an enumerator arrives in differ by position', () => {
  // `E.A` as a PATTERN is a TypeReference whose TypeName carries an
  // IdentifierReference and a list of MemberNames; as a switch CASE LABEL it is
  // a MemberExpression, an expression. Reading the label shape in the pattern
  // position found nothing, so every clause looked uncovered and an exhaustive
  // `match` was reported as missing EVERY member - a check that fires on
  // correct code, which is worse than one that never fires.
  expect(outcome(`${E} function f(e: E) { return match (e) { when E.A: 1; when E.B: 2; }; } f(E.A);`)).toBe('ACCEPTED');
  // A label that is not an enumerator of the subject's enum does not count.
  expect(outcome(`${E} enum F { C } function f(e: E) { return match (e) { when E.A: 1; when F.C: 2; }; } f(E.A);`)).toBe('TypeError');
});

test('what the checker half still lacks', () => {
  // NARROWING per pattern form - a bound name types loosely rather than as the
  // pattern established - and LITERAL PROPAGATION into patterns, where
  // `when 27:` against a `uint8` field should be a `uint8` 27.
  expect(evaluated('String(typeof (1 is 1));')).toBe('boolean');
  // Sealed-class exhaustiveness landed - see below.
});


test('a SEALED class is a closed set too', () => {
  // README: "A `sealed` class restricts `extends` to the module that declares
  // it. The set of direct subclasses is therefore FIXED AND KNOWN when the
  // module finishes evaluating." There is no `permits` clause to read - the set
  // is whatever the declaration list holds.
  const outcome8 = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);
  const S = 'sealed class S {} class T extends S {} class U extends S {} ';
  expect(outcome8(`${S} function f(s: S) { return match (s) { when T: 1; when U: 2; }; } f(new T());`)).toBe('ACCEPTED');
  expect(outcome8(`${S} function f(s: S) { return match (s) { when T: 1; }; } f(new T());`)).toBe('TypeError');
  expect(outcome8(`${S} function f(s: S) { return match (s) { when T: 1; default: 0; }; } f(new T());`)).toBe('ACCEPTED');
  // A guarded arm proves nothing, for the same reason it proves nothing over an
  // enum: the checker does not evaluate guards.
  expect(outcome8(`${S} function f(s: S) { return match (s) { when T: 1; when U if (true): 2; }; } f(new T());`)).toBe('TypeError');
  // An UNSEALED base is not a closed set, so nothing is required of it - which
  // is what says the check reads `sealed` rather than any class hierarchy.
  expect(outcome8('class B {} class C extends B {} function f(b: B) { return match (b) { when C: 1; }; } f(new C());')).toBe('ACCEPTED');
});

test('the shape a class instance type carries', () => {
  // A class instance type carries a `Declaration` NODE, not a `Name` - and an
  // earlier attempt at this check looked for a name, found nothing, and was
  // SILENTLY INERT: every probe returned ACCEPTED including the one that should
  // have failed. It was reverted rather than shipped, because inert code that
  // looks implemented is worse than an open gap.
  //
  // Keying by node also settles shadowing for free, which a name could not.
  const outcome9 = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);
  expect(outcome9('sealed class S {} class T extends S {} function f(s: S) { return match (s) { when T: 1; }; } f(new T());')).toBe('ACCEPTED');
  // A subclass declared BEFORE its sealed base is still collected, since the
  // set is fixed when the MODULE finishes rather than when a declaration is
  // reached - which is why the linking is a second pass.
  expect(outcome9('class T extends S {} sealed class S {} class U extends S {} function f(s: S) { return match (s) { when T: 1; }; } f(new T());')).toBe('TypeError');
});

// -- Atoms(t) --------------------------------------------------------------------

/**
 * Spec: #sec-match-exhaustiveness - `Atoms(t)`.
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
  // The whole plan in one assertion: #sec-match-exhaustiveness says "for a
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
