import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * TYPED PROXY. #sec-reflection-and-declared-types: "A Proxy constructed with a
 * type argument _T_ has a [[RuntimeType]] internal slot whose value is _T_'s
 * Type Record, so `Reflect.typeOf` reports _T_ rather than the shape of its
 * target ... A Proxy constructed without one has no such slot and is of the
 * `any` type."
 */

test('a proxy constructed with a type argument reports it', () => {
  expect(evaluated('type P = { a: uint8 }; const p = new Proxy.<P>({ a: 1 }, {}); `${Reflect.typeOf(p) === (type P)}`;')).toBe('true');
  expect(evaluated('type P = { a: uint8 }; `${Reflect.typeOf(new Proxy.<P>({ a: 1 }, {}))}`;')).toBe('{ a: uint.<8> }');
});

test('a proxy constructed without one is `any`', () => {
  // Not the empty object type, which is what the shape walk used to produce: it
  // derives a type from the value's own internal property map, and a proxy never
  // populates one. `{}` says the value has no members; `any` says nothing is
  // known about them, and only the second is true.
  expect(evaluated('`${Reflect.typeOf(new Proxy({ a: 1 }, {}))}`;')).toBe('any');
  expect(evaluated('const r = Proxy.revocable({ a: 1 }, {}); r.revoke(); `${Reflect.typeOf(r.proxy)}`;')).toBe('any');
});

test('a callable proxy still reports a function type', () => {
  // The `any` rule is read AFTER the callable step, which is stated generally -
  // "if value is callable and is not a Type Object, return the ~function~ Type
  // Record". Placed before it, every proxy over a function reported `any`.
  expect(evaluated('const p = new Proxy(function (a: uint8): uint8 { return a; }, {}); `${Reflect.typeOf(p)}`;')).toBe('() => void');
});

test('a layout-backed target cannot be proxied', () => {
  // Both halves of "an instance of a typed class or a typed array": a field or
  // element read is an offset load, so there is no point at which a trap could
  // correctly run.
  expectThrown('class C { v: uint8 = 1; } new Proxy(new C(), {});', 'typed class and cannot be proxied');
  expectThrown('let a: [2].<uint8> = [1, 2]; new Proxy(a, {});', 'typed array and cannot be proxied');
  // An untyped target of either shape is untouched.
  expect(evaluated('`${typeof new Proxy({ a: 1 }, {})}`;')).toBe('object');
  expect(evaluated('`${typeof new Proxy([1, 2], {})}`;')).toBe('object');
});

test('membership reads the target, as it does for any object', () => {
  // NOT a proxy rule: `({ a: 1 }) is P` is false too, because an untyped Number
  // is not a `uint8`. With a typed target both answer true.
  expect(evaluated('type P = { a: uint8 }; `${({ a: 1 }) is P}`;')).toBe('false');
  expect(evaluated('type P = { a: uint8 }; `${({ a: (1 := uint8) }) is P}`;')).toBe('true');
  expect(evaluated('type P = { a: uint8 }; `${new Proxy.<P>({ a: (1 := uint8) }, {}) is P}`;')).toBe('true');
});

test('a typed proxy IS of its declared type, statically', () => {
  // `Proxy` sits among the global constructors usable as type names, which is
  // right for `Map` - "a nominal type whose values are its instances" - and
  // wrong here: a proxy has no instances of its own. Typed as `Proxy.<T>` a
  // construction was assignable to nothing.
  expect(evaluated('type P = { a: uint8 }; function f(x: P): uint8 { return x.a; } '
    + 'const p = new Proxy.<P>({ a: (1 := uint8) }, {}); `${f(p)}`;')).toBe('1');
});

test('the four value traps are checked against the declared type', () => {
  const P = 'type P = { a: uint8 }; ';
  // Out of the proxy: `get` and the descriptor's value.
  expectThrown(`${P}const p = new Proxy.<P>({ a: 1 }, { get() { return "nope"; } }); p.a;`, 'uint.<8>');
  expectThrown(`${P}const p = new Proxy.<P>({ a: 1 }, { getOwnPropertyDescriptor() { return { value: "nope", configurable: true, writable: true, enumerable: true }; } }); Object.getOwnPropertyDescriptor(p, "a");`, 'uint.<8>');
  // INTO the proxy: `set` and `defineProperty`, checked before the trap sees the
  // value. A trap that stored whatever it was handed would leave the proxy
  // reporting a type its own storage contradicts.
  expectThrown(`${P}const p = new Proxy.<P>({ a: 1 }, { set() { return true; } }); p.a = "x";`, 'uint.<8>');
  expectThrown(`${P}const p = new Proxy.<P>({ a: 1 }, { defineProperty() { return true; } }); Object.defineProperty(p, "a", { value: "nope" });`, 'uint.<8>');
  // Conforming values pass, and a member the type does not name is free.
  expect(evaluated(`${P}const p = new Proxy.<P>({ a: 1 }, { get() { return (7 := uint8); } }); \`\${p.a}\`;`)).toBe('7');
  // The handler's declared contract - `ProxyHandler.<P>`'s `get` returns
  // `P[keyof P]` - now refuses a `get` returning a non-member type at the
  // construction, so the runtime "an undeclared member is free" control is
  // shown with a CONFORMING handler: the value comes back unchecked.
  expect(evaluated(`${P}const p = new Proxy.<P>({ a: 1 }, { get() { return (9 := uint8); } }); \`\${p.other}\`;`)).toBe('9');
});

