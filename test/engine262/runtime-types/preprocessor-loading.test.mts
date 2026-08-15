import { expect, test } from 'vitest';
import {
  Agent, ManagedRealm, setSurroundingAgent, FinishLoadingImportedModule,
  LoadPreprocessorModule, PreprocessorExport,
} from '#self';


/**
 * `sec-preprocessor-modules`: "A preprocessor module is fetched and evaluated
 * BEFORE the importing module is parsed. The loader blocks on it as it blocks
 * for a module with top-level await."
 *
 * The blocking is the point, and it does not need asynchrony: a host may call
 * `FinishLoadingImportedModule` synchronously, and where it does the graph
 * resolves before `LoadRequestedModules` returns. A host that cannot gets a
 * diagnostic rather than a hang - which the specification does not say, because
 * it does not say what a host that cannot block is owed.
 */
const NL = String.fromCharCode(10);

/** A host whose loader answers from a map, synchronously. */
/** Runs `f` with the realm's execution context on the stack. */
function inRealm<T>(realm: ManagedRealm, f: () => T): T {
  const pop = (realm as unknown as { pushTopContext(): (() => void) | undefined }).pushTopContext();
  try {
    return f();
  } finally {
    pop?.();
  }
}

function realmWithModules(modules: Record<string, string>, defer = false) {
  const pending: (() => void)[] = [];
  setSurroundingAgent(new Agent({
    features: ['runtime-types'],
    hostHooks: {
      HostLoadImportedModule(referrer: unknown, request: { Specifier: string }, _hostDefined: unknown, payload: unknown) {
        const source = modules[request.Specifier];
        const realm = (globalThis as { __realm?: ManagedRealm }).__realm as ManagedRealm;
        const finish = () => {
          if (source === undefined) {
            FinishLoadingImportedModule(referrer as never, request as never, payload as never, realm.compileModule('throw new Error("not found");') as never);
            return;
          }
          const compiled = realm.compileModule(source, { specifier: request.Specifier } as never);
          FinishLoadingImportedModule(referrer as never, request as never, payload as never, compiled as never);
        };
        if (defer) {
 pending.push(finish);
} else {
 finish();
}
      },
    },
  } as never));
  const realm = new ManagedRealm();
  (globalThis as { __realm?: ManagedRealm }).__realm = realm;
  return { realm, pending };
}

test('a preprocessor module loads, links and evaluates before anything is parsed', () => {
  const { realm } = realmWithModules({
    './m.js': 'export const jsx = (t) => t;' + NL + 'export const other = 1;',
  });
  const result = inRealm(realm, () => LoadPreprocessorModule(realm, realm as never, './m.js')) as { Type?: string };
  expect(result.Type === 'throw').toBe(false);
});

test('the EXPORT name is what the module is asked for', () => {
  // `import { jsx as h }` declares `@h` and asks for `jsx`. Keying by the bound
  // name and asking by the exported one is the whole reason the pre-scan keeps
  // both.
  const { realm } = realmWithModules({
    './m.js': 'export const jsx = (t) => t;',
  });
  const loaded = inRealm(realm, () => {
    const module = LoadPreprocessorModule(realm, realm as never, './m.js');
    if ((module as { Type?: string }).Type === 'throw') {
 return 'LOAD FAILED';
}
    const found = PreprocessorExport(module as never, 'jsx');
    const missing = PreprocessorExport(module as never, 'nope');
    return (found === undefined ? 'none' : 'callable') + '/' + (missing === undefined ? 'none' : 'callable');
  });
  expect(loaded).toBe('callable/none');
});

test('a host that defers gets a diagnostic, not a hang', () => {
  // The importing module's PARSE is what is waiting, so there is nothing to wait
  // WITH. Saying so is better than blocking forever.
  const { realm } = realmWithModules({ './m.js': 'export const jsx = 1;' }, true);
  const result = inRealm(realm, () => LoadPreprocessorModule(realm, realm as never, './m.js')) as { Type?: string };
  expect(result.Type).toBe('throw');
});

test('a module that throws while evaluating propagates', () => {
  const { realm } = realmWithModules({ './m.js': 'throw new Error("boom");' });
  const result = inRealm(realm, () => LoadPreprocessorModule(realm, realm as never, './m.js')) as { Type?: string };
  expect(result.Type).toBe('throw');
});

