import { test } from 'vitest';
import { expectBuilderTrue, kit } from './harness.mts';

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
 * TRIAGE STATE. **29 of 46 blocks hold**, after phase 4b steps 1, 2, 3, 7 and
 * F115 direction B. The remaining 17 are findings, not defects in this file.
 *
 * F115 closed 8 at once: `[]` is now the EMPTY TUPLE rather than the array of
 * `any`. The corpus was written expecting exactly that - it is what TypeScript
 * means - and the old reading failed SILENTLY, since `type []` was not an error
 * but a different type.
 *
 * Remaining, by cause:
 *
 *   D  a bare constructor where a type is required, plus `Function`, which is
 *      not a type at all and needs a design answer rather than a spelling
 *   G  `mapProperties` on a nominal - the OQ2-A boundary working as decided;
 *      these blocks predate that decision
 *   I  "Unexpected token" - a third extraction gap
 *   B  a name the block never declares
 *   H  `keys` undefined inside a default parameter - no hypothesis yet
 *   F  genuine semantic disagreement
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

test('with std:types - 533  Concat', () => {
  expectBuilderTrue(kit(`function concat(A: type, B: type): type {
  return Reflect.makeType({ kind: 'tuple', elements: [...tupleElements(A), ...tupleElements(B)] });
}

concat(type [], type []) === type [];
concat(type [], type [1]) === type [1];
concat(type [1, 2], type [3, 4]) === type [1, 2, 3, 4];
concat(type ['1', 2, '3'], type [false, boolean, '4']) === type ['1', 2, '3', false, boolean, '4'];
\nString(std.concat(type ['1', 2, '3'], type [false, boolean, '4']) === type ['1', 2, '3', false, boolean, '4']);`));
});

test('with std:types - 3057  Push', () => {
  expectBuilderTrue(kit(`function push(T: type, U: type): type {
  return Reflect.makeType({ kind: 'tuple',
    elements: [...tupleElements(T), { type: U, rest: false, initial: undefined }] });
}

push(type [], type 1) === type [1];
push(type [1, 2], type '3') === type [1, 2, '3'];
push(type ['1', 2, '3'], boolean) === type ['1', 2, '3', boolean];
\nString(std.concat(type [1, 2], type [3]) === push(type [1, 2], type 3));`));
});

test('with std:types - 3060  Unshift', () => {
  expectBuilderTrue(kit(`function unshift(T: type, U: type): type {
  return Reflect.makeType({ kind: 'tuple',
    elements: [{ type: U, rest: false, initial: undefined }, ...tupleElements(T)] });
}

unshift(type [], type 1) === type [1];
unshift(type [1, 2], type 0) === type [0, 1, 2];
unshift(type ['1', 2, '3'], boolean) === type [boolean, '1', 2, '3'];
\nString(std.concat(type [0], type [1, 2]) === unshift(type [1, 2], type 0));`));
});

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

test('with std:types - 2  Get Return Type', () => {
  expectBuilderTrue(kit(`function myReturnType(F: type): type {
  const node = reflect(F);
  if (node.kind !== 'function') throw new TypeError(\`myReturnType: \${String(F)} is not a function type\`);
  return node.signatures[0].return.type;
}

myReturnType(type () => string) === string;
myReturnType(type () => 123) === type 123;
myReturnType(type () => Promise.<boolean>) === type Promise.<boolean>;
myReturnType(type () => () => 'foo') === type () => 'foo';
\nString(std.returnType(type () => Promise.<boolean>) === type Promise.<boolean>);`));
});

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

test('with std:types - 15  Last of Array', () => {
  expectBuilderTrue(kit(`function last(T: type): type {
  return tupleElements(T).at(-1)?.type ?? never;
}

last(type [3, 2, 1]) === type 1;
last(type [2]) === type 2;
last(type []) === never;
\nString(std.elementTypes(type [3, 2, 1]).at(-1) === type 1);`));
});

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

