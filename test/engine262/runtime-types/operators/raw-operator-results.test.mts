import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, ObjectValue, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/raw-operator-results.json', import.meta.url), 'utf8')) as {
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

const sources = [
  { name: 'known invalid raw body', source: 'primitive string{operator +(n:uint8):uint8{return "bad";}}', error: 'StaticTypeError' },
  { name: 'unknown invalid raw body', source: 'globalThis.raw="bad";primitive string{operator +(n:uint8):uint8{return globalThis.raw;}}function run(a,b){return a+b;}run("a",(1:=uint8));', error: 'TypeError' },
  { name: 'valid admitted raw body', source: 'primitive string{operator +(n:uint8):uint8{return 7;}}function run(a,b){return a+b;}if(String(Reflect.typeOf(run("a",(1:=uint8))))!=="uint.<8>")throw new Error("wrong representation");', error: undefined },
];
for (const { name, source, error } of sources) {
  test(`generated Function: ${name}`, () => {
    setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
    const realm = new ManagedRealm();
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(`Function(${JSON.stringify(source)})();`));
    expect(result.Type).toBe(error ? 'throw' : 'normal');
    if (error) expect((result.Value as ObjectValue).Prototype).toBe(realm.Intrinsics[`%${error}.prototype%`]);
    if (error === 'StaticTypeError') expect(TypeDiagnosticOf(result.Value)).toMatchObject({ rule: 'rt-assignability', phase: 'static' });
  });
  test(`Module: ${name}`, async () => {
    expect(await observeModuleGraph({ main: source })).toMatchObject(error
      ? { status: 'rejected', bodyEntries: error === 'StaticTypeError' ? [] : ['main'], errorClass: error,
        ...(error === 'StaticTypeError' ? { diagnostic: { rule: 'rt-assignability', phase: 'static' } } : {}) }
      : { status: 'fulfilled', bodyEntries: ['main'] });
  });
}
