import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test.each([
  "function f(read = () => { let n: uint8 = value; }, value: string = \"s\") {}",
  "function f(read = () => { let n: uint8 = value; }, value: string = \"s\") { read(); } f();",
  "function f(value: string = \"s\", read = () => { let n: uint8 = value; }) {}",
  "let value: uint8 = 1; function f(read = () => { let n: uint8 = value; }, value: string = \"s\") {}",
  "let value: string = \"s\"; function f(read = () => { let n: uint8 = value; }) { let value: uint8 = 1; }",
  "function f(read = () => { let n: uint8 = value; }, {value}: {value: string} = {value: \"s\"}) {}",
  "const f = (read = () => { let n: uint8 = value; }, value: string = \"s\") => {};",
])("parameter defaults see every parameter contract: %s", (source) => expectStaticTypeError(source));

test("parameter defaults see every parameter contract preserve valid and dynamic cases", () => {
  expect(evaluated("function f(read = () => { let n: string = value; return n; }, value: string = \"s\") { return read(); } f();")).toBe("s");
  expect(ok("function f(read = () => { let n: uint8 = value; }, value: any = \"s\") {}")).toBe(true);
});

test.each([
  "const f: (x?: uint8) => void = (x) => { let n: uint8 = x; };",
  "const f: (x?: uint8) => void = function(x) { let n: uint8 = x; };",
  "function f(x?: uint8) { let n: uint8 = x; }",
  "const f: (x?: uint8) => void = (x) => { let n: uint8 = x; }; f();",
  "const f: (x?: uint8) => uint8 = (x) => x;",
  "const o: {m: (x?: uint8) => void} = {m(x) { let n: uint8 = x; }};",
  "const f: (x: uint8 | undefined) => void = (x) => { let n: uint8 = x; };",
  "const f: (x?: uint8) => void = (x?: uint8) => { let n: uint8 = x; };",
  "const f: (x?: uint8) => Promise.<void, any> = async (x) => { let n: uint8 = x; };",
])("contextual optional parameters include omission: %s", (source) => expectStaticTypeError(source));

test("contextual optional parameters include omission preserve valid and dynamic cases", () => {
  expect(ok("const f: (x?: uint8) => void = (x = 1) => { let n: uint8 = x; }; f();")).toBe(true);
  expect(ok("const f: (x?: uint8) => void = (x) => { let n: uint8 | undefined = x; }; f();")).toBe(true);
  expect(evaluated("const f: (x?: uint8) => string = (x) => typeof x; f();")).toBe("undefined");
  expect(evaluated("const f: (x?: uint8) => uint8 = (x = 1) => x; String(f());")).toBe("1");
});

test.each([
  "const f: (...x: [].<uint8>) => void = (...x) => { let n: string = x[0]; };",
  "const f: (...x: [].<uint8>) => void = (...x) => { let n: string = x[0]; }; f(1);",
  "function f(...x: [].<uint8>) { let n: string = x[0]; }",
  "const f: (...x: [].<uint8>) => void = function(...x) { let n: string = x[0]; };",
  "const o: {m: (...x: [].<uint8>) => void} = {m(...x) { let n: string = x[0]; }};",
  "const f: (...x: [uint8, string]) => void = (...x) => { let n: boolean = x[1]; };",
  "const f: (...x: [].<uint8>) => void = (...x: [].<uint8>) => { let n: string = x[0]; };",
  "const f: (...x: [].<uint8>) => Promise.<void, any> = async (...x) => { let n: string = x[0]; };",
])("contextual rest bindings retain collected types: %s", (source) => expectStaticTypeError(source));

test("contextual rest bindings retain collected types preserve valid and dynamic cases", () => {
  expect(evaluated("const f: (...x: [].<uint8>) => uint8 = (...x) => { return x[0]; }; String(f(1));")).toBe("1");
  expect(ok("const f: (...x: [].<any>) => void = (...x) => { let n: string = x[0]; };")).toBe(true);
  expect(evaluated("const f: (...xs: [].<uint8>) => string = (...xs) => typeof xs[0]; f(1);")).toBe("number");
});

