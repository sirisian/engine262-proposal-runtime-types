import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';

function check(source: string) {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  let bodyRan = false;
  agent.hostDefinedOptions.onNodeEvaluation = (node) => {
    if (node.type === 'ScriptBody') bodyRan = true;
  };
  const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
  return { result, bodyRan, diagnostic: TypeDiagnosticOf(result.Value) };
}

const invalid = [
  'type R = { a: int32 } | R; let c: R = { a: 1 };',
  'type R = { a: int32 } | R; let c: R = { a: (1 := int32) };',
  'type R = { a: int32 } | R; if (false) { let c: R = { a: 1 }; }',
  'type R = { next: R }; let c: R;',
  'type R = [R]; let c: R;',
  'type R = [1].<R>; let c: R;',
];
test.each(invalid.flatMap((source) => [source, `function unused() { ${source} }`]))('invalid layout has a declaration diagnostic: %s', (source) => {
  const { result, diagnostic, bodyRan } = check(source);
  expect(result.Type).toBe('throw');
  expect(bodyRan).toBe(false);
  expect(diagnostic).toMatchObject({
    rule: 'rt-layout', code: 'RT_LAYOUT', errorClass: 'StaticTypeError', phase: 'static',
    location: { start: source.indexOf('type R'), nodeType: 'TypeAliasDeclaration' },
  });
});

test.each(['type R = R;', 'type A = B; type B = A;'])('a bare cycle reports its distinct rule: %s', (source) => {
  const { result, diagnostic, bodyRan } = check(source);
  expect(result.Type).toBe('throw');
  expect(bodyRan).toBe(false);
  expect(diagnostic).toMatchObject({ rule: 'rt-unproductive-type', location: { nodeType: 'TypeAliasDeclaration' } });
});

test.each([
  'type S = { next: S | null }; let s: S = { next: null };',
  'type S = { items: [].<S> }; let s: S = { items: [] };',
  'type S = { next: S | null }; type T = { value: S }; let t: T = { value: { next: null } };',
])('reference-bearing recursive layouts remain valid: %s', (source) => {
  const { result, diagnostic, bodyRan } = check(source);
  expect(result.Type).toBe('normal');
  expect(bodyRan).toBe(true);
  expect(diagnostic).toBeUndefined();
});
