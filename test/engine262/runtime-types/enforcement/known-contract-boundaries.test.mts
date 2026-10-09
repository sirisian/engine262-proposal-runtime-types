import { expect, test } from 'vitest';
import { evaluated, evaluatedSequence, expectStaticTypeError, ok } from '../harness.mts';

test.each(['new K("bad")', 'new K()', 'new K(x: "bad")'])(
  'stable constructor aliases preserve argument contracts: %s', (expression) => {
    expectStaticTypeError(`class C { constructor(x: uint8) {} } const K = C; function unused() { ${expression}; }`);
  },
);

test('constructor origins retain ref, generic and conditional contracts', () => {
  expectStaticTypeError('class C { constructor(ref x: uint8) {} } const K = C; function unused() { new K(1); }');
  expectStaticTypeError('class C<T: type> { constructor(x: T) {} } const K = C; function unused() { new K.<uint8>("bad"); }');
  expectStaticTypeError('class A { constructor(x: uint8) {} } class B { constructor(x: uint8) {} } function unused(b: boolean) { new (b ? A : B)("bad"); }');
  expectStaticTypeError('const K = class { constructor(x: uint8) {} }; function unused() { new K("bad"); }');
  expect(ok('class C { constructor(x: uint8) {} } const K = C; new K(1);')).toBe(true);
  expect(ok('class C { constructor(x: uint8) {} } let K = C; K = class { constructor(x: string) {} }; new K("s");')).toBe(true);
  expect(ok('class C { constructor(x: uint8) {} } const K: any = C; function unused() { new K("s"); }')).toBe(true);
  expect(ok('class C { constructor(x: uint8) {} } const K = C; function unused(K: any) { new K("s"); }')).toBe(true);
});

test.each([
  'type A<T: type extends uint8> = [T]; type Bad = A.<string>;',
  'type A<T: type extends uint8> = [T]; type Bad = A.<T: string>;',
  'interface I<T: type extends uint8> { x: T; } type Bad = I.<string>;',
  'interface I<T: type extends uint8> { x: T; } type Bad = I.<T: string>;',
  'type A<N: uint8> = [N].<uint8>; type Bad = A.<300>;',
  'type A<N: boolean> = [uint8]; type Bad = A.<"s">;',
])('type applications enforce declared domains and bounds: %s', (source) => expectStaticTypeError(source));

test('checked type application preserves named arguments, defaults and open declarations', () => {
  expect(evaluated('type A<T: type extends uint8, U: type = T> = [T,U]; type B = A.<T: uint8>; String(B);')).toBe('[uint.<8>, uint.<8>]');
  expect(ok('interface I<T: type extends uint8> { x: T; } type Good = I.<T: uint8>;')).toBe(true);
  expect(ok('type A<T: type extends uint8> = [T]; function f<U: type extends uint8>(x: A.<U>) {}')).toBe(true);
});

test.each([
  'function g<T: type>() {} function unused() { g(); }',
  'function g<A: type, B: type>(x: A) {} function unused() { g(1); }',
  'function g<A: type, B: type>(x: A) {} function unused() { g(x: 1); }',
])('generic calls require complete inference: %s', (source) => expectStaticTypeError(source));

test('generic inference completes explicit, contextual, argument and default bindings', () => {
  expect(ok('function g<T: type>() {} g.<uint8>();')).toBe(true);
  expect(ok('function g<T: type = uint8>() {} g();')).toBe(true);
  expect(ok('function g<T: type>(x: T) {} g(1);')).toBe(true);
  expect(ok('function g<T: type>() {} const f: any = g; function unused() { f(); }')).toBe(true);
  expect(ok('function g<T: type>(x: T) {} function f(x: any) { g(x); }')).toBe(true);
});

test.each([
  'const f: (x: uint8) => void = (x = "bad") => {};',
  'const f: (x: uint8) => void = function(x = "bad") {};',
  'const f: (x?: uint8) => void = (x = "bad") => {};',
  'let o: { m(x: uint8): void } = { m(x = "bad") {} };',
  'const f: (x: {a: uint8}) => void = ({a} = {a: "bad"}) => {};',
])('contextual parameter types check their defaults: %s', (source) => expectStaticTypeError(source));

test('contextual parameters govern the body and preserve per-call default evaluation', () => {
  expectStaticTypeError('const f: (x: uint8) => void = (x = 1) => { let n: string = x; };');
  expect(evaluated('let calls = 0; function value(): uint8 { calls++; return 1; } const f: (x?: uint8) => uint8 = (x = value()) => x; f(); f(); String(calls);')).toBe('2');
  expect(ok('const f = (x = "s") => x; f();')).toBe(true);
});

test('published return types participate in override compatibility', () => {
  expectStaticTypeError('class B { m(x: uint8): uint8 { return x; } } class D extends B { m(x: uint8) { return "s"; } }');
  expectStaticTypeError('class B { m(x: uint8) { return x; } } class D extends B { m(x: uint8): string { return "s"; } }');
  expectStaticTypeError('class B { m(x: uint8): uint8 { return x; } } class D extends B { m(x: uint8) { return result(x); } } function result(x: uint8) { return "s"; }');
  expect(ok('class B { m(x: uint8): uint8 { return x; } } class D extends B { m(x: uint8) { return x; } }')).toBe(true);
  expect(ok('class B { m(x: uint8): uint8 { return x; } } class D extends B { m(x: string): string { return x; } }')).toBe(true);
  expect(ok('class B { m(x: uint8): uint8 { return x; } } class D extends B { m(x: uint8): any { return "s"; } }')).toBe(true);
});

