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
type TodoPreview = myPick(Todo, type 'title' | 'completed');\nString(std.pick(Todo, type 'title' | 'completed') === TodoPreview);`));
  // // TypeError: pick: Todo has no property 'invalid'
  expectBuilderThrows(kit(`function myPick(T: type, K: type): type {
  const wanted = new Set(literalValues(K));
  const kept = reflect(T).properties.filter(p => wanted.has(p.name));
  const missing = [...wanted].filter(k => !kept.some(p => p.name === k));
  if (missing.length > 0)
    throw new TypeError(\`myPick: \${String(T)} has no property \${missing.map(k => \`'\${String(k)}'\`).join(', ')}\`);
  return objectOf(kept);
}
type Todo = { title: string, description: string, completed: boolean };
type TodoPreview = myPick(Todo, type 'title' | 'completed');\nstd.pick(Todo, type 'title' | 'invalid');`));
});

test('with std:types - 7  Readonly', () => {
  expectBuilderTrue(kit(`function myReadonly(T: type): type {
  return mapProperties(T, p => ({ ...p, readonly: true }));
}
type Todo = { title: string, description: string, meta: { author: string } };
type Frozen = myReadonly(Todo);\nString(std.readonly(Todo) === Frozen);`));
});

test('with std:types - 14  First of Array', () => {
  expectBuilderTrue(kit(`function first(T: type): type {
  const node = reflect(T);
  if (node.kind === 'tuple') return node.elements[0]?.type ?? never;
  if (node.kind === 'array') return node.extent === 0 ? never : node.element;
  throw new TypeError(\`first: \${String(T)} is not an array or tuple type\`);
}\nString(std.head(type [3, 2, 1]) === type 3);`));
  expectBuilderTrue(kit(`function first(T: type): type {
  const node = reflect(T);
  if (node.kind === 'tuple') return node.elements[0]?.type ?? never;
  if (node.kind === 'array') return node.extent === 0 ? never : node.element;
  throw new TypeError(\`first: \${String(T)} is not an array or tuple type\`);
}\nString(std.head(type []) === never);`));
  // // TypeError: expected a tuple type: head is tuple-only, where first also takes arrays
  expectBuilderThrows(kit(`function first(T: type): type {
  const node = reflect(T);
  if (node.kind === 'tuple') return node.elements[0]?.type ?? never;
  if (node.kind === 'array') return node.extent === 0 ? never : node.element;
  throw new TypeError(\`first: \${String(T)} is not an array or tuple type\`);
}\nstd.head(type [].<string>);`));
});

test('with std:types - 43  Exclude', () => {
  expectBuilderTrue(kit(`function myExclude(T: type, U: type): type {
  return union(arms(T).filter(arm => !Reflect.isAssignable(arm, U)));
}\nString(std.exclude(type string | uint32 | (() => void), type (...a: [].<any>) => any) === type string | uint32);`));
});

test('with std:types - 189  Awaited', () => {
  expectBuilderTrue(kit(`function thenValue(T: type): type | null {
  const node = reflect(T);
  if (node.kind === 'primitive' && node.generic?.base === type Promise)
    return node.generic.arguments[0];
  const then = node.kind === 'object' && node.properties.find(p => p.name === 'then');
  return then ? firstParameter(reflect(then.type).signatures[0].parameters[0].type) : null;
}
function myAwaited(T: type): type {
  const inner = thenValue(T);
  if (inner === null) throw new TypeError(\`myAwaited: \${String(T)} is not a thenable\`);
  return thenValue(inner) === null ? inner : myAwaited(inner);
}\nString(std.awaited(type Promise.<Promise.<string | uint32>>) === type string | uint32);`));
  expectBuilderTrue(kit(`function thenValue(T: type): type | null {
  const node = reflect(T);
  if (node.kind === 'primitive' && node.generic?.base === type Promise)
    return node.generic.arguments[0];
  const then = node.kind === 'object' && node.properties.find(p => p.name === 'then');
  return then ? firstParameter(reflect(then.type).signatures[0].parameters[0].type) : null;
}
function myAwaited(T: type): type {
  const inner = thenValue(T);
  if (inner === null) throw new TypeError(\`myAwaited: \${String(T)} is not a thenable\`);
  return thenValue(inner) === null ? inner : myAwaited(inner);
}\nString(std.awaited(uint32) === uint32);`));
});

