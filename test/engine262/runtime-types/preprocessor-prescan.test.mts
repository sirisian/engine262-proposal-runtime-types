import { expect, test } from 'vitest';
import { PrescanPreprocessorNames } from '../../../src/parser/PrescanDecoratorModes.mts';

/**
 * The pre-scan reads a module's preprocessor imports out of SOURCE TEXT, before
 * the module is parsed - which is the only point at which they can be known,
 * since `sec-preprocessor-modules` has them fetched and evaluated before that
 * parse.
 *
 * It answers the bound name, the specifier, and the exported name. The specifier
 * because the module must be LOADED, which is what the specification says
 * happens and what the implementation does not yet do; the exported name because
 * `import { jsx as h }` binds `h` and exports `jsx`, so the decoration is
 * spelled with one and the module asked for the other.
 */
const entries = (source: string) => [...PrescanPreprocessorNames(source)]
  .map(([bound, i]) => `${bound}<-${i.ExportName}@${i.Specifier}`);

test('a preprocessor import answers its bound name, export and specifier', () => {
  expect(entries('import { jsx } from "./jsx.js" with { preprocessor: "true" };'))
    .toEqual(['jsx<-jsx@./jsx.js']);
});

test('an alias binds one name and exports another', () => {
  // The decoration is `@h`; the module is asked for `jsx`. Keying by the bound
  // name is what lets a tool recognise a region without resolving the import.
  expect(entries('import { jsx as h } from "./jsx.js" with { preprocessor: "true" };'))
    .toEqual(['h<-jsx@./jsx.js']);
});

test('several names in one import, and single quotes', () => {
  expect(entries("import { a, b as c } from './m.js' with { preprocessor: 'true' };"))
    .toEqual(['a<-a@./m.js', 'c<-b@./m.js']);
});

test('an import without the attribute contributes nothing', () => {
  expect(entries('import { jsx } from "./jsx.js";')).toEqual([]);
  expect(entries('import { jsx } from "./jsx.js" with { type: "json" };')).toEqual([]);
  // `preprocessor` must be "true": the key alone is not the declaration.
  expect(entries('import { jsx } from "./jsx.js" with { preprocessor: "false" };')).toEqual([]);
});

test('a default, namespace or bare import binds no name a decoration can use', () => {
  // `sec-preprocessor-modules` says as much, so the scan matches named imports
  // only rather than refusing these later.
  expect(entries('import jsx from "./jsx.js" with { preprocessor: "true" };')).toEqual([]);
  expect(entries('import * as jsx from "./jsx.js" with { preprocessor: "true" };')).toEqual([]);
  expect(entries('import "./jsx.js" with { preprocessor: "true" };')).toEqual([]);
});

test('source with no preprocessor import costs one substring test', () => {
  expect(entries('const a = 1; import { x } from "./y.js";')).toEqual([]);
});
