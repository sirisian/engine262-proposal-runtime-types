import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf, type Value as EngineValue } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/finite-scalar-rests.json', import.meta.url), 'utf8')) as {
  cases: { name: string; limits?: { steps?: number; records?: number; depth?: number }; steps: { source: string; expected: Record<string, unknown>; messageIncludes?: string }[] }[];
};
for (const { name, steps, limits } of corpus.cases) {
  test(name, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm(limits ? { typeEvaluationBudget: limits } as never : undefined);
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
        expect(agent.jobQueue?.length ?? 0, 'promise jobs settle before the next observation').toBe(0);
      }
    } finally {
      delete agent.hostDefinedOptions.onNodeEvaluation;
    }
  });
}

test('Module aliases retain scalar rest ordering', async () => {
  const { observeModuleGraph } = await import('../module-observer.mts');
  const result = await observeModuleGraph({
    dep: 'export type T=[...[].<number>,...[1].<string>,...[].<boolean>];',
    main: 'import {T} from "dep";await 0;const raw:any=[1,"s"];const t:T=raw;raw[1]=2;if(typeof raw[1]!=="string"||!(raw is T))throw new Error("unguarded");',
  });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  expect(result.diagnostic).toBeUndefined();
});

test('cross-realm Proxy alias retains an acquired scalar guard', async () => {
  const { CreateDataPropertyOrThrow, Value, X } = await import('#self');
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const foreign = new ManagedRealm();
  const selected = EnsureCompletion(foreign.evaluateScriptSkipDebugger('const raw:any=[1,"s"];const t:[...[].<number>,...[1].<string>,...[].<boolean>]=raw;new Proxy(raw,{});'));
  expect(selected.Type).toBe('normal');
  const realm = new ManagedRealm();
  X(CreateDataPropertyOrThrow(realm.GlobalObject, Value('foreignSource'), selected.Value as EngineValue));
  const result = EnsureCompletion(realm.evaluateScriptSkipDebugger('foreignSource[1]=2;typeof foreignSource[1]+"/"+foreignSource.join(",");'));
  expect(result.Type).toBe('normal');
  expect((result.Value as { stringValue: () => string }).stringValue()).toBe('string/1,2');
  expect(agent.jobQueue?.length ?? 0).toBe(0);
});

for (const mode of ['Function', 'eval']) {
  test(`${mode} aliases retain scalar rest ordering`, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm();
    const body = 'type T=[...[].<number>,...[1].<string>,...[].<boolean>];const raw:any=[1,"s"];const t:T=raw;raw[1]=2;'
      + (mode === 'Function' ? 'return ' : '') + 'typeof raw[1]+"/"+String(raw is T);';
    const source = mode === 'Function' ? `Function(${JSON.stringify(body)})();` : `eval(${JSON.stringify(body)});`;
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
    expect(result.Type).toBe('normal');
    expect((result.Value as { stringValue: () => string }).stringValue()).toBe('string/true');
  });
}

test('feature-disabled ordinary Array movement remains unguarded', () => {
  const agent = new Agent();
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  const result = EnsureCompletion(realm.evaluateScriptSkipDebugger('const a=[1,"s"];a.reverse();a.join(",");'));
  expect(result.Type).toBe('normal');
  expect((result.Value as { stringValue: () => string }).stringValue()).toBe('s,1');
});

// Independent small-language oracle: enumerate complete declared sequences,
// then compare membership, projections and jointly selected assignments.
test('compact scalar automata and projections agree with finite language enumeration', async () => {
  const { ScalarRestsAccept, ScalarRestTypeAt, ScalarRestRun, Value } = await import('#self');
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const types = ['number', 'string'].map((Name) => ({ Kind: 'primitive' as const, Name, Arguments: [] }));
  const choices = types.flatMap((Type) => [0, 1, 2, Infinity].map((Max) => ({ Type, Min: Max === Infinity ? 0 : Max, Max })));
  const language = (pattern: typeof choices, length: number): number[][] => {
    let words: number[][] = [[]];
    for (const run of pattern) {
      const next: number[][] = [];
      for (const prefix of words) {
        for (let count = run.Min; count <= Math.min(run.Max, length - prefix.length); count += 1) {
          next.push([...prefix, ...Array.from({ length: count }, () => types.indexOf(run.Type))]);
        }
      }
      words = next;
    }
    return words.filter((word) => word.length === length);
  };
  for (const a of choices) for (const b of choices) for (const c of choices) {
    const pattern = [a, b, c];
    for (let length = 0; length <= 4; length += 1) {
      const words = language(pattern, length);
      const accepted = new Set(words.map((word) => word.join('')));
      for (let mask = 0; mask < 2 ** length; mask += 1) {
        const word = Array.from({ length }, (_, i) => (mask >> i) & 1);
        const values = word.map((type) => type ? Value('s') : Value(1));
        expect(ScalarRestsAccept(pattern, values)).toBe(accepted.has(word.join('')));
      }
      if (!words.length) continue;
      for (let i = 0; i < length; i += 1) {
        const members = [...new Set(words.map((word) => word[i]!))].map((j) => types[j]!);
        const projection = ScalarRestTypeAt(pattern, i, length)!;
        const actual = projection.Kind === 'union' ? projection.Members : [projection];
        expect(actual.map((type) => type.Kind === 'primitive' ? type.Name : type.Kind).sort()).toEqual(members.map((type) => type.Name).sort());
        for (const direction of [-1, 1]) {
          const count = ScalarRestRun(pattern, i, length, direction);
          expect(count).toBeGreaterThan(0);
          expect(count).toBeLessThanOrEqual(direction === 1 ? length - i : i + 1);
          for (let offset = 1; offset < count; offset += 1) {
            expect(ScalarRestTypeAt(pattern, i, length)).toEqual(ScalarRestTypeAt(pattern, i + offset * direction, length));
          }
        }
      }
    }
  }
});

test('joint scalar assignment retains finite alternatives and written greedy order', async () => {
  const { AssignScalarRests } = await import('#self');
  const types = ['number', 'string'].map((Name) => ({ Kind: 'primitive' as const, Name, Arguments: [] }));
  const choices = types.flatMap((Type) => [1, 2, Infinity].map((Max) => ({ Type, Min: Max === Infinity ? 0 : Max, Max })));
  const patterns = choices.flatMap((a) => choices.flatMap((b) => choices.map((c) => [a, b, c])));
  const words = (pattern: typeof choices, length: number) => {
    let rows: { word: string, counts: number[] }[] = [{ word: '', counts: [] }];
    for (const run of pattern) rows = rows.flatMap((row) => {
      const next = [];
      for (let count = Math.min(run.Max, length - row.word.length); count >= run.Min; count -= 1) {
        next.push({ word: row.word + String(types.indexOf(run.Type)).repeat(count), counts: [...row.counts, count] });
      }
      return next;
    });
    return rows.filter((row) => row.word.length === length).map((row) => row.word);
  };
  for (let i = 0; i < patterns.length; i += 7) {
    const first = patterns[i]!;
    const other = patterns[(i * 13 + 5) % patterns.length]!;
    for (let length = 0; length <= 5; length += 1) {
      const accepted = new Set(words(other, length));
      for (const blocked of [-1, 0, 2]) {
        const expected = words(first, length).find((word) => accepted.has(word) && (blocked >= length || blocked < 0 || word[blocked] === '1'));
        const actual = AssignScalarRests([first, other], length, (index, type) => index !== blocked || type === types[1]);
        expect(actual?.map((type) => types.indexOf(type as typeof types[number])).join('')).toBe(expected);
      }
    }
  }
});