test('with std:types - 533  Concat', () => {
  expectBuilderTrue(kit(`function concat(A: type, B: type): type {
  return Reflect.makeType({ kind: 'tuple', elements: [...tupleElements(A), ...tupleElements(B)] });
}\nString(std.concat(type ['1', 2, '3'], type [false, boolean, '4']) === type ['1', 2, '3', false, boolean, '4']);`));
});

test('with std:types - 3057  Push', () => {
  expectBuilderTrue(kit(`function push(T: type, U: type): type {
  return Reflect.makeType({ kind: 'tuple',
    elements: [...tupleElements(T), { type: U, rest: false, initial: undefined }] });
}\nString(std.concat(type [1, 2], type [3]) === push(type [1, 2], type 3));`));
});

test('with std:types - 3060  Unshift', () => {
  expectBuilderTrue(kit(`function unshift(T: type, U: type): type {
  return Reflect.makeType({ kind: 'tuple',
    elements: [{ type: U, rest: false, initial: undefined }, ...tupleElements(T)] });
}\nString(std.concat(type [0], type [1, 2]) === unshift(type [1, 2], type 0));`));
});

test('with std:types - 3312  Parameters', () => {
  expectBuilderTrue(kit(`function myParameters(F: type): type {
  const node = reflect(F);
  if (node.kind !== 'function') throw new TypeError(\`myParameters: \${String(F)} is not a function type\`);
  return Reflect.makeType({ kind: 'tuple',
    elements: node.signatures[0].parameters.map(p => ({ type: p.type, rest: p.rest, initial: p.initial })) });
}
function foo(arg1: string, arg2: uint32): void {}
function baz(): void {}\nString(std.parameters(Reflect.typeOf(foo)) === type [string, uint32]);`));
});

test('with std:types - 2  Get Return Type', () => {
  expectBuilderTrue(kit(`function myReturnType(F: type): type {
  const node = reflect(F);
  if (node.kind !== 'function') throw new TypeError(\`myReturnType: \${String(F)} is not a function type\`);
  return node.signatures[0].return.type;
}\nString(std.returnType(type () => Promise.<boolean>) === type Promise.<boolean>);`));
});

test('with std:types - 3  Omit', () => {
  expectBuilderTrue(kit(`function myOmit(T: type, K: type): type {
  const dropped = new Set(literalValues(K));
  return mapProperties(T, p => dropped.has(p.name) ? null : p);
}
type Todo = { readonly title: string, description: string, completed: boolean };\nString(std.omit(Todo, type 'description' | 'completed') === type { readonly title: string });`));
});

test('with std:types - 8  Readonly 2', () => {
  expectBuilderTrue(kit(`function myReadonly2(T: type, K: type = keys(T)): type {
  const wanted = new Set(literalValues(K));
  const have = new Set(literalValues(keys(T)));
  for (const k of wanted) if (!have.has(k))
    throw new TypeError(\`myReadonly2: \${String(T)} has no property '\${String(k)}'\`);
  return mapProperties(T, p => wanted.has(p.name) ? { ...p, readonly: true } : p);
}
type Todo = { title: string, description?: string, completed: boolean };\nString(std.merge(Todo, std.readonly(std.pick(Todo, type 'title' | 'description')))
  === myReadonly2(Todo, type 'title' | 'description'));`));
});

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
type X = { a: () => 22, b: string, c: { d: boolean, e: { g: { h: { i: true } } } } };\nString(std.traverse(X, { property: p => ({ ...p, readonly: true }) }) === deepReadonly(X));`));
});

test('with std:types - 10  Tuple to Union', () => {
  expectBuilderTrue(kit(`function tupleToUnion(T: type): type {
  const node = reflect(T);
  if (node.kind === 'tuple') return union(node.elements.map(e => e.type));
  if (node.kind === 'array') return node.element;
  throw new TypeError(\`tupleToUnion: \${String(T)} is not an array or tuple type\`);
}\nString(std.union(std.elementTypes(type [123, '456', true])) === type 123 | '456' | true);`));
  expectBuilderTrue(kit(`function tupleToUnion(T: type): type {
  const node = reflect(T);
  if (node.kind === 'tuple') return union(node.elements.map(e => e.type));
  if (node.kind === 'array') return node.element;
  throw new TypeError(\`tupleToUnion: \${String(T)} is not an array or tuple type\`);
}\nString(std.flatten([].<string | uint32>) === type string | uint32);`));
});

