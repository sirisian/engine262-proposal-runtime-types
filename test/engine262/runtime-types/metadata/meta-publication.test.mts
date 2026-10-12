import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, ObjectValue, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/meta-publication.json', import.meta.url), 'utf8')) as {
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

for (const topLevelAwait of [false, true]) {
  for (const failure of [
    { name: 'invalid default', source: 'type M={mark:boolean};meta M{default={mark:1};subtype(a,b){return true;}}',
      recovery: 'type Good={mark?:number};meta Good{default={};subtype(a,b){return true;}}"recovered";' },
    { name: 'generic key conflict', source: 'type M<T:type>={mark?:boolean};meta M<T:type>{default={};subtype(a,b){return true;}}type N={mark?:number};meta N{default={};subtype(a,b){return true;}}',
      recovery: 'type Good={fresh?:number};meta Good{default={};subtype(a,b){return true;}}"recovered";' },
  ]) {
    test(`Module ${topLevelAwait ? 'with await' : 'without await'} rejects ${failure.name} before entry`, async () => {
      const agent = new Agent({ features: ['runtime-types'] });
      setSurroundingAgent(agent);
      const realm = new ManagedRealm();
      let entered = false;
      agent.hostDefinedOptions.onNodeEvaluation = (node) => {
        if (node.type === 'ModuleBody') entered = true;
      };
      try {
        const compiled = realm.compileModule(`${topLevelAwait ? 'await 0;' : ''}${failure.source}`);
        expect(compiled.Type).toBe('normal');
        if (compiled.Type !== 'normal') return;
        const result = await new Promise<{ status: string; diagnostic: unknown; errorClass: unknown }>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Module did not settle')), 5000);
          realm.evaluateModule(compiled.Value, undefined, (value) => {
            clearTimeout(timer);
            try {
              const completion = EnsureCompletion(value);
              const promise = completion.Value as ObjectValue;
              const status = completion.Type === 'throw' ? 'rejected' : promise.PromiseState;
              const error = completion.Type === 'throw' ? completion.Value : promise.PromiseResult;
              resolve({ status, diagnostic: TypeDiagnosticOf(error), errorClass: error instanceof ObjectValue ? error.Prototype : undefined });
            } catch (error) {
              reject(error);
            }
          });
        });
        expect(result.status).toBe('rejected');
        expect(result.errorClass).toBe(realm.Intrinsics['%StaticTypeError.prototype%']);
        expect(result.diagnostic).toMatchObject({ rule: 'rt-meta-declaration', phase: 'pre-evaluation' });
        expect(entered).toBe(false);
        const recovered = EnsureCompletion(realm.evaluateScriptSkipDebugger(failure.recovery));
        expect(recovered.Type).toBe('normal');
        expect((recovered.Value as { stringValue(): string }).stringValue()).toBe('recovered');
      } finally {
        delete agent.hostDefinedOptions.onNodeEvaluation;
      }
    });
  }
}