test('the shape traps may not contradict the declared type', () => {
  // If `Reflect.typeOf` reports `{ a: uint8 }` while `has` denies `a`, the
  // report is false and a program can see it. This is the base language's own
  // invariant - a trap may not deny a non-configurable property - extended to
  // the members a declared type requires.
  const P = 'type P = { a: uint8 }; const t = { a: (1 := uint8) }; ';
  expectThrown(`${P}const p = new Proxy.<P>(t, { has() { return false; } }); "a" in p;`, 'may not deny it');
  // Deleting a declared member is refused by the CHECKER, which knows the
  // proxy's Static Type is `P` now that G1 landed, so the `deleteProperty` trap
  // is never reached. That is the better answer - earlier, and without running
  // the trap - and the runtime refusal beside it still covers a proxy whose
  // static type is not known at the deletion.
  expectThrown(`${P}const p = new Proxy.<P>({ a: 1 }, { deleteProperty() { return true; } }); delete p.a;`, 'cannot be deleted');
  expectThrown(`${P}const p = new Proxy.<P>(t, { ownKeys() { return []; } }); Object.keys(p);`, 'may not omit it');
  // An OPTIONAL member may be absent, a member the type does not name is free,
  // and an untyped proxy is untouched. These are what keep the rule from
  // refusing proxies the type never spoke about.
  expect(evaluated('type Q = { a?: uint8 }; const p = new Proxy.<Q>({}, { has() { return false; } }); `${"a" in p}`;')).toBe('false');
  expect(evaluated(`${P}const p = new Proxy.<P>(t, { has() { return false; } }); \`\${"zz" in p}\`;`)).toBe('false');
  expect(evaluated('const p = new Proxy({ a: 1 }, { ownKeys() { return []; } }); `${Object.keys(p).length}`;')).toBe('0');
});

test('a callable type constrains what apply and construct hand back', () => {
  const F = 'type F = (x: uint8) => uint8; ';
  expectThrown(`${F}const p = new Proxy.<F>(function (x) { return x; }, { apply() { return "nope"; } }); p(1 := uint8);`, 'uint.<8>');
  expect(evaluated(`${F}const p = new Proxy.<F>(function (x) { return x; }, { apply() { return (7 := uint8); } }); \`\${p(1 := uint8)}\`;`)).toBe('7');
  expectThrown('class A { v: uint8 = 1; } type G = () => A; const p = new Proxy.<G>(A, { construct() { return { nope: 1 }; } }); new p();', 'not assignable to "A"');
});

test('ProxyHandler.<T> checks a handler where it is written', () => {
  // The run-time trap checks bound what a proxy may DO; this says what the
  // author has WRITTEN, and the two are complements. A `get` trap for a
  // rarely-read property can ship wrong and stay wrong, where an annotation
  // catches every trap at the declaration.
  const P = 'type P = { a: uint8 }; ';
  // A wrong return, a wrong arity, and a mistyped trap NAME - the typo case a
  // declaration-site type exists to catch.
  expectThrown(`${P}let h: ProxyHandler.<P> = { has(t, k) { return "nope"; } };`, 'is not assignable to "boolean"');
  expectThrown(`${P}let h: ProxyHandler.<P> = { isExtensible(t, extra) { return true; } };`, 'is not assignable to');
  expectThrown(`${P}let h: ProxyHandler.<P> = { gett(t, k) { return 1; } };`, '"gett" is not declared');
  // Every trap is optional: a handler declares the ones it intercepts.
  expect(evaluated(`${P}let h: ProxyHandler.<P> = {}; \`\${typeof h}\`;`)).toBe('object');
  expect(evaluated(`${P}let h: ProxyHandler.<P> = { has(t, k) { return true; } }; \`\${typeof h}\`;`)).toBe('object');
});

test('the construction checks its arguments against the declared parameters', () => {
  // `libraryConstructParameters` gives `Proxy` the signature
  // `(target: T, handler: ProxyHandler.<T>)`, so the INLINE spelling - how a
  // handler is almost always written - is checked as an annotation is. Before
  // this, library constructor arguments were not typed at all.
  const P = 'type P = { a: uint8 }; const t = { a: (1 := uint8) }; ';
  expectThrown(`${P}new Proxy.<P>(t, { has(t, k) { return "nope"; } });`, 'is not assignable to "boolean"');
  expectThrown(`${P}new Proxy.<P>(t, { gett(t, k) { return 1; } });`, '"gett" is not declared');
  expectThrown(`${P}new Proxy.<P>(5, {});`, 'is not assignable to "{ a: uint.<8> }"');
  expect(evaluated(`${P}const p = new Proxy.<P>(t, { has(t, k) { return true; } }); \`\${"a" in p}\`;`)).toBe('true');
  // An UNTYPED construction is untouched: an untyped proxy is `any`, and the
  // base language admits any handler object, unknown trap names included.
  expect(evaluated('const p = new Proxy({ a: 1 }, { anything() { return 1; } }); `${typeof p}`;')).toBe('object');
});

test('a value trap is typed over T[keyof T]', () => {
  // Coarser than the exact per-key T[K] - which needs a generic member and so a
  // source-declared library interface - and strictly better than `any`: a trap
  // returning a type no member of T holds is caught where it is written, and a
  // `set` handed one is too. A handler over a non-object T keeps `any`.
  const P = 'type P = { a: uint8, b: string }; ';
  expectThrown(`${P}let h: ProxyHandler.<P> = { get(t, k) { return true; } };`, 'is not assignable to "uint.<8> | string"');
  expect(evaluated(`${P}let h: ProxyHandler.<P> = { get(t, k) { return "x"; } }; \`\${typeof h}\`;`)).toBe('object');
  expectThrown(`${P}new Proxy.<P>({ a: (1 := uint8), b: "x" }, { get(t, k) { return true; } });`, 'is not assignable to "uint.<8> | string"');
  expect(evaluated('let h: ProxyHandler.<any> = { get(t, k) { return true; } }; `${typeof h}`;')).toBe('object');
});