test('with std:types - 15  Last of Array', () => {
  expectBuilderTrue(kit(`function last(T: type): type {
  return tupleElements(T).at(-1)?.type ?? never;
}\nString(std.elementTypes(type [3, 2, 1]).at(-1) === type 1);`));
});

test('with std:types - 20  Promise.all', () => {
  expectBuilderTrue(kit(`function settled(T: type): type {
  const node = reflect(T);
  switch (node.kind) {
    case 'tuple': return Reflect.makeType({ ...node, elements: node.elements.map(e => ({ ...e, type: awaited(e.type) })) });
    case 'array': return arrayOf(awaited(node.element), node.extent);
    default: throw new TypeError(\`promiseAll: \${String(T)} is not an array or tuple type\`);
  }
}
function promiseAll<T>(values: T): Promise.<settled(T)> { /* implementation elsewhere */ return undefined; }\nString(std.genericApplication(type Promise, [std.mapElements(type [1, 2, Promise.<uint32>], std.awaited)])
  === type Promise.<[1, 2, uint32]>);`));
  expectBuilderTrue(kit(`function settled(T: type): type {
  const node = reflect(T);
  switch (node.kind) {
    case 'tuple': return Reflect.makeType({ ...node, elements: node.elements.map(e => ({ ...e, type: awaited(e.type) })) });
    case 'array': return arrayOf(awaited(node.element), node.extent);
    default: throw new TypeError(\`promiseAll: \${String(T)} is not an array or tuple type\`);
  }
}
function promiseAll<T>(values: T): Promise.<settled(T)> { /* implementation elsewhere */ return undefined; }\nString(std.mapElements(type [].<uint32 | Promise.<string>>, std.awaited) === type [].<uint32 | string>);`));
});

test('with std:types - 62  Type Lookup', () => {
  expectBuilderTrue(kit(`function lookUp(U: type, T: type): type {
  return union(arms(U).filter(arm => Reflect.isAssignable(arm, objectOf([prop('type', T)]))));
}
interface Cat { type: 'cat'; breeds: 'Abyssinian' | 'Shorthair' }
interface Dog { type: 'dog'; breeds: 'Hound' | 'Boxer'; color: 'brown' | 'white' }
type Animal = Cat | Dog;\nString(std.extract(Animal, std.objectOf([std.prop('type', type 'dog')])) === Dog);`));
  expectBuilderTrue(kit(`function lookUp(U: type, T: type): type {
  return union(arms(U).filter(arm => Reflect.isAssignable(arm, objectOf([prop('type', T)]))));
}
interface Cat { type: 'cat'; breeds: 'Abyssinian' | 'Shorthair' }
interface Dog { type: 'dog'; breeds: 'Hound' | 'Boxer'; color: 'brown' | 'white' }
type Animal = Cat | Dog;\nString(std.byKind(Animal, 'dog', 'type') === Dog);`));
});

test('with std:types - 110  Capitalize', () => {
  expectBuilderTrue(kit(`function myCapitalize(s: string): type {
  return literal(s.charAt(0).toUpperCase() + s.slice(1));
}\nString(std.capitalized(type 'foo bar') === type 'Foo bar');`));
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
const Fn = type (a: uint32, b: string) => uint32;\nString(std.fn([...std.elementTypes(std.parameters(Fn)), boolean], std.returnType(Fn)) === appendArgument(Fn, boolean));`));
});

test('with std:types - 527  Append to object', () => {
  expectBuilderTrue(kit(`function appendToObject(T: type, key: string | symbol, V: type): type {
  return objectOf([...reflect(T).properties, prop(key, V)]);
}
type Test = { key: 'cat', value: 'green' };\nString(std.merge(Test, std.record(type 'home', boolean)) === type { key: 'cat', value: 'green', home: boolean });`));
});

test('with std:types - 599  Merge', () => {
  expectBuilderTrue(kit(`function merge(F: type, S: type): type {
  const second = reflect(S).properties;
  const overridden = new Set(second.map(p => p.name));
  return objectOf([...reflect(F).properties.filter(p => !overridden.has(p.name)), ...second]);
}
type Foo = { a: uint32, b: string };
type Bar = { b: uint32, c: boolean };\nString(std.merge(Foo, Bar) === merge(Foo, Bar));`));
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
type Coo = { name: string, gender: uint32 };\nString(std.merge(std.omit(Foo, std.keys(Coo)), std.omit(Coo, std.keys(Foo))) === type { age: string, gender: uint32 });`));
});

