import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { PositionalReferenceRoutePossible, type PositionalContribution } from '../../../../src/type-system/reference-routing.mts';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, ObjectValue, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/static-reference-routing.json', import.meta.url), 'utf8')) as {
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

for (const optional of [false, true]) {
  const declaration = 'function g(first:string' + (optional ? '="d"' : '') + ',ref ...ys:[].<uint8>,last:string="t"){}';
  const wrapper = 'function unused(ref ...xs:[].<uint8>){g(...xs,"L");}';
  test(`generated Function checks unused forwarding route (optional=${optional})`, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm();
    let scripts = 0;
    let bodies = 0;
    agent.hostDefinedOptions.onNodeEvaluation = (node) => {
      if (node.type === 'ScriptBody') scripts += 1;
      if (node.type === 'FunctionBody') bodies += 1;
    };
    try {
      const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(
        `Function(${JSON.stringify(declaration + wrapper)}); "accepted";`,
      ));
      expect(scripts).toBe(1);
      expect(bodies).toBe(0);
      if (optional) {
        expect(result.Type).toBe('normal');
        expect(TypeDiagnosticOf(result.Value)).toBeUndefined();
      } else {
        expect(result.Type).toBe('throw');
        expect((result.Value as ObjectValue).Prototype).toBe(realm.Intrinsics['%StaticTypeError.prototype%']);
        expect(TypeDiagnosticOf(result.Value)).toMatchObject({ rule: 'rt-reference-permission', phase: 'static' });
      }
    } finally {
      delete agent.hostDefinedOptions.onNodeEvaluation;
    }
  });
  test(`importing Module checks unused forwarding route (optional=${optional})`, async () => {
    const result = await observeModuleGraph({ dep: declaration + 'export {g};', main: 'import {g} from "dep";' + wrapper });
    if (optional) {
      expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
      expect(result.diagnostic).toBeUndefined();
    } else {
      expect(result).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError',
        diagnostic: { rule: 'rt-reference-permission', phase: 'static' } });
    }
  });
}

// Independent oracle: expand finite concrete argument sequences and enumerate
// complete count vectors. No graph traversal or shared assignment helper is
// used. Three ordinary items per spread suffice for three fixed slots; extra
// items in unconstrained rests cannot make an impossible route possible.
test('routing abstraction agrees with exhaustive concrete assignments', () => {
  const kinds: PositionalContribution[] = ['value', 'spread', 'reference-run'];
  const sources: PositionalContribution[][] = [[], ...kinds.map((kind) => [kind]),
    ...kinds.flatMap((first) => kinds.map((second) => [first, second]))];
  let patterns = 0;
  for (let pattern = 0; pattern < 64; pattern += 1) {
    const parameters = [0, 1, 2].map((i) => {
      const kind = (pattern >> (i * 2)) & 3;
      return { Name: `p${i}`, Rest: kind >= 2, Ref: kind === 3, Optional: kind === 1 };
    });
    const concrete = (items: boolean[], empty: number[]): boolean => {
      for (let a = 0; a <= items.length; a += 1) {
        for (let b = 0; b <= items.length - a; b += 1) {
          const counts = [a, b, items.length - a - b];
          if (counts.some((count, k) => !parameters[k].Rest && (count > 1 || (!parameters[k].Optional && count !== 1)))) continue;
          let cursor = 0;
          let valid = true;
          const covered = new Set<number>();
          counts.forEach((count, k) => {
            const end = cursor + count;
            if (parameters[k].Ref) {
              for (const boundary of empty) if (cursor <= boundary && boundary <= end) covered.add(boundary);
            } else if (items.slice(cursor, end).some(Boolean)) valid = false;
            cursor = end;
          });
          if (valid && empty.every((boundary) => covered.has(boundary))) return true;
        }
      }
      return false;
    };
    for (const source of sources) {
      const expand = (at: number, items: boolean[], empty: number[]): boolean => {
        if (at === source.length) return concrete(items, empty);
        const kind = source[at];
        if (kind === 'value') return expand(at + 1, [...items, false], empty);
        const maximum = kind === 'spread' ? parameters.length : 1;
        for (let count = 0; count <= maximum; count += 1) {
          if (expand(at + 1, [...items, ...Array.from({ length: count }, () => kind === 'reference-run')],
            kind === 'reference-run' && count === 0 ? [...empty, items.length] : empty)) return true;
        }
        return false;
      };
      expect(PositionalReferenceRoutePossible(parameters, source)).toBe(expand(0, [], []));
      patterns += 1;
    }
  }
  expect(patterns).toBe(832);
});

test('unknown positional counts have no trial-length ceiling', () => {
  const prefix = Array.from({ length: 512 }, (_, i) => ({ Name: `p${i}`, Rest: false, Ref: false, Optional: false }));
  const parameters = [...prefix, { Name: 'refs', Rest: true, Ref: true, Optional: false }];
  expect(PositionalReferenceRoutePossible(parameters, ['spread', 'reference-run'])).toBe(true);
  expect(PositionalReferenceRoutePossible(parameters, ['reference-run', 'spread'])).toBe(false);
});
