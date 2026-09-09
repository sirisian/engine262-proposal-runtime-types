import { test, expect } from 'vitest';
import { run } from '../harness.mts';
import { MemberOrigins, TypeOrigins } from '#self';

/**
 * #sec-provenance: "A Property Type Record and a Type Record may carry an
 * [[Origin]], a List of references to the declaration sites the record came
 * from." Only the Type Record half was recorded, so a tool could say where a
 * TYPE was declared and not where any of its members was - and a member is what
 * the clause's own motivation is about: "`partial(User)` should not cost an
 * editor its memory of where `name` came from."
 *
 * Keyed on the interned Type Object rather than on the property record, because
 * canonicalization REBUILDS property records: the record a declaration produced
 * is not the record the interned type holds. Keying on the interned type also
 * makes the union fall out, as it does for a Type Record.
 *
 * Host-facing, like the rest of provenance: an embedder or a language server
 * calls `MemberOrigins`, and no program can.
 */

function typeOf(source: string): object {
  const completion = run(source) as { Type: string, Value?: unknown };
  expect(completion.Type).toBe('normal');
  return completion.Value as object;
}

test('a declared member carries its OWN position, not the type\'s', () => {
  const t = typeOf('type User = {\n  name: string,\n  age: uint8\n};\nUser;');
  const [name] = MemberOrigins(t, 'name');
  const [age] = MemberOrigins(t, 'age');
  expect(name?.line).toBe(2);
  expect(age?.line).toBe(3);
  // The type's own origin is the declaration, which is a different position.
  expect(TypeOrigins(t)[0]?.line).toBe(1);
  // And the offsets slice the member's text without re-parsing.
  expect(age!.endIndex).toBeGreaterThan(age!.startIndex);
});

test('an interface member is recorded too, since it is the same declaration form', () => {
  const t = typeOf('interface I {\n  name: string\n}\nI;');
  expect(MemberOrigins(t, 'name')[0]?.line).toBe(2);
});

test('origins union across structurally identical declarations', () => {
  // Two declarations, one interned type, both sites on the member - which is the
  // union #sec-provenance specifies, and the reason the channel is host-facing:
  // a program reading this would see its own type change when an unrelated
  // module declared the same shape.
  const t = typeOf('type A = { q: string };\ntype B = { q: string };\nA;');
  expect(MemberOrigins(t, 'q').map((o) => o.line)).toEqual([1, 2]);
});

test('a member a builder minted has none, and the application is the fallback', () => {
  // "A record a builder mints carries no [[Origin]] ... nothing declared it."
  const t = typeOf('Reflect.makeType({ kind: "object", indexSignatures: [], properties:'
    + ' [{ name: "name", type: type string, optional: false, readonly: false }] });');
  expect(MemberOrigins(t, 'name')).toEqual([]);
  expect(TypeOrigins(t)).toEqual([]);
});

test('a class carries an origin, as every other declaration form does', () => {
  // It carried none, while an alias, an interface and an enum all did - so a tool
  // could say where every other form was written and nothing about a class,
  // which is the form most often asked about. Found while asking how a NOMINAL
  // type could be named in an expansion artifact: a declaration cannot cross a
  // wire, so the stable name has to come from somewhere, and provenance is where.
  const cls = typeOf('class C {}\nC;');
  expect(TypeOrigins(cls)[0]?.name).toBe('C');
  expect(TypeOrigins(cls)[0]?.kind).toBe('ClassDeclaration');
  // A generic class records on both the generic Type Object and the constructor,
  // because a tool may hold either and it is the same question.
  const generic = typeOf('class G<T> { v: T; }\nG;');
  expect(TypeOrigins(generic)[0]?.name).toBe('G');
});

test('a key that was never declared has none', () => {
  const t = typeOf('type User = { name: string }; User;');
  expect(MemberOrigins(t, 'nope')).toEqual([]);
});
