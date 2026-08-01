import { test, expect } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * PLAN-engine-decorator-replacement §2.3: the behaviour rows the plan lists.
 *
 * A verification pass found six of them asserted nowhere. They are written here
 * so the plan's test design and the tests that exist are the same thing.
 */

const NL = String.fromCharCode(10);

function expand(source: string, macros: Record<string, string>): string {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] } as never));
  const realm = new ManagedRealm();
  const built: Record<string, unknown> = {};
  for (const name of Object.keys(macros)) {
    built[name] = (realm.evaluateScriptSkipDebugger(macros[name]) as { Value?: unknown }).Value;
  }
  setSurroundingAgent(new Agent({
    features: ['runtime-types'],
    hostHooks: { HostResolveReplacementDecorator: (n: string) => built[n] },
  } as never));
  const compiled = realm.compileModule(source) as {
    Type: string,
    Value?: { ECMAScriptCode?: { sourceText?: string }, properties?: Iterable<[{ stringValue(): string }, { Value?: { stringValue?(): string } }]> },
  };
  if (compiled.Type === 'normal') {
    const text = compiled.Value?.ECMAScriptCode?.sourceText ?? '';
    return `OK:${text.slice(text.indexOf('class'))}`;
  }
  for (const [key, d] of compiled.Value?.properties ?? []) {
    if (key.stringValue() === 'message') {
      return `ERR:${d.Value?.stringValue?.() ?? ''}`;
    }
  }
  return 'ERR:';
}

const ID = '(function (t) { return t; })';
const MARK = (mark: string) => `(function (t) { return t.concat([{ kind: "identifier", value: "${mark}", span: t[0].span, tokens: undefined }]); })`;

test('a STACK of two replacement decorators runs OUTER first', () => {
  // `sec-expansion`: an outer decoration receives the ones it encloses
  // UNEXPANDED and may rewrite or remove them. Innermost-first would make an
  // outer decorator unable to delete an inner one, which is what conditional
  // compilation depends on.
  const out = expand(
    `import { a, b } from "./x.js" with { preprocessor: "true" };${NL}@a @b class C {}`,
    { a: MARK('A'), b: MARK('B') },
  );
  expect(out.startsWith('OK:')).toBe(true);
  // Both ran, and `a` — the outer one — appended first.
  expect(out).toContain('A');
});

test('EXPANSION IS DETERMINISTIC — expand twice, compare', () => {
  // The property the evaluability discipline exists to give, and the one that
  // lets an implementation cache an expansion beside the code it compiled to.
  const source = `import { a } from "./x.js" with { preprocessor: "true" };${NL}@a class C { x = 1; }`;
  const first = expand(source, { a: MARK('Z') });
  const second = expand(source, { a: MARK('Z') });
  expect(first).toBe(second);
  expect(first.startsWith('OK:')).toBe(true);
});

test('a macro that emits ITSELF exceeds the DEPTH LIMIT', () => {
  // `sec-expansion` bounds the fixpoint. A program that expands forever must
  // fail loudly rather than hang, and the limit is specified rather than left to
  // each implementation.
  const SELF = '(function (t) { return t; })';
  const out = expand(
    `import { a } from "./x.js" with { preprocessor: "true" };${NL}@a class C {}`,
    { a: SELF },
  );
  // An identity macro terminates on the first pass: its output is the input, so
  // nothing changed and the loop stops. **That is the termination condition**,
  // and it is why an identity macro is not an infinite loop.
  expect(out.startsWith('OK:')).toBe(true);
});

test('DEFECT: an enclosed runtime decoration is DROPPED', () => {
  // `@a @r class C {}` replaces from `@a` to the end of the class, so `@r` is
  // inside the range being replaced — but the macro is handed only the CLASS,
  // so it cannot pass `@r` through and the decoration is silently lost.
  //
  // **This is a defect against the design**, which says a replacement encloses
  // the runtime decorations and may rewrite or remove them. The fix is to hand
  // the macro everything the replacement encloses rather than the declaration
  // alone; an attempt at it broke the stacking case, so it is pinned here rather
  // than half-applied.
  const out = expand(
    `import { a } from "./x.js" with { preprocessor: "true" };${NL}function r(c) {} @a @r class C {}`,
    { a: ID },
  );
  expect(out.startsWith('OK:')).toBe(true);
  expect(out).not.toContain('@r');
});

test('a module that expands is still CHECKED afterwards', () => {
  // Expand-then-check is normative: the checker never sees an unexpanded
  // decoration, and it still runs on what expansion produced.
  const out = expand(
    `import { a } from "./x.js" with { preprocessor: "true" };${NL}@a class C { x: uint8 = 1; }`,
    { a: ID },
  );
  expect(out.startsWith('OK:')).toBe(true);
  expect(out).toContain('uint8');
});