test.each([
  "const C = class { static x: uint8 = 1; static m() { this.x = \"s\"; } };",
  "const C = class D { static x: uint8 = 1; static m() { this.x = \"s\"; } };",
  "const C = class { static x: uint8 = 1; static m() { this.x = \"s\"; } }; C.m();",
  "class C { static x: uint8 = 1; static m() { this.x = \"s\"; } }",
  "const C = class { static x: uint8 = 1; static m(): string { return this.x; } };",
  "const C = class { x: uint8 = 1; m() { this.x = \"s\"; } };",
  "const C = class { static x: uint8 = 1; static m() { const f = () => { this.x = \"s\"; }; } };",
  "const C = class { static x: uint8 = 1; static { this.x = \"s\"; } };",
])("class expressions type static this: %s", (source) => expectStaticTypeError(source));

test("class expressions type static this preserve valid and dynamic cases", () => {
  expect(evaluated("const C = class { static x: uint8 = 1; static m() { this.x = 2; } }; C.m(); String(C.x);")).toBe("2");
  expect(ok("const C = class { static x: uint8 = 1; static m() { function nested() { this.x = \"s\"; } } };")).toBe(true);
});

test.each([
  "enum E { A, B } type Alias = E; function unused(e: Alias) { switch(e) { case E.A: break; } }",
  "enum E { A, B } function e(): E { return E.A; } function unused() { switch(e()) { case E.A: break; } }",
  "enum E { A, B } function unused(o: {e: E}) { switch(o.e) { case E.A: break; } }",
  "enum E { A, B } function unused(e: E) { switch(e) { case E.A: break; } }",
  "enum E { A, B } type Alias = E; function unused(e: Alias) { switch(e) { case 1: break; default: break; } }",
  "enum E { A, B } function unused(o: {e: E}) { switch(o.e) { case 1: break; default: break; } }",
  "enum E { A, B } type Alias = E; function f(e: Alias): string { switch(e) { case E.A: return \"A\"; } return \"miss\"; } f(E.B);",
  "enum E { A, B } type Alias = E; function unused(E: any, e: Alias) { switch(e) { case E.A: break; } }",
])("enum switches retain declaration identity: %s", (source) => expectStaticTypeError(source));

test("enum switches retain declaration identity preserve valid and dynamic cases", () => {
  expect(ok("enum E { A, B } function unused(o: {e: E}) { switch(o.e) { case E.A: break; default: break; } }")).toBe(true);
  expect(evaluated("enum E { A, B } type Alias = E; function f(e: Alias) { switch(e) { case E.A: return \"A\"; case E.B: return \"B\"; } } f(E.B);")).toBe("B");
  expect(evaluated("enum E { A = 1, B = 1 } type Alias = E; function f(e: Alias) { switch(e) { case E.A: return 1; } } String(f(E.B));")).toBe("1");
  expect(ok("function unused(x: number) { switch(x) { case 1: break; } }")).toBe(true);
  expect(ok("enum E { A, B } function unused(x: any) { switch(x) { case E.A: break; } }")).toBe(true);
});

test.each([
  "class C { operator [](i: uint8): uint8 { return 1; } } function unused(c: C) { c[0] = 2; }",
  "class C { operator [](i: uint8): uint8 { return 1; } } function unused(c: C) { c[0]++; }",
  "class C { operator [](i: uint8): uint8 { return 1; } } const c: C = new C(); c[0] = 2;",
  "class C { operator [](i: uint8): uint8 { return \"s\"; } }",
  "class C { operator [](i: uint8): uint8 { return 1; } } function unused(c: C, i: uint8) { c[i] = 2; }",
  "class C { operator [](i: uint8): uint8 { return 1; } } const c: C = new C(); c[0]++;",
  "class C { operator [](i: uint8): uint8 { return 1; } } function unused(c: C) { c[0] += 1; }",
  "class C { operator [](i: uint8): uint8 { return 1; } } function unused(c: C) { [c[0]] = [1]; }",
  "class C { x: uint8; operator [](i: uint8): ref uint8 { return ref this.x; } } function unused(c: C) { c[0] = \"s\"; }",
])("index writes require a writable location: %s", (source) => expectStaticTypeError(source));

