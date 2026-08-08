import { test, expect } from 'vitest';
import {
  Agent, ManagedRealm, Parser, ReplacementDecoratorNames, setSurroundingAgent,
} from '#self';

/**
 * PLAN-engine-decorator-replacement stage E:
 * `sec-static-semantics-replacementdecoratornames`.
 */

function names(source: string): string {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  void new ManagedRealm();
  const module = new Parser({ source, specifier: 't' }).parseModule();
  return ReplacementDecoratorNames(module).join(',') || '(none)';
}

test('a preprocessor import introduces its NAMED bindings', () => {
  expect(names('import { derive } from "./m.js" with { preprocessor: "true" };')).toBe('derive');
  expect(names('import { a, b } from "./m.js" with { preprocessor: "true" };')).toBe('a,b');
});

test('an ordinary import introduces nothing', () => {
  expect(names('import { derive } from "./m.js";')).toBe('(none)');
  expect(names('import { derive } from "./m.js" with { type: "json" };')).toBe('(none)');
});

test('only NamedImports contribute - three forms that parse and provide nothing', () => {
  // A default import, a namespace import and a bare specifier introduce no name
  // a DECORATION can be spelled with under the Strict Lexical Rule. All three
  // parse, so a developer can write them and get a preprocessor module that
  // provides no decorators - which is why each is asserted rather than assumed.
  expect(names('import d from "./m.js" with { preprocessor: "true" };')).toBe('(none)');
  expect(names('import * as ns from "./m.js" with { preprocessor: "true" };')).toBe('(none)');
  expect(names('import "./m.js" with { preprocessor: "true" };')).toBe('(none)');
});

test('the names come from the IMPORT CLAUSES, not from scope', () => {
  // A TOP-LEVEL redeclaration is already a SyntaxError in ordinary JavaScript -
  // `import { derive }` then `const derive` is a duplicate binding - so the
  // Strict Lexical Rule's early error is only load-bearing for INNER scopes.
  // Worth knowing before stage H writes a rule that is half redundant.
  // **This is the property the whole rule rests on.** Deciding by scope would be
  // circular: a replacement decorator may introduce declarations, so the scope
  // to resolve against is not final until expansion finishes - which is the
  // thing being decided. A syntactic scan is available before anything runs.
  //
  // An INNER declaration of the same name does not remove it from the set. This
  // is the case the Strict Lexical Rule's early error exists for, and stage H
  // raises it.
  expect(names('import { derive } from "./m.js" with { preprocessor: "true" };\n{ const derive = 1; }')).toBe('derive');
  expect(names('import { derive } from "./m.js" with { preprocessor: "true" };\nfunction f() { const derive = 1; }')).toBe('derive');
  // And a module with none is the common case: it decides that no expansion
  // phase runs at all.
  expect(names('const x = 1; export { x };')).toBe('(none)');
});

test('`preprocessor` is a supported import attribute key', () => {
  // Without this a conforming host rejects the attribute before anything else in
  // the feature can run.
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  void new ManagedRealm();
  expect(names('import { d } from "./m.js" with { preprocessor: "true" };')).toBe('d');
});

test('the gate is recorded on the parsed module, before the checker runs', () => {
  // `ParseModule` computes the names where the parsed module first exists and
  // where `CheckModule` is about to run - which is exactly the seam expansion
  // occupies. **The ordering is normative**: expand, then check, so the checker
  // never sees an unexpanded decoration and never rejects syntax a replacement
  // decorator was about to produce.
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const gate = (source) => {
    const compiled = realm.compileModule(source);
    return JSON.stringify(compiled.Value?.ECMAScriptCode?.ReplacementDecoratorNames ?? 'ABSENT');
  };
  expect(gate('import { derive } from "./m.js" with { preprocessor: "true" }; const x = 1;')).toBe('["derive"]');
  // **A module with none observes no phase at all** - same parse, same errors,
  // same positions. That is the common case, and it is what makes a gate worth
  // computing rather than always expanding.
  expect(gate('const x = 1;')).toBe('[]');
  expect(gate('import { a } from "./m.js"; const x = 1;')).toBe('[]');
});
