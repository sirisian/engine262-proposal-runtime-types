import { test } from 'vitest';
import { expectBuilderTrue } from './harness.mts';

/**
 * Type Challenges — the hard tier, shard 5.
 * Source: ecmascript-types/examples/typechallenges.md
 *
 * Nested dotted access, recursive key transforms over object/tuple structure,
 * code-point string length, union filtering by key, and folding an `undefined`
 * arm into optionality. Uses the `undefined` type from shard 1; note that the
 * `undefined` type is `void`, so `arms(p.type)` compares against the `undefined`
 * TYPE (an alias), not the JS `undefined` value. Tuple operands are aliases.
 */

const L = `function literal(v) { return Reflect.makeType({ kind: 'literal', value: v, base: Reflect.typeOf(v) }); }`;
const TUP = `
function tupleOf(ts) { return Reflect.makeType({ kind: 'tuple', elements: ts.map(t => ({ type: t, rest: false })) }); }
function elementTypes(T) { return Reflect.getReflection(T).elements.map(e => e.type); }
function objectOf(props) { return Reflect.makeType({ kind: 'object', properties: props, indexSignatures: [] }); }
function union(a) { return Reflect.makeType({ kind: 'union', arms: a }); }
function arms(T) { const n = Reflect.getReflection(T); return n.kind === 'union' ? n.arms : [T]; }
`;

// 270 · Typed Get — the type at a dotted path, or never.
test('hard 270 · Typed Get', () => {
  const f = `
    function field(T, name) { const p = Reflect.getReflection(T).properties.find(x => x.name === name); return p ? p.type : never; }
    function get(T, path) {
      const dot = path.indexOf('.');
      if (dot === -1) { return field(T, path); }
      const head = field(T, path.slice(0, dot));
      return head === never ? never : get(head, path.slice(dot + 1));
    }`;
  expectBuilderTrue(`${f}\n type T = { a: { b: { c: uint32 } } }; String(get(T, 'a.b.c') === uint32);`);
  expectBuilderTrue(`${f}\n type T = { a: { b: uint32 } }; String(get(T, 'a.x') === never);`);
});

// 1383 · Camelize — snake_case keys to camelCase, recursively over objects.
test('hard 1383 · Camelize', () => {
  const f = `${TUP}
    function snakeToCamel(s) { return s.replace(/_(.)/g, (m, c) => c.toUpperCase()); }
    function camelize(T) {
      const n = Reflect.getReflection(T);
      if (n.kind !== 'object') { return T; }
      return objectOf(n.properties.map(p => ({ ...p, name: typeof p.name === 'string' ? snakeToCamel(p.name) : p.name, type: camelize(p.type) })));
    }`;
  expectBuilderTrue(`${f}
    type Wire = { first_name: string, last_name: string, address_info: { home_town: string } };
    type Expected = { firstName: string, lastName: string, addressInfo: { homeTown: string } };
    String(camelize(Wire) === Expected);
  `);
});

// 9155 · ValidDate — an MMDD string names a real day (non-leap February).
test('hard 9155 · ValidDate', () => {
  const f = `
    function validDate(s) {
      const month = Number(s.slice(0, 2)), day = Number(s.slice(2, 4));
      const monthLengths = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      return month >= 1 && month <= 12 && day >= 1 && day <= monthLengths[month - 1] - (month === 2 ? 1 : 0) ? type true : type false;
    }`;
  expectBuilderTrue(`${f}\n String(validDate('0102') === type true);`);
  expectBuilderTrue(`${f}\n String(validDate('1231') === type true);`);
  expectBuilderTrue(`${f}\n String(validDate('0229') === type false);`);
});

