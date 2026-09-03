import { expect, test } from 'vitest';
import { realmWithMacro } from './harness.mts';

/**
 * Applicability: a replacement decorator declares WHERE it may be used by typing
 * its context parameter, exactly as a runtime decorator does.
 *
 * No new machinery was needed. The context is `{ kind }` and the `Reflect.*`
 * context types are already assignable from it, so the existing checker enforces
 * the position - a macro declaring `Reflect.Block` used on a class is refused
 * because the argument does not satisfy the parameter.
 *
 * `Reflect.Block` is the one context that had to be added, being the one
 * position that is not also a reflection: nothing reflects on a region at run
 * time, because a region does not survive to run time.
 */
const NL = String.fromCharCode(10);
const BODY = 'return [{ kind: "string", value: JSON.stringify("X"), span: t[0] && t[0].span }];';

function outcome(macro: string, source: string): string {
  const realm = realmWithMacro('m', macro);
  const compiled = realm.compileModule(
    'import { m } from "./m.js" with { preprocessor: "true" };' + NL + source,
  ) as { Type: string, Value?: { ECMAScriptCode?: { sourceText?: string } } };
  if (compiled.Type !== 'normal') {
    return 'REFUSED';
  }
  const text = compiled.Value?.ECMAScriptCode?.sourceText ?? '';
  return text.slice(text.indexOf(NL) + 1).trim();
}

test('a macro declaring a position is accepted there', () => {
  expect(outcome('(function (t, c: Reflect.Block) { ' + BODY + ' })', 'const v = @m { x };'))
    .toBe('const v = "X";');
  expect(outcome('(function (t, c: Reflect.Class) { ' + BODY + ' })', '@m class C {}'))
    .toBe('"X"');
});

test('a macro declaring a position is REFUSED elsewhere', () => {
  // The whole point: the mistake is caught where the decoration is written,
  // rather than as whatever the macro happens to throw when its tokens are not
  // the shape it assumed.
  expect(outcome('(function (t, c: Reflect.Block) { ' + BODY + ' })', '@m class C {}'))
    .toBe('REFUSED');
  expect(outcome('(function (t, c: Reflect.Class) { ' + BODY + ' })', 'const v = @m { x };'))
    .toBe('REFUSED');
});

test('a macro declaring NO context stays usable anywhere', () => {
  // Applicability is optional, and has to be: the specification lets one
  // decorator serve several positions without being told which it is in, and a
  // required context parameter would force every macro to enumerate positions
  // including the ones that genuinely work anywhere.
  const anywhere = '(function (t) { ' + BODY + ' })';
  expect(outcome(anywhere, 'const v = @m { x };')).toBe('const v = "X";');
  expect(outcome(anywhere, '@m class C {}')).toBe('"X"');
  expect(outcome(anywhere, '@m function f() {}')).toBe('"X"');
});

test('an untyped context parameter is not a declaration', () => {
  // Taking the context without typing it reads the position without constraining
  // where the macro may be used.
  const reads = '(function (t, c) { return [{ kind: "string",'
    + ' value: JSON.stringify(c.kind), span: t[0] && t[0].span }]; })';
  // `Block`, not `Region`: a captured region IS a block, and the engine not
  // parsing its text is a fact about the DECORATOR rather than a second
  // position, so there is no separate region context.
  expect(outcome(reads, 'const v = @m { x };')).toBe('const v = "Block";');
  expect(outcome(reads, '@m class C {}')).toBe('"Class"');
});

test('TokenStream is a type, so a macro can be fully annotated', () => {
  // It is a global whose values are its instances, like `Map` - and its absence
  // from that list is why `function jsx(tokens: TokenStream)` could not be
  // written, though both reference macros are documented with that signature.
  expect(outcome('(function (t: TokenStream, c: Reflect.Block) { ' + BODY + ' })', 'const v = @m { x };'))
    .toBe('const v = "X";');
  // And the annotation is enforced rather than decorative: the position still
  // decides where the macro may be used.
  expect(outcome('(function (t: TokenStream, c: Reflect.Class) { ' + BODY + ' })', 'const v = @m { x };'))
    .toBe('REFUSED');
});

test('a non-stream is not a TokenStream', () => {
  // The nominal test is the prototype chain, so an object that merely looks
  // array-like does not satisfy it.
  const realm = realmWithMacro('m', '(function (t) { ' + BODY + ' })');
  const r = realm.evaluateScriptSkipDebugger(
    'function f(t: TokenStream) { return 1; } f([]);',
  ) as { Type: string };
  expect(r.Type).toBe('throw');
});
