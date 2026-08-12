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
