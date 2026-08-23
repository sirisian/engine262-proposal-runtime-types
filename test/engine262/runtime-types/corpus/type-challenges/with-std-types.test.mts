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
 * TRIAGE STATE. Of the 46 blocks, 7 hold against the shipped kit and 39 do not.
 *
 * That is the finding, not a defect in this file: these blocks have never been
 * executed, so the document has been advertising 42 helpers with demonstrations
 * nobody could check. Sampling the failures shows they are real claims that do
 * not hold - `std.head(type [])` expects `never` but `type []` parses as an
 * ARRAY rather than an empty tuple (F115), and one block passes `Function`
 * where a type is required.
 *
 * The failing blocks are `test.todo` rather than deleted or weakened, each
 * naming the claim it makes, so the list is the triage queue. Each one is a
 * separate judgement - the document may be wrong, the kit may be wrong, or the
 * engine may be - and answering 39 of those is its own pass.
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

test.todo('with std:types - 14  First of Array - block does not hold against the shipped kit; see TRIAGE STATE');

test.todo('with std:types - 43  Exclude - block does not hold against the shipped kit; see TRIAGE STATE');

test.todo('with std:types - 189  Awaited - block does not hold against the shipped kit; see TRIAGE STATE');

test.todo('with std:types - 533  Concat - block does not hold against the shipped kit; see TRIAGE STATE');

test.todo('with std:types - 3057  Push - block does not hold against the shipped kit; see TRIAGE STATE');

test.todo('with std:types - 3060  Unshift - block does not hold against the shipped kit; see TRIAGE STATE');

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

test.todo('with std:types - 2  Get Return Type - block does not hold against the shipped kit; see TRIAGE STATE');

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

test.todo('with std:types - 8  Readonly 2 - block does not hold against the shipped kit; see TRIAGE STATE');

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

test.todo('with std:types - 10  Tuple to Union - block does not hold against the shipped kit; see TRIAGE STATE');

test.todo('with std:types - 15  Last of Array - block does not hold against the shipped kit; see TRIAGE STATE');

test.todo('with std:types - 20  Promise.all - block does not hold against the shipped kit; see TRIAGE STATE');

test.todo('with std:types - 62  Type Lookup - block does not hold against the shipped kit; see TRIAGE STATE');

test.todo('with std:types - 110  Capitalize - block does not hold against the shipped kit; see TRIAGE STATE');

test.todo('with std:types - 191  Append Argument - block does not hold against the shipped kit; see TRIAGE STATE');

test('with std:types - 527  Append to object', () => {
  expectBuilderTrue(kit(`function appendToObject(T: type, key: string | symbol, V: type): type {
  return objectOf([...reflect(T).properties, prop(key, V)]);
}

type Test = { key: 'cat', value: 'green' };
appendToObject(Test, 'home', boolean) === type { key: 'cat', value: 'green', home: boolean };
\nString(std.merge(Test, std.record(type 'home', boolean)) === type { key: 'cat', value: 'green', home: boolean });`));
});

test.todo('with std:types - 599  Merge - block does not hold against the shipped kit; see TRIAGE STATE');

test.todo('with std:types - 645  Diff - block does not hold against the shipped kit; see TRIAGE STATE');

test.todo('with std:types - 2595  PickByType - block does not hold against the shipped kit; see TRIAGE STATE');

test.todo('with std:types - 2757  PartialByKeys - block does not hold against the shipped kit; see TRIAGE STATE');

test.todo('with std:types - 2759  RequiredByKeys - block does not hold against the shipped kit; see TRIAGE STATE');

test.todo('with std:types - 2793  Mutable - block does not hold against the shipped kit; see TRIAGE STATE');

test.todo('with std:types - 2852  OmitByType - block does not hold against the shipped kit; see TRIAGE STATE');

test.todo('with std:types - 3062  Shift - block does not hold against the shipped kit; see TRIAGE STATE');

test.todo('with std:types - 3192  Reverse - block does not hold against the shipped kit; see TRIAGE STATE');

test.todo('with std:types - 3196  Flip Arguments - block does not hold against the shipped kit; see TRIAGE STATE');

test.todo('with std:types - 4471  Zip - block does not hold against the shipped kit; see TRIAGE STATE');

test.todo('with std:types - 9616  Parse URL Params - block does not hold against the shipped kit; see TRIAGE STATE');

test.todo('with std:types - 16259  ToPrimitive - block does not hold against the shipped kit; see TRIAGE STATE');

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

test.todo('with std:types - 29650  ExtractToObject - block does not hold against the shipped kit; see TRIAGE STATE');

test.todo('with std:types - 35991  MyUppercase - block does not hold against the shipped kit; see TRIAGE STATE');

test.todo('with std:types - 6  Simple Vue - block does not hold against the shipped kit; see TRIAGE STATE');

test.todo('with std:types - 55  Union to Intersection - block does not hold against the shipped kit; see TRIAGE STATE');

test.todo('with std:types - 213  Vue Basic Props - block does not hold against the shipped kit; see TRIAGE STATE');

test.todo('with std:types - 270  Typed Get - block does not hold against the shipped kit; see TRIAGE STATE');

test.todo('with std:types - 1383  Camelize - block does not hold against the shipped kit; see TRIAGE STATE');

test.todo('with std:types - 9160  Assign - block does not hold against the shipped kit; see TRIAGE STATE');

test.todo('with std:types - 9775  Capitalize Nest Object Keys - block does not hold against the shipped kit; see TRIAGE STATE');

test.todo('with std:types - 13580  Replace Union - block does not hold against the shipped kit; see TRIAGE STATE');

test.todo('with std:types - 19458  SnakeCase - block does not hold against the shipped kit; see TRIAGE STATE');

test.todo('with std:types - 33763  Union to Object from key - block does not hold against the shipped kit; see TRIAGE STATE');