test("index writes require a writable location preserve valid and dynamic cases", () => {
  expect(evaluated("class C { x: uint8; operator [](i: uint8): ref uint8 { return ref this.x; } } const c: C = new C(); c[0] = 2; String(c.x);")).toBe("2");
  expect(evaluated("class C { operator [](i: uint8): uint8 { return 1; } } const c: C = new C(); String(c[0]);")).toBe("1");
  expect(ok("function unused(c: any) { c[0] = 2; }")).toBe(true);
  expect(evaluated("class C { x: uint8; get operator [](i: uint8): uint8 { return this.x; } set operator [](i: uint8, v: uint8) { this.x = v; } } const c: C = new C(); c[0] = 2; String(c[0]);")).toBe("2");
  expect(evaluated("dynamic class C { operator [](i: uint8): uint8 { return 1; } } const c: C = new C(); c[\"foo\"] = \"s\"; c.foo;")).toBe("s");
});

test.each([
  "function unused() { abstract class B { m(): uint8; } class C extends B { static m(): uint8 { return 1; } } }",
  "function unused() { abstract class B { m(): uint8; } class C extends B { m: uint8 = 1; } }",
  "function unused() { abstract class B { m(x: uint8): uint8; } class C extends B { *m(x: string): uint8 { yield 1; } } }",
  "abstract class B { m(): uint8; } class C extends B { static m(): uint8 { return 1; } }",
  "abstract class B { m(): uint8; } class C extends B { m: uint8 = 1; }",
  "abstract class B { m(x: uint8): uint8; } class C extends B { *m(x: string): uint8 { yield 1; } }",
  "abstract class B { m(x: uint8): uint8; } class C extends B { m(x: string): uint8 { return 1; } }",
  "function unused() { abstract class B { m(): uint8; } class C extends B {} }",
])("abstract members require compatible instance implementations: %s", (source) => expectStaticTypeError(source));

test("abstract members require compatible instance implementations preserve valid and dynamic cases", () => {
  expect(evaluated("abstract class B { m(): uint8; } class C extends B { m(): uint8 { return 1; } } String(new C().m());")).toBe("1");
  expect(ok("abstract class B { m(): uint8; } abstract class C extends B { static m(): uint8 { return 1; } }")).toBe(true);
});

test.each([
  "function s(): string { return \"s\"; } const o = {get x() { return s(); }}; function unused() { let n: uint8 = o.x; }",
  "const o = {get x(): string { return \"s\"; }}; function unused() { let n: uint8 = o.x; }",
  "function s(): string { return \"s\"; } const o = {get x() { return s(); }}; let n: uint8 = o.x;",
  "function s(): string { return \"s\"; } class C { get x() { return s(); } } function unused(c: C) { let n: uint8 = c.x; }",
  "function s(): string { return \"s\"; } function unused() { const o: {x: uint8} = {get x() { return s(); }}; }",
])("published getter returns type object properties: %s", (source) => expectStaticTypeError(source));

test("published getter returns type object properties preserve valid and dynamic cases", () => {
  expect(evaluated("function s(): string { return \"s\"; } const o = {get x() { return s(); }}; let n: string = o.x; n;")).toBe("s");
  expect(ok("const o = {get x() { return \"s\"; }}; function unused() { let n: uint8 = o.x; }")).toBe(true);
  expect(ok("function s(): any { return \"s\"; } const o = {get x() { return s(); }}; function unused() { let n: uint8 = o.x; }")).toBe(true);
  expect(evaluated("let reads = 0; function s(): string { return \"s\"; } const o = {get x() { reads++; return s(); }}; function unused() { let n: string = o.x; } String(reads);")).toBe("0");
});

test.each([
  "class C { x: uint8; m(): uint8 { return this.x; } } function unused(c: C) { const f = c.m; f?.(); }",
  "class C { x: uint8; m(): uint8 { return this.x; } } function unused(c: C) { (0,c.m)?.(); }",
  "class C { x: uint8; m(): uint8 { return this.x; } } function unused(c: C) { const f = c.m; f(); }",
  "class C { x: uint8; m(): uint8 { return this.x; } } const c: C = new C(); const f = c.m; f?.();",
  "class C { m(): uint8 { return 1; } } const c: C = new C(); const f = c.m; String(f?.());",
  "function unused(x: uint8) { x?.(); }",
  "class C { x: uint8; m(): uint8 { return this.x; } } function unused(c: C) { const f = c[\"m\"]; f?.(); }",
  "class C { x: uint8; m(): uint8 { return this.x; } } function unused(c: C) { const {m} = c; m?.(); }",
])("optional calls preserve receiver requirements: %s", (source) => expectStaticTypeError(source));