// 9775 · Capitalize Nest Object Keys — capitalize keys recursively, through
// tuples too.
test('hard 9775 · Capitalize Nest Object Keys', () => {
  const f = `${TUP}
    function cap(T) {
      const n = Reflect.getReflection(T);
      if (n.kind === 'object') { return objectOf(n.properties.map(p => ({ ...p, name: typeof p.name === 'string' ? p.name[0].toUpperCase() + p.name.slice(1) : p.name, type: cap(p.type) }))); }
      if (n.kind === 'tuple') { return tupleOf(n.elements.map(e => cap(e.type))); }
      return T;
    }`;
  expectBuilderTrue(`${f}
    type T = { foo: 1, bar: { baz: [{ deep: 2 }] } };
    type Expected = { Foo: 1, Bar: { Baz: [{ Deep: 2 }] } };
    String(cap(T) === Expected);
  `);
});

// 30178 · Unique Items — keep the first occurrence by identity, else never.
test('hard 30178 · Unique Items', () => {
  const f = `${TUP}\n function uniqueItems(T) { const types = elementTypes(T); return tupleOf(types.map((t, i) => types.indexOf(t) === i ? t : never)); }`;
  expectBuilderTrue(`${f}\n type T = [1, 2, 1, 3]; type Expected = [1, 2, never, 3]; String(uniqueItems(T) === Expected);`);
});

// 31824 · Length of String 3 — code-point count, not UTF-16 units.
test('hard 31824 · Length of String 3', () => {
  const f = `${L}\n function lengthOfString(s) { return literal([...s].length); }`;
  expectBuilderTrue(`${f}\n String(lengthOfString('foo') === type 3);`);
  expectBuilderTrue(`${f}\n String(lengthOfString('') === type 0);`);
  expectBuilderTrue(`${f}\n String(lengthOfString('\\u{1F603}\\u{1F603}') === type 2);`);
});

// 33763 · Union to Object from key — the arms that have the given key.
test('hard 33763 · Union to Object from key', () => {
  const f = `
    function arms(T) { const n = Reflect.getReflection(T); return n.kind === 'union' ? n.arms : [T]; }
    function union(a) { return Reflect.makeType({ kind: 'union', arms: a }); }
    function unionToObjectFromKey(U, name) { return union(arms(U).filter(a => Reflect.getReflection(a).properties.some(p => p.name === name))); }`;
  expectBuilderTrue(`${f}
    type Foo = { foo: 1, common: string };
    type Bar = { bar: 2, common: string };
    type U = Foo | Bar;
    String(unionToObjectFromKey(U, 'foo') === Foo);
  `);
  // a common key selects every arm, recovering the union
  expectBuilderTrue(`${f}
    type Foo = { foo: 1, common: string };
    type Bar = { bar: 2, common: string };
    type U = Foo | Bar;
    String(unionToObjectFromKey(U, 'common') === U);
  `);
});

// 28143 · OptionalUndefined — a property whose type includes `undefined` becomes
// optional, with the `undefined` arm folded into the optionality. An optional
// key-name list restricts which keys are affected (default: all). Since the
// `undefined` type is `void`, the arm test compares against the `undefined` type
// alias. (Key selection is expressed with a plain name array here.)
test('hard 28143 · OptionalUndefined', () => {
  const f = `${TUP}
    type UndefT = undefined;
    function optionalUndefined(T, keyNames) {
      const names = keyNames || Reflect.getReflection(T).properties.map(p => p.name);
      return objectOf(Reflect.getReflection(T).properties.map(p => {
        if (names.indexOf(p.name) === -1 || !arms(p.type).some(a => a === UndefT)) { return p; }
        const rest = arms(p.type).filter(arm => arm !== UndefT);
        return { ...p, optional: true, type: rest.length > 0 ? union(rest) : UndefT };
      }));
    }`;
  expectBuilderTrue(`${f}
    type X = { value: string | undefined, desc: string };
    type Expected = { value?: string, desc: string };
    String(optionalUndefined(X, ['value']) === Expected);
  `);
  expectBuilderTrue(`${f}
    type X = { value: string | undefined, desc: string | undefined };
    type Expected = { value?: string, desc?: string };
    String(optionalUndefined(X) === Expected);
  `);
  expectBuilderTrue(`${f}
    type X = { value: string, desc: string };
    type Expected = { value: string, desc: string };
    String(optionalUndefined(X, ['value']) === Expected);
  `);
});
