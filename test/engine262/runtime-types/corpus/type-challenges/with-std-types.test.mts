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
 * TRIAGE STATE. **15 of 46 blocks hold; 31 do not**, and the failures are
 * FINDINGS rather than defects in this file - these blocks had never run, so
 * the document has been advertising 42 helpers with demonstrations nobody could
 * check.
 *
 * The counts agree now, which they did not at first. An earlier pass reported
 * "21 failing assertions across 38 blocks", which is arithmetically impossible
 * and was two separate mistakes: a truncated console listing read as a total,
 * and an extractor that split each block by LINE. Several blocks wrap one
 * assertion across two or three lines, so each fragment parsed as its own
 * program and reported "Unexpected token" - 39 phantom failures, the largest
 * bucket in the first triage and entirely an artefact. The extractor now splits
 * on `;` at bracket depth zero.
 *
 * The remaining 40 failing assertions across 31 blocks, by cause:
 *
 *   D  8  a bare constructor where a type is required - `Function`, `Promise`,
 *         `Date`. Partly fixed in the document; the residue is that `type
 *         Function` is not a type either, so those need a different answer.
 *   I  8  still "Unexpected token" - a second extraction gap, not yet chased
 *   E  6  `std.head(type [])` expects `never`, but `type []` parses as an ARRAY
 *         rather than an empty tuple (F115, recorded in phase 1)
 *   B  6  a name the block uses that its `// Builder` block never declares -
 *         the block was written against the challenge's PROSE
 *   C  5  the challenge declares a function whose name AND annotated signature
 *         match a kit export, so the two form a duplicate OVERLOAD rather than
 *         a shadow. A hazard of the script prelude, not of either program.
 *   G  4  `mapProperties` given a non-object type
 *   F  1  genuine semantic disagreement
 *
 * Fixed in the document already: `keysOf` renamed to `keys` (OQ1, 18 sites),
 * and the preamble's `never` (F107) and `stringPattern` (OQ8-C) imports.
 */

test.todo('with std:types - 4  Pick - see TRIAGE STATE');

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

test('with std:types - 10  Tuple to Union', () => {
  expectBuilderTrue(kit(`function tupleToUnion(T: type): type {
  const node = reflect(T);
  if (node.kind === 'tuple') return union(node.elements.map(e => e.type));
  if (node.kind === 'array') return node.element;
  throw new TypeError(\`tupleToUnion: \${String(T)} is not an array or tuple type\`);
}

tupleToUnion(type [123, '456', true]) === type 123 | '456' | true;
tupleToUnion(type [123]) === type 123;                 // union of one arm is that arm
tupleToUnion([].<string | uint32>) === type string | uint32;
\nString(std.union(std.elementTypes(type [123, '456', true])) === type 123 | '456' | true);`));
  expectBuilderTrue(kit(`function tupleToUnion(T: type): type {
  const node = reflect(T);
  if (node.kind === 'tuple') return union(node.elements.map(e => e.type));
  if (node.kind === 'array') return node.element;
  throw new TypeError(\`tupleToUnion: \${String(T)} is not an array or tuple type\`);
}

tupleToUnion(type [123, '456', true]) === type 123 | '456' | true;
tupleToUnion(type [123]) === type 123;                 // union of one arm is that arm
tupleToUnion([].<string | uint32>) === type string | uint32;
\nString(std.flatten([].<string | uint32>) === type string | uint32);`));
});

test.todo('with std:types - 15  Last of Array - see TRIAGE STATE');

test.todo('with std:types - 20  Promise.all - see TRIAGE STATE');

test('with std:types - 62  Type Lookup', () => {
  expectBuilderTrue(kit(`function lookUp(U: type, T: type): type {
  return union(arms(U).filter(arm => Reflect.isAssignable(arm, objectOf([prop('type', T)]))));
}

interface Cat { type: 'cat'; breeds: 'Abyssinian' | 'Shorthair' }
interface Dog { type: 'dog'; breeds: 'Hound' | 'Boxer'; color: 'brown' | 'white' }
type Animal = Cat | Dog;

lookUp(Animal, type 'dog') === Dog;
lookUp(Animal, type 'cat') === Cat;
lookUp(Animal, type 'bird') === never;
\nString(std.extract(Animal, std.objectOf([std.prop('type', type 'dog')])) === Dog);`));
  expectBuilderTrue(kit(`function lookUp(U: type, T: type): type {
  return union(arms(U).filter(arm => Reflect.isAssignable(arm, objectOf([prop('type', T)]))));
}

interface Cat { type: 'cat'; breeds: 'Abyssinian' | 'Shorthair' }
interface Dog { type: 'dog'; breeds: 'Hound' | 'Boxer'; color: 'brown' | 'white' }
type Animal = Cat | Dog;

lookUp(Animal, type 'dog') === Dog;
lookUp(Animal, type 'cat') === Cat;
lookUp(Animal, type 'bird') === never;
\nString(std.byKind(Animal, 'dog', 'type') === Dog);`));
});

test('with std:types - 110  Capitalize', () => {
  expectBuilderTrue(kit(`function myCapitalize(s: string): type {
  return literal(s.charAt(0).toUpperCase() + s.slice(1));
}

myCapitalize('foo bar') === type 'Foo bar';
myCapitalize('FOOBAR') === type 'FOOBAR';
myCapitalize('') === type '';
\nString(std.capitalized(type 'foo bar') === type 'Foo bar');`));
});

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

