/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test } from 'vitest';
import type Protocol from 'devtools-protocol';
import { TestInspector } from './utils.mts';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

// ---------------------------------------------------------------------------
// A TYPE OBJECT'S PREVIEW AND ITS EXPANSION SHOW THE SAME THINGS.
//
// The console previewed `type A = { a: uint32, b: float32 }; A` as
// `{ a: uint.<32>, b: float32 } {kind: 'object', properties: Array(2)}` and
// then, expanded, showed only `Type.prototype`'s getters - `alignment`,
// `bitLength`, ... - with `kind` and `properties` nowhere. The preview came from
// the inspector's `additionalProperties`; the expansion consulted
// `exoticProperties` and the object's own property table, and nothing else, so
// the two disagreed for every inspector that gave the first and not the second.
//
// Now the additional properties ARE the expansion's exotic properties, each
// rendered through its value's inspector - so a member that is itself a Type
// Object opens again, and a developer walks a union's members or an object
// type's properties without calling `Reflect.getReflection` at each step.
// ---------------------------------------------------------------------------

async function setUp() {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const inspector = new TestInspector();
  const realm = new ManagedRealm();
  inspector.attachAgent(agent, [realm]);
  return inspector;
}

/** The expanded own properties of an evaluated expression, by name. */
async function expanded(inspector: TestInspector, source: string) {
  const result = await inspector.eval(source) as any;
  expect(result.objectId, `${source} should be an object`).toBeTruthy();
  const { result: props } = await inspector.runtime.getProperties({ objectId: result.objectId, ownProperties: true, generatePreview: true }) as Protocol.Protocol.Runtime.GetPropertiesResponse;
  const byName = new Map(props.map((p) => [p.name, p]));
  const previewNames = (result.preview?.properties ?? []).map((p: { name: string }) => p.name);
  return { result, byName, previewNames, props };
}

test('what the preview names, the expansion shows', async () => {
  const inspector = await setUp();
  const { result, byName, previewNames } = await expanded(inspector, 'type A = { a: uint32, b: float32 }; A;');
  expect(result.description).toBe('{ a: uint.<32>, b: float32 }');
  expect(previewNames).toEqual(['kind', 'properties']);
  for (const name of previewNames) {
    expect(byName.has(name), `expansion is missing "${name}", which the preview showed`).toBe(true);
  }
  expect(byName.get('kind')!.value!.value).toBe('object');
  expect(byName.get('kind')!.isOwn).toBe(true);
});

test('an object type\'s properties open by NAME to their types', async () => {
  const inspector = await setUp();
  const { byName } = await expanded(inspector, 'type A = { a: uint32, b: float32, readonly c?: string }; A;');
  const properties = byName.get('properties')!.value!;
  expect(properties.type).toBe('object');
  const inner = await inspector.runtime.getProperties({ objectId: properties.objectId!, ownProperties: true }) as Protocol.Protocol.Runtime.GetPropertiesResponse;
  const names = inner.result.map((p) => p.name);
  // The names are kept, with the modifiers a reader would want to see.
  expect(names).toEqual(['a', 'b', 'readonly c?']);
  // ...and each value is a Type Object, described in canonical text.
  expect(inner.result.map((p) => p.value!.description)).toEqual(['uint.<32>', 'float32', 'string']);
  expect(inner.result[0].value!.className).toBe('Type');
});

test('a union\'s members open, and each member is a Type Object that opens again', async () => {
  const inspector = await setUp();
  const { byName, previewNames } = await expanded(inspector, 'type U = uint8 | { x: string } | [].<float32>; U;');
  expect(previewNames).toEqual(['kind', 'members']);
  expect(byName.get('kind')!.value!.value).toBe('union');
  const members = byName.get('members')!.value!;
  expect(members.subtype).toBe('array');
  const list = await inspector.runtime.getProperties({ objectId: members.objectId!, ownProperties: true }) as Protocol.Protocol.Runtime.GetPropertiesResponse;
  const memberValues = list.result.filter((p) => /^\d+$/.test(p.name)).map((p) => p.value!);
  expect(memberValues.map((v) => v.className)).toEqual(['Type', 'Type', 'Type']);
  // The object member opens to its own `kind` and `properties`.
  const objectMember = memberValues.find((v) => v.description === '{ x: string }')!;
  const objectExpansion = await inspector.runtime.getProperties({ objectId: objectMember.objectId!, ownProperties: true }) as Protocol.Protocol.Runtime.GetPropertiesResponse;
  expect(objectExpansion.result.map((p) => p.name)).toEqual(expect.arrayContaining(['kind', 'properties']));
});

test('every record kind exposes its structure', async () => {
  const inspector = await setUp();
  const own = async (source: string) => (await expanded(inspector, source)).byName;
  // Each case names its own alias: one realm serves the whole test, and a
  // second `type T = ...` would be a redeclaration.
  // array: element and, where fixed, extent
  let m = await own('type T1 = [4].<uint8>; T1;');
  expect(m.get('kind')!.value!.value).toBe('array');
  expect(m.get('element')!.value!.description).toBe('uint.<8>');
  expect(m.get('extent')!.value!.value).toBe('4');
  // tuple: elements
  m = await own('type T2 = [uint8, string]; T2;');
  expect(m.get('kind')!.value!.value).toBe('tuple');
  expect(m.get('elements')!.value!.subtype).toBe('array');
  // literal: value and base
  m = await own("type T3 = 'a'; T3;");
  expect(m.get('kind')!.value!.value).toBe('literal');
  expect(m.get('value')!.value!.value).toBe('a');
  expect(m.get('base')!.value!.description).toBe('string');
  // function: signatures with named parameters and a return
  m = await own('type F = (a: uint8, b?: string) => float32; F;');
  expect(m.get('kind')!.value!.value).toBe('function');
  const sigs = await inspector.runtime.getProperties({ objectId: m.get('signatures')!.value!.objectId!, ownProperties: true }) as Protocol.Protocol.Runtime.GetPropertiesResponse;
  const sig0 = await inspector.runtime.getProperties({ objectId: sigs.result.find((p) => p.name === '0')!.value!.objectId!, ownProperties: true }) as Protocol.Protocol.Runtime.GetPropertiesResponse;
  expect(sig0.result.map((p) => p.name)).toEqual(['parameters', 'returns']);
  const params = await inspector.runtime.getProperties({ objectId: sig0.result[0].value!.objectId!, ownProperties: true }) as Protocol.Protocol.Runtime.GetPropertiesResponse;
  expect(params.result.map((p) => p.name)).toEqual(['a', 'b?']);
  expect(sig0.result[1].value!.description).toBe('float32');
  // nominal with arguments
  m = await own('type T4 = Map.<string, uint8>; T4;');
  expect(m.get('kind')!.value!.value).toBe('nominal');
  expect(m.get('arguments')!.value!.subtype).toBe('array');
});

test('the prototype getters are still there, beside the structure, not instead of it', async () => {
  const inspector = await setUp();
  const { result } = await expanded(inspector, 'type A = { a: uint32 }; A;');
  const accessors = await inspector.runtime.getProperties({ objectId: result.objectId, accessorPropertiesOnly: true }) as Protocol.Protocol.Runtime.GetPropertiesResponse;
  const names = accessors.result.map((p) => p.name);
  expect(names).toEqual(expect.arrayContaining(['alignment', 'byteLength', 'family']));
});
