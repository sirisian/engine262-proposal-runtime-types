import { expect, test } from 'vitest';
import { Agent, ManagedRealm, ModuleCache, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf, Value } from '#self';

const work = 'let n = 0; while (n < 1000) { n++; }';
const value = `(() => { ${work} return 1; })()`;
const sources = [
  `function build(T: type): type { ${work} return T; } type T = build(uint8);`,
  `type T = { x?: number = ${value} };`,
  `type T = [number = ${value}];`,
  `type T = [${value}].<uint8>;`,
  `type T<N: uint32> = uint8 where (${value} === 1); type U = T.<1>;`,
  `function build(T: type): type { ${work} return T; } function outer<T: type>(x: T) {
    return function inner<U: type = build(T)>(x: U): U { return x; };
  } const fn = outer(1); fn.<>;`,
  `function build(T: type): type { ${work} return T; } function outer<T: type>(x: T) {
    return function inner<U: type extends build(T)>(x: U): U { return x; };
  } const fn = outer(1); fn(2);`,
];

function check(source: string, steps: number) {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm({ typeEvaluationBudget: { steps } } as never);
  let bodyRan = false;
  agent.hostDefinedOptions.onNodeEvaluation = (node) => {
    if (node.type === 'ScriptBody') bodyRan = true;
  };
  const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
  return { result, bodyRan, diagnostic: TypeDiagnosticOf(result.Value) };
}

test.each(sources)('user computation is metered before body entry: %s', (source) => {
  const low = check(source, 100);
  expect(low.result.Type).toBe('throw');
  expect(low.bodyRan).toBe(false);
  expect(low.diagnostic).toMatchObject({
    code: 'RT_TYPE_EVALUATION_LIMIT', phase: 'pre-evaluation', errorClass: 'StaticTypeError',
  });
  const enough = check(source, 100_000);
  expect(enough.result.Type).toBe('normal');
  expect(enough.bodyRan).toBe(true);
});

test.each([
  'function build(T: type): type { return build(T); } type T = build(uint8);',
  'function a(T: type): type { return b(T); } function b(T: type): type { return a(T); } type T = a(uint8);',
  'function build(T: type): type { return [T].map((x) => build(x))[0]; } type T = build(uint8);',
  'function build(T: type): type { try { return build(T); } catch(e) { return string; } } type T = build(uint8);',
])('recursive builder calls abandon evaluation without a host overflow: %s', (source) => {
  const result = check(source, 100_000);
  expect(result.result.Type).toBe('throw');
  expect(result.bodyRan).toBe(false);
  expect(result.diagnostic).toMatchObject({ code: 'RT_TYPE_EVALUATION_LIMIT', phase: 'pre-evaluation' });
});

test('a terminating recursive builder retains its type result', () => {
  const source = 'function build(T: type, n: number): type { if (n === 0) { return T; } return build(T, n - 1); } '
    + 'type T = build(uint8, 3); T === uint8;';
  const result = check(source, 100_000);
  expect(result.result.Type).toBe('normal');
  expect(result.bodyRan).toBe(true);
  expect(result.diagnostic).toBeUndefined();
  expect(result.result.Value).toBe(Value.true);
});

test('ordinary JavaScript recursion outside type computation spends no type fuel', () => {
  const result = check('function count(n) { if (n === 0) { return 0; } return count(n - 1); } String(count(20));', 0);
  expect(result.result.Type).toBe('normal');
  expect(result.bodyRan).toBe(true);
  expect((result.result.Value as { stringValue(): string }).stringValue()).toBe('0');
});

test('a computed builder cannot turn caught exhaustion into a fallback type', () => {
  const source = `function build(T: type): type { try { ${work} } catch(e) { return string; } return T; }
    type T = build(uint8);`;
  expect(check(source, 100).diagnostic?.code).toBe('RT_TYPE_EVALUATION_LIMIT');
  expect(check(source, 100_000).result.Type).toBe('normal');
});

async function inverse(steps: number, body: string) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm({ resolverCache: new ModuleCache(), typeEvaluationBudget: { steps } } as never);
  const source = `import { inverse } from 'std:types';
    class Box<T: type> { v: T; constructor(v: T) { this.v = v; } }
    function unbox(B) { ${body} return Reflect.getReflection(B).generic.arguments[0]; }
    @inverse(unbox)
    function boxOf(T) { const t = T; return type Box.<t>; }
    function open<T: type>(b: boxOf(T)): string { return String(T); }
    open(new Box.<uint8>(1));`;
  const compiled = realm.compileModule(source, { specifier: 'main' });
  expect(compiled).toMatchObject({ Type: 'normal' });
  if (Array.isArray(compiled) || compiled.Type !== 'normal') throw new Error('inverse fixture did not parse');
  return new Promise<{ state: unknown, message: unknown }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('module evaluation did not settle')), 10_000);
    realm.evaluateModule(compiled.Value, undefined, (promise) => {
      clearTimeout(timer);
      const result = promise as unknown as { PromiseState: string, PromiseResult: { HostDefinedMessageString?: string } };
      resolve({ state: result.PromiseState, message: result.PromiseResult?.HostDefinedMessageString });
    });
  });
}

test('an inverse body spends fuel and cannot cache a caught-exhaustion fallback', async () => {
  const body = `try { ${work} } catch(e) {}`;
  const low = await inverse(100, body);
  expect(low.state).toBe('rejected');
  expect(low.message).toContain('evaluation budget');
  expect(low.message).toContain('inverse of boxOf');
  expect((await inverse(100_000, body)).state).toBe('fulfilled');
});
