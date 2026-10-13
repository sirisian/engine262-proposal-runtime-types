import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/variable-object-spread.json', import.meta.url), 'utf8')) as {
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

for (const invalid of [false, true]) {
  const declarations = 'function f(a:string="d",b:string){return a+b;}';
  const source = 'const args=' + (invalid ? '{unknown:"B"}' : '{b:"B"}')
    + ';const g:any=f;let result="missed";try{result=g(...args);}catch(e){result=e.name;}';
  const expected = invalid ? 'TypeError' : 'dB';
  test(`generated Function variable spread (invalid=${invalid})`, () => {
    setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
    const realm = new ManagedRealm();
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(
      `Function(${JSON.stringify(declarations + source + 'return result;')})();`,
    ));
    expect(result.Type).toBe('normal');
    expect((result.Value as { stringValue(): string }).stringValue()).toBe(expected);
  });
  test(`importing Module variable spread (invalid=${invalid})`, async () => {
    const result = await observeModuleGraph({ dep: declarations + 'export {f};',
      main: 'import {f} from "dep";' + source + 'if(result!=='+JSON.stringify(expected)+')throw new Error("wrong binding");',
    });
    expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
    expect(result.diagnostic).toBeUndefined();
  });
}

for (const [name, source, expected] of [
  ['object spread', 'function f(a){return a;}const args={a:"A"};let result="missed";try{f(...args);}catch(e){result=e.name;}result;', 'TypeError'],
  ['iterator getter once', 'let calls=0;function f(a){return a;}const args={get [Symbol.iterator](){calls++;return function*(){yield "A";};}};f(...args)+String(calls);', 'A1'],
  ['ordinary arity', 'function f(a="A"){return a+arguments.length;}f(...[]);', 'A0'],
]) {
  test(`feature off preserves ${name}`, () => {
    setSurroundingAgent(new Agent({ features: [] }));
    const realm = new ManagedRealm();
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
    expect(result.Type).toBe('normal');
    expect((result.Value as { stringValue(): string }).stringValue()).toBe(expected);
  });
}
