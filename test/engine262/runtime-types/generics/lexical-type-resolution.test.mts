import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeScript } from '../harness.mts';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/lexical-type-resolution.json', import.meta.url), 'utf8')) as {
  cases: { name: string; source: string; expected: Record<string, unknown> }[];
};
for (const { name, source, expected } of corpus.cases) {
  test(name, () => {
    const result = observeScript(source);
    expect({ ...result, completion: result.completion.Type,
      value: (result.completion.Value as { stringValue?: () => string })?.stringValue?.() }).toMatchObject(expected);
    if (!expected.diagnostic) expect(result.diagnostic).toBeUndefined();
    if (!expected.errorClass) expect(result.errorClass).toBeUndefined();
  });
}

test.each([
  ['alias', 'export type Known=string;', 'Known'],
  ['generic alias', 'export type Known<T:type>=T;', 'Known.<string>'],
  ['class', 'export class Known {}', 'Known'],
  ['interface', 'export interface Known {}', 'Known'],
  ['enum', 'enum Known { A } export {Known};', 'Known'],
])('an imported %s stays visible to a nested declaration', async (_kind, declaration, type) => {
  const result = await observeModuleGraph({
    main: `import {Known} from "dep"; function outer(){function f<[].<${type}>>(x:string):string{return x;}}`,
    dep: declaration,
  });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  expect(result.diagnostic).toBeUndefined();
});

test('previous-script aliases remain visible and a failed lookup does not poison the realm', () => {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  const first = EnsureCompletion(realm.evaluateScriptSkipDebugger('type Published=string;function build(){return type string;}type Computed=build();'));
  expect(first.Type).toBe('normal');
  let bodyEntered = false;
  agent.hostDefinedOptions.onNodeEvaluation = (node) => {
    if (node.type === 'ScriptBody') bodyEntered = true;
  };
  try {
    const failure = EnsureCompletion(realm.evaluateScriptSkipDebugger('function a(){type Hidden=string;}function b(){function f<[].<Hidden>>(x:string):string{return x;}}'));
    expect(failure.Type).toBe('throw');
    expect(TypeDiagnosticOf(failure.Value)).toMatchObject({ code: 'RT_TYPE_EVALUATION', phase: 'pre-evaluation' });
    expect(bodyEntered).toBe(false);
    const corrected = EnsureCompletion(realm.evaluateScriptSkipDebugger('function c(){function f<[Published,Computed]>(x:string):string{return x;}}"ok";'));
    expect(corrected.Type).toBe('normal');
    expect((corrected.Value as { stringValue(): string }).stringValue()).toBe('ok');
    expect(TypeDiagnosticOf(corrected.Value)).toBeUndefined();
    expect(bodyEntered).toBe(true);
  } finally {
    delete agent.hostDefinedOptions.onNodeEvaluation;
  }
});
