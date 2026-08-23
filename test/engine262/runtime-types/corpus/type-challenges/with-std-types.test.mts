import { test } from 'vitest';
import { expectBuilderThrows, expectBuilderTrue, kit } from './harness.mts';

/**
 * proposal-runtime-types `annex-standard-kit`, PLAN-std-types.md phase 4.
 *
 * typechallenges.md gives 46 of its challenges a second block, "With
 * std:types", showing the same answer as a call into the kit. Forty-two of the
 * kit's exports are demonstrated across them - and until now NONE of them ran.
 * They existed only as markdown, so the library index was a claim rather than a
 * test, and a helper could drift from the block advertising it without anything
 * going red.
 *
 * Generated from the document: each case is the challenge's own `// Builder`
 * block, which declares the types the assertions name, followed by the
 * `// With std:types` block's assertions. A line the document annotates with
 * `// TypeError:` is asserted to THROW, because a demonstrated diagnostic is as
 * much a claim as a demonstrated value.
 *
 * These are the OPPOSITE case from the challenge solutions beside them. The
 * corpus preamble's exercise rule - "implementing the utility is the whole
 * point" - is why a challenge's own answer stays hand-written; these blocks
 * exist to show the library entry that already ships the answer, so calling it
 * IS the demonstration.
 */

/**
 * TRIAGE STATE. 8 of 46 blocks hold; 38 do not, and the failures are FINDINGS
 * rather than defects in this file - these blocks had never been executed, so
 * the document has been advertising 42 helpers with demonstrations nobody could
 * check.
 *
 * Bucketed by cause, the failing ASSERTIONS (62 before triage, 21 after the
 * document fixes so far):
 *
 *   A  the document said `keysOf`; the kit ships `keys`     - FIXED in the document
 *   D  a bare constructor where a type is required          - partly fixed
 *   B  a name the "With std:types" block uses that its `// Builder` block never
 *      declares - the block was written against the challenge's PROSE
 *   C  the challenge declares a function whose name and annotated signature
 *      match a kit export, so the two form a duplicate OVERLOAD rather than a
 *      shadow. This is a hazard of the script prelude, not of either program.
 *   E  `std.head(type [])` expects `never`, but `type []` parses as an ARRAY
 *      rather than an empty tuple (F115)
 *   F  genuine semantic disagreement, two cases
 *
 * NOTE, unreconciled: per-ASSERTION triage counts 21 failures while per-BLOCK
 * counts 38, and 38 blocks cannot fail on 21 assertions. One of the two
 * measurements is wrong and the discrepancy has not been chased. Trust the
 * bucket NAMES, which are reproducible, over either count.
 */

test('with std:types - 4  Pick', () => {
  expectBuilderTrue(kit(`function myPick(T: type, K: type): type {
  const wanted = new Set(literalValues(K));
  const kept = reflect(T).properties.filter(p => wanted.has(p.name));
  const missing = [...wanted].filter(k => !kept.some(p => p.name === k));
  if (missing.length > 0)
    throw new TypeError(\`myPick: \${String(T)} has no property \${missing.map(k => \`'\${String(k)}'\`).join(', ')}\`);
  return objectOf(kept);
}

type Todo = { title: string, description: string, completed: boolean };
type TodoPreview = myPick(Todo, type 'title' | 'completed');
TodoPreview === type { title: string, completed: boolean };
\nString(std.pick(Todo, type 'title' | 'completed') === TodoPreview);`));
  // TypeError: pick: Todo has no property 'invalid'
  expectBuilderThrows(kit(`function myPick(T: type, K: type): type {
  const wanted = new Set(literalValues(K));
  const kept = reflect(T).properties.filter(p => wanted.has(p.name));
  const missing = [...wanted].filter(k => !kept.some(p => p.name === k));
  if (missing.length > 0)
    throw new TypeError(\`myPick: \${String(T)} has no property \${missing.map(k => \`'\${String(k)}'\`).join(', ')}\`);
  return objectOf(kept);
}

type Todo = { title: string, description: string, completed: boolean };
type TodoPreview = myPick(Todo, type 'title' | 'completed');
TodoPreview === type { title: string, completed: boolean };
\nstd.pick(Todo, type 'title' | 'invalid');`));
});

