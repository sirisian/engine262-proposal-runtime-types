import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass, errorPrototypeOf } from '../error-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/registered-operator-signatures.json', import.meta.url), 'utf8')) as {
  cases: { name: string; steps: { source: string; expected: Record<string, unknown>; messageIncludes?: string }[] }[];
};
for (const { name, steps } of corpus.cases) {
  test(name, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm();
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

const seeds = [
  { name: 'fixed signature', seed: 'primitive string{operator +(n:uint8):uint8{return 7;}}',
    body: 'function f(a:string,b:uint8):string{return a+b;}', phase: 'static' },
  { name: 'captured alias', seed: '{type Out=uint8;primitive uint<const W>{operator +(n:string):Out{return 7;}}}',
    body: 'type Out=string;function f(a:uint16,b:string):string{return a+b;}', phase: 'pre-evaluation' },
  { name: 'enclosing generic', seed: 'globalThis.raw=7;function install<T:type>(){primitive uint<const W>{operator +(n:string):T{return globalThis.raw;}}}install.<uint8>();',
    body: 'function f(a:uint16,b:string):string{return a+b;}', phase: 'pre-evaluation' },
  { name: 'valid signature', seed: 'primitive string{operator +(n:uint8):uint8{return 7;}}',
    body: 'function f(a:string,b:uint8):uint8{return a+b;}if(String(f("a",(1:=uint8)))!=="7")throw new Error("wrong value");', phase: undefined },
];
for (const { name, seed, body, phase } of seeds) {
  test(`generated Function recovers ${name}`, () => {
    setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
    const realm = new ManagedRealm();
    expect(EnsureCompletion(realm.evaluateScriptSkipDebugger(seed)).Type).toBe('normal');
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(`Function(${JSON.stringify(body)})();`));
    expect(result.Type).toBe(phase ? 'throw' : 'normal');
    if (phase) {
      expect(errorPrototypeOf(result.Value)).toBe(realm.Intrinsics['%StaticTypeError.prototype%']);
      expect(TypeDiagnosticOf(result.Value)).toMatchObject({ rule: 'rt-assignability', phase });
    }
  });
  test(`Module recovers ${name} registered by an earlier Script`, async () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm();
    expect(EnsureCompletion(realm.evaluateScriptSkipDebugger(seed)).Type).toBe('normal');
    let entered = false;
    agent.hostDefinedOptions.onNodeEvaluation = (node) => {
      if (node.type === 'ModuleBody') entered = true;
    };
    try {
      const compiled = realm.compileModule(body);
      if (compiled.Type === 'throw') {
        expect(phase).toBe('static');
        expect(errorPrototypeOf(compiled.Value)).toBe(realm.Intrinsics['%StaticTypeError.prototype%']);
        expect(TypeDiagnosticOf(compiled.Value)).toMatchObject({ rule: 'rt-assignability', phase });
        expect(entered).toBe(false);
        return;
      }
      const result = await new Promise<{ status: string; diagnostic: unknown; errorClass: unknown }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Module did not settle')), 5000);
        realm.evaluateModule(compiled.Value, undefined, (value) => {
          clearTimeout(timer);
          try {
            const completion = EnsureCompletion(value);
            const status = completion.Type === 'throw' ? 'rejected' : completion.Value.PromiseState;
            const error = completion.Type === 'throw' ? completion.Value : completion.Value.PromiseResult;
            resolve({ status, diagnostic: TypeDiagnosticOf(error), errorClass: errorPrototypeOf(error) });
          } catch (error) {
            reject(error);
          }
        });
      });
      expect(result.status).toBe(phase ? 'rejected' : 'fulfilled');
      expect(entered).toBe(!phase);
      if (phase) {
        expect(result.errorClass).toBe(realm.Intrinsics['%StaticTypeError.prototype%']);
        expect(result.diagnostic).toMatchObject({ rule: 'rt-assignability', phase });
      }
    } finally {
      delete agent.hostDefinedOptions.onNodeEvaluation;
    }
  });
}

test('a registered signature does not enter a different agent checker', () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const first = new ManagedRealm();
  expect(EnsureCompletion(first.evaluateScriptSkipDebugger(seeds[0].seed)).Type).toBe('normal');
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const second = new ManagedRealm();
  const result = EnsureCompletion(second.evaluateScriptSkipDebugger('function f(a:string,b:uint8):string{return a+b;}f("a",(1:=uint8));'));
  expect(result.Type).toBe('normal');
  expect((result.Value as { stringValue(): string }).stringValue()).toBe('a1');
});
