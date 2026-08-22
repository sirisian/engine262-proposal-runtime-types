import { expect, test } from 'vitest';
import { realmWithPreprocessors } from '../harness.mts';
import { Agent, setSurroundingAgent } from '#self';

/**
 * `#sec-syntax-replacement`: "A name denotes one REPLACEMENT decorator … A name
 * may nonetheless carry an ORDINARY decorator as well, since the two are told
 * apart by their signatures rather than by their arguments … the replacement
 * runs at expansion and the ordinary one at decoration, in that order."
 *
 * One name transforms a construct and then decorates what it produced, which is
 * the compact form this is for. The clause used to say a replacement decorator
 * name "denotes one function" and was "not resolved by overload resolution" —
 * true of selecting AMONG replacement decorators, whose arguments are all Token
 * Records, and not of separating the replacement role from the ordinary one.
 *
 * `parse.mts` read a single signature, which would see whichever overload was
 * declared last; it reads the whole set now.
 */

/** A module declaring `jsx` twice: a replacement overload and an ordinary one. */
function bothRoles(ordinaryParams: string): string {
  return [
    // The replacement half: a TokenStream in, a token sequence out.
    'function jsx(t: TokenStream, c: Reflect.Region): [].<Token> {',
    '  return t.concat([{ kind: "identifier", value: "EXPANDED", span: t[0].span, tokens: undefined },',
    '                   { kind: "punctuator", value: ";", span: t[0].span, tokens: undefined }]);',
    '}',
    // The ordinary half: takes a class, returns one.
    `function jsx(${ordinaryParams}) { return c; }`,
    'export { jsx };',
  ].join('\n');
}

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

test('the REPLACEMENT overload is found beside an ordinary one', () => {
  // Without the whole-set read, the ordinary overload declared second would be
  // the only one seen, and the region would not be captured.
  const out = compile(bothRoles('c: Reflect.Class'), '@jsx { <<< not ecmascript >>> }');
  expect(out.type).toBe('ok');
  expect(out.text).toContain('EXPANDED');
});

test('… and with ARGUMENTS on the decoration', () => {
  // The argument run is the path that broke twice while this area was converted,
  // so it is asserted rather than assumed to follow.
  const out = compile(bothRoles('c: Reflect.Class'), '@jsx(1) { <<< not ecmascript >>> }');
  expect(out.type).toBe('ok');
  expect(out.text).toContain('EXPANDED');
});

test('the ordinary overload still decorates its own position', () => {
  // The same name on a CLASS is the ordinary decoration: the replacement half
  // does not claim it, and the class is not a region.
  const out = compile(bothRoles('c: Reflect.Class'), '@jsx class C { x = 1; }');
  expect(out.type).toBe('ok');
  expect(out.text).not.toContain('EXPANDED');
});

test('… with arguments too', () => {
  const out = compile(bothRoles('c: Reflect.Class'), '@jsx(1) class C { x = 1; }');
  expect(out.type).toBe('ok');
  expect(out.text).not.toContain('EXPANDED');
});

test('a name with ONLY a replacement overload is unaffected', () => {
  // The control: everything above must hold without changing the single-overload
  // case, which is every macro written today.
  const only = [
    'function jsx(t: TokenStream, c: Reflect.Region): [].<Token> {',
    '  return t.concat([{ kind: "identifier", value: "EXPANDED", span: t[0].span, tokens: undefined },',
    '                   { kind: "punctuator", value: ";", span: t[0].span, tokens: undefined }]);',
    '}',
    'export { jsx };',
  ].join('\n');
  expect(compile(only, '@jsx { <<< not ecmascript >>> }').text).toContain('EXPANDED');
});