test.each([
  "class C { x: uint8; m(): uint8 { return this.x; } } const c: C | null = new C(); String(c?.m());",
  "const f: (() => uint8) | null = null; f?.();",
  "const f: (() => uint8) | null = (): uint8 => 1; String(f?.());",
])("optional calls reject a deciding test made constant by initialization: %s", (source) => expectStaticTypeError(source));

test("optional calls preserve receiver requirements preserve valid and dynamic cases", () => {
  expect(evaluated("class C { x: uint8; m(): uint8 { return this.x; } } function invoke(c: C | null) { return c?.m(); } String(invoke(new C())) + '/' + String(invoke(null));")).toBe("0/undefined");
  expect(ok("class C { x: uint8; m(): uint8 { return this.x; } } function unused(c: C) { const f: any = c.m; f?.(); }")).toBe(true);
});

test.each([
  "function unused() { class C { x: uint8; x: string; } }",
  "function unused() { class C { static x: uint8; static x: string; } }",
  "function unused() { class C { x: string; x: uint8; } }",
  "function unused() { class C { [\"x\"]: uint8; x: string; } }",
  "class C { x: uint8; x: string; } new C();",
  "function unused() { class B { x: uint8; } class C extends B { x: string; } }",
])("repeated fields share a storage contract: %s", (source) => expectStaticTypeError(source));

test("repeated fields share a storage contract preserve valid and dynamic cases", () => {
  expect(ok("class C { x: uint8; x: uint8; } new C();")).toBe(true);
  expect(evaluated("class C { x = 1; x = \"s\"; } new C().x;")).toBe("s");
  expect(evaluated("class C { x: uint8; static x: string; } String(new C().x) + C.x;")).toBe("0");
  expect(evaluated("class C { x: uint8 = 1; x: uint8 = 2; } String(new C().x);")).toBe("2");
  expect(ok("function unused(key: any) { class C { [key]: uint8; x: string; } }")).toBe(true);
});

test('a receiver-free function remains callable through an optional call', () => {
  expect(evaluated('function invoke(f: (() => uint8) | null) { return f?.(); } String(invoke((): uint8 => 1)) + "/" + String(invoke(null));')).toBe('1/undefined');
});

test('abstract redeclarations must preserve covariance', () => {
  expectStaticTypeError('abstract class A { m(): number; } abstract class B extends A { m(): uint8; }');
  expect(ok('abstract class A { m(): number; } abstract class B extends A { m(): 1; } class C extends B { m(): 1 { return 1; } }')).toBe(true);
});

test('method carriers and symbol keys agree at checking and class definition', () => {
  expectStaticTypeError('function unused() { abstract class B { [Symbol.iterator](): uint8; } class C extends B {} }');
  expect(ok('abstract class B { [Symbol.iterator](): Generator.<uint8, void, void>; } class C extends B { *[Symbol.iterator](): uint8 { yield 1; } }')).toBe(true);
  expectStaticTypeError('function unused() { abstract class B { m(): uint8; } class C extends B { async m(): Promise.<uint8> { return 1; } } }');
  expect(ok('abstract class B { m(): Promise.<uint8>; } class C extends B { async m(): Promise.<uint8> { return 1; } }')).toBe(true);
});

test('resolved dynamic heritage retains abstract obligations', () => {
  expectThrownKind('abstract class B { m(): uint8; } const Parent: any = B; class C extends Parent { static m(): uint8 { return 1; } }', 'TypeError');
});

