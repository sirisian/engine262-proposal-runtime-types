import { expect, test } from 'vitest';
import { Agent, EnsureCompletion, ManagedRealm, setSurroundingAgent } from '#self';

for (const constraint of ['any', '_']) {
  test(`a returned generic method retains its activation's family (${constraint})`, () => {
    setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
    const realm = new ManagedRealm();
    const creation = EnsureCompletion(realm.evaluateScriptSkipDebugger(`
      function make(){class A<T:type>{} return {
        value:new A.<uint8>(),
        accepts<T:type extends A.<${constraint}>>(x:T){return "yes";}
      };}
      const left=make();const right=make();let erased:any=left.value;
    `));
    expect(creation.Type).toBe('normal');
    for (let i = 0; i < 3; i += 1) {
      const rejected = EnsureCompletion(realm.evaluateScriptSkipDebugger('erased=left.value;right.accepts(erased);'));
      expect(rejected.Type).toBe('throw');
      expect((rejected.Value as { HostDefinedMessageString?: string }).HostDefinedMessageString)
        .toContain(`"A.<uint.<8>>" is not assignable to "A.<${constraint}>"`);
      const accepted = EnsureCompletion(realm.evaluateScriptSkipDebugger('erased=right.value;right.accepts(erased);'));
      expect(accepted.Type).toBe('normal');
      expect((accepted.Value as { stringValue?(): string }).stringValue?.()).toBe('yes');
    }
  });
}
