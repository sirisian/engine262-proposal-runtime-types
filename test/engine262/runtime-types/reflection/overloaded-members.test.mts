import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * Spec: #sec-retrieval-overloaded-targets. "A parameter of an overloaded
 * function or method cannot be reached by name or by position, since neither
 * says which signature it belongs to ... the parameters are read through the
 * `signatures` of the declaration's own reflection."
 *
 * Three gaps stood between the engine and that rule. A class body's second
 * declaration of a name REPLACED the first, where a function scope merges - so
 * a method dispatched to its last arm for every argument. The member reflection
 * had no `signatures`. And the flat parameter forms answered where the clause
 * requires a refusal.
 */

const M = 'class A { m(a: uint8) { return 1; } m(a: string) { return 2; } } ';

test('overloads: a method dispatches over its arms', () => {
  expect(evaluated(`${M}String(new A().m((1 := uint8)));`)).toBe('1');
  expect(evaluated(`${M}String(new A().m('x'));`)).toBe('2');
  // a static method is declared the same way and behaves the same
  expect(evaluated("class A { static m(a: uint8) { return 'u8'; } static m(a: string) { return 'str'; } }"
    + " String(A.m((1 := uint8))) + ',' + String(A.m('x'));")).toBe('u8,str');
  // three arms join as they are found, rather than the last two replacing
  expect(evaluated('class A { m(a: uint8) { return 1; } m(a: string) { return 2; } m(a: boolean) { return 3; } }'
    + " String(new A().m('x')) + ',' + String(new A().m(true));")).toBe('2,3');
  // and the function path, which always worked, still does
  expect(evaluated("function f(a: uint8) { return 'u8'; } function f(a: string) { return 'str'; }"
    + ' String(f((1 := uint8)));')).toBe('u8');
});

test('overloads: an override replaces rather than joining', () => {
  // a base class's method is not an arm of a subclass's - the prototype chain
  // means replacement, and merging through it made the call ambiguous
  expect(evaluated("class B { m() { return 'base'; } } class D extends B { m() { return 'derived'; } }"
    + ' String(new D().m());')).toBe('derived');
  // the same for the reflected type: an override reports its own declaration
  expect(evaluated('type G = () => uint8; class B { m(): uint8 { return uint8(1); } }'
    + ' class D extends B { m(): uint8 { return uint8(2); } }'
    + ' String(Reflect.getReflection.<Reflect.ClassMethod, D>("m").type === (type G));')).toBe('true');
});

test('overloads: the reflection reports one signature per arm', () => {
  expect(evaluated(`${M}String(Reflect.getReflection.<Reflect.ClassMethod, A>('m').signatures.length);`)).toBe('2');
  expect(evaluated(`${M}const r = Reflect.getReflection.<Reflect.ClassMethod, A>('m');`
    + ' String(r.signatures[0].parameters[0].type === uint8);')).toBe('true');
  expect(evaluated(`${M}const r = Reflect.getReflection.<Reflect.ClassMethod, A>('m');`
    + ' String(r.signatures[1].parameters[0].type === string);')).toBe('true');
  expect(evaluated(`${M}const r = Reflect.getReflection.<Reflect.ClassMethod, A>('m');`
    + ' String(r.signatures[0].parameters[0].name);')).toBe('a');
  // a member with no overloads is the ONE-ARM case, not a shape of its own -
  // which is what spares a consumer a branch
  expect(evaluated("class B { m(a: uint8) {} }"
    + " String(Reflect.getReflection.<Reflect.ClassMethod, B>('m').signatures.length);")).toBe('1');
  expect(evaluated('class D { get v(): uint8 { return 1; } }'
    + " String(Reflect.getReflection.<Reflect.ClassGetter, D>('v').signatures.length);")).toBe('1');
});

test('overloads: the flat parameter forms refuse an overloaded target', () => {
  // "answering one signature's parameter would be answering a question the
  // caller did not ask, and answering all of them would not be a parameter
  // reflection"
  expectThrown(`${M}Reflect.getReflection.<Reflect.ClassMethodParameter, A>('m', 0);`);
  expectThrown(`${M}Reflect.getReflectionByIndex.<Reflect.ClassMethodParameter, A>('m');`);
  // the arms are reachable instead, which is what makes the refusal fair
  expect(evaluated(`${M}const r = Reflect.getReflection.<Reflect.ClassMethod, A>('m');`
    + ' String(r.signatures[1].parameters[0].type === string);')).toBe('true');
  // and a target that is NOT overloaded keeps the flat forms, "the shorter way
  // to write the common case"
  expect(evaluated("class B { m(a: uint8) {} }"
    + " String(Reflect.getReflection.<Reflect.ClassMethodParameter, B>('m', 0).name);")).toBe('a');
  expect(evaluated("class B { m(a: uint8) {} }"
    + " String(Reflect.getReflectionByIndex.<Reflect.ClassMethodParameter, B>('m').length);")).toBe('1');
  // a constructor is a method, and an unoverloaded one reads its parameters
  expect(evaluated('class C { constructor(a: uint8) {} }'
    + " String(Reflect.getReflection.<Reflect.ClassMethodParameter, C>('constructor', 0).name);")).toBe('a');
});

test('overloads: a constructor may not be overloaded', () => {
  // base ECMAScript's rule, which this proposal does not relax: the arms would
  // have to agree on the instance they initialise, and `super` binds to one
  expectThrown('class A { constructor(a: uint8) {} constructor(a: string) {} }');
});