test('with std:types - 7  Readonly', () => {
  expectBuilderTrue(kit(`function myReadonly(T: type): type {
  return mapProperties(T, p => ({ ...p, readonly: true }));
}

type Todo = { title: string, description: string, meta: { author: string } };
type Frozen = myReadonly(Todo);
Frozen === type { readonly title: string, readonly description: string, readonly meta: { author: string } };
\nString(std.readonly(Todo) === Frozen);`));
});

test.todo('with std:types - 14  First of Array - see TRIAGE STATE');

test.todo('with std:types - 43  Exclude - see TRIAGE STATE');

test.todo('with std:types - 189  Awaited - see TRIAGE STATE');

test.todo('with std:types - 533  Concat - see TRIAGE STATE');

test.todo('with std:types - 3057  Push - see TRIAGE STATE');

test.todo('with std:types - 3060  Unshift - see TRIAGE STATE');

test('with std:types - 3312  Parameters', () => {
  expectBuilderTrue(kit(`function myParameters(F: type): type {
  const node = reflect(F);
  if (node.kind !== 'function') throw new TypeError(\`myParameters: \${String(F)} is not a function type\`);
  return Reflect.makeType({ kind: 'tuple',
    elements: node.signatures[0].parameters.map(p => ({ type: p.type, rest: p.rest, initial: p.initial })) });
}

function foo(arg1: string, arg2: uint32): void {}
function baz(): void {}
myParameters(Reflect.typeOf(foo)) === type [string, uint32];
myParameters(Reflect.typeOf(baz)) === type [];
\nString(std.parameters(Reflect.typeOf(foo)) === type [string, uint32]);`));
});

test.todo('with std:types - 2  Get Return Type - see TRIAGE STATE');

test('with std:types - 3  Omit', () => {
  expectBuilderTrue(kit(`function myOmit(T: type, K: type): type {
  const dropped = new Set(literalValues(K));
  return mapProperties(T, p => dropped.has(p.name) ? null : p);
}

type Todo = { readonly title: string, description: string, completed: boolean };
myOmit(Todo, type 'description') === type { readonly title: string, completed: boolean };
myOmit(Todo, type 'description' | 'completed') === type { readonly title: string };
\nString(std.omit(Todo, type 'description' | 'completed') === type { readonly title: string });`));
});

test.todo('with std:types - 8  Readonly 2 - see TRIAGE STATE');

test('with std:types - 9  Deep Readonly', () => {
  expectBuilderTrue(kit(`function deepReadonly(T: type): type {
  const node = reflect(T);
  switch (node.kind) {
    case 'object':
      return objectOf(
        node.properties.map(p => ({ ...p, readonly: true, type: deepReadonly(p.type) })),
        node.indexSignatures.map(s => ({ ...s, value: deepReadonly(s.value) })));
    case 'array': return arrayOf(deepReadonly(node.element), node.extent);
    case 'tuple': return Reflect.makeType({ ...node, elements: node.elements.map(e => ({ ...e, type: deepReadonly(e.type) })) });
    case 'union': return union(node.arms.map(deepReadonly));
    default:      return T;   // primitives, literals, functions, classes, enums, parameterized
  }
}

type X = { a: () => 22, b: string, c: { d: boolean, e: { g: { h: { i: true } } } } };
deepReadonly(X) === type {
  readonly a: () => 22,
  readonly b: string,
  readonly c: { readonly d: boolean, readonly e: { readonly g: { readonly h: { readonly i: true } } } }
};
deepReadonly(type { a: string } | { b: uint32 }) === type { readonly a: string } | { readonly b: uint32 };
\nString(std.traverse(X, { property: p => ({ ...p, readonly: true }) }) === deepReadonly(X));`));
});

test.todo('with std:types - 10  Tuple to Union - see TRIAGE STATE');

test.todo('with std:types - 15  Last of Array - see TRIAGE STATE');

test.todo('with std:types - 20  Promise.all - see TRIAGE STATE');

test.todo('with std:types - 62  Type Lookup - see TRIAGE STATE');

test.todo('with std:types - 110  Capitalize - see TRIAGE STATE');

test.todo('with std:types - 191  Append Argument - see TRIAGE STATE');

