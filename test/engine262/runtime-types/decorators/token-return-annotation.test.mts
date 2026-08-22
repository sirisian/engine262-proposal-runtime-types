import { test, expect } from 'vitest';
import {
  Agent, ManagedRealm, Throw, composeModuleLoaders, createBuiltinModuleLoader,
  setSurroundingAgent,
} from '#self';

/**
 * Spec: #sec-applyreplacementdecorator - reading Token Records back out of what
 * a macro returned.
 *
 * A macro that ANNOTATES ITS RETURN. An array whose type is written down
 * carries `length` as a TypedNumberValue rather than a NumberValue, and the
 * read that recovers the tokens admitted only the latter - so `: []` and
 * `: [].<Token>` both failed, the second being the very type the operation
 * exists to read.
 *
 * The report made it worse than a refusal. "did not return tokens" is the
 * message for a macro that produced the WRONG THING, and it was issued for
 * arrays that were correct in every particular, so it sent whoever hit it to
 * re-read a body that was already right. These tests pin the reading and the
 * reporting together for that reason: a return that IS tokens must be read, and
 * the message must stay true of the returns it is issued for.
 */
const NL = String.fromCharCode(10);

function compileWithMacro(macro: string, entry: string) {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  const builtin = createBuiltinModuleLoader({
    loadBuiltinModule: (request, _realm, callback) => {
      callback(request.Specifier === 'm.js' ? macro : Throw.Error('missing') as never);
    },
  });
  const relative: typeof builtin = (referrer, request, hostDefined, finish, suggestError) => {
    const stripped = request.Specifier.replace(/^\.\//, '');
    if (stripped !== request.Specifier) {
      builtin(referrer, { ...request, Specifier: stripped }, hostDefined, finish, suggestError);
      return;
    }
    finish(undefined);
  };
  agent.hostDefinedOptions.hostHooks ??= {};
  agent.hostDefinedOptions.hostHooks.HostLoadImportedModule = composeModuleLoaders([relative, builtin]) as never;
  return realm.compileModule(entry, { specifier: 'entry' } as never) as { Type?: string };
}

// The region's text is NOT ECMAScript, so it survives only if the macro was
// reached and its replacement was used.
const ENTRY = 'import { m } from "./m.js" with { preprocessor: "true" };' + NL
  + 'const v = @m do { <not-ecmascript /> };';
const RETURNS = `{ return [{ kind: 'string', value: JSON.stringify('EXPANDED') }]; }`;
const macro = (signature: string) => `function m${signature} ${RETURNS}${NL}export { m };`;

test('a macro ANNOTATES its return, and the annotation is what identifies it', () => {
  // `#sec-preprocessor-modules`: a macro declares a captured region in its
  // signature - "what a decorator RECEIVES is a TokenStream and what it RETURNS
  // is a token sequence". ENTRY's region is not ECMAScript, so it compiles only
  // where the macro is identified and the region is therefore captured.
  //
  // These three were once interchangeable, because a `capture` PROPERTY declared
  // the mode and the return annotation was free. It is not free now: it is half
  // of what says this is a replacement decorator at all.
  expect(compileWithMacro(macro('(stream: TokenStream, context: Reflect.Region): [].<Token>'), ENTRY).Type).not.toBe('throw');
  // Neither half alone identifies one.
  expect(compileWithMacro(macro('(stream, context): [].<Token>'), ENTRY).Type).toBe('throw');
  expect(compileWithMacro(macro('(stream: TokenStream, context: Reflect.Region): []'), ENTRY).Type).toBe('throw');
});

test('annotating the parameters as well changes nothing', () => {
  expect(compileWithMacro(
    macro('(stream: TokenStream, context: Reflect.Region): [].<Token>'),
    ENTRY,
  ).Type).not.toBe('throw');
});

test('a return that is not tokens is still refused', () => {
  // The message must not become vacuous in the course of being made true: each
  // of these genuinely did not return tokens.
  for (const body of ['{ return 42; }', '{}', '{ return [{}]; }']) {
    expect(compileWithMacro(
      `function m(stream, context) ${body}${NL}m.capture = true;${NL}export { m };`,
      ENTRY,
    ).Type).toBe('throw');
  }
});
