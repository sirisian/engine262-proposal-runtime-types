import { expect, test } from 'vitest';
import {
  Agent, ManagedRealm, setSurroundingAgent, FinishLoadingImportedModule,
  ParseModule, ParseScript, surroundingAgent,
} from '#self';

/**
 * `ParseModule` and `ParseScript` called with NOTHING on the execution context
 * stack.
 *
 * Every other test compiles through `ManagedRealm.compileModule`, which pushes
 * the realm's context around its own call - so the whole suite ran on a
 * non-empty stack and none of it could see this. A host is not obliged to use
 * that helper: `ParseModule` is exported and the inspector calls it directly,
 * outside any scope, which is how the expansion phase came to read
 * `currentRealmRecord` off an undefined context and crash the host rather than
 * return the error list `ParseModule` promises.
 *
 * The console's module goal is not an obscure corner of that: it exists so a
 * PREPROCESSOR import can be written at a prompt, expansion running before
 * evaluation and a dynamic `import()` being too late to feed it. So the one
 * path a macro must travel was the one with no context.
 */
const NL = String.fromCharCode(10);

function realmWithModules(modules: Record<string, string>) {
  setSurroundingAgent(new Agent({
    features: ['runtime-types'],
    hostHooks: {
      HostLoadImportedModule(referrer: unknown, request: { Specifier: string }, _hostDefined: unknown, payload: unknown) {
        const realm = (globalThis as { __realm?: ManagedRealm }).__realm as ManagedRealm;
        const source = modules[request.Specifier];
        const compiled = source === undefined
          ? realm.compileModule('throw new Error("not found");')
          : realm.compileModule(source, { specifier: request.Specifier } as never);
        FinishLoadingImportedModule(referrer as never, request as never, payload as never, compiled as never);
      },
    },
  } as never));
  const realm = new ManagedRealm();
  (globalThis as { __realm?: ManagedRealm }).__realm = realm;
  return realm;
}

const MACRO = 'export const m = (t) => [{ kind: "string", value: JSON.stringify("EXPANDED"), span: t[0] && t[0].span }];';
const SOURCE = 'import { m } from "./m.js" with { preprocessor: "true" };' + NL
  + 'export const v = @m { anything };';

test('a module using a replacement decorator parses with no execution context', () => {
  const realm = realmWithModules({ './m.js': MACRO });
  expect(surroundingAgent.executionContextStack.length).toBe(0);

  // Not wrapped in `inRealm`: that is the whole point of this test.
  const parsed = ParseModule(SOURCE, realm, { specifier: 'console' }) as {
    ECMAScriptCode?: { sourceText?: string },
  };

  const text = parsed.ECMAScriptCode?.sourceText ?? '';
  expect(text.slice(text.indexOf(NL) + 1).trim()).toBe('export const v = "EXPANDED";');
  // Entered and left: the stack is as it was found.
  expect(surroundingAgent.executionContextStack.length).toBe(0);
});

test('a malformed module answers with errors rather than crashing the host', () => {
  // An early error is a SyntaxError OBJECT, and building one reads
  // %SyntaxError% from the running context's realm. This is the failure
  // `withRealmContext` was introduced for; it is asserted here so that a rule
  // added after the parse cannot quietly reintroduce it.
  const realm = realmWithModules({});
  expect(surroundingAgent.executionContextStack.length).toBe(0);

  const parsed = ParseModule('const = ;', realm);
  expect(Array.isArray(parsed)).toBe(true);
  expect(surroundingAgent.executionContextStack.length).toBe(0);
});

test('the script goal is safe on an empty stack too', () => {
  const realm = realmWithModules({});
  expect(Array.isArray(ParseScript('const = ;', realm))).toBe(true);
  // A decorated statement in a Script has nothing to run at, and reports as a
  // SyntaxError object built after the parse.
  expect(Array.isArray(ParseScript('@nope if (1) {}', realm))).toBe(true);
  expect(surroundingAgent.executionContextStack.length).toBe(0);
});
