import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/alias-default-demand.json', import.meta.url), 'utf8')) as {
  cases: { name: string; budget?: { steps: number }; steps: { source: string; expected: Record<string, unknown>; messageIncludes?: string }[] }[];
};
for (const { name, steps, budget } of corpus.cases) {
  test(name, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    // Precedence and recovery need a finite budget, not millions of spin steps.
    const realm = new ManagedRealm({ typeEvaluationBudget: budget });
    try {
      for (const { source, expected, messageIncludes } of steps) {
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
        if (messageIncludes) expect((completion.Value as { HostDefinedMessageString?: string }).HostDefinedMessageString).toContain(messageIncludes);
        if (!expected.errorClass) expect(errorClass).toBeUndefined();
        if (!expected.diagnostic) expect(diagnostic).toBeUndefined();
      }
    } finally {
      delete agent.hostDefinedOptions.onNodeEvaluation;
    }
  });
}

const producer = "function identity(t:type):type{return t;}function fail():type{throw new Error(\"default ran\");}export function outer<T:type>(x:T){type R<U:type=fail()> =identity(U);return function f<V:type extends R.<T> >(y:V):V{return y;};}";
for (const valid of [false, true]) {
  test(`imported alias default demand (${valid})`, async () => {
    const result = await observeModuleGraph({
      dep: producer,
      main: 'import {outer} from "dep";const fn=outer.<string>("x");'
        + (valid ? 'fn.<string>("ok");' : 'function unused(){fn.<uint8>(1);}'),
    });
    expect(result).toMatchObject(valid
      ? { status: 'fulfilled', bodyEntries: ['dep', 'main'] }
      : { status: 'rejected', bodyEntries: ['dep'], errorClass: 'StaticTypeError',
        diagnostic: { code: 'RT_ASSIGNABILITY', phase: 'pre-evaluation' } });
    if (valid) expect(result.diagnostic).toBeUndefined();
  });
}

for (const valid of [false, true]) {
  test(`generated Function alias default demand (${valid})`, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm();
    const source = producer.replace('export ', '')
      + 'const fn=outer.<string>("x");'
      + (valid ? 'return fn.<string>("ok");' : 'function unused(){fn.<uint8>(1);}return "missed";');
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(
      `let outcome="missed";try{outcome=Function(${JSON.stringify(source)})();}catch(e){outcome=e.name;}outcome;`,
    ));
    expect(result.Type).toBe('normal');
    expect((result.Value as { stringValue(): string }).stringValue()).toBe(valid ? 'ok' : 'StaticTypeError');
  });
}
