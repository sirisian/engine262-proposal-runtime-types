import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import type { TypeRecord } from '../../../../src/type-system/records.mts';
import { observeModuleGraph } from '../module-observer.mts';
import { AreDisjoint, Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/composite-overlap.json', import.meta.url), 'utf8')) as {
  cases: { name: string; steps: { source: string; expected: Record<string, unknown>; messageIncludes?: string }[] }[];
};
for (const { name, steps } of corpus.cases) {
  test(name, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm();
    try {
      for (const { source, expected, messageIncludes } of steps) {
        let bodyEntered = false;
        let scriptBodies = 0;
        agent.hostDefinedOptions.onNodeEvaluation = (node) => {
          if (node.type === 'ScriptBody') {
            bodyEntered = true;
            scriptBodies += 1;
          }
        };
        const completion = EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
        const diagnostic = TypeDiagnosticOf(completion.Value);
        const errorClass = completion.Type === 'throw' ? nativeErrorClass(completion.Value, realm) : undefined;
        expect({ completion: completion.Type, bodyEntered, scriptBodies, errorClass, diagnostic,
          value: completion.Type === 'normal' ? (completion.Value as { stringValue?: () => string })?.stringValue?.() : undefined }).toMatchObject(expected);
        if (messageIncludes) expect((completion.Value as { HostDefinedMessageString?: string }).HostDefinedMessageString).toContain(messageIncludes);
        if (!expected.errorClass) expect(errorClass).toBeUndefined();
        if (!expected.diagnostic) expect(diagnostic).toBeUndefined();
      }
    } finally {
      delete agent.hostDefinedOptions.onNodeEvaluation;
    }
  });
}

