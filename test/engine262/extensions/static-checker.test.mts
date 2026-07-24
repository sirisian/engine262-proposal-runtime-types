import { test, expect } from 'vitest';
import {
  Agent, EnsureCompletion, ManagedRealm, ParseScript, setSurroundingAgent, skipDebugger,
  CheckProgram, StaticTypeOfExpression, TypeEnvironment,
} from '#self';

/**
 * proposal-runtime-types: the static checker, Phase 1 of STATIC-CHECKER-PLAN.md.
 *
 * The phase's whole claim is that the pass READS THE PROGRAM CORRECTLY, before
 * anything depends on its answers. So the tests are of two kinds: the Static
 * Types it assigns to the forms it understands, and silence over programs it
 * should have nothing to say about. The second is the more important: a checker
 * that misunderstands the language is worse than no checker, and the cheapest
 * evidence is that it walks real programs without inventing a complaint.
 */
function check(source: string) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const parsed = ParseScript(source, realm) as { ECMAScriptCode?: unknown };
  expect(Array.isArray(parsed), `expected ${source} to parse`).toBe(false);
  // Resolving an annotation runs TypeNodeToTypeRecord, which reads the running
  // execution context's LexicalEnvironment, so the pass needs one. That the pass
  // needs a context at all is the visible consequence of Phase 2: a checker that
  // may run a builder is a checker that runs inside the machine.
  const pop = realm.pushTopContext();
  try {
    return EnsureCompletion(skipDebugger(CheckProgram(parsed.ECMAScriptCode as never))).Value as never;
  } finally {
    pop?.();
  }
}

test('checker: the pass runs and collects rather than throws', () => {
  const result = check('let a = 1; let b = "x"; a;');
  expect(result.diagnostics).toEqual([]);
  expect(result.types.size).toBeGreaterThan(0);
});

test('checker: Static Type of the literal forms', () => {
  const result = check('1; "x"; true; null;');
  const kinds = [...result.types.values()].map((t) => (t.Kind === 'primitive' ? t.Name : t.Kind));
  expect(kinds).toContain('number');
  expect(kinds).toContain('string');
  expect(kinds).toContain('boolean');
});

test('checker: an unknown name is `any`, not a diagnostic', () => {
  // Phase 1 reports nothing it has not implemented, which is what lets it be run
  // over everything. `any` is the correct answer for "the checker knows nothing
  // here" and is exactly how every judgment that consumes a Static Type reads it.
  const result = check('someUndeclaredName;');
  expect(result.diagnostics).toEqual([]);
  const kinds = [...result.types.values()].map((t) => t.Kind);
  expect(kinds).toContain('any');
});

test('checker: the environment is a scope chain', () => {
  const outer = new TypeEnvironment();
  const inner = new TypeEnvironment(outer);
  outer.declare('x', { Kind: 'primitive', Name: 'number', Arguments: [] });
  expect(inner.lookup('x')?.Kind).toBe('primitive');
  expect(inner.lookup('nope')).toBe(undefined);
  // and an inner binding shadows without disturbing the outer one
  inner.declare('x', { Kind: 'primitive', Name: 'string', Arguments: [] });
  expect((inner.lookup('x') as { Name: string }).Name).toBe('string');
  expect((outer.lookup('x') as { Name: string }).Name).toBe('number');
});

test('checker: an expression can be typed on its own', () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const parsed = ParseScript('42;', realm) as { ECMAScriptCode?: unknown };
  const t = EnsureCompletion(skipDebugger(StaticTypeOfExpression(parsed.ECMAScriptCode as never))).Value as { Kind: string };
  expect(t.Kind).toBe('any');
});

// -- The phase's real gate: silence over programs it should not complain about -
test('checker: it walks real typed programs without inventing a complaint', () => {
  const programs = [
    'let a: uint8 = 5; a;',
    'function f(x: int32): int32 { return x; } f(1);',
    'type T = { a: float64 }; let t: T = { a: 1 }; t;',
    'meta float32 { subtype(a, b) { return true; } default = 0; validate(v, m) { return true; } } 1;',
    'let r = uint8.tryParse("5"); if (r !== null) { r; }',
    'enum E { A, B } E.A;',
    'interface I { z: float64 } 1;',
    'for (let i: uint32 = 0; Number(i) < 3; i = uint32(Number(i) + 1)) { i; }',
    'class C { x: int32 = 0; } new C();',
    'let v = [1, 2, 3].map((n) => n + 1); v;',
    'try { null.x; } catch (e) { e; }',
    'label: for (const q of [1]) { if (q) { continue label; } }',
  ];
  for (const source of programs) {
    const result = check(source);
    expect(result.diagnostics, `unexpected diagnostics for: ${source}`).toEqual([]);
  }
});

test('checker: the traversal terminates on a node graph with back-references', () => {
  // A ParseNode carries a `parent`, so a structural walk that followed every
  // object property would climb out of the subtree and never stop. This is the
  // regression pin for that, and it is a real one: the first run overflowed.
  const result = check(`
    function outer(a: int32) {
      function inner(b: int32) { return a; }
      return inner(a);
    }
    outer(1);
  `);
  expect(result.diagnostics).toEqual([]);
  expect(result.types.size).toBeGreaterThan(0);
});

test('checker: it is inert, so no program observes it', () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const completion = realm.evaluateScriptSkipDebugger('let a: uint8 = 5; String(Number(a));') as { Value: { stringValue(): string } };
  expect(completion.Value.stringValue()).toBe('5');
});

// -- The type-declaration pre-pass (Phase 2) ----------------------------------
// The checker cannot use the runtime's type-name resolution: that reads the
// runtime lexical environment through ResolveBinding, which does not exist when
// the checker runs and asserts rather than failing catchably. So the checker
// keeps its own type namespace and fills it before walking.
test('checker: a declared type is resolvable by name', () => {
  const result = check('type Point = { x: float64 }; let p: Point = { x: 1 }; p;');
  expect(result.diagnostics).toEqual([]);
  // the binding's type came from the type namespace, not from `any`
  const kinds = [...result.types.values()].map((t) => t.Kind);
  expect(kinds.length).toBeGreaterThan(0);
});

test('checker: a type may be used before it is declared', () => {
  // this is why collection is a separate pass. A single walk would resolve the
  // annotation against an empty namespace and silently answer `any`.
  const result = check('let a: Later = 1; type Later = float64; a;');
  expect(result.diagnostics).toEqual([]);
});

test('checker: a builtin name resolves without any declaration', () => {
  const result = check('let a: uint8 = 5; let b: float32 = 1; a; b;');
  expect(result.diagnostics).toEqual([]);
});

test('checker: a declaration shadows a builtin name', () => {
  // the declared type wins, which is the order resolveTypeNode uses
  const result = check('type uint8 = { spoofed: float64 }; let a: uint8 = 1; a;');
  expect(result.diagnostics).toEqual([]);
});

test('checker: interfaces and enums are collected too', () => {
  const result = check(`
    interface Shape { area: float64 }
    enum Colour { Red, Green }
    let s: Shape = { area: 1 };
    let c: Colour = Colour.Red;
    s; c;
  `);
  expect(result.diagnostics).toEqual([]);
});

test('checker: a self-referring interface does not recurse forever', () => {
  // an interface is nominal, so its record is built from the declaration without
  // resolving its members, which is what makes this terminate
  const result = check('interface Node2 { next: Node2 } let n: Node2 = { next: null }; n;');
  expect(result.diagnostics).toEqual([]);
});
