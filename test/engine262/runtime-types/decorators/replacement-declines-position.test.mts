import { expect, test } from 'vitest';
import { realmWithPreprocessors } from '../harness.mts';
import { Agent, setSurroundingAgent } from '#self';

/**
 * A name carrying BOTH roles declines the positions its replacement half does
 * not take.
 *
 * `#sec-syntax-replacement`: "Where a name carries both, the replacement runs at
 * expansion and the ordinary one at decoration, in that order."
 *
 * At expansion the dispatcher is called `(tokens, context, args)`. Where the
 * decoration is on a CLASS, the context is a `Reflect.Class` and no replacement
 * overload accepts one — resolution answers `none`, correctly. That must mean
 * "no replacement applies here, leave it for decoration time", NOT that the macro
 * rejected what it decorates.
 *
 * Distinct from a macro THROWING, which is how a macro rejects its input and
 * which must never be ignored. The two are indistinguishable by message, so the
 * question is asked of resolution BEFORE the call rather than inferred from the
 * error after it.
 *
 * `FINDING-overload-resolution-host-nominals.md` §9.3.
 */

function compile(moduleSource: string, body: string): { type: string, text: string } {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] } as never));
  const realm = realmWithPreprocessors(new Proxy({}, {
    get: () => moduleSource,
    has: () => true,
  }) as Record<string, string>);
  const compiled = realm.compileModule(
    `import { jsx } from "./x.js" with { preprocessor: "true" };\n${body}`,
  ) as { Type: string, Value?: { ECMAScriptCode?: { sourceText?: string } } };
  if (compiled.Type !== 'normal') {
    return { type: 'REFUSED', text: '' };
  }
  const text = compiled.Value?.ECMAScriptCode?.sourceText ?? '';
  return { type: 'ok', text: text.slice(text.indexOf('\n') + 1).trim() };
}

/**
 * A module whose `jsx` is a replacement decorator AND an ordinary one.
 *
 * The third parameter is OPTIONAL because the same name is written both
 * `@jsx { … }` and `@jsx(1) { … }`: the first passes two arguments and the second
 * three, and a required third parameter makes the bare form match no signature.
 * That is a real constraint on how a macro is written, found by measuring
 * `[disp] sigs=2 args=2 kind=none params=[3,1]`.
 */
const BOTH_ROLES = [
  'function jsx(t: TokenStream, c: Reflect.Block, args?): [].<Token> {',
  '  return [{ kind: "identifier", value: "EXPANDED", span: t[0].span, tokens: undefined },',
  '          { kind: "punctuator", value: ";", span: t[0].span, tokens: undefined }];',
  '}',
  'function jsx(c: Reflect.Class) { return c; }',
  'export { jsx };',
].join('\n');

test('the REPLACEMENT half takes a region', () => {
  const out = compile(BOTH_ROLES, '@jsx { <<< not ecmascript >>> }');
  expect(out.type).toBe('ok');
  expect(out.text).toContain('EXPANDED');
});

test('… and with ARGUMENTS on the decoration', () => {
  const out = compile(BOTH_ROLES, '@jsx(1) { <<< not ecmascript >>> }');
  expect(out.type).toBe('ok');
  expect(out.text).toContain('EXPANDED');
});

test('the decoration on a CLASS is DECLINED, not failed', () => {
  // The replacement half does not accept a class context, so expansion leaves
  // the decoration exactly as written. Before this, it was reported as "the
  // replacement decorator jsx rejected what it decorates".
  const out = compile(BOTH_ROLES, '@jsx class C { x = 1; }');
  expect(out.type).toBe('ok');
  expect(out.text).not.toContain('EXPANDED');
  // Left in place for decoration time rather than consumed at expansion.
  expect(out.text).toContain('@jsx');
});

test('… with arguments too', () => {
  const out = compile(BOTH_ROLES, '@jsx(1) class C { x = 1; }');
  expect(out.type).toBe('ok');
  expect(out.text).not.toContain('EXPANDED');
});

test('a name with ONLY a replacement overload is unaffected', () => {
  // The control. Declining applies where a name carries SEVERAL overloads,
  // because that is when another may handle the position. A name with one
  // declaration behaves exactly as it did.
  const only = [
    'function jsx(t: TokenStream, c: Reflect.Block, args?): [].<Token> {',
    '  return [{ kind: "identifier", value: "EXPANDED", span: t[0].span, tokens: undefined },',
    '          { kind: "punctuator", value: ";", span: t[0].span, tokens: undefined }];',
    '}',
    'export { jsx };',
  ].join('\n');
  expect(compile(only, '@jsx { <<< not ecmascript >>> }').text).toContain('EXPANDED');
});