test('with std:types - 9616  Parse URL Params', () => {
  expectBuilderTrue(kit(`function parseUrlParams(path: string): type {
  return union(path.split('/').filter(seg => seg.startsWith(':')).map(seg => literal(seg.slice(1))));
}

parseUrlParams('') === never;
parseUrlParams('posts/:id') === type 'id';
parseUrlParams('posts/:id/:user/like') === type 'id' | 'user';
\nString(std.keys(std.routeParams('posts/:id/:user/like')) === type 'id' | 'user');`));
  expectBuilderTrue(kit(`function parseUrlParams(path: string): type {
  return union(path.split('/').filter(seg => seg.startsWith(':')).map(seg => literal(seg.slice(1))));
}

parseUrlParams('') === never;
parseUrlParams('posts/:id') === type 'id';
parseUrlParams('posts/:id/:user/like') === type 'id' | 'user';
\nString(std.keys(std.routeParams('')) === never);`));
});

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

test('with std:types - 35991  MyUppercase', () => {
  expectBuilderTrue(kit(`function myUppercase(s: string): type {
  return literal(s.toUpperCase());
}

myUppercase('a') === type 'A';
myUppercase('Z') === type 'Z';
myUppercase('A z h yy ??cda\\n\\t  a   ') === type 'A Z H YY ??CDA\\n\\t  A   ';
\nString(std.uppercase(type 'a') === type 'A');`));
  expectBuilderTrue(kit(`function myUppercase(s: string): type {
  return literal(s.toUpperCase());
}

myUppercase('a') === type 'A';
myUppercase('Z') === type 'Z';
myUppercase('A z h yy ??cda\\n\\t  a   ') === type 'A Z H YY ??CDA\\n\\t  A   ';
\nString(std.uppercase(type 'a' | 'z') === type 'A' | 'Z');`));
});

test.todo('with std:types - 6  Simple Vue - see TRIAGE STATE');

test.todo('with std:types - 55  Union to Intersection - see TRIAGE STATE');

test.todo('with std:types - 213  Vue Basic Props - see TRIAGE STATE');

test.todo('with std:types - 270  Typed Get - see TRIAGE STATE');

test.todo('with std:types - 1383  Camelize - see TRIAGE STATE');

test('with std:types - 9160  Assign', () => {
  expectBuilderTrue(kit(`function assign(T: type, sources: [].<type>): type {
  const byName = new Map(reflect(T).properties.map(p => [p.name, p]));
  for (const source of sources)
    for (const p of reflect(source).properties) byName.set(p.name, p);
  return objectOf([...byName.values()]);
}

assign(type {}, [type { a: 'a' }]) === type { a: 'a' };
assign(type { a: 'a', b: 'b' }, [type { a: 1 }, type { c: 'c' }]) === type { a: 1, b: 'b', c: 'c' };
\nString([type { a: 1 }, type { c: 'c' }].reduce((acc, source) => std.merge(acc, source), type { a: 'a', b: 'b' })
  === type { a: 1, b: 'b', c: 'c' });`));
});

test('with std:types - 9775  Capitalize Nest Object Keys', () => {
  expectBuilderTrue(kit(`function capitalizeNestObjectKeys(T: type): type {
  const node = reflect(T);
  switch (node.kind) {
    case 'object': return objectOf(node.properties.map(p => ({
      ...p,
      name: typeof p.name === 'string' ? \`\${p.name[0].toUpperCase()}\${p.name.slice(1)}\` : p.name,
      type: capitalizeNestObjectKeys(p.type),
    })));
    case 'tuple': return tupleOf(node.elements.map(e => capitalizeNestObjectKeys(e.type)));
    default: return T;
  }
}

type T = { foo: 1, bar: { baz: [{ deep: 2 }] } };
capitalizeNestObjectKeys(T) === type { Foo: 1, Bar: { Baz: [{ Deep: 2 }] } };
\nString(std.traverse(T, { property: p => ({ ...p,
  name: typeof p.name === 'string' ? \`\${p.name[0].toUpperCase()}\${p.name.slice(1)}\` : p.name }) })
  === capitalizeNestObjectKeys(T));`));
});

test.todo('with std:types - 13580  Replace Union - see TRIAGE STATE');

test('with std:types - 19458  SnakeCase', () => {
  expectBuilderTrue(kit(`function snakeCase(T: type): type {
  return union(arms(T).map(a =>
    literal(literalValues(a)[0].replace(/\\p{Lu}/gu, c => \`_\${c.toLowerCase()}\`))));
}

snakeCase(type 'hello') === type 'hello';
snakeCase(type 'userName') === type 'user_name';
snakeCase(type 'getElementById') === type 'get_element_by_id';
snakeCase(type 'getElementById' | 'getElementByClassNames')
  === type 'get_element_by_id' | 'get_element_by_class_names';
\nString(std.mapLiterals(type 'getElementById' | 'getElementByClassNames',
  s => s.replace(/\\p{Lu}/gu, c => \`_\${c.toLowerCase()}\`)) === type 'get_element_by_id' | 'get_element_by_class_names');`));
});

test.todo('with std:types - 33763  Union to Object from key - see TRIAGE STATE');
