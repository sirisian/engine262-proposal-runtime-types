import { expect, test } from 'vitest';
import {
  Agent, EnsureCompletion, JSStringValue, ManagedRealm, performDevtoolsEval, setSurroundingAgent,
  skipDebugger,
} from '#self';

/**
 * A devtools console entry is parsed with its parent links, as a script is.
 *
 * Several rules read a node's enclosing declaration: the class heritage
 * deferral asks a ClassTail for its declaration's type parameters, so that a
 * generic class whose heritage reads a parameter waits for an application
 * rather than evaluating it unbound. `setNodeParent` runs in ParseScript,
 * ParseModule and eval, and did not run here - so the same class that declared
 * fine in a script reported that its parameter was not defined in the console.
 */
function evaluate(realm: ManagedRealm, source: string) {
  const pop = realm.pushTopContext();
  // A ValueCompletion is `Value | NormalCompletion | ThrowCompletion`, so a
  // result that is already a bare value carries no [[Type]] to read. Normalize
  // once here rather than at each assertion.
  const completion = EnsureCompletion(skipDebugger(performDevtoolsEval(source, realm, false, true)));
  pop?.();
  return completion;
}

/** The string a console entry evaluated to, or a description of what it was instead. */
function stringOf(realm: ManagedRealm, source: string): string {
  const completion = evaluate(realm, source);
  if (completion.Type !== 'normal') {
    return `<${completion.Type}>`;
  }
  const value = completion.Value;
  return value instanceof JSStringValue ? value.stringValue() : `<${typeof value}>`;
}

test('a generic class with a parameter-reading heritage declares in the console', () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const grid = 'class GridArray<W: uint32, H: uint32> extends [W * H].<uint8> {'
    + ' get operator[](x: uint32, y: uint32) { return ref this[y * W + x]; } }';

  expect(evaluate(realm, grid).Type).toBe('normal');
  // and the specialization it defers to works across console entries
  expect(stringOf(realm, 'String(new GridArray.<4,4>().length)')).toBe('16');
  expect(stringOf(realm, 'const g = new GridArray.<4,4>(); g[2,1] = 10; String(g[2,1])')).toBe('10');
});

test('an ordinary console entry is unaffected', () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  expect(stringOf(realm, 'let x = 1; String(x + 1)')).toBe('2');
  expect(stringOf(realm, 'class C { m() { return 5; } } String(new C().m())')).toBe('5');
});
