import { expect, test } from 'vitest';
import { realmWithMacro } from '../harness.mts';
import { Agent, setSurroundingAgent } from '#self';

/**
 * A macro's arguments carry their NOMINAL types.
 *
 * `#sec-syntax-replacement` says a replacement decorator "RECEIVES a TokenStream"
 * and `#sec-reflection-contexts` names the context it takes. Both were true of
 * the values and false of their TYPES: `RuntimeTypeOf` answered `array` for the
 * stream and `object` for the context, so nothing that selects on argument types
 * could see what they were.
 *
 * That was invisible while a macro was called DIRECTLY, because parameter
 * enforcement judges a value against a nominal differently and accepted them. It
 * became visible the moment a name carried two overloads: overload resolution
 * selects on argument types, found `array` where a signature asked for
 * `TokenStream`, and reported "no overload matches these arguments".
 *
 * These tests exist so the two paths cannot drift apart again silently — a value that a direct call accepts
 * for a nominal parameter must also be MATCHABLE against it.
 */

/** Run `macro` over `@m { x; }` and answer what it reported about its arguments. */
function reported(expression: string): string {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] } as never));
  const macro = '(function (t, c) { return [{ kind: "string", value: JSON.stringify('
    + expression
    + '), span: t[0].span, tokens: undefined }]; })';
  const realm = realmWithMacro('m', macro);
  const compiled = realm.compileModule(
    'import { m } from "./x.js" with { preprocessor: "true" };\n@m { x; }',
  ) as { Type: string, Value?: { ECMAScriptCode?: { sourceText?: string } } };
  if (compiled.Type !== 'normal') {
    return 'REFUSED';
  }
  const text = compiled.Value?.ECMAScriptCode?.sourceText ?? '';
  return text.slice(text.indexOf('\n') + 1).trim();
}

test('the tokens argument answers `TokenStream`, not `array`', () => {
  // `TokenStream` is in the library-nominal list so `function jsx(tokens: TokenStream)`
  // can be written. A value whose type does not answer that name cannot be
  // matched against it, which makes the annotation unusable for selection.
  expect(reported('String(Reflect.isAssignable(Reflect.typeOf(t), type TokenStream))'))
    .toBe('"true";');
});

test('the context argument answers its reflection context, not `object`', () => {
  // `SyntaxContextFor` built a plain object carrying only a `kind` property. The
  // property said "Region" while the TYPE said `object`, so the two disagreed
  // about the same value.
  expect(reported('String(Reflect.isAssignable(Reflect.typeOf(c), type Reflect.Block))'))
    .toBe('"true";');
});

test('the context still carries its `kind`, which is what a macro reads', () => {
  // `Block`, not `Region`: a captured region IS a block, and the engine not
  // parsing its text is a fact about the DECORATOR rather than a second position.
  // The stamp is additive: `#sec-syntax-replacement` says the context "is an
  // ordinary object with one own property, `kind`", and that is unchanged.
  expect(reported('String(c.kind)')).toBe('"Block";');
});

test('a context of another position answers ITS own type', () => {
  // Not everything is a Region. A decoration on a class hands the macro a class
  // context, and the type must distinguish them or an overload set cannot use
  // the context to choose.
  setSurroundingAgent(new Agent({ features: ['runtime-types'] } as never));
  const macro = '(function (t, c) { return [{ kind: "string", value: JSON.stringify('
    + 'String(c.kind) + ":" + String(Reflect.isAssignable(Reflect.typeOf(c), type Reflect.Block))'
    + '), span: t[0].span, tokens: undefined }]; })';
  const realm = realmWithMacro('m', macro);
  const compiled = realm.compileModule(
    'import { m } from "./x.js" with { preprocessor: "true" };\n@m class C { x = 1; }',
  ) as { Type: string, Value?: { ECMAScriptCode?: { sourceText?: string } } };
  expect(compiled.Type).toBe('normal');
  const text = compiled.Value?.ECMAScriptCode?.sourceText ?? '';
  // A class context is NOT a region, and says so.
  expect(text).toContain('Class:false');
});

test('an ordinary array is still an array', () => {
  // The guard on the TokenStream change: it must recognise a TokenStream, not
  // everything with a length.
  expect(reported('String(Reflect.isAssignable(Reflect.typeOf([1, 2]), type TokenStream))'))
    .toBe('"false";');
});
