import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, ObjectValue, TypeDiagnosticOf, performDevtoolsEval, skipDebugger } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/symbol-binding-identity.json', import.meta.url), 'utf8')) as {
  cases: { name: string; limits?: { steps?: number; records?: number; depth?: number }; steps: { source: string; expected: Record<string, unknown>; messageIncludes?: string }[] }[];
};
for (const { name, steps, limits } of corpus.cases) {
  test(name, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm(limits ? { typeEvaluationBudget: limits } as never : undefined);
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
        const errorClass = completion.Type === 'throw' && completion.Value instanceof ObjectValue
          ? ['Error', 'SyntaxError', 'TypeError', 'RangeError', 'ReferenceError', 'StaticTypeError'].find((kind) =>
            completion.Value.Prototype === realm.Intrinsics[`%${kind}.prototype%`]) : undefined;
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

const declaration = 'type M={[k]:number};meta M{default={[k]:0};subtype(a,b){return a[k]===b[k];}}';
const capture = 'type A=float32.<{[k]:1}>;function f<float32.<const D:M>>():number{return D[k];}';
const assertion = 'if(f.<A>()!==1)throw new Error("wrong Symbol capture");';

for (const awaitPrefix of ['', 'await 0;']) {
  test(`Module same-source Symbol capture (${awaitPrefix || 'sync'})`, async () => {
    const result = await observeModuleGraph({ main: `${awaitPrefix}const k=Symbol("key");${declaration}${capture}${assertion}` });
    expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['main'] });
    expect(result.diagnostic).toBeUndefined();
  });
}

test('Module initialized import preserves the exporting Symbol', async () => {
  const result = await observeModuleGraph({ dep: 'export const k=Symbol("key");',
    main: `import {k} from "dep";${declaration}${capture}${assertion}` });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
});

test('Module re-export preserves the target binding identity', async () => {
  const result = await observeModuleGraph({ dep: 'export const k=Symbol("key");', bridge: 'export {k as key} from "dep";',
    main: `import {key as k} from "bridge";${declaration}${capture}${assertion}` });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'bridge', 'main'] });
});

test('Module cyclic unavailable import is not a pending local claim', async () => {
  const result = await observeModuleGraph({ main: 'import "dep";export const k=Symbol("key");',
    dep: `import {k} from "main";${declaration}` });
  expect(result).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError',
    diagnostic: { rule: 'rt-type-evaluation', phase: 'pre-evaluation' } });
});

test('direct eval follows an initialized imported Symbol', async () => {
  const source = `${declaration}${capture}${assertion}`;
  const result = await observeModuleGraph({ dep: 'export const k=Symbol("key");',
    main: `import {k} from "dep";eval(${JSON.stringify(source)});` });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
});

for (const throwsAfter of [false, true]) {
  test(`console refreshes Symbol identity after initialization (throw=${throwsAfter})`, () => {
    setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
    const realm = new ManagedRealm();
    const evaluate = (source: string) => EnsureCompletion(skipDebugger(performDevtoolsEval(source, realm, false, true)));
    const first = evaluate(`const k=Symbol("key");${throwsAfter ? 'throw new Error("stop");' : '"seed";'}`);
    expect(first.Type).toBe(throwsAfter ? 'throw' : 'normal');
    const result = evaluate(`${declaration}${capture}String(f.<A>());`);
    expect(result.Type).toBe('normal');
    expect((result.Value as { stringValue(): string }).stringValue()).toBe('1');
    expect(TypeDiagnosticOf(result.Value)).toBeUndefined();
  });
}

test('console does not initialize an unreached Symbol declaration', () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const evaluate = (source: string) => EnsureCompletion(skipDebugger(performDevtoolsEval(source, realm, false, true)));
  expect(evaluate('throw new Error("stop");const k=Symbol("key");').Type).toBe('throw');
  const result = evaluate('String(k);');
  expect(result.Type).toBe('throw');
  expect((result.Value as ObjectValue).Prototype).toBe(realm.Intrinsics['%ReferenceError.prototype%']);
  expect(TypeDiagnosticOf(result.Value)).toBeUndefined();
});

test('Symbol evidence belongs to its realm binding', () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realms = [new ManagedRealm(), new ManagedRealm()];
  for (const realm of realms) expect(EnsureCompletion(realm.evaluateScriptSkipDebugger('const k=Symbol("key");')).Type).toBe('normal');
  for (const [index, realm] of realms.entries()) {
    const source = `${declaration}${capture.replace('{[k]:1}', `{[k]:${index + 1}}`)}String(f.<A>());`;
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
    expect(result.Type).toBe('normal');
    expect((result.Value as { stringValue(): string }).stringValue()).toBe(String(index + 1));
  }
});
