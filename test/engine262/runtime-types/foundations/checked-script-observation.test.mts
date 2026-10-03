import { expect, test } from 'vitest';
import { observeScript, expectEarlyError } from '../harness.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf, type JSStringValue } from '#self';

const inferredFailures = [
  'if ([]) {}',
  'function f() { if ([]) {} }',
  'class C { m() { if ([]) {} } }',
  'let x = 1; if (x === 1) {} else if (x === 1) {}',
];

test.each(inferredFailures)('the same legacy source can be observed before and after checking: %s', (source) => {
  for (const mode of ['disabled', 'automatic'] as const) {
    expect(observeScript(source, mode)).toMatchObject({ completion: { Type: 'normal' }, bodyEntered: true, diagnostic: undefined });
  }
  expect(observeScript(source, 'forced')).toMatchObject({
    completion: { Type: 'throw' }, bodyEntered: false, errorClass: 'StaticTypeError',
    diagnostic: { checked: true, phase: 'static' },
  });
});

test('a dynamic error becomes the intended pre-body error under forced checking', () => {
  const source = 'false();';
  for (const mode of ['disabled', 'automatic'] as const) {
    expect(observeScript(source, mode)).toMatchObject({
      completion: { Type: 'throw' }, bodyEntered: true, errorClass: 'TypeError', diagnostic: undefined,
    });
  }
  expect(observeScript(source, 'forced')).toMatchObject({
    completion: { Type: 'throw' }, bodyEntered: false, errorClass: 'StaticTypeError',
    diagnostic: { code: 'RT_NOT_CALLABLE', phase: 'static' },
  });
});

test('forcing applicability does not infer a new declared contract for an untyped binding', () => {
  expect(observeScript('const f = 1; f();', 'forced')).toMatchObject({
    completion: { Type: 'throw' }, bodyEntered: true, errorClass: 'TypeError', diagnostic: undefined,
  });
});

test('forced checking preserves original source positions and a hashbang', () => {
  const source = '#!/usr/bin/env node\nif ([]) {}';
  const result = observeScript(source, 'forced');
  expect(result).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError' });
  expect(result.diagnostic?.location).toMatchObject({ start: source.indexOf('[]'), end: source.indexOf('[]') + 2 });
});

test.each([
  'function f(a, a) { return a; } String(f(1, 2));',
  'with ({ value: 2 }) { String(value); }',
])('forcing applicability alone leaves sloppy parsing intact: %s', (source) => {
  const result = observeScript(source, 'forced');
  expect(result).toMatchObject({ bodyEntered: true, completion: { Type: 'normal' }, diagnostic: undefined });
  expect((result.completion.Value as JSStringValue).stringValue()).toBe('2');
});

test.each(['automatic', 'forced', 'disabled'] as const)('the observer preserves a strict directive in %s mode', (mode) => {
  expect(observeScript('"use strict"; with ({}) {}', mode)).toMatchObject({
    completion: { Type: 'throw' }, bodyEntered: false, errorClass: 'SyntaxError', diagnostic: undefined,
  });
});

test('the early-error assertion preserves directives and accepts hashbang source', () => {
  expectEarlyError('"use strict"; with ({}) {}', 'SyntaxError');
  expectEarlyError('#!/usr/bin/env node\nlet x: number; if ([]) {}', 'StaticTypeError');
});

test('a runtime-thrown StaticTypeError is not an early error, even if it spoofs the former sentinel', () => {
  const source = 'globalThis.__earlyErrorBodyRan = false; throw new StaticTypeError("runtime");';
  expect(observeScript(source)).toMatchObject({ bodyEntered: true, errorClass: 'StaticTypeError', diagnostic: undefined });
  expect(() => expectEarlyError(source, 'StaticTypeError')).toThrow('candidate body ran');
});

test('ordinary legacy code does not need proposal syntax to opt in for one compilation', () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const source = 'if ([]) {}';
  const forced = EnsureCompletion(realm.compileScript(source, { forceCheckedCode: true }));
  expect(forced.Type).toBe('throw');
  expect(TypeDiagnosticOf(forced.Value)?.code).toBe('RT_CONSTANT_CONDITION');
  expect(EnsureCompletion(realm.compileScript(source)).Type).toBe('normal');
  expect(EnsureCompletion(realm.compileScript(source, { forceCheckedCode: false })).Type).toBe('normal');
});

test('the host override does not enable the proposal feature', () => {
  setSurroundingAgent(new Agent({ features: [] }));
  const realm = new ManagedRealm();
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger('if ([]) {}', { forceCheckedCode: true })).Type).toBe('normal');
  const typed = EnsureCompletion(realm.evaluateScriptSkipDebugger('let x: number;', { forceCheckedCode: true }));
  expect(typed.Type).toBe('throw');
  expect(TypeDiagnosticOf(typed.Value)).toBeUndefined();
});

test('direct eval inherits the forced checked caller after the outer body starts', () => {
  expect(observeScript('eval("if ([]) {}");', 'forced')).toMatchObject({
    bodyEntered: true, errorClass: 'StaticTypeError', diagnostic: { code: 'RT_CONSTANT_CONDITION' },
  });
});

test.each(['(0, eval)("if ([]) {}");', 'new Function("if ([]) {}")();'])('independent generated source does not inherit the override: %s', (source) => {
  expect(observeScript(source, 'forced')).toMatchObject({ bodyEntered: true, completion: { Type: 'normal' }, diagnostic: undefined });
});

test('typed source is checked in the default mode', () => {
  expect(observeScript('function f(x: number) { if ([]) {} }')).toMatchObject({
    bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { code: 'RT_CONSTANT_CONDITION' },
  });
});