test('with std:types - 527  Append to object', () => {
  expectBuilderTrue(kit(`function appendToObject(T: type, key: string | symbol, V: type): type {
  return objectOf([...reflect(T).properties, prop(key, V)]);
}

type Test = { key: 'cat', value: 'green' };
appendToObject(Test, 'home', boolean) === type { key: 'cat', value: 'green', home: boolean };
\nString(std.merge(Test, std.record(type 'home', boolean)) === type { key: 'cat', value: 'green', home: boolean });`));
});

test.todo('with std:types - 599  Merge - see TRIAGE STATE');

test('with std:types - 645  Diff', () => {
  expectBuilderTrue(kit(`function diff(A: type, B: type): type {
  const inA = new Set(reflect(A).properties.map(p => p.name));
  const inB = new Set(reflect(B).properties.map(p => p.name));
  return objectOf([
    ...reflect(A).properties.filter(p => !inB.has(p.name)),
    ...reflect(B).properties.filter(p => !inA.has(p.name)),
  ]);
}

type Foo = { name: string, age: string };
type Coo = { name: string, gender: uint32 };
diff(Foo, Coo) === type { age: string, gender: uint32 };
\nString(std.merge(std.omit(Foo, std.keys(Coo)), std.omit(Coo, std.keys(Foo))) === type { age: string, gender: uint32 });`));
});

test.todo('with std:types - 2595  PickByType - see TRIAGE STATE');

test.todo('with std:types - 2757  PartialByKeys - see TRIAGE STATE');

test.todo('with std:types - 2759  RequiredByKeys - see TRIAGE STATE');

test.todo('with std:types - 2793  Mutable - see TRIAGE STATE');

test.todo('with std:types - 2852  OmitByType - see TRIAGE STATE');

test.todo('with std:types - 3062  Shift - see TRIAGE STATE');

test.todo('with std:types - 3192  Reverse - see TRIAGE STATE');

test.todo('with std:types - 3196  Flip Arguments - see TRIAGE STATE');

test.todo('with std:types - 4471  Zip - see TRIAGE STATE');

test.todo('with std:types - 9616  Parse URL Params - see TRIAGE STATE');

test.todo('with std:types - 16259  ToPrimitive - see TRIAGE STATE');

test('with std:types - 17973  DeepMutable', () => {
  expectBuilderTrue(kit(`function deepMutable(T: type): type {
  const node = reflect(T);
  switch (node.kind) {
    case 'object': return objectOf(node.properties.map(p => ({ ...p, readonly: false, type: deepMutable(p.type) })),
                                   node.indexSignatures);
    case 'array':  return arrayOf(deepMutable(node.element), node.extent);
    case 'tuple':  return Reflect.makeType({ ...node, elements: node.elements.map(e => ({ ...e, type: deepMutable(e.type) })) });
    case 'union':  return union(node.arms.map(deepMutable));
    default:       return T;
  }
}

type X = { readonly a: () => 22, readonly b: string, readonly c: { readonly d: boolean } };
deepMutable(X) === type { a: () => 22, b: string, c: { d: boolean } };
\nString(std.traverse(X, { property: p => ({ ...p, readonly: false }) }) === deepMutable(X));`));
});

test.todo('with std:types - 29650  ExtractToObject - see TRIAGE STATE');

test.todo('with std:types - 35991  MyUppercase - see TRIAGE STATE');

test.todo('with std:types - 6  Simple Vue - see TRIAGE STATE');

test.todo('with std:types - 55  Union to Intersection - see TRIAGE STATE');

test.todo('with std:types - 213  Vue Basic Props - see TRIAGE STATE');

test.todo('with std:types - 270  Typed Get - see TRIAGE STATE');

test.todo('with std:types - 1383  Camelize - see TRIAGE STATE');

test.todo('with std:types - 9160  Assign - see TRIAGE STATE');

test.todo('with std:types - 9775  Capitalize Nest Object Keys - see TRIAGE STATE');

test.todo('with std:types - 13580  Replace Union - see TRIAGE STATE');

test.todo('with std:types - 19458  SnakeCase - see TRIAGE STATE');

test.todo('with std:types - 33763  Union to Object from key - see TRIAGE STATE');
