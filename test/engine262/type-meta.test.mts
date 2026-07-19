import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

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

test('the default hook supplies uninitialized annotated bindings', () => {
  expect(evaluated('meta uint8 { default = 7; } let x: uint8; x === (7 := uint8) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('type T = uint8 | string; meta T { default = "d"; } let s: T; s === "d" ? "ok" : "no";')).toBe('ok');
  // Without a registered default, undefined as today.
  expect(evaluated('let y: uint8 = 3; let z: string; z === undefined && y === (3 := uint8) ? "ok" : "no";')).toBe('ok');
  // An initializer wins over the default.
  expect(evaluated('meta uint8 { default = 7; } let x: uint8 = 2; x === (2 := uint8) ? "ok" : "no";')).toBe('ok');
});

test('method hooks are name-checked at parse time', () => {
  expect(run('meta uint8 { default = 0; validate(v, c) { return true; } }')).toMatchObject({ Type: 'normal' });
  expect(run('meta uint8 { default = 0; subtype(a, b) { return true; } narrow(c, o, v) { return c; } }')).toMatchObject({ Type: 'normal' });
  expect(run('meta uint8 { default = 0; frobnicate(v) { return v; } }')).toMatchObject({ Type: 'throw' });
});
