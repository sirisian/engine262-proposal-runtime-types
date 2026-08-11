import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * Spec: #table-reflection-contexts, the Class row. "A constructor is a
 * `ClassMethod` whose name is *"constructor"*, and its parameters are that
 * method's, so a construct signature needs no context of its own."
 *
 * Members are recorded from ClassElementEvaluation, which runs over
 * NonConstructorElements - the static semantics whose purpose is to exclude the
 * constructor, since the base specification evaluates it separately. So the
 * constructor was never recorded and reflecting it reported that it was not a
 * member of the type, though a class always has one.
 */

test('constructor reflection: a constructor is a ClassMethod of that name', () => {
  const A = 'class A { constructor() {} m() {} } ';
  expect(evaluated(`${A}String(Reflect.getReflection.<Reflect.ClassMethod, A>('constructor').kind);`))
    .toBe('ClassMethod');
  expect(evaluated(`${A}String(Reflect.getReflection.<Reflect.ClassMethod, A>('constructor').name);`))
    .toBe('constructor');
  // it is never static, whatever a static method of the same name may be
  expect(evaluated(`${A}String(Reflect.getReflection.<Reflect.ClassMethod, A>('constructor').static);`))
    .toBe('false');
  expect(evaluated("class A { protected constructor() {} }"
    + " String(Reflect.getReflection.<Reflect.ClassMethod, A>('constructor').protected);")).toBe('true');
});

test('constructor reflection: a class always has one', () => {
  // a class that writes none still has the default, which is what `new` calls
  expect(evaluated("class B { m() {} } String(Reflect.getReflection.<Reflect.ClassMethod, B>('constructor').kind);"))
    .toBe('ClassMethod');
  // and a derived class that writes none finds its base's, by the same chain
  // walk that finds an inherited method
  expect(evaluated('class B { constructor(a) {} } class C extends B {}'
    + " String(Reflect.getReflection.<Reflect.ClassMethod, C>('constructor').kind);")).toBe('ClassMethod');
});

test('constructor reflection: a static method of that name is a different member', () => {
  // `static constructor() {}` is a legal static method named `constructor` and
  // not the class's constructor. Both reach the same owner, so keying a member
  // by name alone let one displace the other; the key carries staticness.
  const BOTH = 'class A { constructor() {} static constructor() {} } ';
  expect(evaluated(`${BOTH}String(Reflect.getReflection.<Reflect.ClassMethod, A>('constructor').static);`))
    .toBe('false');
  // an instance and a static method sharing an ordinary name likewise
  expect(evaluated("class A { m() {} static m() {} }"
    + " const r = Reflect.getReflection.<Reflect.ClassMethod, A>('m'); String(r.name + ',' + r.static);"))
    .toBe('m,false');
});

test('constructor reflection: enumeration includes it, and names stay declared names', () => {
  expect(evaluated('class A { constructor() {} m() {} }'
    + ' const r = Reflect.getReflection.<Reflect.ClassMethod, A>();'
    + ' String(Object.keys(r).sort().join(","));')).toBe('constructor,m');
  // the storage key qualifies a static member; what is reported is the name as
  // written. The default constructor is enumerated too, a class always having
  // one, which is the observable change this fix makes to the enumerate form.
  expect(evaluated('class A { m() {} static s() {} }'
    + ' const r = Reflect.getReflection.<Reflect.ClassMethod, A>();'
    + ' String(Object.keys(r).sort().join(","));')).toBe('constructor,m,s');
  expect(evaluated("class A { static s() {} }"
    + " const r = Reflect.getReflection.<Reflect.ClassMethod, A>('s');"
    + " String(r.name + ',' + r.static);")).toBe('s,true');
});

test('constructor reflection: the surrounding members are unaffected', () => {
  expect(evaluated("class A { constructor() {} m() {} } String(Reflect.getReflection.<Reflect.ClassMethod, A>('m').kind);"))
    .toBe('ClassMethod');
  expect(evaluated("class A { x: uint8 = 1; } String(Reflect.getReflection.<Reflect.ClassField, A>('x').kind);"))
    .toBe('ClassField');
  expect(evaluated("class B { m() {} } class C extends B {} String(Reflect.getReflection.<Reflect.ClassMethod, C>('m').kind);"))
    .toBe('ClassMethod');
});
