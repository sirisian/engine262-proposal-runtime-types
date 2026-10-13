import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/metadata-range-admission.json', import.meta.url), 'utf8')) as {
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

const metadataDeclaration = 'type M={mark:any};meta M{default={mark:{}};subtype(a,b){return true;}}';

test('Module rejects a completed Composite builder before body entry', async () => {
  const result = await observeModuleGraph({ main: metadataDeclaration
    + 'function build(){return {mark:Composite({x:1})};}type T=uint8.<build()>;' });
  expect(result).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError',
    diagnostic: { rule: 'rt-type-evaluation', phase: 'pre-evaluation' } });
});

test('Module rejects a completed Span default before body entry', async () => {
  const result = await observeModuleGraph({ main: 'type M={mark:any};meta M{default={mark:Span.<uint8>(new ArrayBuffer(2))};subtype(a,b){return true;}}' });
  expect(result).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError',
    diagnostic: { rule: 'rt-meta-declaration', phase: 'pre-evaluation' } });
});

test('Module reflected class endpoint rejection stays at runtime', async () => {
  const result = await observeModuleGraph({ main: 'class C{operator <(o:C){return false;}}' + metadataDeclaration
    + 'Reflect.makeType({kind:"parameterized",base:uint8,metadata:{mark:(new C())..<(new C())}});' });
  expect(result).toMatchObject({ status: 'rejected', bodyEntries: ['main'], errorClass: 'TypeError' });
  expect(result.diagnostic).toBeUndefined();
});

test('Module retains numeric ranges and explicit projections after await', async () => {
  const result = await observeModuleGraph({ main: 'await 0;' + metadataDeclaration
    + 'const T=Reflect.makeType({kind:"parameterized",base:uint8,metadata:{mark:[0..<3,{...Composite({x:1})}]}});'
    + 'const m=Reflect.getReflection(T).metadata.mark;if(m[0].end!==3||m[1].x!==1)throw new Error("lost value");' });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['main'] });
  expect(result.diagnostic).toBeUndefined();
});