test('with std:types - 2595  PickByType', () => {
  expectBuilderTrue(kit(`function pickByType(T: type, U: type): type {
  return mapProperties(T, p => Reflect.isAssignable(p.type, U) ? p : null);
}
type Model = { name: string, count: uint32, isReadonly: boolean, isEnable: boolean };\nString(std.pickByValue(Model, boolean) === type { isReadonly: boolean, isEnable: boolean });`));
});

test('with std:types - 2757  PartialByKeys', () => {
  expectBuilderTrue(kit(`function partialByKeys(T: type, K: type = keys(T)): type {
  const keys = new Set(literalValues(K));
  return mapProperties(T, p => keys.has(p.name) ? { ...p, optional: true } : p);
}
type User = { name: string, age: uint32, address: string };\nString(std.merge(std.omit(User, type 'name'), std.partial(std.pick(User, type 'name')))
  === partialByKeys(User, type 'name'));`));
});

test('with std:types - 2759  RequiredByKeys', () => {
  expectBuilderTrue(kit(`function requiredByKeys(T: type, K: type = keys(T)): type {
  const keys = new Set(literalValues(K));
  return mapProperties(T, p => keys.has(p.name) ? { ...p, optional: false } : p);
}
type User = { name?: string, age?: uint32, address?: string };\nString(std.merge(std.omit(User, type 'name'), std.required(std.pick(User, type 'name')))
  === requiredByKeys(User, type 'name'));`));
});

test('with std:types - 2793  Mutable', () => {
  expectBuilderTrue(kit(`function mutable(T: type): type {
  return mapProperties(T, p => ({ ...p, readonly: false }));
}
type Todo = { title: string, description: string, completed: boolean };\nString(std.mutable(std.readonly(Todo)) === Todo);`));
});

test('with std:types - 2852  OmitByType', () => {
  expectBuilderTrue(kit(`function omitByType(T: type, U: type): type {
  return mapProperties(T, p => Reflect.isAssignable(p.type, U) ? null : p);
}
type Model = { name: string, count: uint32, isReadonly: boolean, isEnable: boolean };\nString(std.omit(Model, std.keys(std.pickByValue(Model, boolean))) === type { name: string, count: uint32 });`));
});

test('with std:types - 3062  Shift', () => {
  expectBuilderTrue(kit(`function shift(T: type): type {
  return Reflect.makeType({ kind: 'tuple', elements: tupleElements(T).slice(1) });
}\nString(std.tail(type [3, 2, 1]) === type [2, 1]);`));
});

test('with std:types - 3192  Reverse', () => {
  expectBuilderTrue(kit(`function reverse(T: type): type {
  return Reflect.makeType({ kind: 'tuple', elements: tupleElements(T).toReversed() });
}\nString(std.reverse(type ['a', 'b', 'c']) === type ['c', 'b', 'a']);`));
});

test('with std:types - 3196  Flip Arguments', () => {
  expectBuilderTrue(kit(`function flipArguments(F: type): type {
  const node = reflect(F);
  if (node.kind !== 'function') throw new TypeError(\`flipArguments: \${String(F)} is not a function type\`);
  return Reflect.makeType({ ...node, signatures: node.signatures.map(sig => ({
    ...sig, parameters: sig.parameters.toReversed().map((p, index) => ({ ...p, index })),
  })) });
}
const Flip = type (arg0: string, arg1: uint32, arg2: boolean) => void;\nString(std.fn(std.elementTypes(std.parameters(Flip)).toReversed(), std.returnType(Flip)) === flipArguments(Flip));`));
});

test('with std:types - 4471  Zip', () => {
  expectBuilderTrue(kit(`function zip(A: type, B: type): type {
  const [a, b] = [tupleElements(A), tupleElements(B)];
  return tupleOf(a.slice(0, Math.min(a.length, b.length)).map((e, i) => tupleOf([e.type, b[i].type])));
}\nString(std.zip(type [1, 2, 3], type ['1', '2']) === type [[1, '1'], [2, '2']]);`));
});

