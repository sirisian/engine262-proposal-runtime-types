import { test, expect } from 'vitest';
import { evaluated } from '../readme/harness.mts';

/**
 * PLAN-decorators-remaining.md phase four:
 * `ClassMethodParameterReflection`'s `type`, `name` and `initial`.
 *
 * decorators.md gives a parameter's context `type`, `name`, `index`, `initial`
 * and `metadata`. The builder took no NODE, so it could report only what its
 * arguments carried - the same gap the method context had, and the parameter
 * node was sitting in the loop that calls it.
 */

test('a parameter context reports its NAME and declared TYPE', () => {
  expect(evaluated('(() => { let n; function g(c) { n = c.name; } '
    + 'class A { m(@g x: uint32) {} } return n; })();')).toBe('x');
  expect(evaluated('(() => { let t; function g(c) { t = c.type; } '
    + 'class A { m(@g x: uint32) {} } return String(t === (type uint32)); })();')).toBe('true');
  // A different annotation reports as itself, which says the node is read
  // rather than a constant returned.
  expect(evaluated('(() => { let t; function g(c) { t = c.type; } '
    + 'class A { m(@g x: string) {} } return String(t === (type string)); })();')).toBe('true');
  expect(evaluated('(() => { let t; function g(c) { t = c.type; } '
    + 'class A { m(@g x: string) {} } return String(t === (type uint32)); })();')).toBe('false');
});

test('`initial` is the DECLARED default, on a field\'s terms', () => {
  // A constant is reported; anything else is *undefined* rather than evaluated,
  // since evaluating a parameter default at CLASS DEFINITION would run it at
  // the wrong time and once rather than per call.
  expect(evaluated('(() => { let i; function g(c) { i = c.initial; } '
    + 'class A { m(@g x: uint32 = 7) {} } return String(i); })();')).toBe('7');
  expect(evaluated('(() => { let i = "X"; function g(c) { i = String(c.initial); } '
    + 'class A { m(@g x: uint32) {} } return i; })();')).toBe('undefined');
  expect(evaluated('(() => { let i = "X"; function g(c) { i = String(c.initial); } '
    + 'class A { m(@g x: uint32 = f()) {} } return i; })();')).toBe('undefined');
});

test('the rest of the sub-target family is unchanged', () => {
  expect(evaluated('(() => { let f = ""; function g(c) { f = Object.getOwnPropertyNames(c).join(","); } '
    + 'class A { m(@g x: uint32) {} } return f; })();')).toBe('kind,index,name,type,initial,metadata,methodContext');
  // `index` still identifies WHICH parameter.
  expect(evaluated('(() => { let i; function g(c) { i = c.index; } '
    + 'class A { m(a: uint8, @g x: uint32) {} } return String(i); })();')).toBe('1');
  // A RETURN sub-target carries no index - "a parameter carries its `index`; a
  // return does not, which is what distinguishes the two beyond the context
  // type" - and no `name` or `initial`, which a return has not got. It DOES
  // carry `type`: the annotated type itself, where the owning member's `type`
  // is the whole FUNCTION type.
  expect(evaluated('(() => { let f = ""; function g(c) { f = Object.getOwnPropertyNames(c).join(","); } '
    + 'class A { m(): @g uint8 { return uint8(1); } } return f; })();')).toBe('kind,type,metadata,methodContext');
});

test('a parameter carries METADATA, keyed by method AND position', () => {
  // decorators.md's `ClassMethodParameterMetadata`. A parameter is identified
  // by its method and index, so the key names both - which is what makes the
  // next three assertions come out the way they do.
  expect(evaluated('(() => { let p; function g(c) { p = c; } '
    + 'class A { m(@g x: uint32) {} } return typeof p.metadata; })();')).toBe('object');
  expect(evaluated('(() => { let p; function g(c) { p = c; } '
    + 'class A { m(@g x: uint32) {} } p.metadata.tag = 1; return String(p.metadata.tag); })();')).toBe('1');
  // TWO PARAMETERS of one method do not share; the SAME index on two methods
  // does not share; and two decorators on ONE parameter DO - which is the
  // property the key exists for.
  expect(evaluated('(() => { let a, b; function g1(c) { a = c; } function g2(c) { b = c; } '
    + 'class A { m(@g1 x: uint8, @g2 y: uint8) {} } return String(a.metadata === b.metadata); })();')).toBe('false');
  expect(evaluated('(() => { let a, b; function g1(c) { a = c; } function g2(c) { b = c; } '
    + 'class A { m(@g1 x: uint8) {} n(@g2 y: uint8) {} } return String(a.metadata === b.metadata); })();')).toBe('false');
  expect(evaluated('(() => { let a, b; function g1(c) { a = c; } function g2(c) { b = c; } '
    + 'class A { m(@g1 @g2 x: uint8) {} } return String(a.metadata === b.metadata); })();')).toBe('true');
});

test('a parameter\'s metadata PROTOTYPE-LINKS to the base class\'s', () => {
  // The same rule a member's metadata follows: a derived class's same parameter
  // READS the base's through the prototype while being a DISTINCT object, so a
  // subclass can add without disturbing what it inherited.
  expect(evaluated('(() => { let base, derived; function b(c) { base = c; } function d(c) { derived = c; } '
    + 'class B { m(@b x: uint8) {} } base.metadata.tag = "from-base"; '
    + 'class D extends B { m(@d x: uint8) {} } return String(derived.metadata.tag); })();')).toBe('from-base');
  expect(evaluated('(() => { let base, derived; function b(c) { base = c; } function d(c) { derived = c; } '
    + 'class B { m(@b x: uint8) {} } class D extends B { m(@d x: uint8) {} } '
    + 'return String(base.metadata === derived.metadata); })();')).toBe('false');
});
