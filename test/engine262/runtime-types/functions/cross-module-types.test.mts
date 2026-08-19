import { expect, test } from 'vitest';
import {
  Agent, ManagedRealm, setSurroundingAgent, FinishLoadingImportedModule,
} from '#self';

/**
 * Spec: #sec-inference-fixpoint (the domain of the fixpoint), #sec-inferred-return-types.
 *
 * "Having a function in a module or in the current source text should have no
 * impact on the behavior of the code" is the Q10 lock, and it did not hold: the
 * checker had no handling for `ImportDeclaration` or `ExportDeclaration` at all,
 * so an imported name was undeclared and every use of it was ~any~. That was
 * true of DECLARED types too, not only inferred ones - a module could write
 * `export function fx(): uint32` and an importer's `const n: string = fx()` was
 * unchecked.
 *
 * Two things fix it. A module's declarations are recorded when it is checked,
 * keyed by local name, so an importer can read them. And a module is checked a
 * second time at LINK time, once every dependency has been resolved, with the
 * types of the names it imports supplied. Nothing is reported twice, because a
 * module whose parse-time check failed never reaches linking: every error the
 * second pass finds is one that needed an import to see.
 */

/** Run a module graph, returning 'ok' or the message of the error it raises. */
function graph(sources: Record<string, string>, entry: string): string {
  let realmRef: ManagedRealm;
  const cache = new Map<string, unknown>();
  const agent = new Agent({
    features: ['runtime-types'],
    hostHooks: {
      HostLoadImportedModule(referrer, moduleRequest, hostDefined, payload) {
        const spec = (moduleRequest as { Specifier: unknown }).Specifier as { stringValue?(): string };
        const asked = typeof spec.stringValue === 'function' ? spec.stringValue() : String(spec);
        const key = asked.replace(/^\.\//, '');
        if (!cache.has(key)) {
          cache.set(key, realmRef.compileModule(sources[key]));
        }
        FinishLoadingImportedModule(referrer, moduleRequest, payload, cache.get(key) as never);
      },
    },
  } as never);
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  realmRef = realm;
  let out = 'no-callback';
  realm.evaluateModule(sources[entry], entry, (completion) => {
    if ((completion as { Type: string }).Type === 'throw') {
      const v = (completion as { Value: { properties?: Map<{ stringValue?(): string }, { Value?: { stringValue?(): string } }> } }).Value;
      let msg = '';
      if (v?.properties) {
        for (const [k, d] of v.properties) {
          if (k.stringValue?.() === 'message') {
            msg = d.Value?.stringValue?.() ?? '';
          }
        }
      }
      out = `error: ${msg}`;
    } else {
      out = 'ok';
    }
  });
  return out;
}

test('a declared export is checked at the importer', () => {
  expect(graph({
    'a.js': 'export function fx(): uint32 { return 5; }',
    'b.js': "import { fx } from './a.js';\nconst n: string = fx();",
  }, 'b.js')).toContain('uint.<32>');
  expect(graph({
    'a.js': 'export function fx(): uint32 { return 5; }',
    'b.js': "import { fx } from './a.js';\nconst n: uint32 = fx();",
  }, 'b.js')).toBe('ok');
});

test('an INFERRED export crosses the boundary', () => {
  // The Q10 lock's substance: `wx` declares no return type and publishes one,
  // and the importer is checked against it.
  expect(graph({
    'a.js': 'function f(): uint32 { return 5; }\nexport function wx() { return f(); }',
    'b.js': "import { wx } from './a.js';\nconst n: string = wx();",
  }, 'b.js')).toContain('uint.<32>');
});

test('location does not change what a program means', () => {
  // The same program, split across modules and written as one, must agree.
  const split = graph({
    'a.js': 'export function fx(): uint32 { return 5; }',
    'b.js': "import { fx } from './a.js';\nconst n: string = fx();",
  }, 'b.js');
  const single = graph({
    'b.js': 'function fx(): uint32 { return 5; }\nconst n: string = fx();',
  }, 'b.js');
  expect(split).toBe(single);
});

test('every spelling of an import is checked alike', () => {
  const cases: Record<string, string>[] = [
    // Renamed.
    { 'a.js': 'export function fx(): uint32 { return 5; }', 'b.js': "import { fx as gx } from './a.js';\nconst n: string = gx();" },
    // Default.
    { 'a.js': 'export default function fx(): uint32 { return 5; }', 'b.js': "import fx from './a.js';\nconst n: string = fx();" },
    // Namespace: one binding holding every export, so its type is the module's
    // shape. Without it the SPELLING of an import would decide whether a
    // program is checked.
    { 'a.js': 'export function fx(): uint32 { return 5; }', 'b.js': "import * as A from './a.js';\nconst n: string = A.fx();" },
  ];
  for (const sources of cases) {
    expect(graph(sources, 'b.js')).toContain('uint.<32>');
  }
});

test('a re-export chain resolves to the declaring module', () => {
  // Resolution gives the module and the LOCAL binding name, so a re-export
  // needs no rule of its own.
  expect(graph({
    'a.js': 'export function fx(): uint32 { return 5; }',
    'mid.js': "export { fx } from './a.js';",
    'b.js': "import { fx } from './mid.js';\nconst n: string = fx();",
  }, 'b.js')).toContain('uint.<32>');
});

test('an import cycle is checked', () => {
  expect(graph({
    'a.js': "import { b1 } from './b.js';\nexport function a1(): uint32 { return 5; }\nconst n: string = b1();",
    'b.js': "import { a1 } from './a.js';\nexport function b1(): uint32 { return 5; }",
  }, 'a.js')).toContain('uint.<32>');
});

test('an untyped export stays legacy', () => {
  expect(graph({
    'a.js': 'export function wx() { return "s"; }',
    'b.js': "import { wx } from './a.js';\nconst n: string = wx();",
  }, 'b.js')).toBe('ok');
});

test('a module with no imports is unaffected', () => {
  expect(graph({ 'b.js': 'const n: uint32 = 5;' }, 'b.js')).toBe('ok');
  expect(graph({ 'b.js': 'const n: string = 5;' }, 'b.js')).toContain('error');
});
