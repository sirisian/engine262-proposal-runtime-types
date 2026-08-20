import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * Spec: #sec-primitive-metadata (Primitive Metadata) - the hooks a meta
 * declaration may supply, and what each is asked.
 */

function run(source: string) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  return realm.evaluateScriptSkipDebugger(source);
}

function evaluated(source: string): string {
  const completion = run(source);
  expect(completion).toMatchObject({ Type: 'normal' });
  return (completion as unknown as { Value: { stringValue(): string } }).Value.stringValue();
}

function expectThrown(source: string) {
  expect(run(source)).toMatchObject({ Type: 'throw' });
}

test('the default hook is required', () => {
  expectThrown('meta uint8 { validate(v, c) { return true; } }');
  expect(run('meta uint8 { subtype(a, b) { return true; } default = 0; validate(v, c) { return true; } }')).toMatchObject({ Type: 'normal' });
});

test('method hooks register and compile', () => {
  // A meta declaration with all four hooks compiles and runs.
  expect(evaluated(`meta uint8 {
    default = 0;
    subtype(a, b) { return true; }
    validate(v, c) { return true; }
    narrow(cur, op, val) { return cur; }
    conversionFactor(from, to) { return 1; }
  } "ok";`)).toBe('ok');
});

test('hook names and signatures are checked', () => {
  expectThrown('meta uint8 { subtype(a, b) { return true; } default = 0; frobnicate(v) { return v; } }');
  // Wrong arity for a known hook.
  expectThrown('meta uint8 { subtype(a, b) { return true; } default = 0; validate(v) { return true; } }');
  expectThrown('meta uint8 { subtype(a, b) { return true; } default = 0; narrow(a, b) { return a; } }');
});

test('at most one meta declaration per type', () => {
  expectThrown('meta uint8 { subtype(a, b) { return true; } default = 0; } meta uint8 { subtype(a, b) { return true; } default = 1; }');
  // Distinct types are independent.
  expect(run('meta uint8 { subtype(a, b) { return true; } default = 0; } meta uint16 { subtype(a, b) { return true; } default = 1; }')).toMatchObject({ Type: 'normal' });
});

test('the default hook does NOT supply a binding of the constraint shape', () => {
  // REWRITTEN by PLAN-meta-default-scope.md phase 1, and the reasoning matters
  // because this test was written to protect the old behaviour.
  //
  // It asserted that `meta uint8 { default = 7; } let x: uint8;` yields 7 - a
  // `meta` declaration redefining the zero of a PRIMITIVE. #table-meta-hooks
  // scopes the hook to metadata: "the unconstrained constraint: what a value
  // carries where it has no field of this meta type". It says nothing about
  // what a binding holds before it is assigned, and #sec-defaultvalueof gives
  // `uint8` the zero 0 whatever any meta type says.
  expect(evaluated('meta uint8 { subtype(a, b) { return true; } default = 7; } let x: uint8; x === (0 := uint8) ? "ok" : "no";')).toBe('ok');
  // And the metadata half, which is what the hook is for: an unparameterized
  // value carries the unconstrained constraint.
  expect(evaluated('meta uint8 { subtype(a, b) { return true; } default = 7; } let y: uint8.<7> = (7 := uint8.<7>); String(y);')).toBe('7');
});