test('a macro resolves from its MODULE, and nothing else resolves one', () => {
  // `sec-preprocessor-modules` says a preprocessor module is fetched and
  // evaluated before the importing module is parsed, and that its exports are
  // what a decoration names. That is now the only way a macro is found.
  const MACRO = 'export const m = (t) => [{ kind: "string", value: JSON.stringify("EXPANDED"), span: t[0] && t[0].span }];';
  const SOURCE = 'import { m } from "./m.js" with { preprocessor: "true" };' + NL
    + 'export const v = @m { anything };';
  const expanded = (c: { Type: string, Value?: { ECMAScriptCode?: { sourceText?: string } } }) => {
    const text = c.Value?.ECMAScriptCode?.sourceText ?? '';
    return c.Type === 'normal' ? text.slice(text.indexOf(NL) + 1).trim() : 'REFUSED';
  };

  const { realm } = realmWithModules({ './m.js': MACRO });
  expect(expanded(realm.compileModule(SOURCE) as never)).toBe('export const v = "EXPANDED";');

  // With no loader there is no macro, and a decoration resolving to nothing is
  // left alone rather than refused - a host that does not implement preprocessor
  // modules gets the parse it would have got anyway.
  setSurroundingAgent(new Agent({ features: ['runtime-types'] } as never));
  const bare = new ManagedRealm();
  expect(expanded(bare.compileModule(SOURCE) as never)).toBe('export const v = @m { anything };');
});

/** The message a compile refused with, or its outcome. */
function refusal(realm: ManagedRealm, source: string): string {
  const c = realm.compileModule(source) as {
    Type: string, Value?: { properties?: Iterable<[{ stringValue(): string }, { Value?: { stringValue?(): string } }]> },
  };
  if (c.Type === 'normal') {
 return 'COMPILED';
}
  for (const [k, d] of c.Value?.properties ?? []) {
    if (k.stringValue() === 'message') {
 return d.Value?.stringValue?.() ?? 'THROW';
}
  }
  return 'THROW';
}

test('a preprocessor may use a preprocessor, and a CYCLE may not', () => {
  // Recursion is ordinary - a macro written with a macro - and every macro
  // system allows it. A cycle has no fixpoint: to parse A you evaluate its
  // preprocessor B, to parse B you evaluate its preprocessor A, and to evaluate
  // A you parse A. `sec-preprocessor-modules` makes it a Syntax Error, and a
  // stronger rule than ECMAScript modules have, which permit cycles.
  const macro = '(t) => t';
  const ok = realmWithModules({
    './outer.js': 'import { p } from "./plain.js" with { preprocessor: "true" };' + NL
      + 'export const outer = ' + macro + ';',
    './plain.js': 'export const p = ' + macro + ';',
  }).realm;
  expect(refusal(ok, 'import { outer } from "./outer.js" with { preprocessor: "true" };' + NL
    + 'export const v = @outer { x };')).toBe('COMPILED');

  const cyclic = realmWithModules({
    './a.js': 'import { b } from "./b.js" with { preprocessor: "true" };' + NL + 'export const a = ' + macro + ';',
    './b.js': 'import { a } from "./a.js" with { preprocessor: "true" };' + NL + 'export const b = ' + macro + ';',
  }).realm;
  // A Syntax Error naming the import, NOT an internal assertion - which is what
  // this produced before, and which reads to a macro author as an engine bug
  // rather than as their own mistake.
  expect(refusal(cyclic, 'import { a } from "./a.js" with { preprocessor: "true" };' + NL
    + 'export const v = @a { x };'))
    .toBe('a preprocessor module cannot import itself, directly or otherwise: "./a.js"');
});

test('a refused cycle does not poison the realm', () => {
  // A refusal recorded and never cleared reaches every compile that follows, and
  // a test that only checks the first one does not notice. This is that check.
  const macro = '(t) => [{ kind: "string", value: JSON.stringify("OK"), span: t[0] && t[0].span }]';
  const realm = realmWithModules({
    './a.js': 'import { b } from "./b.js" with { preprocessor: "true" };' + NL + 'export const a = ' + macro + ';',
    './b.js': 'import { a } from "./a.js" with { preprocessor: "true" };' + NL + 'export const b = ' + macro + ';',
    './fine.js': 'export const m = ' + macro + ';',
  }).realm;
  refusal(realm, 'import { a } from "./a.js" with { preprocessor: "true" };' + NL + 'export const v = @a { x };');
  // A second, unrelated module in the SAME realm still compiles and expands.
  expect(refusal(realm, 'import { m } from "./fine.js" with { preprocessor: "true" };' + NL
    + 'export const v = @m { x };')).toBe('COMPILED');
});
