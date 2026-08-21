import { expect, test } from 'vitest';
import { realmWithMacros } from '../harness.mts';
import { Agent, setSurroundingAgent } from '#self';

/**
 * proposal-runtime-types `sec-static-semantics-replacementdecoratornames`: a
 * DEFAULT import of a preprocessor module contributes its binding, as named
 * imports do.
 *
 * The rule used to read |NamedImports| alone, and its note grouped the default
 * import with a namespace import and a bare specifier as forms that "introduce
 * no name a decoration can be spelled with". That is true of the other two - a
 * namespace import gives `ns.jsx`, a member access rather than an
 * IdentifierReference, and a bare specifier binds nothing - and false of a
 * default import, which binds exactly the kind of name `@jsx { … }` takes.
 *
 * It is also the common shape: a preprocessor module usually provides one macro,
 * which is what `export default` is for.
 */

// Appends `MARKED;` - the punctuator matters: an identifier alone is not a
// statement, so a macro that appends only one produces source that does not
// parse, and every assertion below would fail for a reason that has nothing to
// do with the import form.
const MARK = '(function (t) { return t.concat(['
  + '{ kind: "identifier", value: "MARKED", span: t[0].span, tokens: undefined }, '
  + '{ kind: "punctuator", value: ";", span: t[0].span, tokens: undefined }]); })';
const NL = '\n';

function expand(source: string, macros: Record<string, string>): string {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] } as never));
  const realm = realmWithMacros(macros);
  const compiled = realm.compileModule(source) as {
    Type: string, Value?: { ECMAScriptCode?: { sourceText?: string } },
  };
  // The EXPANSION, not merely whether it compiled: a decoration that is not a
  // replacement decorator compiles perfectly well as an ordinary one, so
  // asserting success would pass whether or not the macro ran.
  return compiled.Type === 'normal' ? (compiled.Value?.ECMAScriptCode?.sourceText ?? '') : 'ERR';
}

test('a NAMED import provides a replacement decorator', () => {
  const out = expand(`import { a } from "./x.js" with { preprocessor: "true" };${NL}@a class C {}`, { a: MARK });
  expect(out).toContain('MARKED');
});

test('a DEFAULT import provides one too', () => {
  const out = expand(`import a from "./x.js" with { preprocessor: "true" };${NL}@a class C {}`, { default: MARK });
  expect(out).toContain('MARKED');
});

test('a default and named imports together, from one module', () => {
  const clause = 'import d, { n } from "./x.js" with { preprocessor: "true" };';
  expect(expand(`${clause}${NL}@d class C {}`, { default: MARK, n: MARK })).toContain('MARKED');
  expect(expand(`${clause}${NL}@n class C {}`, { default: MARK, n: MARK })).toContain('MARKED');
  // And the two STACK, which is the case that first looked like a defect in
  // mixing the forms and was a malformed macro in the test.
  const both = expand(`${clause}${NL}@d @n class C {}`, { default: MARK, n: MARK });
  expect(both.split('MARKED').length - 1).toBe(2);
});

test('the binding may be named anything, since it is the LOCAL name that counts', () => {
  const out = expand(`import jsx from "./x.js" with { preprocessor: "true" };${NL}@jsx class C {}`, { default: MARK });
  expect(out).toContain('MARKED');
});

test('a module imported WITHOUT the attribute provides none', () => {
  // The preprocessor attribute is what makes an import contribute, not the form.
  const out = expand(`import a from "./x.js";${NL}@a class C {}`, { default: MARK });
  expect(out).not.toContain('MARKED');
});
