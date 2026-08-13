import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * Enumerating a class's members answers ONE staticness.
 *
 * A name alone does not identify a member: `m()` and `static m()` are both
 * legal in one body, and both reach the same owner - a static member's home is
 * the constructor, an instance member's is the prototype, whose `constructor`
 * names that same object. A result keyed by name can hold one of them, so the
 * later declaration displaced the earlier and the static member had no route at
 * all.
 *
 * `{ static: true }` asks for the other set, as `{ own: true }` asks for the
 * declared one. A bare call answers INSTANCE members, which is what a bare name
 * means at a named lookup and what a consumer asking what an instance has wants
 * without passing anything.
 */

const A = 'class A { constructor() {} m() {} static m() {} } ';
const G = 'const g = (o) => Reflect.getReflection.<Reflect.ClassMethod, A>(o); ';

test('static enumeration: both members of one name are reachable', () => {
  expect(evaluated(`${A}${G}String(Object.keys(g()).sort().join(","));`)).toBe('constructor,m');
  expect(evaluated(`${A}${G}String(g().m.static);`)).toBe('false');
  expect(evaluated(`${A}${G}String(Object.keys(g({ static: true })).join(","));`)).toBe('m');
  expect(evaluated(`${A}${G}String(g({ static: true }).m.static);`)).toBe('true');
  // a named lookup is unchanged and still answers the instance member
  expect(evaluated(`${A}const r = Reflect.getReflection.<Reflect.ClassMethod, A>('m');`
    + ' String(r.name + ":" + r.static);')).toBe('m:false');
});

test('static enumeration: the two sets merge by VALUE, not by key', () => {
  // the working spelling - each entry carries its own `name` and `static`
  expect(evaluated(`${A}${G}`
    + 'const all = [...Object.values(g()), ...Object.values(g({ static: true }))];'
    + ' String(all.length);')).toBe('3');
  // and the spelling that looks equivalent and is not: keyed by name, `m`
  // collides again, which is the hazard the option exists to resolve
  expect(evaluated(`${A}${G}const broken = { ...g(), ...g({ static: true }) };`
    + ' String(Object.keys(broken).length);')).toBe('2');
});

test('static enumeration: every member kind, since one builder serves all', () => {
  const pair = (decl: string, context: string, name: string) => `class A { ${decl} }`
    + ` const f = (o) => Reflect.getReflection.<Reflect.${context}, A>(o);`
    + ` String(f().${name}.static) + "," + String(f({ static: true }).${name}.static);`;
  expect(evaluated(pair('x: uint8 = 1; static x: uint8 = 2;', 'ClassField', 'x'))).toBe('false,true');
  expect(evaluated(pair('get v(): uint8 { return 1; } static get v(): uint8 { return 2; }',
    'ClassGetter', 'v'))).toBe('false,true');
  expect(evaluated(pair('m() {} static m() {}', 'ClassMethod', 'm'))).toBe('false,true');
  // setters and accessors collide the same way and are served by the same
  // collector - this said "every member kind" while testing three of five
  expect(evaluated(pair('set v(x: uint8) {} static set v(x: uint8) {}',
    'ClassSetter', 'v'))).toBe('false,true');
  expect(evaluated(pair('accessor a: uint8 = 1; static accessor a: uint8 = 2;',
    'ClassAccessor', 'a'))).toBe('false,true');
});

test('static enumeration: it composes with own, and constructor is included', () => {
  // `{ own: true }` narrows to what the class declares; the two options compose
  expect(evaluated('class B { static b() {} } class D extends B { static d() {} }'
    + ' String(Object.keys(Reflect.getReflection.<Reflect.ClassMethod, D>({ static: true, own: true })).join(","));'))
    .toBe('d');
  // inherited by default, as before
  expect(evaluated('class B { b() {} } class D extends B { d() {} }'
    + ' String(Object.keys(Reflect.getReflection.<Reflect.ClassMethod, D>()).sort().join(","));'))
    .toBe('b,constructor,d');
  // `constructor` is among the enumerated methods - a class always has one, so
  // a consumer listing "methods to expose" skips it
  expect(evaluated(`${A}${G}String(Object.keys(g()).includes("constructor"));`)).toBe('true');
  // and it is an instance member, so it is not in the static set
  expect(evaluated(`${A}${G}String(Object.keys(g({ static: true })).includes("constructor"));`)).toBe('false');
});

// -- The context selects among members sharing a name -------------------------
//
// #sec-decorator-contexts: `Reflect.getReflection.<C, T>(...)` "reflects the
// part of _T_ that the context _C_ names", and #table-reflection-contexts gives
// the Class family thirteen contexts, each naming a distinct part. A getter and
// a setter of one name are two of those parts.

