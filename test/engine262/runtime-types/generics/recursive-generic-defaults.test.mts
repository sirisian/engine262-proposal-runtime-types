import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/recursive-generic-defaults.json', import.meta.url), 'utf8')) as {
  cases: { name: string; steps: { source: string; expected: Record<string, unknown> }[] }[];
};
for (const { name, steps } of corpus.cases) {
  test(name, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm();
    try {
      for (const { source, expected } of steps) {
        let bodyEntered = false;
        let scriptBodies = 0;
        agent.hostDefinedOptions.onNodeEvaluation = (node) => {
          if (node.type === 'ScriptBody') {
            bodyEntered = true;
            scriptBodies += 1;
          }
        };
        const completion = EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
        const diagnostic = TypeDiagnosticOf(completion.Value);
        const errorClass = completion.Type === 'throw' ? nativeErrorClass(completion.Value, realm) : undefined;
        expect({ completion: completion.Type, bodyEntered, scriptBodies, errorClass, diagnostic,
          value: completion.Type === 'normal' ? (completion.Value as { stringValue?: () => string })?.stringValue?.() : undefined }).toMatchObject(expected);
        if (!expected.errorClass) expect(errorClass).toBeUndefined();
        if (!expected.diagnostic) expect(diagnostic).toBeUndefined();
      }
    } finally {
      delete agent.hostDefinedOptions.onNodeEvaluation;
    }
  });
}

for (const demanded of [false, true]) {
  test(`imported recursive default is evaluated only when demanded (${demanded})`, async () => {
    const result = await observeModuleGraph({
      dep: 'export type R<T:type=R.<> >=T;',
      main: 'import {R} from "dep";' + (demanded ? 'function f(x:R.<>){}' : 'function f(x:R.<string>){}'),
    });
    expect(result).toMatchObject(demanded
      ? { status: 'rejected', bodyEntries: ['dep'], errorClass: 'StaticTypeError',
        diagnostic: { code: 'RT_TYPE_EVALUATION_LIMIT', phase: 'pre-evaluation' } }
      : { status: 'fulfilled', bodyEntries: ['dep', 'main'] });
    if (!demanded) expect(result.diagnostic).toBeUndefined();
  });
}

for (const computed of [false, true]) {
  test(`finite imported default checks its consumer at the required phase (${computed})`, async () => {
    const result = await observeModuleGraph({
      dep: computed ? 'export function build(){return type string;}export type R<T:type=build()> = T;'
        : 'export type R<T:type=R.<string>>=T;',
      main: 'import {R} from "dep";function f():R.<> {return 1;}',
    });
    // Closed substitution needs no source evaluation. A builder application
    // retains the module's pre-body boundary and dependency prerequisites.
    expect(result).toMatchObject({ status: 'rejected', bodyEntries: computed ? ['dep'] : [], errorClass: 'StaticTypeError',
      diagnostic: { code: 'RT_ASSIGNABILITY', phase: computed ? 'pre-evaluation' : 'static' } });
  });
}

for (const depth of [8, 32]) {
  test(`required recursive defaults use the host depth budget and restore it (${depth})`, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm({ typeEvaluationBudget: { depth } } as never);
    let entries = 0;
    agent.hostDefinedOptions.onNodeEvaluation = (node) => {
      if (node.type === 'ScriptBody') entries += 1;
    };
    try {
      const failed = EnsureCompletion(realm.evaluateScriptSkipDebugger('type R<T:type=R.<> >=T;type K=R.<>;'));
      expect(failed.Type).toBe('throw');
      expect(entries).toBe(0);
      expect(TypeDiagnosticOf(failed.Value)).toMatchObject({ code: 'RT_TYPE_EVALUATION_LIMIT', phase: 'pre-evaluation' });
      const next = EnsureCompletion(realm.evaluateScriptSkipDebugger('type F<T:type=F.<string>>=T;let x:F.<> = "ok";x;'));
      expect(next.Type).toBe('normal');
      expect((next.Value as { stringValue(): string }).stringValue()).toBe('ok');
      expect(entries).toBe(1);
    } finally {
      delete agent.hostDefinedOptions.onNodeEvaluation;
    }
  });
}

test('dynamic Function checks a required default before the generated body runs', () => {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(`
    let entered=false;
    try { Function('type R<T:type=R.<> >=T;type K=R.<>;entered=true;')(); }
    catch(e) { if(e.name!=="StaticTypeError") throw e; }
    String(entered);
  `));
  expect(result.Type).toBe('normal');
  expect((result.Value as { stringValue(): string }).stringValue()).toBe('false');
});
