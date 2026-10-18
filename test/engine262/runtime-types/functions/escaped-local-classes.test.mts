import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/escaped-local-classes.json', import.meta.url), 'utf8')) as {
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

const modules = JSON.parse(readFileSync(new URL('../conformance/escaped-local-classes-modules.json', import.meta.url), 'utf8')) as {
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
  test(`${mode} retains an escaped local nominal result`, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm();
    const body = 'let log="";function make<T:type>(){class P{constructor(v:T){log+="t";}}return(v:any)=>{const p:P=v;return p;};}const convert=make.<string>();function use<T:type>(){return convert("yes");}use.<boolean>();'
      + (mode === 'Function' ? 'return ' : '') + 'log;';
    const source = mode === 'Function' ? `Function(${JSON.stringify(body)})();` : `eval(${JSON.stringify(body)});`;
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
    expect(result.Type).toBe('normal');
    expect((result.Value as { stringValue: () => string }).stringValue()).toBe('t');
  });
}

test('foreign closure supplies its own class identity', async () => {
  const { CreateDataPropertyOrThrow, Value, X } = await import('#self');
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const foreign = new ManagedRealm();
  const closure = EnsureCompletion(foreign.evaluateScriptSkipDebugger('function make(){class P{tag:string="foreign";constructor(v:string){}}return(v:any)=>{const p:P=v;return p;};}const convert=make();function use(){return convert("yes");}use;'));
  expect(closure.Type).toBe('normal');
  const local = new ManagedRealm();
  X(CreateDataPropertyOrThrow(local.GlobalObject, Value('foreign'), closure.Value as import('#self').Value));
  const result = EnsureCompletion(local.evaluateScriptSkipDebugger('class P{tag:string="wrong";}foreign().tag;'));
  expect(result.Type).toBe('normal');
  expect((result.Value as { stringValue: () => string }).stringValue()).toBe('foreign');
});
