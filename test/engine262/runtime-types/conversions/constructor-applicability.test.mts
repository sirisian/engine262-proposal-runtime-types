import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/constructor-applicability.json', import.meta.url), 'utf8')) as {
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
        expect(agent.jobQueue?.length ?? 0, 'promise jobs settle before the next observation').toBe(0);
      }
    } finally {
      delete agent.hostDefinedOptions.onNodeEvaluation;
    }
  });
}

const modules = JSON.parse(readFileSync(new URL('../conformance/constructor-applicability-modules.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Record<string, unknown>; runtimeTypes?: boolean }[];
};
for (const item of modules.cases) {
  test(item.name, async () => {
    const { observeModuleGraph } = await import('../module-observer.mts');
    const result = await observeModuleGraph(item.modules, 'main', { runtimeTypes: item.runtimeTypes });
    expect(result).toMatchObject(item.expected);
    if (!item.expected.errorClass) expect(result.errorClass).toBeUndefined();
    if (!item.expected.diagnostic) expect(result.diagnostic).toBeUndefined();
  });
}

for (const mode of ['Function', 'eval']) {
  test(`${mode} selects a value-class source conversion`, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm();
    const body = 'class P{x:uint8=1;constructor(v:boolean=true){}constructor(v:string){}}class S{operator P(){return new P(true);}}const raw:any=new S();const p:P=raw;'
      + (mode === 'Function' ? 'return ' : '') + 'String(p.x);';
    const source = mode === 'Function' ? `Function(${JSON.stringify(body)})();` : `eval(${JSON.stringify(body)});`;
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
    expect(result.Type).toBe('normal');
    expect((result.Value as { stringValue: () => string }).stringValue()).toBe('1');
  });
}

test('foreign value-class conversion retains nominal identity and copies its result', async () => {
  const { CreateDataPropertyOrThrow, Value, X } = await import('#self');
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const foreign = new ManagedRealm();
  const target = EnsureCompletion(foreign.evaluateScriptSkipDebugger('class P{x:uint8=1;constructor(v:boolean=true){}constructor(v:string){}}const saved:any=new P(true);class S{operator P(){return saved;}}P;'));
  const source = EnsureCompletion(foreign.evaluateScriptSkipDebugger('new S();'));
  expect(target.Type).toBe('normal');
  expect(source.Type).toBe('normal');
  const local = new ManagedRealm();
  X(CreateDataPropertyOrThrow(local.GlobalObject, Value('ForeignP'), target.Value as import('#self').Value));
  X(CreateDataPropertyOrThrow(local.GlobalObject, Value('source'), source.Value as import('#self').Value));
  const result = EnsureCompletion(local.evaluateScriptSkipDebugger('const raw:any=source;const p:ForeignP=raw;p.x=9;String(p.x)+"/"+String(p instanceof ForeignP);'));
  expect(result.Type).toBe('normal');
  expect((result.Value as { stringValue: () => string }).stringValue()).toBe('9/true');
  const saved = EnsureCompletion(foreign.evaluateScriptSkipDebugger('String(saved.x);'));
  expect(saved.Type).toBe('normal');
  expect((saved.Value as { stringValue: () => string }).stringValue()).toBe('1');
});