test('with std:types - 9616  Parse URL Params', () => {
  expectBuilderTrue(kit(`function parseUrlParams(path: string): type {
  return union(path.split('/').filter(seg => seg.startsWith(':')).map(seg => literal(seg.slice(1))));
}\nString(std.keys(std.routeParams('posts/:id/:user/like')) === type 'id' | 'user');`));
  expectBuilderTrue(kit(`function parseUrlParams(path: string): type {
  return union(path.split('/').filter(seg => seg.startsWith(':')).map(seg => literal(seg.slice(1))));
}\nString(std.keys(std.routeParams('')) === never);`));
});

test('with std:types - 16259  ToPrimitive', () => {
  expectBuilderTrue(kit(`function toPrimitive(T: type): type {
  const node = reflect(T);
  switch (node.kind) {
    case 'literal':  return node.base;
    case 'object':   return objectOf(node.properties.map(p => ({ ...p, type: toPrimitive(p.type) })), node.indexSignatures);
    case 'tuple':    return Reflect.makeType({ ...node, elements: node.elements.map(e => ({ ...e, type: toPrimitive(e.type) })) });
    case 'function': return type (...a: [].<any>) => any;
    default:         return T;
  }
}
type PersonInfo = {
  name: 'Tom', age: 30, married: false,
  addr: { home: '123456', phone: '13111111111' },
  hobbies: ['sing', 'dance'], fn: () => any,
};\nString(std.traverse(PersonInfo, { leaf: t => {
  const node = std.reflect(t);
  return node.kind === 'literal' ? node.base : node.kind === 'function' ? type (...a: [].<any>) => any : t;
} }) === toPrimitive(PersonInfo));`));
});

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
type X = { readonly a: () => 22, readonly b: string, readonly c: { readonly d: boolean } };\nString(std.traverse(X, { property: p => ({ ...p, readonly: false }) }) === deepMutable(X));`));
});

test('with std:types - 29650  ExtractToObject', () => {
  expectBuilderTrue(kit(`function extractToObject(T: type, P: type): type {
  const key = literalValues(P)[0];
  const properties = reflect(T).properties;
  const nested = properties.find(p => p.name === key);
  return objectOf([...properties.filter(p => p.name !== key), ...reflect(nested.type).properties]);
}
const Nested = type { id: '1', myProp: { foo: '2' } };\nString(std.merge(std.omit(Nested, type 'myProp'), std.indexed(Nested, type 'myProp'))
  === extractToObject(Nested, type 'myProp'));`));
});

test('with std:types - 35991  MyUppercase', () => {
  expectBuilderTrue(kit(`function myUppercase(s: string): type {
  return literal(s.toUpperCase());
}\nString(std.uppercase(type 'a') === type 'A');`));
  expectBuilderTrue(kit(`function myUppercase(s: string): type {
  return literal(s.toUpperCase());
}\nString(std.uppercase(type 'a' | 'z') === type 'A' | 'Z');`));
});

test('with std:types - 6  Simple Vue', () => {
  expectBuilderTrue(kit(`function computedResults(C: type): type {
  return mapProperties(C, p => ({ ...p, type: returnType(p.type) }));
}
function withThisOnMethods(O: type, Self: type): type {
  return mapProperties(O, p => ({ ...p, type: withThisType(p.type, Self) }));
}
function vueOptions(D: type, C: type, M: type): type {
  const self = Reflect.makeType({ kind: 'intersection', members: [D, computedResults(C), M] });
  return objectOf([
    prop('data', withThisType(fn([], D), type void)),
    prop('computed', withThisOnMethods(C, D)),
    prop('methods', withThisOnMethods(M, self)),
  ]);
}
function simpleVue<D, C, M>(options: vueOptions(D, C, M)): any { /* implementation elsewhere */ return undefined; }\nString(std.mapPropertyTypes(type { fullname(): string, amount(): uint32 }, std.returnType)
  === type { fullname: string, amount: uint32 });`));
});

test('with std:types - 55  Union to Intersection', () => {
  expectBuilderTrue(kit(`function unionToIntersection(U: type): type {
  return Reflect.makeType({ kind: 'intersection', members: arms(U) });
}
type Foo55 = () => 'foo';
type Bar55 = (i: 42) => true;\nString(std.intersection(std.arms(type 'foo' | 42 | true)) === type 'foo' & 42 & true);`));
});

test('with std:types - 213  Vue Basic Props', () => {
  expectBuilderTrue(kit(`function inferPropType(P: type): type {
  const node = reflect(P);
  const declared = node.kind === 'object'
    ? node.properties.find(p => p.name === 'type')?.type ?? any
    : P;
  const each = (C: type): type => {
    const node = reflect(C);
    if (node.kind === 'tuple') return union(tupleElements(C).map(e => each(e.type)));
    return node.kind === 'function' ? returnType(C) : C;   // String's call signature says string; a class's type object already denotes its instances
  };
  return each(declared);
}
function vueProps(Props: type, D: type, C: type, M: type): type {
  const props = mapProperties(Props, p => ({ ...p, type: inferPropType(p.type) }));
  const self = Reflect.makeType({ kind: 'intersection', members: [props, D, computedResults(C), M] });   // both helpers from challenge 6
  return objectOf([
    prop('props', Props),
    prop('data', withThisType(fn([], D), props)),
    prop('computed', withThisOnMethods(C, D)),
    prop('methods', withThisOnMethods(M, self)),
  ]);
}
function vueBasicProps<P, D, C, M>(options: vueProps(P, D, C, M)): any { /* implementation elsewhere */ return undefined; }
class ClassA {}\nString(std.returnType(type (v: any) => string) === string);`));
});

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
};\nString(std.propertyType(Data, 'foo.baz') === type false);`));
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
};\nString(std.propertyType(Data, 'no') === undefined);`));
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
const Wire = type { some_prop: string, prop: { another_prop: string } };\nString(std.traverse(Wire, { property: p => ({ ...p, name: typeof p.name === 'string' ? snakeToCamel(p.name) : p.name }) })
  === camelize(Wire));`));
});