test('with std:types - 191  Append Argument', () => {
  expectBuilderTrue(kit(`function appendArgument(F: type, A: type): type {
  const node = reflect(F);
  if (node.kind !== 'function') throw new TypeError(\`appendArgument: \${String(F)} is not a function type\`);
  return Reflect.makeType({ ...node, signatures: node.signatures.map(sig => ({
    ...sig,
    parameters: [...sig.parameters,
      { type: A, name: 'appended', index: sig.parameters.length, rest: false, initial: undefined, metadata: {} }],
  })) });
}

appendArgument(type (a: uint32, b: string) => uint32, boolean) === type (a: uint32, b: string, x: boolean) => uint32;
appendArgument(type () => void, type undefined) === type (x: undefined) => void;

const Fn = type (a: uint32, b: string) => uint32;\nString(std.fn([...std.elementTypes(std.parameters(Fn)), boolean], std.returnType(Fn)) === appendArgument(Fn, boolean));`));
});

test('with std:types - 527  Append to object', () => {
  expectBuilderTrue(kit(`function appendToObject(T: type, key: string | symbol, V: type): type {
  return objectOf([...reflect(T).properties, prop(key, V)]);
}

type Test = { key: 'cat', value: 'green' };
appendToObject(Test, 'home', boolean) === type { key: 'cat', value: 'green', home: boolean };
\nString(std.merge(Test, std.record(type 'home', boolean)) === type { key: 'cat', value: 'green', home: boolean });`));
});

test('with std:types - 599  Merge', () => {
  expectBuilderTrue(kit(`function merge(F: type, S: type): type {
  const second = reflect(S).properties;
  const overridden = new Set(second.map(p => p.name));
  return objectOf([...reflect(F).properties.filter(p => !overridden.has(p.name)), ...second]);
}

type Foo = { a: uint32, b: string };
type Bar = { b: uint32, c: boolean };
merge(Foo, Bar) === type { a: uint32, b: uint32, c: boolean };
\nString(std.merge(Foo, Bar) === merge(Foo, Bar));`));
});

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

test('with std:types - 3062  Shift', () => {
  expectBuilderTrue(kit(`function shift(T: type): type {
  return Reflect.makeType({ kind: 'tuple', elements: tupleElements(T).slice(1) });
}

shift(type [3, 2, 1]) === type [2, 1];
shift(type [1]) === type [];
shift(type []) === type [];
\nString(std.tail(type [3, 2, 1]) === type [2, 1]);`));
});

test('with std:types - 3192  Reverse', () => {
  expectBuilderTrue(kit(`function reverse(T: type): type {
  return Reflect.makeType({ kind: 'tuple', elements: tupleElements(T).toReversed() });
}

reverse(type ['a', 'b', 'c']) === type ['c', 'b', 'a'];
reverse(type []) === type [];
\nString(std.reverse(type ['a', 'b', 'c']) === type ['c', 'b', 'a']);`));
});

test('with std:types - 3196  Flip Arguments', () => {
  expectBuilderTrue(kit(`function flipArguments(F: type): type {
  const node = reflect(F);
  if (node.kind !== 'function') throw new TypeError(\`flipArguments: \${String(F)} is not a function type\`);
  return Reflect.makeType({ ...node, signatures: node.signatures.map(sig => ({
    ...sig, parameters: sig.parameters.toReversed().map((p, index) => ({ ...p, index })),
  })) });
}

flipArguments(type (arg0: string, arg1: uint32, arg2: boolean) => void)
  === type (arg0: boolean, arg1: uint32, arg2: string) => void;
flipArguments(type () => boolean) === type () => boolean;

const Flip = type (arg0: string, arg1: uint32, arg2: boolean) => void;\nString(std.fn(std.elementTypes(std.parameters(Flip)).toReversed(), std.returnType(Flip)) === flipArguments(Flip));`));
});

test('with std:types - 4471  Zip', () => {
  expectBuilderTrue(kit(`function zip(A: type, B: type): type {
  const [a, b] = [tupleElements(A), tupleElements(B)];
  return tupleOf(a.slice(0, Math.min(a.length, b.length)).map((e, i) => tupleOf([e.type, b[i].type])));
}

zip(type [], type []) === type [];
zip(type [1, 2], type [true, false]) === type [[1, true], [2, false]];
zip(type [1, 2, 3], type ['1', '2']) === type [[1, '1'], [2, '2']];
\nString(std.zip(type [1, 2, 3], type ['1', '2']) === type [[1, '1'], [2, '2']]);`));
});

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

