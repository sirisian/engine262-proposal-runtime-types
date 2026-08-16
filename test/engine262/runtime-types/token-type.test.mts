import { expect, test } from 'vitest';
import { realmWithPreprocessors } from './harness.mts';

/**
 * `Token`, the record a replacement decorator RETURNS.
 *
 * A decorator RECEIVES a TokenStream and ANSWERS an array-like of Token. The
 * asymmetry is deliberate: a TokenStream carries spans the engine assigns and
 * refuses construction, so a decorator that rewrites assembles ordinary records.
 * Without this name the return of every macro in the companion documents could
 * not be annotated, though its parameters could.
 *
 * Structural, because a macro builds these with object literals and they are
 * instances of nothing.
 */
function call(source: string): string {
  const realm = realmWithPreprocessors({});
  const result = realm.evaluateScriptSkipDebugger(source) as {
    Type: string, Value?: { properties?: Iterable<[{ stringValue(): string }, { Value?: { stringValue?(): string } }]> },
  };
  if (result.Type === 'normal') {
    return 'OK';
  }
  for (const [key, descriptor] of result.Value?.properties ?? []) {
    if (key.stringValue() === 'message') {
      return descriptor.Value?.stringValue?.() ?? 'THROW';
    }
  }
  return 'THROW';
}

test('a token record satisfies Token', () => {
  expect(call('function f(t: Token) { return 1; } f({ kind: "string", value: "1" });')).toBe('OK');
  // `span` and `tokens` are optional: a CREATED token carries no span until the
  // engine assigns one, and only a group carries tokens.
  expect(call('function f(t: Token) { return 1; } f({ kind: "group", value: "(", tokens: [] });')).toBe('OK');
});

test('a record missing a required member does not', () => {
  expect(call('function f(t: Token) { return 1; } f({ kind: "string" });'))
    .toMatch(/is not assignable to "Token"/);
  expect(call('function f(t: Token) { return 1; } f({});'))
    .toMatch(/is not assignable to "Token"/);
});

test('an array of them is what a decorator answers', () => {
  expect(call('function f(t: [].<Token>) { return 1; } f([{ kind: "a", value: "b" }]);')).toBe('OK');
  expect(call('function f(t: [].<Token>) { return 1; } f([]);')).toBe('OK');
});
