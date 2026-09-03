import { test } from 'vitest';
import { expectBuilderTrue, kit } from './harness.mts';

/**
 * Type Challenges - the medium tier, shard 14 (the last three).
 * Source: ecmascript-types/examples/typechallenges.md
 *
 * The remaining medium challenges. Two of the three depend on primitives that
 * are not present, so they are recorded as pending with the named missing
 * primitive rather than approximated.
 */

// 12 - Chainable Options - the corpus builds this as a typed `interface
// Chainable` whose `option(key, value)` returns `Chainable.<withKey(T, K, V)>`
// and whose `get()` returns the accumulated object. The typed method-chaining
// interface is a declaration-level construct, but its core is the `withKey`
// accumulator, which is a builder function and is asserted here: chaining
// withKey builds exactly the object the challenge's `.get()` returns.
test('medium 12 - Chainable Options (withKey accumulator)', () => {
  const f = `
    function withKey(T, key, V) {
      if (Reflect.getReflection(T).properties.some(p => p.name === key)) {
        throw new TypeError("option: '" + key + "' is already set");
      }
      return objectOf([...Reflect.getReflection(T).properties, { name: key, type: V, optional: false, readonly: false }]);
    }`;
  expectBuilderTrue(kit(`${f}
    let acc = Reflect.makeType({ kind: 'object', properties: [], indexSignatures: [] });
    acc = withKey(acc, 'foo', uint32);
    acc = withKey(acc, 'bar', Reflect.makeType({ kind: 'object', properties: [{ name: 'value', type: string, optional: false, readonly: false }], indexSignatures: [] }));
    acc = withKey(acc, 'name', string);
    type Expected = { foo: uint32, bar: { value: string }, name: string };
    String(acc === Expected);
  `));
  // setting the same key twice is a type error, as the builder throws
  expectBuilderTrue(kit(`${f}
    let threw = false;
    let acc = Reflect.makeType({ kind: 'object', properties: [], indexSignatures: [] });
    acc = withKey(acc, 'foo', uint32);
    try { withKey(acc, 'foo', string); } catch (e) { threw = true; }
    String(threw);
  `));
});

// 20 - Promise.all - settled(T) maps a tuple/array's element types through
// `awaited` and the signature wraps the result in `Promise.<...>`. Promise is a
// library generic type (implemented in this phase): `Promise.<T>` is a real type,
// reflection exposes it through a `generic` view (`node.generic.base` and
// `node.generic.arguments`), and `makeType({ kind: 'generic', ... })` constructs
// one. `awaited` reads the argument off a Promise and passes anything else
// through. The settled-and-wrapped transform is asserted directly (the corpus's
// `promiseAll.<...>` form would additionally need generic call inference, as with
// Currying). Expected types use aliases, since a nested `Promise.<...>` written
// inline in expression position does not yet parse.
test('medium 20 - Promise.all (settled)', () => {
  const f = `
    type PromiseBase = Promise;
    function promiseOf(X) { return Reflect.makeType({ kind: 'generic', base: PromiseBase, arguments: [X] }); }
    function awaited(T) {
      const n = Reflect.getReflection(T);
      if (n.generic && n.generic.base === PromiseBase) { return awaited(n.generic.arguments[0]); }
      if (n.kind === 'union') { return union(arms(T).map(awaited)); }
      return T;
    }
    function settled(T) {
      const node = Reflect.getReflection(T);
      if (node.kind === 'tuple') { return tupleOf(node.elements.map(e => awaited(e.type))); }
      if (node.kind === 'array') { return arrayOf(awaited(node.element), node.extent); }
      throw new TypeError('not an array or tuple');
    }
    function promiseAll(T) { return promiseOf(settled(T)); }`;
  // awaited unwraps a Promise, recursively, and passes a non-Promise through
  expectBuilderTrue(kit(`${f}\n type P = Promise.<uint32>; String(awaited(P) === uint32);`));
  expectBuilderTrue(kit(`${f}\n type P = Promise.<Promise.<string | uint32>>; type Expected = string | uint32; String(awaited(P) === Expected);`));
  expectBuilderTrue(kit(`${f}\n String(awaited(uint32) === uint32);`));
  // promiseAll on a plain tuple wraps it unchanged
  expectBuilderTrue(kit(`${f}\n type T = [1, 2, 3]; type Expected = Promise.<[1, 2, 3]>; String(promiseAll(T) === Expected);`));
  // a promise element is awaited before wrapping
  expectBuilderTrue(kit(`${f}\n type T = [1, 2, Promise.<uint32>]; type Expected = Promise.<[1, 2, uint32]>; String(promiseAll(T) === Expected);`));
  // awaiting reaches inside a union inside a dynamic array element
  expectBuilderTrue(kit(`${f}\n type T = [].<uint32 | Promise.<string>>; type Inner = [].<uint32 | string>; type Expected = Promise.<Inner>; String(promiseAll(T) === Expected);`));
});

// 26401 - JSON Schema to TypeScript - a recursive schema interpreter: an object
// schema without properties becomes an index-signature object type
// `{ [k: string]: any }` (which is what TypeScript's `Record<string, any>` is;
// this proposal has no built-in `Record` type, so the shape is built directly
// with an index signature), a typed enum becomes the union of its literals, an
// array schema uses the array kit, and a plain primitive schema its base type.
test('medium 26401 - JSON Schema to TypeScript', () => {
  const f = `
    function field(schema, name) { const p = Reflect.getReflection(schema).properties.find(x => x.name === name); return p ? p.type : undefined; }
    function litval(T) { return Reflect.getReflection(T).value; }
    function jsonSchema2TS(schema) {
      const kindT = field(schema, 'type');
      if (kindT === undefined) { return never; }
      const kind = litval(kindT);
      if (kind === 'string') { const en = field(schema, 'enum'); return en === undefined ? string : union(elementTypes(en)); }
      if (kind === 'number') { const en = field(schema, 'enum'); return en === undefined ? number : union(elementTypes(en)); }
      if (kind === 'object') {
        const properties = field(schema, 'properties');
        if (properties === undefined) { return type { [key: string]: any }; }
        const requiredList = field(schema, 'required');
        const required = requiredList === undefined ? [] : elementTypes(requiredList).map(litval);
        return objectOf(Reflect.getReflection(properties).properties.map(p => ({
          name: p.name, type: jsonSchema2TS(p.type), optional: required.indexOf(p.name) === -1, readonly: false,
        })));
      }
      if (kind === 'array') { const items = field(schema, 'items'); return Reflect.makeType({ kind: 'array', element: items === undefined ? any : jsonSchema2TS(items) }); }
      return never;
    }`;
  expectBuilderTrue(kit(`${f}\n type S = { type: 'string' }; String(jsonSchema2TS(S) === string);`));
  expectBuilderTrue(kit(`${f}\n type S = { type: 'number', enum: [1, 2, 3] }; type Expected = 1 | 2 | 3; String(jsonSchema2TS(S) === Expected);`));
  expectBuilderTrue(kit(`${f}\n type S = { type: 'object' }; type Expected = { [key: string]: any }; String(jsonSchema2TS(S) === Expected);`));
  expectBuilderTrue(kit(`${f}\n type S = { type: 'array', items: { type: 'string' } }; type Expected = [].<string>; String(jsonSchema2TS(S) === Expected);`));
  // an object schema with required and optional properties
  expectBuilderTrue(kit(`${f}
    type S = { type: 'object', properties: { req1: { type: 'string' }, add1: { type: 'string' } }, required: ['req1'] };
    type Expected = { req1: string, add1?: string };
    String(jsonSchema2TS(S) === Expected);
  `));
});
