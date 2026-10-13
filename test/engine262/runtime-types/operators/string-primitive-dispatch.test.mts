import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/string-primitive-dispatch.json', import.meta.url), 'utf8')) as {
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

const block = 'primitive string{operator +(n:uint8):uint8{return 7;}}';
for (const conflict of [false, true]) {
  test(`generated Function selects a local String block (conflict=${conflict})`, () => {
    setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
    const realm = new ManagedRealm();
    const source = `${block}function f(s:string,n:uint8):${conflict ? 'string' : 'uint8'}{return s+n;}return String(f("a",(1:=uint8)));`;
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(`Function(${JSON.stringify(source)})();`));
    expect(result.Type).toBe(conflict ? 'throw' : 'normal');
    if (conflict) expect(TypeDiagnosticOf(result.Value)).toMatchObject({ rule: 'rt-assignability', phase: 'static' });
    else expect((result.Value as { stringValue(): string }).stringValue()).toBe('7');
  });
  test(`Module selects a local String block (conflict=${conflict})`, async () => {
    const source = `${block}function f(s:string,n:uint8):${conflict ? 'string' : 'uint8'}{return s+n;}const result=f("a",(1:=uint8));if(String(result)!=="7")throw new Error("wrong result");`;
    expect(await observeModuleGraph({ main: source })).toMatchObject(conflict
      ? { status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-assignability', phase: 'static' } }
      : { status: 'fulfilled', bodyEntries: ['main'] });
  });
}

test('a dependency registers its String block before importer execution', async () => {
  expect(await observeModuleGraph({ dep: block,
    main: 'import "dep";function f(s,n){return s+n;}if(String(f("a",(1:=uint8)))!=="7")throw new Error("wrong result");',
  })).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
});

test('String blocks do not leak between agents', () => {
  const a = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(a);
  const first = new ManagedRealm();
  expect(EnsureCompletion(first.evaluateScriptSkipDebugger(block)).Type).toBe('normal');
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const second = new ManagedRealm();
  const result = EnsureCompletion(second.evaluateScriptSkipDebugger('String("a"+(1:=uint8));'));
  expect(result.Type).toBe('normal');
  expect((result.Value as { stringValue(): string }).stringValue()).toBe('a1');
});

test('feature-off retains ordinary String operators', () => {
  setSurroundingAgent(new Agent());
  const realm = new ManagedRealm();
  const result = EnsureCompletion(realm.evaluateScriptSkipDebugger('String("a"+1)+":"+String("2"*3)+":"+String("a"<"b");'));
  expect(result.Type).toBe('normal');
  expect(TypeDiagnosticOf(result.Value)).toBeUndefined();
  expect((result.Value as { stringValue(): string }).stringValue()).toBe('a1:6:true');
});