test.each(['done: { "s"; break done; 1; }', 'done: { "s"; break done; }', 'done: { try { "s"; break done; } finally { 1; } }'])(
  'do expressions check carried completion values: %s', (body) => expectStaticTypeError(`function unused() { let n: uint8 = do { ${body} }; }`),
);

test('do completion context follows the reached producer', () => {
  expect(evaluated('let n: uint8 = do { done: { 1; break done; "unreachable"; } }; String(n);')).toBe('1');
  expect(evaluated('let n: uint8 = do { outer: { inner: { 2; break outer; } "unreachable"; } }; String(n);')).toBe('2');
  expect(evaluated('let n: uint8 = do { done: { try { "s"; break done; } finally { 3; break done; } } }; String(n);')).toBe('3');
});

test('interpolation patterns compare actual types at each position', () => {
  expectStaticTypeError('function unused(x: uint8, y: string) { match(x) { when ${y}: 0; default: 1; } }');
  expectStaticTypeError('function unused(x: {value: uint8}, y: string) { match(x) { when {value: ${y}}: 0; default: 1; } }');
  expect(ok('function unused(x: uint8, y: any) { match(x) { when ${y}: 0; default: 1; } }')).toBe(true);
  expect(ok('function unused(x: uint8 | string, y: string) { match(x) { when ${y}: 0; default: 1; } }')).toBe(true);
  expect(evaluated('function f(x: uint8, y: uint8) { return match(x) { when ${y}: 1; default: 0; }; } String(f(1,1));')).toBe('1');
});

test('extractor hooks must be callable when known', () => {
  expectStaticTypeError('function unused(head: {[Symbol.customMatcher]: uint8}, x: uint8) { match(x) { when head(let a): 0; default: 1; } }');
  expect(ok('function unused(head: any, x: uint8) { match(x) { when head(let a): 0; default: 1; } }')).toBe(true);
  expect(evaluated('function f(head: {[Symbol.customMatcher]: (x: uint8) => [uint8] | null}, x: uint8) { return match(x) { when head(let a): a; default: 0; }; } String(f({[Symbol.customMatcher]: (x: uint8): [uint8] => [x]},1));')).toBe('1');
});

test.each(['s.length = 0', 's["length"]++', 'delete s.length'])(
  'fixed String length descriptors reject %s', (expression) => expectStaticTypeError(`function unused(s: string) { ${expression}; }`),
);

test('String index proofs use UTF-16 extent and preserve unknown or skipped stores', () => {
  expectStaticTypeError('function unused(s: "abc") { s[0] = "x"; }');
  expectStaticTypeError('function unused(s: "??") { delete s[1]; }');
  expect(ok('function unused(s: "abc") { s[9] = "x"; }')).toBe(true);
  expect(ok('function unused(s: any) { s.length = 0; }')).toBe(true);
  expect(ok('function unused(s: string) { s.length ??= 0; }')).toBe(true);
  expectStaticTypeError('function unused(s: "abc") { s.length ||= 0; }');
  expectStaticTypeError('function unused(s: "abc") { s.length &&= 0; }');
  expect(ok('function unused(n: number) { n.x = 1; }')).toBe(true);
});

test('proven local delegation checks its resumed input boundary', () => {
  const declarations = 'function* inner(): Generator.<uint8, void, uint8> { yield 1; } function* outer(): Generator.<uint8, void, string> { yield* inner(); }';
  expectStaticTypeError(`${declarations} const g = outer(); g.next(); g.next("bad");`);
  expect(ok(declarations)).toBe(true);
  expect(ok(`${declarations} const g = outer(); g.next();`)).toBe(true);
  expect(ok('function* inner(): Generator.<uint8, void, string> { yield 1; } function* outer(): Generator.<uint8, void, string> { yield* inner(); } const g = outer(); g.next(); g.next("ok");')).toBe(true);
  expect(ok('function* inner(): Generator.<never, void, uint8> {} function* outer(): Generator.<uint8, void, string> { yield* inner(); } const g = outer(); g.next(); g.next("ok");')).toBe(true);
  expect(ok('function* inner(): Generator.<uint8, void, any> { yield 1; } function* outer(): Generator.<uint8, void, string> { yield* inner(); } const g = outer(); g.next(); g.next("ok");')).toBe(true);
});

test('delegation defers when protocol replacement prevents the proof', () => {
  expect(ok(`
    function* inner(): Generator.<uint8, void, uint8> { yield 1; }
    function* outer(): Generator.<uint8, void, string> { yield* inner(); }
    inner.prototype[Symbol.iterator] = function() { return { next() { return {done: true}; } }; };
    const g = outer(); g.next(); g.next("ok");
  `)).toBe(true);
  expect(evaluatedSequence([
    'Object.getPrototypeOf(Object.getPrototypeOf((function*(){})())).next = function() { return {done: true}; }; "changed";',
    'function* inner(): Generator.<uint8, void, uint8> { yield 1; } function* outer(): Generator.<uint8, void, string> { yield* inner(); } const g = outer(); g.next(); g.next("ok"); "ok";',
  ])).toBe('ok');
});
