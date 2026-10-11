import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, ObjectValue, TypeDiagnosticOf, performDevtoolsEval, skipDebugger } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/constant-publication.json', import.meta.url), 'utf8')) as {
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
          ? ['Error', 'SyntaxError', 'TypeError', 'ReferenceError', 'StaticTypeError'].find((kind) =>
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

for (const annotated of [false, true]) {
  for (const conflict of [false, true]) {
    test(`generated Function prior constant (annotated=${annotated}, conflict=${conflict})`, () => {
      setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
      const realm = new ManagedRealm();
      expect(EnsureCompletion(realm.evaluateScriptSkipDebugger(`const text${annotated ? ':string' : ''}="a";`)).Type).toBe('normal');
      const body = `let n:uint8=1;let result:${conflict ? 'uint8' : 'string'}=n+text;return result;`;
      const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(`Function(${JSON.stringify(body)})();`));
      expect(result.Type).toBe(conflict ? 'throw' : 'normal');
      if (conflict) expect(TypeDiagnosticOf(result.Value)).toMatchObject({ rule: 'rt-assignability', phase: 'static' });
      else expect((result.Value as { stringValue(): string }).stringValue()).toBe('1a');
    });
    test(`Module local constant chain (annotated=${annotated}, conflict=${conflict})`, async () => {
      const source = `const a${annotated ? ':string' : ''}="a";const text=a;let n:uint8=1;let result:${conflict ? 'uint8' : 'string'}=n+text;export {result};`;
      const result = await observeModuleGraph({ dep: source, main: 'import {result} from "dep";' });
      expect(result).toMatchObject(conflict
        ? { status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-assignability', phase: 'static' } }
        : { status: 'fulfilled', bodyEntries: ['dep', 'main'] });
    });
  }
}

test('publication belongs to the target realm binding', () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const a = new ManagedRealm();
  const b = new ManagedRealm();
  expect(EnsureCompletion(a.evaluateScriptSkipDebugger('const text:string="a";')).Type).toBe('normal');
  expect(EnsureCompletion(b.evaluateScriptSkipDebugger('const text:uint8=2;')).Type).toBe('normal');
  const bad = EnsureCompletion(a.evaluateScriptSkipDebugger('let n:uint8=1;let result:uint8=n+text;'));
  expect(TypeDiagnosticOf(bad.Value)).toMatchObject({ rule: 'rt-assignability', phase: 'static' });
  const good = EnsureCompletion(b.evaluateScriptSkipDebugger('let n:uint8=1;let result:uint8=n+text;String(result);'));
  expect(good.Type).toBe('normal');
  expect((good.Value as { stringValue(): string }).stringValue()).toBe('3');
});

for (const immutable of [false, true]) {
  test(`direct eval follows the exporting binding (immutable=${immutable})`, async () => {
    const expected = immutable ? 'StaticTypeError' : 'TypeError';
    const result = await observeModuleGraph({
      dep: `export ${immutable ? 'const' : 'let'} text="a";`,
      main: 'import {text} from "dep";let caught="";try{eval("let n:uint8=1;let bad:uint8=n+text;");}'
        + `catch(e){caught=e.name;}if(caught!==${JSON.stringify(expected)})throw new Error(caught);`,
    });
    expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  });
}

test('direct eval reads each generic activation contract', () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const source = 'function f<T:type>(x:T){const text:T=x;try{return eval("let n:uint8=1;let result:uint8=n+text;String(result);");}catch(e){return e.name;}}f.<string>("a")+":"+f.<uint8>(2);';
  const result = EnsureCompletion(new ManagedRealm().evaluateScriptSkipDebugger(source));
  expect(result.Type).toBe('normal');
  expect((result.Value as { stringValue(): string }).stringValue()).toBe('StaticTypeError:3');
});

test('feature-off String constant aliases retain ordinary evaluation', () => {
  setSurroundingAgent(new Agent());
  const realm = new ManagedRealm();
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger('const text="a";')).Type).toBe('normal');
  const result = EnsureCompletion(realm.evaluateScriptSkipDebugger('const copy=text;String(1+copy);'));
  expect(result.Type).toBe('normal');
  expect(TypeDiagnosticOf(result.Value)).toBeUndefined();
  expect((result.Value as { stringValue(): string }).stringValue()).toBe('1a');
});

for (const [label, seed, initialized] of [
  ['normal', 'const a="a";const text=a;', true],
  ['unreached', 'throw new Error("stop");const a="a";const text=a;', false],
  ['initialized before throw', 'const a="a";const text=a;throw new Error("stop");', true],
] as const) {
  test(`console publication follows initialization (${label})`, () => {
    setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
    const realm = new ManagedRealm();
    const evaluate = (source: string) => EnsureCompletion(skipDebugger(performDevtoolsEval(source, realm, false, true)));
    expect(evaluate(seed).Type).toBe(label === 'normal' ? 'normal' : 'throw');
    const result = evaluate('let n:uint8=1;let bad:uint8=n+text;');
    expect(result.Type).toBe('throw');
    expect((result.Value as ObjectValue).Prototype).toBe(realm.Intrinsics[initialized ? '%StaticTypeError.prototype%' : '%ReferenceError.prototype%']);
    if (initialized) expect(TypeDiagnosticOf(result.Value)).toMatchObject({ rule: 'rt-assignability', phase: 'static' });
    else expect(TypeDiagnosticOf(result.Value)).toBeUndefined();
  });
}

for (const declaration of ['let text=2;', 'let text;', 'const text:any=2;']) {
  test(`a new console binding shadows earlier String evidence (${declaration})`, () => {
    setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
    const realm = new ManagedRealm();
    const evaluate = (source: string) => EnsureCompletion(skipDebugger(performDevtoolsEval(source, realm, false, true)));
    expect(evaluate('const a="a";const text=a;').Type).toBe('normal');
    const result = evaluate(`${declaration}let n:uint8=1;let result:uint8=n+text;`);
    expect(result.Type).toBe('throw');
    expect((result.Value as ObjectValue).Prototype).toBe(realm.Intrinsics['%TypeError.prototype%']);
    expect(TypeDiagnosticOf(result.Value)).toBeUndefined();
  });
}
