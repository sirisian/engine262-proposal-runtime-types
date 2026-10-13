import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/structural-storage-contracts.json', import.meta.url), 'utf8')) as {
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

for (const wide of [false, true]) {
  const declarations = 'let entered=0;function borrow(ref ...xs:[uint8]):string{entered++;xs[0]=2;return "ok";}const call:any=borrow;';
  const source = 'let raw:any={x:(1:=uint8)};let typed:{x:' + (wide ? 'uint8|string' : 'uint8')
    + '}=raw;let result="missed";try{result=call(ref raw.x);}catch(e){result=e.name;}';
  const expected = wide ? 'TypeError/0/1' : 'ok/1/2';
  test(`generated Function structural storage contract (wide=${wide})`, () => {
    setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
    const realm = new ManagedRealm();
    const body = declarations + source + 'return result+"/"+String(entered)+"/"+String(raw.x);';
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(`Function(${JSON.stringify(body)})();`));
    expect(result.Type).toBe('normal');
    expect((result.Value as { stringValue(): string }).stringValue()).toBe(expected);
  });
  test(`importing Module structural storage contract (wide=${wide})`, async () => {
    const result = await observeModuleGraph({
      dep: declarations + 'export {call,entered};',
      main: 'import {call,entered} from "dep";' + source
        + 'if(result+"/"+String(entered)+"/"+String(raw.x)!=='
        + JSON.stringify(expected) + ')throw new Error("wrong storage admission or write");',
    });
    expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
    expect(result.diagnostic).toBeUndefined();
  });
}
