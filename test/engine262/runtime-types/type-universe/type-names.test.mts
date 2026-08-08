import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * Spec: #sec-type-names (Type Names).
 *
 * The built-in type names are global bindings whose values are the interned
 * Type Objects - first-class, alias-stable, reported by Reflect.typeOf - and
 * none of it exists with the feature off.
 */

function run(source: string, runtimeTypes = true) {
  setSurroundingAgent(new Agent(runtimeTypes ? { features: ['runtime-types'] } : {}));
  const realm = new ManagedRealm();
  return realm.evaluateScriptSkipDebugger(source);
}

function evaluated(source: string, runtimeTypes = true): string {
  const completion = run(source, runtimeTypes);
  expect(completion).toMatchObject({ Type: 'normal' });
  return (completion as unknown as { Value: { stringValue(): string } }).Value.stringValue();
}

test('type names are global Type Object bindings', () => {
  expect(evaluated('uint8 === type uint8 ? "same" : "different";')).toBe('same');
  expect(evaluated('((5 := uint8) instanceof uint8) && !(5 instanceof uint8) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('int8 === (type int.<8>) ? "same" : "different";')).toBe('same');
  // Types are first-class values.
  expect(evaluated('function member(T, v) { return v instanceof T; } member(uint8, (7 := uint8)) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('type A = uint8; A === uint8 ? "same" : "different";')).toBe('same');
});

test('Reflect.typeOf returns the interned run-time type', () => {
  expect(evaluated('Reflect.typeOf("s") === (type string) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('Reflect.typeOf(5) === (type number) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('Reflect.typeOf((5 := uint8)) === uint8 ? "ok" : "no";')).toBe('ok');
  expect(evaluated('Reflect.typeOf(true) === (type boolean) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('Reflect.typeOf(Reflect.typeOf(1)) === Reflect.typeOf({}) ? "ok" : "no";')).toBe('ok');
});

test('feature off: no globals, no Reflect.typeOf', () => {
  expect(evaluated('typeof uint8 === "undefined" ? "ok" : "no";', false)).toBe('ok');
  expect(evaluated('Reflect.typeOf === undefined ? "ok" : "no";', false)).toBe('ok');
});