test('with std:types - 29650  ExtractToObject', () => {
  expectBuilderTrue(kit(`function extractToObject(T: type, P: type): type {
  const key = literalValues(P)[0];
  const properties = reflect(T).properties;
  const nested = properties.find(p => p.name === key);
  return objectOf([...properties.filter(p => p.name !== key), ...reflect(nested.type).properties]);
}

extractToObject(type { id: '1', myProp: { foo: '2' } }, type 'myProp') === type { id: '1', foo: '2' };
extractToObject(type { id: '1', prop1: { zoo: '2' }, prop2: { foo: '4' } }, type 'prop2')
  === type { id: '1', prop1: { zoo: '2' }, foo: '4' };

const Nested = type { id: '1', myProp: { foo: '2' } };\nString(std.merge(std.omit(Nested, type 'myProp'), std.indexed(Nested, type 'myProp'))
  === extractToObject(Nested, type 'myProp'));`));
});

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

test('with std:types - 270  Typed Get', () => {
  expectBuilderTrue(kit(`function get(T: type, path: string): type {
  const at = (name: string): type | undefined =>
    reflect(T).properties.find(p => p.name === name)?.type;
  const exact = at(path);
  if (exact !== undefined) return exact;      // a literal key beats the dotted reading
  const dot = path.indexOf('.');
  if (dot === -1) return never;
  const head = at(path.slice(0, dot));
  return head === undefined ? never : get(head, path.slice(dot + 1));
}

type Data = {
  foo: { bar: { value: 'foobar', count: 6 }, included: true },
  'foo.baz': false,
  hello: 'world',
};
get(Data, 'hello') === type 'world';
get(Data, 'foo.bar.count') === type 6;
get(Data, 'foo.baz') === type false;        // the key 'foo.baz' exists
get(Data, 'no.existed') === never;
\nString(std.propertyType(Data, 'foo.baz') === type false);`));
  expectBuilderTrue(kit(`function get(T: type, path: string): type {
  const at = (name: string): type | undefined =>
    reflect(T).properties.find(p => p.name === name)?.type;
  const exact = at(path);
  if (exact !== undefined) return exact;      // a literal key beats the dotted reading
  const dot = path.indexOf('.');
  if (dot === -1) return never;
  const head = at(path.slice(0, dot));
  return head === undefined ? never : get(head, path.slice(dot + 1));
}

type Data = {
  foo: { bar: { value: 'foobar', count: 6 }, included: true },
  'foo.baz': false,
  hello: 'world',
};
get(Data, 'hello') === type 'world';
get(Data, 'foo.bar.count') === type 6;
get(Data, 'foo.baz') === type false;        // the key 'foo.baz' exists
get(Data, 'no.existed') === never;
\nString(std.propertyType(Data, 'no') === undefined);`));
});

test('with std:types - 1383  Camelize', () => {
  expectBuilderTrue(kit(`const snakeToCamel = (s: string): string => s.replace(/_(\\p{L})/gu, (_, c) => c.toUpperCase());

function camelize(T: type): type {
  const node = reflect(T);
  switch (node.kind) {
    case 'object': return objectOf(node.properties.map(p => ({
      ...p,
      name: typeof p.name === 'string' ? snakeToCamel(p.name) : p.name,
      type: camelize(p.type),
    })));
    case 'tuple': return tupleOf(node.elements.map(e => camelize(e.type)));
    default: return T;
  }
}

camelize(type {
  some_prop: string,
  prop: { another_prop: string },
  array: [{ snake_case: string }, { another_element: { yet_another_prop: string } }],
}) === type {
  someProp: string,
  prop: { anotherProp: string },
  array: [{ snakeCase: string }, { anotherElement: { yetAnotherProp: string } }],
};

const Wire = type { some_prop: string, prop: { another_prop: string } };\nString(std.traverse(Wire, { property: p => ({ ...p, name: typeof p.name === 'string' ? snakeToCamel(p.name) : p.name }) })
  === camelize(Wire));`));
});

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