for (const conflict of [false, true]) {
  const source = conflict
    ? 'function unused(a:Composite.<{x:uint8}>,b:Composite.<{x:string}>){return a===b;}'
    : 'function unused(a:Composite,b:Composite.<{x:uint8}>){return a===b;}';
  test(`generated Function Composite overlap (conflict=${conflict})`, () => {
    setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
    const realm = new ManagedRealm();
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(`Function(${JSON.stringify(source)});"accepted";`));
    expect(result.Type).toBe(conflict ? 'throw' : 'normal');
    if (conflict) expect(TypeDiagnosticOf(result.Value)).toMatchObject({ rule: 'rt-disjoint-comparison', phase: 'static' });
    else expect(TypeDiagnosticOf(result.Value)).toBeUndefined();
  });
  test(`importing Module Composite overlap (conflict=${conflict})`, async () => {
    const result = await observeModuleGraph({ dep: source+'export {unused};', main: 'import {unused} from "dep";' });
    expect(result).toMatchObject(conflict
      ? { status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-disjoint-comparison', phase: 'static' } }
      : { status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  });
}

const scalar = (name: string): TypeRecord => ({ Kind: 'primitive', Name: name, Arguments: [] } as TypeRecord);
const string = scalar('string');
const number = scalar('number');
const composite = (shape?: TypeRecord): TypeRecord => ({ Kind: 'primitive', Name: 'Composite', Arguments: shape ? [shape] : [] });
const tuple = (types: TypeRecord[], optional = 0): TypeRecord => ({ Kind: 'tuple', Elements: types.map((Type, i) =>
  ({ Type, Rest: false, Initial: 'none', DeclaredDefault: i >= types.length-optional })) });
const array = (Element: TypeRecord): TypeRecord => ({ Kind: 'array', Element, Extent: 'dynamic' });
const object = (properties: { key: string, type: TypeRecord, optional: boolean }[]): TypeRecord =>
  ({ Kind: 'object', Properties: properties.map((p) => ({ ...p, readonly: true })), IndexSignatures: [] });

test('finite Composite overlap agrees with independently enumerated values', () => {
  type Sample = { kind: 'record', fields: (string | undefined)[] } | { kind: 'tuple', fields: string[] };
  const samples: Sample[] = [];
  for (const a of [undefined, 'n', 's']) for (const b of [undefined, 'n', 's']) samples.push({ kind: 'record', fields: [a, b] });
  for (const fields of [[], ['n'], ['s'], ['n', 'n'], ['n', 's'], ['s', 'n'], ['s', 's']]) samples.push({ kind: 'tuple', fields });
  const shapes: { type: TypeRecord, accepts: (v: Sample) => boolean }[] = [{ type: composite(), accepts: () => true }];
  // 0: unconstrained/absent declaration; 1/2: required n/s; 3/4: optional n/s.
  for (let a = 0; a < 5; a += 1) for (let b = 0; b < 5; b += 1) {
    const flags = [a, b];
    shapes.push({ type: composite(object(flags.flatMap((flag, i) => flag === 0 ? [] :
      [{ key: ['a', 'b'][i], type: flag % 2 ? number : string, optional: flag >= 3 }]))),
    accepts: (v) => v.kind === 'record' && flags.every((flag, i) => flag === 0
      || (flag >= 3 && v.fields[i] === undefined) || v.fields[i] === (flag % 2 ? 'n' : 's')) });
  }
  for (const fields of [[], ['n'], ['s'], ['n', 'n'], ['n', 's'], ['s', 'n'], ['s', 's']]) {
    for (let optional = 0; optional <= fields.length; optional += 1) {
      shapes.push({ type: composite(tuple(fields.map((x) => x === 'n' ? number : string), optional)),
        accepts: (v) => v.kind === 'tuple' && v.fields.length >= fields.length-optional && v.fields.length <= fields.length
          && v.fields.every((x, i) => x === fields[i]) });
    }
  }
  for (const kind of ['n', 's']) shapes.push({ type: composite(array(kind === 'n' ? number : string)),
    accepts: (v) => v.kind === 'tuple' && v.fields.every((x) => x === kind) });
  expect(shapes.length).toBe(45);
  let pairs = 0;
  for (const a of shapes) for (const b of shapes) {
    expect(AreDisjoint(a.type, b.type)).toBe(!samples.some((v) => a.accepts(v) && b.accepts(v)));
    pairs += 1;
  }
  expect(pairs).toBe(2025);
});

test('recursive shapes terminate without losing a later established conflict', () => {
  type Property = Extract<TypeRecord, { Kind: 'object' }>['Properties'][number];
  const leftProperties: Property[] = [];
  const rightProperties: Property[] = [];
  const left = composite({ Kind: 'object', Properties: leftProperties, IndexSignatures: [] });
  const right = composite({ Kind: 'object', Properties: rightProperties, IndexSignatures: [] });
  leftProperties.push({ key: 'next', type: { Kind: 'union', Members: [left, scalar('undefined')] }, optional: false, readonly: true });
  rightProperties.push({ key: 'next', type: { Kind: 'union', Members: [right, scalar('undefined')] }, optional: false, readonly: true });
  expect(AreDisjoint(left, right)).toBe(false);
  leftProperties.push({ key: 'tag', type: number, optional: false, readonly: true });
  rightProperties.push({ key: 'tag', type: string, optional: false, readonly: true });
  expect(AreDisjoint(left, right)).toBe(true);
  expect(AreDisjoint(right, left)).toBe(true);
});

test('unresolved tuple rests remain conservative and scalar exclusions remain active', () => {
  const rest = composite({ Kind: 'tuple', Elements: [{ Type: array(number), Rest: true, Initial: 'none' }] });
  expect(AreDisjoint(rest, composite(tuple([string])))).toBe(false);
  expect(AreDisjoint(rest, composite(object([])))).toBe(true);
  expect(AreDisjoint(composite(), array(number))).toBe(true);
  expect(AreDisjoint(composite(), object([]))).toBe(false);
  expect(AreDisjoint(composite(), string)).toBe(true);
});
