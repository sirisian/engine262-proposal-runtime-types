import { expect, test } from 'vitest';
import { expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test.each([
  [
    "immutable alias unused",
    "abstract class A{m():uint8;} function f(){const K=A;new K();}"
  ],
  [
    "immutable alias executed",
    "abstract class A{m():uint8;} function f(){const K=A;new K();}f();"
  ],
  [
    "alias chain unused",
    "abstract class A{m():uint8;} const B=A;function f(){const K=B;new (K)();}"
  ],
  [
    "alias chain executed",
    "abstract class A{m():uint8;} const B=A;function f(){const K=B;new (K)();}f();"
  ],
  [
    "class expression unused",
    "function f(){const K=abstract class{m():uint8;};new K();}"
  ],
  [
    "class expression executed",
    "function f(){const K=abstract class{m():uint8;};new K();}f();"
  ],
  [
    "direct already rejects",
    "abstract class A{m():uint8;} function f(){new A();}"
  ]
])('R41 rejects before evaluation: %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "any retains runtime",
    "abstract class A{m():uint8;} const K:any=A;new K();"
  ],
  [
    "computed producer stays dynamic",
    "abstract class A{m():uint8;} function get():any{return A;}new (get())();"
  ]
])('R41 retains runtime timing: %s', (_name, source) => {
  expectThrownKind(source, 'TypeError');
});

test.each([
  [
    "concrete alias",
    "class A{m():uint8{return 1;}}const K=A;new K();"
  ],
  [
    "valid subclass and super",
    "abstract class A{m():uint8;} const K=A;class B extends K{constructor(){super();}m():uint8{return 1;}}new B();"
  ],
  [
    "reassigned mutable alias",
    "abstract class A{m():uint8;} class B extends A{m():uint8{return 1;}}let K=A;K=B;new K();"
  ],
  [
    "shadowed alias",
    "abstract class A{m():uint8;} function f(K:any){new K();}f(class{});"
  ]
])('R41 preserves valid behavior: %s', (_name, source) => {
  expect(ok(source)).toBe(true);
});


test.each([
  [
    "generic alias",
    "abstract class A<T: type>{m():T;}const K=A;function f(){new K.<uint8>();}"
  ],
  [
    "specialized alias",
    "abstract class A<T: type>{m():T;}const K=A.<uint8>;function f(){new K();}"
  ],
  [
    "class expression direct",
    "function f(){new (abstract class{m():uint8;})();}"
  ],
  [
    "block alias",
    "abstract class A{m():uint8;}function f(){const K=A;{const Alias=K;new Alias();}}"
  ]
])('R41 rejects a proved edge case: %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "abstract constructor from parameter",
    "abstract class A{m():uint8;}function f(K:any){new K();}f(A);"
  ]
])('R41 keeps unknown origins dynamic: %s', (_name, source) => {
  expectThrownKind(source, 'TypeError');
});

test.each([
  [
    "class binding replaced",
    "abstract class A{m():uint8;}class B extends A{m():uint8{return 1;}}A=B;new A();"
  ],
  [
    "captured reassignment",
    "abstract class A{m():uint8;}class B extends A{m():uint8{return 1;}}let K=A;function replace(){K=B;}replace();new K();"
  ],
  [
    "concrete shadow",
    "abstract class A{m():uint8;}function f(){const A=class{m():uint8{return 1;}};new A();}f();"
  ],
  [
    "mutable declaration via eval",
    "abstract class A{m():uint8;}eval(\"A=class{};\");new A();"
  ],
  [
    "anonymous concrete expression",
    "const K=class{x:uint8=1;};new K();"
  ]
])('R41 accepts a viable edge case: %s', (_name, source) => {
  expect(ok(source)).toBe(true);
});
