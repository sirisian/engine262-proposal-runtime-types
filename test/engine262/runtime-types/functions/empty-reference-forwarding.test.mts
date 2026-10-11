import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { SequenceAssignment } from '../../../../src/type-system/sequence-assignment.mts';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, ObjectValue, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/empty-reference-forwarding.json', import.meta.url), 'utf8')) as {
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

for (const ref of [false, true]) {
  const declarations = 'let entered=0;function g(' + (ref ? 'ref ' : '') + '...ys:[].<uint8>){entered++;return String(ys.length);}';
  const source = 'function f(ref ...xs:[].<uint8>){return g(...xs);}let out="missed";try{out=f();}catch(e){out=e.name;}';
  const expected = ref ? '0/1' : 'TypeError/0';
  test(`generated Function empty forwarding (ref=${ref})`, () => {
    setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
    const realm = new ManagedRealm();
    const body = declarations + source + 'return out+"/"+entered;';
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(`Function(${JSON.stringify(body)})();`));
    expect(result.Type).toBe('normal');
    expect((result.Value as { stringValue(): string }).stringValue()).toBe(expected);
  });
  test(`importing Module empty forwarding (ref=${ref})`, async () => {
    const result = await observeModuleGraph({
      dep: declarations + 'export {g,entered};',
      main: 'import {g,entered} from "dep";' + source
        + 'if(out+"/"+entered!==' + JSON.stringify(expected) + ')throw new Error("wrong forwarding admission");',
    });
    expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
    expect(result.diagnostic).toBeUndefined();
  });
}

// Independent finite oracle: enumerate complete count vectors and test their
// interval coverage, rather than reproducing the memoized recursive search.
test('zero-width constraints agree with exhaustive count enumeration', () => {
  for (let pattern = 0; pattern < 64; pattern += 1) {
    const kinds = [0, 1, 2].map((i) => (pattern >> (i * 2)) & 3);
    const slots = kinds.map((kind) => ({ Rest: kind >= 2, Optional: kind === 1 }));
    for (let n = 0; n <= 3; n += 1) {
      for (let mask = 0; mask < 2 ** (n + 1); mask += 1) {
        const boundaries = Array.from({ length: n + 1 }, (_, i) => i).filter((i) => mask & (1 << i));
        for (const typed of [false, true]) {
          const admits = (i: number, k: number) => !typed || (i + k) % 3 !== 1;
          const vectors: number[][] = [];
          for (let a = n; a >= 0; a -= 1) {
            for (let b = n; b >= 0; b -= 1) {
              const counts = [a, b, n - a - b];
              if (counts.some((count, k) => count < 0 || (!slots[k].Rest && count > 1)
                  || (!slots[k].Rest && !slots[k].Optional && count !== 1))) continue;
              let cursor = 0;
              const covered = new Set<number>();
              let valid = true;
              counts.forEach((count, k) => {
                for (let i = cursor; i < cursor + count; i += 1) if (!admits(i, k)) valid = false;
                if (kinds[k] === 3) for (const offset of boundaries) if (cursor <= offset && offset <= cursor + count) covered.add(offset);
                cursor += count;
              });
              if (valid && boundaries.every((offset) => covered.has(offset))) vectors.push(counts);
            }
          }
          expect(SequenceAssignment(slots, n, admits, undefined, { boundaries, admits: (k) => kinds[k] === 3 }))
            .toEqual(vectors[0] ?? 'unmatched');
        }
      }
    }
  }
});
