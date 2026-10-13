import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/named-overload-selection.json', import.meta.url), 'utf8')) as {
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
  const declarations = 'let entered=0;function f(ref ...xs:[uint8,string],label:string):string{entered++;xs[0]=2;xs[1]=label;return "chosen";}'
    + 'function f(ref ...xs:[boolean,uint8],label:string):string{entered++;return "wrong";}';
  const call = 'let a:uint8=1;let b:string="b";const fn:any=f;let result="missed";try{result='
    + (invalid ? 'fn(ref b,ref a,label:"ok");' : 'fn(ref a,ref b,label:"ok");')
    + '}catch(e){result=e.name;}';
  const expected = invalid ? 'TypeError/0/1/b' : 'chosen/1/2/ok';
  test(`generated Function named overload selection (invalid=${invalid})`, () => {
    setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
    const realm = new ManagedRealm();
    const source = declarations + call + 'return result+"/"+String(entered)+"/"+String(a)+"/"+b;';
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(`Function(${JSON.stringify(source)})();`));
    expect(result.Type).toBe('normal');
    expect((result.Value as { stringValue(): string }).stringValue()).toBe(expected);
  });
  test(`importing Module named overload selection (invalid=${invalid})`, async () => {
    const result = await observeModuleGraph({
      dep: declarations + 'export {f,entered};',
      main: 'import {f,entered} from "dep";' + call
        + 'if(result+"/"+String(entered)+"/"+String(a)+"/"+b!=='
        + JSON.stringify(expected) + ')throw new Error("wrong selection or lost write");',
    });
    expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
    expect(result.diagnostic).toBeUndefined();
  });
}
