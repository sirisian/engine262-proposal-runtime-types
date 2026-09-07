import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * Spec: #sec-reflect-getreflection, #table-reflection-nodes.
 *
 * "Every property of a node that denotes a type holds a Type Object, so a walker
 * recurses by reflecting it in turn."
 *
 * This file is that sentence, asserted over EVERY kind the table lists rather
 * than over the slots someone remembered. It exists because three slots violated
 * it at once - a signature's `this`, a narrowing record's `type`, and an enum
 * node's `underlying` - and no test caught any of them. The earlier coverage
 * checked `parameters[].type` and `return.type`, which were never the problem;
 * a control that only inspects the slots you already trust cannot fail.
 *
 * `===` is the assertion, deliberately. A node holding a NODE where a Type
 * Object belongs answers correctly to every weaker check - same kind, same base,
 * same field values - and differs only under identity, which is the comparison
 * interning exists to make meaningful.
 */

/** Every kind #table-reflection-nodes lists, and nothing else. */
const TABLE_KINDS = [
  'primitive', 'literal', 'parameterized', 'union', 'intersection',
  'tuple', 'array', 'object', 'function', 'reference',
];

/** [name, setup, expression asserting identity of one type-valued slot] */
const SLOTS: ReadonlyArray<readonly [string, string, string]> = [
  ['primitive.type', '', 'Reflect.getReflection(type uint8).type === uint8'],
  ['primitive.generic.base', '',
    'Reflect.getReflection(type Promise.<uint8>).generic.base === (type Promise)'],
  ['primitive.generic.arguments', '',
    'Reflect.getReflection(type Promise.<uint8>).generic.arguments[0] === uint8'],
  ['literal.base', '', 'Reflect.getReflection(type "a").base === (type string)'],
  ['parameterized.base', "type B = uint32.<{ brand: 'X' }>;",
    'Reflect.getReflection(B).base === uint32'],
  ['union.members', 'type U = uint8 | string;',
    'Reflect.getReflection(U).members.some(m => m === uint8)'],
  // Two OBJECT types intersect into one merged object type, so an intersection
  // node needs members canonicalization keeps apart - two parameterizations of
  // one base do.
  ['intersection.members', "type E = string.<{ brand: 'A' }>; type V = string.<{ brand: 'B' }>; type EV = E & V;",
    'Reflect.getReflection(EV).members.some(m => m === E)'],
  ['tuple.elements[].type', 'type T = [uint8, string];',
    'Reflect.getReflection(T).elements[0].type === uint8'],
  ['array.element', 'type A = [].<uint8>;', 'Reflect.getReflection(A).element === uint8'],
  ['object.properties[].type', 'type O = { a: uint8 };',
    'Reflect.getReflection(O).properties[0].type === uint8'],
  ['object.indexSignatures[].key', 'type X = { [key: string]: uint8 };',
    'Reflect.getReflection(X).indexSignatures[0].key === (type string)'],
  ['object.indexSignatures[].value', 'type X = { [key: string]: uint8 };',
    'Reflect.getReflection(X).indexSignatures[0].value === uint8'],
  ['function.parameters[].type', 'type F = (uint8) => string;',
    'Reflect.getReflection(F).signatures[0].parameters[0].type === uint8'],
  ['function.return.type', 'type F = (uint8) => string;',
    'Reflect.getReflection(F).signatures[0].return.type === (type string)'],
  ['function.thisType',
    'type F = (uint8) => string; const G = Reflect.makeType({ ...Reflect.getReflection(F),'
    + ' signatures: Reflect.getReflection(F).signatures.map(s => ({ ...s, thisType: type string })) });',
    'Reflect.getReflection(G).signatures[0].thisType === (type string)'],
  ['function.narrows[].type',
    'type B = (uint8) => boolean; const H = Reflect.makeType({ ...Reflect.getReflection(B),'
    + ' signatures: Reflect.getReflection(B).signatures.map(s => ({ ...s,'
    + " narrows: [{ target: 'p0', type: type uint8 }] })) });",
    'Reflect.getReflection(H).signatures[0].narrows[0].type === uint8'],
  ['reference.target', '', 'Reflect.getReflection(type ref uint8).target === uint8'],
];

for (const [name, setup, expr] of SLOTS) {
  test(`a Type Object, not a node: ${name}`, () => {
    expect(evaluated(`${setup} String(${expr});`), name).toBe('true');
  });
}

test('every emitted kind is one the table lists', () => {
  // The other half of the invariant, and the one that would have caught the
  // `enum` node the day it appeared: a walker written from the table must not
  // meet a kind the table does not name.
  const spellings = [
    'type uint8', 'type "a"', "type uint32.<{ brand: 'X' }>", 'type uint8 | string',
    'type [uint8, string]', 'type [].<uint8>',
    'type { a: uint8 }', 'type (uint8) => string', 'type ref uint8',
    'type never', 'type any', 'type void', 'type string',
  ];
  for (const spelling of spellings) {
    const kind = evaluated(`String(Reflect.getReflection(${spelling}).kind);`);
    expect(TABLE_KINDS, `${spelling} reflected as ${kind}`).toContain(kind);
  }
  // A class and an enum are named leaves and share the `primitive` node; the
  // enum-ness a walker needs is `family` on that node, not a kind of its own.
  expect(evaluated('class P { x: uint8 } String(Reflect.getReflection(type P).kind);')).toBe('primitive');
  expect(evaluated('enum E { a, b } String(Reflect.getReflection(type E).kind);')).toBe('primitive');
  expect(evaluated('enum E { a, b } String(Reflect.getReflection(type E).family);')).toBe('enum');
});
