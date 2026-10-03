import { expect, test } from 'vitest';
import { ok } from '../harness.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, Get, Value, X, TypeDiagnosticOf, type ObjectValue, type JSStringValue } from '#self';

// #sec-checked-code: direct eval code inherits its caller's classification, as
// it inherits the caller's strictness, since it sees the caller's typed
// bindings. Indirect eval and a dynamically constructed function classify their
// own source, and a unit inside either still classifies itself.

test.each([
  "eval('if ([]) {}');",
  "function f(p: number) { (0, eval)('if ([]) {}'); } f(1);",
  "function f(p: number) { new Function('if ([]) {}'); } f(1);",
])("code whose own source is unchecked keeps its behaviour: %s", (source) => {
  expect(ok(`${source} 'ok';`)).toBe(true);
});

test.each([
  "function f(p: number) { eval('if ([]) {}'); } f(1);",
  "eval('function g(p: number) { if ([]) {} }');",
  "new Function('p: number', 'if ([]) {}');",
  "new Function('let z: number = 1; if ([]) {}');",
  "new Function('function g(q: number) { if ([]) {} }');",
])("checked eval or function code is refused when it runs: %s", (source) => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  realm.evaluateScriptSkipDebugger('globalThis.outerRan = false; globalThis.innerRan = false;');
  const marked = source.replaceAll("'if ([]) {}'", "'globalThis.innerRan = true; if ([]) {}'");
  const completion = EnsureCompletion(realm.evaluateScriptSkipDebugger(`globalThis.outerRan = true; ${marked}`));
  expect(completion.Type).toBe('throw');
  const flags = EnsureCompletion(realm.evaluateScriptSkipDebugger('String(outerRan) + ":" + String(innerRan);'));
  expect((flags.Value as JSStringValue).stringValue()).toBe('true:false');
  expect(TypeDiagnosticOf(completion.Value)?.code).toBe('RT_CONSTANT_CONDITION');
  const pop = realm.pushTopContext();
  try {
    const ctor = X(Get(completion.Value as ObjectValue, Value('constructor'))) as ObjectValue;
    expect((X(Get(ctor, Value('name'))) as JSStringValue).stringValue()).toBe('StaticTypeError');
  } finally { pop?.(); }
});

test.each([
  'Function', '(function* () {}).constructor', '(async function () {}).constructor', '(async function* () {}).constructor',
])('dynamic %s completes deferred checking during construction', (constructor) => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const completion = EnsureCompletion(realm.evaluateScriptSkipDebugger(`${constructor}('x: float32.<{ unknownKey: 1 }>', 'void x;');`));
  expect(completion.Type).toBe('throw');
  expect(TypeDiagnosticOf(completion.Value)).toMatchObject({ code: 'RT_UNCLAIMED_METADATA', phase: 'pre-evaluation' });
});