test('with std:types - 9160  Assign', () => {
  expectBuilderTrue(kit(`function assign(T: type, sources: [].<type>): type {
  const byName = new Map(reflect(T).properties.map(p => [p.name, p]));
  for (const source of sources)
    for (const p of reflect(source).properties) byName.set(p.name, p);
  return objectOf([...byName.values()]);
}\nString([type { a: 1 }, type { c: 'c' }].reduce((acc, source) => std.merge(acc, source), type { a: 'a', b: 'b' })
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
type T = { foo: 1, bar: { baz: [{ deep: 2 }] } };\nString(std.traverse(T, { property: p => ({ ...p,
  name: typeof p.name === 'string' ? \`\${p.name[0].toUpperCase()}\${p.name.slice(1)}\` : p.name }) })
  === capitalizeNestObjectKeys(T));`));
});

test('with std:types - 13580  Replace Union', () => {
  expectBuilderTrue(kit(`function unionReplace(T: type, pairs: [].<[type, type]>): type {
  return union(arms(T).map(arm => pairs.find(([from]) => from === arm)?.[1] ?? arm));
}\nString(std.mapUnion(type float64 | string, arm => arm === string ? type null : arm) === type float64 | null);`));
});

test('with std:types - 19458  SnakeCase', () => {
  expectBuilderTrue(kit(`function snakeCase(T: type): type {
  return union(arms(T).map(a =>
    literal(literalValues(a)[0].replace(/\\p{Lu}/gu, c => \`_\${c.toLowerCase()}\`))));
}\nString(std.mapLiterals(type 'getElementById' | 'getElementByClassNames',
  s => s.replace(/\\p{Lu}/gu, c => \`_\${c.toLowerCase()}\`)) === type 'get_element_by_id' | 'get_element_by_class_names');`));
});

test('with std:types - 33763  Union to Object from key', () => {
  expectBuilderTrue(kit(`function unionToObjectFromKey(U: type, key: type): type {
  const name = literalValues(key)[0];
  return union(arms(U).filter(a => reflect(a).properties.some(p => p.name === name)));
}
type Foo = { foo: string, common: boolean };
type Bar = { bar: float64, common: boolean };\nString(std.extract(type Foo | Bar, type { foo: any }) === Foo);`));
  expectBuilderTrue(kit(`function unionToObjectFromKey(U: type, key: type): type {
  const name = literalValues(key)[0];
  return union(arms(U).filter(a => reflect(a).properties.some(p => p.name === name)));
}
type Foo = { foo: string, common: boolean };
type Bar = { bar: float64, common: boolean };\nString(std.extract(type Foo | Bar, type { common: any }) === type Foo | Bar);`));
});
