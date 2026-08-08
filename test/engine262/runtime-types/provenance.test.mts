import { test, expect } from 'vitest';
import {
  Agent, ManagedRealm, setSurroundingAgent, TypeOrigins,
} from '#self';

/**
 * Spec: #sec-provenance (Provenance) - the declaration sites a type came from,
 * carried beside the interned Type Object and never inside it.
 *
 * This is the channel structural typing makes necessary. `type A = { x: float64 }`
 * and `type B = { x: float64 }` intern to ONE Type Object, which is what lets two
 * modules agree without a registry, and the cost is that the object no longer
 * knows where it came from. Rust never meets this because it is nominal;
 * TypeScript meets it and answers it the same way, by hanging declaration links
 * off the type.
 *
 * It is deliberately NOT reflected. The consumer is a tool, and a program that
 * could read it would see its own type's origins change because an unrelated
 * module declared a structurally identical shape.
 */
function run(source: string) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const completion = realm.evaluateScriptSkipDebugger(source);
  expect(completion, `expected normal completion for: ${source}`).toMatchObject({ Type: 'normal' });
  return realm;
}

/** Read a type back out of the realm by the global it was stashed on. */
function typeNamed(realm: ManagedRealm, name: string) {
  const completion = realm.evaluateScriptSkipDebugger(`globalThis.${name};`) as { Value: object };
  return completion.Value;
}

test('provenance: a declaration records its site', () => {
  const realm = run(`
    type Point = { x: float64, y: float64 };
    globalThis.P = Point;
    "ok";
  `);
  const origins = TypeOrigins(typeNamed(realm, 'P'));
  expect(origins).toHaveLength(1);
  expect(origins[0].kind).toBe('TypeAliasDeclaration');
  expect(origins[0].name).toBe('Point');
  // an opaque handle: a position, never the parse node
  expect(origins[0].line).toBeGreaterThan(0);
  expect(origins[0].endIndex).toBeGreaterThan(origins[0].startIndex);
});

test('provenance: two declarations of one shape UNION on the interned type', () => {
  // this is the case the channel exists for, and the reason canonicalization is
  // specified to union rather than to pick
  const realm = run(`
    type A = { x: float64 };
    type B = { x: float64 };
    globalThis.A = A; globalThis.B = B;
    "ok";
  `);
  // interning made them one object
  expect(typeNamed(realm, 'A')).toBe(typeNamed(realm, 'B'));
  const origins = TypeOrigins(typeNamed(realm, 'A'));
  expect(origins).toHaveLength(2);
  expect(origins.map((o) => o.name).sort()).toEqual(['A', 'B']);
  // and reading through either name gives the same union, since it is one object
  expect(TypeOrigins(typeNamed(realm, 'B'))).toHaveLength(2);
});

test('provenance: a different shape keeps its own site', () => {
  const realm = run(`
    type A = { x: float64 };
    type C = { y: float64 };
    globalThis.A = A; globalThis.C = C;
    "ok";
  `);
  expect(TypeOrigins(typeNamed(realm, 'A'))).toHaveLength(1);
  expect(TypeOrigins(typeNamed(realm, 'C'))).toHaveLength(1);
  expect(TypeOrigins(typeNamed(realm, 'C'))[0].name).toBe('C');
});

test('provenance: interfaces and enums record their form', () => {
  const realm = run(`
    interface Shape { area: float64 }
    enum Colour { Red, Green }
    globalThis.S = Shape; globalThis.Col = Colour;
    "ok";
  `);
  expect(TypeOrigins(typeNamed(realm, 'S'))[0].kind).toBe('InterfaceDeclaration');
  expect(TypeOrigins(typeNamed(realm, 'S'))[0].name).toBe('Shape');
  expect(TypeOrigins(typeNamed(realm, 'Col'))[0].kind).toBe('EnumDeclaration');
});

test('provenance: identity does not read it', () => {
  // the whole point of keeping origins beside the record rather than in it: two
  // declarations with different origins are still one type
  const realm = run(`
    type A = { x: float64 };
    type B = { x: float64 };
    globalThis.same = (A === B);
    globalThis.A = A;
    "ok";
  `);
  const completion = realm.evaluateScriptSkipDebugger('String(globalThis.same);') as { Value: { stringValue(): string } };
  expect(completion.Value.stringValue()).toBe('true');
  // and the type carries both sites while being one type
  expect(TypeOrigins(typeNamed(realm, 'A'))).toHaveLength(2);
});

test('provenance: no program can read it', () => {
  // not on the reflection, not on the Type Object, not on Reflect
  const realm = run(`
    type A = { x: float64 };
    globalThis.r = Reflect.getReflection(A);
    globalThis.probe = String(("origin" in Reflect.getReflection(A)) + "/" + ("origin" in A) + "/" + (typeof Reflect.getOrigin));
    "ok";
  `);
  const completion = realm.evaluateScriptSkipDebugger('globalThis.probe;') as { Value: { stringValue(): string } };
  expect(completion.Value.stringValue()).toBe('false/false/undefined');
});

test('provenance: a type with no declaration has no origins', () => {
  // a builtin reached by name was declared by nobody, and an empty list is the
  // correct answer rather than a missing one
  const realm = run('globalThis.T = type float64; "ok";');
  expect(TypeOrigins(typeNamed(realm, 'T'))).toHaveLength(0);
});