test('resolved repeated field keys enforce the same runtime contract', () => {
  expectThrownKind('function key() { return "x"; } class C { [key()]: uint8; [key()]: string; }', 'TypeError');
  expectStaticTypeError('function unused() { class C { x: uint8; x = "bad"; } }');
  expectStaticTypeError('function unused() { class C { readonly x: uint8; x: uint8; } }');
  expect(evaluated('let count = 0; class C { x: uint8 = ++count; x: uint8 = ++count; } const c = new C(); String(count) + ":" + String(c.x);')).toBe('2:2');
});

test('contextual rest collection preserves a fixed argument sequence', () => {
  expectStaticTypeError('const f: (x: uint8, y: string) => void = (...xs) => { let n: boolean = xs[1]; };');
  expect(evaluated('const f: (x: uint8, y: string) => string = (...xs) => xs[1]; f(1,"s");')).toBe('s');
});

test('default closure contracts do not initialize later parameters', () => {
  expectThrownKind('function f(read = () => value, run = read(), value: string = "s") {} f();', 'ReferenceError');
});

test('logical index assignments reject only a possible store', () => {
  // `||=` on a value that is always truthy can never store, and its right
  // operand is dead code (#sec-narrowfrom).
  expect(ok('class C { operator [](i: uint8): 1 { return 1; } } function unused(c: C) { c[0] ||= 2; }')).toBe(false);
  // `??=` on a value that can never be nullish can never store (#sec-narrowing).
  expect(ok('class C { operator [](i: uint8): 1 { return 1; } } function unused(c: C) { c[0] ??= 2; }')).toBe(false);
  expectStaticTypeError('class C { operator [](i: uint8): 1 { return 1; } } function unused(c: C) { c[0] &&= 2; }');
});

test('contextual declared defaults exclude omission from the body type', () => {
  expect(evaluated('const f: (x: uint8 = 1) => uint8 = (x) => x; String(f());')).toBe('1');
});

test('compatible repeated fields occupy one layout slot', () => {
  expect(evaluated('class C { x: uint8 = 1; x: uint8 = 2; } String((type C).byteLength);')).toBe('1');
});

test('repeated typed field qualifiers and computed key effects are preserved', () => {
  expectStaticTypeError('function unused() { class C { @align(4) x: uint8; @align(8) x: uint8; } }');
  expectStaticTypeError('function unused() { class C { protected x: uint8; x: uint8; } }');
  expect(evaluated('let calls = 0; function key() { calls++; return "x"; } class C { [key()]: uint8 = 1; [key()]: uint8 = 2; } const c = new C(); String(calls) + ":" + String(c.x);')).toBe('2:2');
  expect(evaluated('class C { x: uint8 = 1; x = 2; } String((type C).byteLength);')).toBe('1');
});

test('a contextual tuple rest distributes its positional contracts', () => {
  expectStaticTypeError('const f: (...xs: [uint8, string]) => void = (x, y) => { let n: boolean = y; };');
  expect(evaluated('const f: (...xs: [uint8, string]) => string = (x, y) => y; f(1,"s");')).toBe('s');
});

test('computed method keys execute once and retain symbol identity', () => {
  expect(evaluated('const key = Symbol.iterator; let count = 0; function name() { count++; return key; } abstract class B { [name()](): uint8; } class C extends B { [name()](): uint8 { return 1; } } String(count);')).toBe('2');
});

test('abstract accessors preserve member kinds and read/write contracts', () => {
  expect(evaluated('abstract class B { get x(): uint8; } class C extends B { get x(): uint8 { return 1; } } String(new C().x);')).toBe('1');
  expect(ok('abstract class B { set x(v: uint8); } class C extends B { set x(v: uint8) {} } const c = new C(); c.x = 1;')).toBe(true);
  expectStaticTypeError('function unused() { abstract class B { get x(): uint8; } class C extends B { set x(v: uint8) {} } }');
  expectStaticTypeError('function unused() { abstract class B { m(): uint8; } class C extends B { m(): uint8 { return 1; } m = 2; } }');
});

test('dependent field contracts are checked when their types close', () => {
  expect(ok('class C<T: type> { x: T; x: uint8; }')).toBe(true);
  expect(ok('class C<T: type> { x: T; x: uint8; } new C.<uint8>();')).toBe(true);
  expectStaticTypeError('class C<T: type> { x: T; x: uint8; } function unused() { new C.<string>(); }');
});
