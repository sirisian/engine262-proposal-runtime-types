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

test('overloads: a constructor carries the one entry the table gives it', () => {
  // #table-reflection-contexts: a constructor "may not be overloaded, so its
  // `signatures` has exactly one entry". The record passed no type at all, so
  // the reflection had none of the field every `ClassMethod` is given - a gap
  // the caveat above made visible.
  const R = (cls: string) => `class A ${cls}`
    + " const r = Reflect.getReflection.<Reflect.ClassMethod, A>('constructor'); ";
  expect(evaluated(`${R('{ constructor(a: uint8) {} }')}String(r.signatures.length);`)).toBe('1');
  expect(evaluated(`${R('{ constructor(a: uint8, b: string) {} }')}String(r.signatures[0].parameters.length);`)).toBe('2');
  expect(evaluated(`${R('{ constructor(a: uint8) {} }')}String(r.signatures[0].parameters[0].type === uint8);`)).toBe('true');
  expect(evaluated(`${R('{ constructor(first: uint8) {} }')}String(r.signatures[0].parameters[0].name);`)).toBe('first');
  // the arm is built by the operation every other member's is, so a
  // constructor's type is a function type like a method's
  expect(evaluated(`${R('{ constructor(a: uint8) {} }')}String(r.type !== undefined);`)).toBe('true');
  // and the rest of the reflection is unchanged
  expect(evaluated(`${R('{ constructor(a: uint8) {} }')}String(r.kind + ',' + r.name + ',' + r.static);`))
    .toBe('ClassMethod,constructor,false');
  expect(evaluated("class A { constructor(a: uint8) {} }"
    + " String(Reflect.getReflection.<Reflect.ClassMethodParameter, A>('constructor', 0).name);")).toBe('a');
});

test('overloads: annotating nothing is not annotating as any', () => {
  // The distinction the absence protects, and the reason `signatures` is absent
  // rather than synthesised as all-`any`: `m(a)` and `m(a: any)` mean different
  // things, and a reflection that reported one arm for both would delete the
  // difference. #sec-typed-declarations puts it generally - "an unannotated
  // binding remaining `any` is what keeps an untyped program untyped" - and
  // this is that rule at a member.
  const sigs = (decl: string) => `class A { ${decl} }`
    + " const r = Reflect.getReflection.<Reflect.ClassMethod, A>('m');"
    + " String(r.signatures === undefined ? 'absent' : r.signatures.length);";
  expect(evaluated(sigs('m(a) {}'))).toBe('absent');
  expect(evaluated(sigs('m(a: any) {}'))).toBe('1');
  // and `type` draws the same line
  expect(evaluated("class A { m(a) {} }"
    + " String(Reflect.getReflection.<Reflect.ClassMethod, A>('m').type === undefined);")).toBe('true');
  expect(evaluated("class A { m(a: any) {} }"
    + " String(Reflect.getReflection.<Reflect.ClassMethod, A>('m').type === undefined);")).toBe('false');
  // one annotation anywhere is enough, and the parameters with none fill as `any`
  expect(evaluated(sigs('m(a: uint8, b) {}'))).toBe('1');
  expect(evaluated('class A { m(a: uint8, b) {} }'
    + " const r = Reflect.getReflection.<Reflect.ClassMethod, A>('m');"
    + ' String(r.signatures[0].parameters[1].type === any);')).toBe('true');
});

test('overloads: an UNANNOTATED member has no signatures, constructor or not', () => {
  // A SEPARATE gap, and not a constructor one: MemberFunctionTypeRecord answers
  // *undefined* where nothing is annotated, so an unannotated method has no
  // `signatures` either. The shape table's "length 1 where the method is not
  // overloaded" says both are wrong; whether an unannotated member has a
  // one-arm signature of untyped parameters is a question for every member
  // kind, so it is pinned here rather than decided by a constructor fix.
  const has = (decl: string, member: string) => `class A { ${decl} }`
    + ` const r = Reflect.getReflection.<Reflect.ClassMethod, A>('${member}');`
    + " String(r.signatures === undefined ? 'absent' : r.signatures.length);";
  expect(evaluated(has('m(a) {}', 'm'))).toBe('absent');
  expect(evaluated(has('constructor(a) {}', 'constructor'))).toBe('absent');
  // annotated, both answer
  expect(evaluated(has('m(a: uint8) {}', 'm'))).toBe('1');
  expect(evaluated(has('constructor(a: uint8) {}', 'constructor'))).toBe('1');
});
