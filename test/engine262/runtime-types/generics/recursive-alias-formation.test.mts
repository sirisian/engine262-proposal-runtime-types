import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf, TypeEvaluationBudget } from '#self';

const original = 'type N<T: type> = { f: (N.<T>) => void }; type X = N.<uint8>; String(1);';

test('the reported function cycle forms a finite type at ordinary budgets', () => {
  for (const depth of [undefined, 8, 32, 64]) {
    setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
    const realm = new ManagedRealm(depth === undefined ? undefined : { typeEvaluationBudget: { depth } } as never);
    const completion = EnsureCompletion(realm.evaluateScriptSkipDebugger(original));
    expect(completion.Type).toBe('normal');
    expect((completion.Value as { stringValue(): string }).stringValue()).toBe('1');
  }
});

for (const [name, body] of [
  ['dynamic array', '{ value: T, children: [].<N.<T>> }'],
  ['nullable member', '{ value: T, next: N.<T> | null }'],
  ['function parameter', '{ value: T, f: (N.<T>) => void }'],
  ['function return', '{ value: T, f: () => N.<T> }'],
  ['call signature', '{ (N.<T>): T }'],
] as const) {
  test(`${name}: completed applications retain structural identity and their arguments`, () => {
    const other = body.replaceAll('N.<T>', 'M.<T>');
    expect(evaluated(`type N<T: type> = ${body}; type M<T: type> = ${other};
      type A = N.<uint8>; type B = N.<uint8>; type C = M.<uint8>; type D = N.<string>;
      String(A === B) + ',' + String(A === C) + ',' + String(A === D);`)).toBe('true,true,false');
  });
}

test('mutual forward declarations close in either source order', () => {
  const a = 'type A<T: type> = { value: T, b: B.<T> | null };';
  const b = 'type B<T: type> = { a: A.<T> | null };';
  for (const declarations of [a + b, b + a]) {
    expect(evaluated(`${declarations} type X = A.<uint8>;
      const x: X = { value: 1, b: { a: { value: 2, b: null } } }; String(x.b?.a?.value);`)).toBe('2');
  }
});

for (const declaration of [
  'type N<T: type> = N.<T>;',
  'type N<T: type> = { next: N.<T> };',
  'type N<T: type> = { next?: N.<T> };',
  'type N<T: type> = { next: [2].<N.<T>> };',
  'type N<T: type> = { next: [N.<T>] };',
  'type N<T: type> = { good: [].<N.<T>>, bad: N.<T> };',
  'type N<T: type> = M.<T>; type M<T: type> = N.<T>;',
]) {
  test(`invalid graph has a semantic diagnostic: ${declaration}`, () => {
    const observation = observeScript(`${declaration} type X = N.<uint8>; String(1);`);
    expect(observation).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError' });
    expect(observation.diagnostic?.code).not.toBe('RT_TYPE_EVALUATION_LIMIT');
  });
}

test('a function edge does not excuse an independent inline cycle', () => {
  const observation = observeScript('type N<T: type> = { f: (B.<T>) => void }; '
    + 'type B<T: type> = { bad: B.<T> }; type X = N.<uint8>; String(1);');
  expect(observation).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError' });
  expect(observation.diagnostic?.code).not.toBe('RT_TYPE_EVALUATION_LIMIT');
});

test('recursive edges preserve constraints instead of certifying the application', () => {
  const observation = observeScript('type N<T: type> = { f: (N.<T>) => void } where T === string; '
    + 'type X = N.<uint8>; String(1);');
  expect(observation).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a finite cycle of different applications does not merge their payload contracts', () => {
  expect(evaluated('type N<T: type, U: type> = { value: T, f: (N.<U, T>) => void }; '
    + 'type A = N.<uint8, string>; type B = N.<string, uint8>; String(A === B);')).toBe('false');
});

test('phantom arguments do not make transparent completed graphs nominal', () => {
  expect(evaluated('type N<T: type> = { f: (N.<T>) => void }; '
    + 'type A = N.<uint8>; type B = N.<string>; String(A === B);')).toBe('true');
});

test('a runtime boundary checks nested members of the completed graph', () => {
  expect(evaluated('type N<T: type> = { value: T, next: N.<T> | null }; type X = N.<uint8>; '
    + 'function take(x: X) {} const bad: any = { value: 1, next: { value: "bad", next: null } }; '
    + 'try { take(bad); "accepted"; } catch (e) { e.constructor.name; }')).toBe('TypeError');
});

test('separate activations preserve captures while equal expansions may intern together', () => {
  expect(evaluated('function make<T: type>() { type N<U: type> = { value: T, next: N.<U> | null }; '
    + 'type R = N.<uint8>; return R; } '
    + 'const A = make.<uint8>(); const B = make.<string>(); const C = make.<uint8>(); '
    + 'String(A === B) + "," + String(A === C);')).toBe('false,true');
});

test('failed formation and exhaustion leave later evaluations independent', () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const sources = [
    '{ type Bad<T: type> = { x: Bad.<T> }; type X = Bad.<uint8>; }',
    '{ function wrap(T: type): type { return type [].<T>; } type G<T: type> = { f: (G.<wrap(T)>) => void }; type X = G.<uint8>; }',
  ];
  for (const source of sources) {
    const failure = EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
    expect(failure.Type).toBe('throw');
    expect(TypeDiagnosticOf(failure.Value)?.errorClass).toBe('StaticTypeError');
    expect(TypeEvaluationBudget.BudgetSpent()).toBeNull();
    const success = EnsureCompletion(realm.evaluateScriptSkipDebugger(`{ ${original} }`));
    expect(success.Type).toBe('normal');
  }
});
