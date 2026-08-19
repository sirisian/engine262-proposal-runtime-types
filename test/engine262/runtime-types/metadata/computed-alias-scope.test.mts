import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * PLAN-declarative-checker-facts.md phase 2. `type G = makeG();` is a
 * |ComputedType|, which resolves by EVALUATING rather than by walking a Type
 * node - so the checker's resolver answered nothing for it and every annotation
 * of `G` degraded to ~any~, refusing a bad value at run time where the inline
 * spelling refuses it at check time.
 */
function realm(): ManagedRealm {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  return new ManagedRealm();
}

const DECL = 'function makeG() { return Reflect.makeType({ kind: "function", signatures: '
  + '[{ parameters: [{ name: "x", type: type uint8 }], return: { type: type uint8 } }] }); } '
  + 'type G = makeG(); ';

test('an alias evaluated by an earlier source text types a later one statically', () => {
  const r = realm();
  expect((r.evaluateScriptSkipDebugger(`${DECL} globalThis.ok = 1;`) as { Type?: string }).Type).toBe('normal');
  // The second script MENTIONS `G` and declares nothing, so there is no
  // declaration node to resolve - only the name. The refusal must arrive before
  // anything in that script runs, which the marker is what distinguishes.
  const probe = r.evaluateScriptSkipDebugger('globalThis.reached = 0; let bad: G = "not a function"; globalThis.reached = 1;');
  expect((probe as { Type?: string }).Type).toBe('throw');
  const marker = r.evaluateScriptSkipDebugger('String(globalThis.reached)');
  expect(String(((marker as { Value?: { stringValue?(): string } }).Value)?.stringValue?.())).toBe('undefined');
});

test('a good value at the same alias is accepted', () => {
  const r = realm();
  r.evaluateScriptSkipDebugger(`${DECL} globalThis.ok = 1;`);
  const good = r.evaluateScriptSkipDebugger('let g: G = (x) => x; String(typeof g);');
  expect((good as { Type?: string }).Type).toBe('normal');
});