test('a getter and a setter of one name are told apart', () => {
  // The halves must agree on their value type - a getter of `uint8` with a
  // setter of `uint16` is refused by the accessor rules - so the two are told
  // apart by their SIGNATURES rather than by differing value types.
  const cls = 'class A { get v(): uint8 { return 1; } set v(x: uint8) {} } ';
  expect(evaluated(`${cls} String(Reflect.getReflection.<Reflect.ClassGetter, A>("v").kind);`)).toBe('ClassGetter');
  expect(evaluated(`${cls} String(Reflect.getReflection.<Reflect.ClassSetter, A>("v").kind);`)).toBe('ClassSetter');
  // The reflected TYPE is checked too: a fix that returned the right `kind` on
  // the wrong declaration would pass a kind-only assertion, and a getter's type
  // is the one that takes nothing.
  expect(evaluated(`${cls} String(Reflect.getReflection.<Reflect.ClassGetter, A>("v").type === (type () => uint8));`)).toBe('true');
  expect(evaluated(`${cls} String(Reflect.getReflection.<Reflect.ClassSetter, A>("v").type === (type () => uint8));`)).toBe('false');
});

test('the order of the pair does not decide the answer', () => {
  // The defect was LAST-WINS, so one order would have passed by luck.
  const setterFirst = 'class A { set v(x: uint8) {} get v(): uint8 { return 1; } } ';
  expect(evaluated(`${setterFirst} String(Reflect.getReflection.<Reflect.ClassGetter, A>("v").kind);`)).toBe('ClassGetter');
  expect(evaluated(`${setterFirst} String(Reflect.getReflection.<Reflect.ClassSetter, A>("v").kind);`)).toBe('ClassSetter');
});

test('the enumerating form lists both halves', () => {
  // The sharper half of the defect: the getter was not mislabeled, it was
  // ABSENT - the setter had overwritten it in the store, so the form that does
  // filter by kind could not find it either. This is the assertion a fix
  // applied only to the named lookup would fail.
  const cls = 'class A { get v(): uint8 { return 1; } set v(x: uint8) {} m(): uint8 { return 2; } } ';
  expect(evaluated(`${cls} Object.keys(Reflect.getReflection.<Reflect.ClassGetter, A>()).sort().join(",");`)).toBe('v');
  expect(evaluated(`${cls} Object.keys(Reflect.getReflection.<Reflect.ClassSetter, A>()).sort().join(",");`)).toBe('v');
  expect(evaluated(`${cls} Object.keys(Reflect.getReflection.<Reflect.ClassMethod, A>()).sort().join(",");`)).toBe('constructor,m');
});

test('a single-member class is unchanged', () => {
  expect(evaluated('class G { get v(): uint8 { return 1; } } String(Reflect.getReflection.<Reflect.ClassGetter, G>("v").kind);')).toBe('ClassGetter');
  expect(evaluated('class S { set v(x: uint8) {} } String(Reflect.getReflection.<Reflect.ClassSetter, S>("v").kind);')).toBe('ClassSetter');
});

test('a static and an instance member of one name stay distinct', () => {
  // Placement was already part of the key; the kind joins it rather than
  // replacing it.
  const cls = 'class A { get v(): uint8 { return 1; } static get v(): uint16 { return 2; } } ';
  // A bare name answers the INSTANCE member, which is what a bare name has
  // always meant here, and its type says which half answered.
  expect(evaluated(`${cls} String(Reflect.getReflection.<Reflect.ClassGetter, A>("v").static);`)).toBe('false');
  expect(evaluated(`${cls} String(Reflect.getReflection.<Reflect.ClassGetter, A>("v").type === (type () => uint8));`)).toBe('true');
  // Both are enumerable, each through its own placement.
  expect(evaluated(`${cls} Object.keys(Reflect.getReflection.<Reflect.ClassGetter, A>()).join(",");`)).toBe('v');
  expect(evaluated(`${cls} Object.keys(Reflect.getReflection.<Reflect.ClassGetter, A>({ static: true })).join(",");`)).toBe('v');
});

test('ClassAccessor names the accessor declaration and nothing else', () => {
  // It is the shape of the `accessor` KEYWORD, a declaration form of its own -
  // not a name for a getter and setter pair.
  expect(evaluated('class B { accessor w: uint8 = (1 := uint8); } '
    + 'Object.keys(Reflect.getReflection.<Reflect.ClassAccessor, B>()).join(",");')).toBe('w');
  expect(evaluated('class A { get v(): uint8 { return 1; } set v(x: uint8) {} } '
    + 'try { Reflect.getReflection.<Reflect.ClassAccessor, A>("v"); "ACCEPTED"; } catch (e) { e.constructor.name; }')).toBe('TypeError');
});
