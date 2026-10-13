import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/metadata-range-normalization.json', import.meta.url), 'utf8')) as {
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

const declaration = 'type M={mark:RangeBounds.<uint8>};meta M{default={mark:..};subtype(a,b){return true;}}';

test('Module rejects a closed written endpoint before body entry', async () => {
  const result = await observeModuleGraph({ main: declaration + 'type Bad=uint8.<{mark:0..<256}>;' });
  expect(result).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError',
    diagnostic: { rule: 'rt-type-evaluation', phase: 'pre-evaluation' } });
});

test('Module rejects an invalid range default before body entry', async () => {
  const result = await observeModuleGraph({ main: declaration.replace('mark:..}', 'mark:0..<256}') });
  expect(result).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError',
    diagnostic: { rule: 'rt-meta-declaration', phase: 'pre-evaluation' } });
});

test('Module reflected endpoint failure remains a dynamic boundary', async () => {
  const result = await observeModuleGraph({ main: declaration
    + 'Reflect.makeType({kind:"parameterized",base:uint8,metadata:{mark:0..<256}});' });
  expect(result).toMatchObject({ status: 'rejected', bodyEntries: ['main'], errorClass: 'TypeError' });
  expect(result.diagnostic).toBeUndefined();
});

test('Module range normalization and reflected identity survive await', async () => {
  const result = await observeModuleGraph({ main: declaration + 'type W=uint8.<{mark:1..<3}>;await 0;'
    + 'const R=Reflect.makeType({kind:"parameterized",base:uint8,metadata:{mark:1..<3}});'
    + 'if(R!==W||Reflect.typeOf(Reflect.getReflection(W).metadata.mark.start)!==uint8)throw new Error("domain");' });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['main'] });
  expect(result.diagnostic).toBeUndefined();
});
