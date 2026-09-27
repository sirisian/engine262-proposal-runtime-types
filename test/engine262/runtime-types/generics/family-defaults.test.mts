import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

// Shared application identity, including the former erased rational width.
for (const width of [8, 16, 32, 64, 128]) {
  test(`rational${width} is its explicit application and reflected reconstruction`, () => {
    expect(evaluated(`String(rational${width} === rational.<${width}> && Reflect.makeType(Reflect.getReflection(rational${width})) === rational${width});`)).toBe('true');
    expect(evaluated(`String(Reflect.typeOf(rational${width}(1, 3)) === rational${width});`)).toBe('true');
  });
}

test('complex keeps its concrete default in every concrete type position', () => {
  expect(evaluated('String(complex === complex.<> && complex === complex.<number>);')).toBe('true');
  expectThrown('function f<T: type extends complex>(x: T) {} f(complex128(1, 2));');
  expect(evaluated('function f<T: type extends complex>(x: T) { return "yes"; } f(complex(1, 2));')).toBe('yes');
});

for (const source of ['let r: rational;', 'type R = rational.<>;', 'function f<T: type extends rational>() {}']) {
  test(`missing rational width: ${source}`, () => expectThrown(source, 'requires type argument N'));
}

test('intrinsic named arguments use the same binder in expressions and annotations', () => {
  expect(evaluated('String(rational.<N: 64> === rational64 && complex.<T: number> === complex);')).toBe('true');
  expect(evaluated('type V = vector.<N: 4, T: float32>; String(V === vector.<float32, 4>);')).toBe('true');
  expectThrown('type R = rational.<int32>;', 'integer width');
  expectThrown('type R = rational.<N: 64, N: 32>;', 'supplied twice');
  expectThrown('type R = rational.<N: 64, 32>;', 'positional');
});

test('range defaults are complete before interning', () => {
  expect(evaluated('String(type Range.<float64> === type Range.<float64, Range.Bound.Closed, Range.Bound.Open>);')).toBe('true');
  expect(evaluated('String(type RangeFrom.<float64> === type RangeFrom.<float64, Range.Bound.Closed>);')).toBe('true');
  expect(evaluated('String(type RangeTo.<float64> === type RangeTo.<float64, Range.Bound.Open>);')).toBe('true');
  expectThrown('type Bounds = { bounds?: Range };', 'requires type argument T');
});

test('one wildcard admits all rational widths including bigint', () => {
  const prefix = 'function f<T: type extends rational.<_>>(x: T): string { return "yes"; } ';
  for (const type of ['rational8', 'rational64', 'rational.<bigint>']) expect(evaluated(`${prefix} f(${type}(1, 3));`)).toBe('yes');
  expectThrown(`${prefix} f(1);`);
});

test('a wildcard family bound preserves the candidate and its metadata', () => {
  expect(evaluated('type M = uint8.<{ brand: "M" }>; function f<T: type extends uint.<_>>(x: T) { return T; } String(f(M(1)) === M);')).toBe('true');
});

test('wildcards are positional and omitted positions retain defaults', () => {
  expectThrown('function f<T: type extends vector.<_>>() {}', 'requires type argument N');
  expect(evaluated('function f<T: type extends vector.<float32, _>>(x: T) { return "yes"; } f(vector.<float32, 3>(1, 2, 3));')).toBe('yes');
  expectThrown('function f<T: type extends vector.<float32, _>>(x: T) {} f(vector.<uint8, 3>(1, 2, 3));');
});

test('nominal heads, dependent defaults and correlated forwarding aliases', () => {
  const pair = 'class Pair<A: type, B: type = A> {} ';
  expect(evaluated(`${pair} function f<T: type extends Pair.<_>>(x: T) { return "yes"; } f(new Pair.<uint8>());`)).toBe('yes');
  expectThrown(`${pair} function f<T: type extends Pair.<_>>(x: T) {} f(new Pair.<uint8, string>());`);
  expect(evaluated(`${pair} function f<T: type extends Pair.<_, _>>(x: T) { return "yes"; } f(new Pair.<uint8, string>());`)).toBe('yes');
  expectThrown(`${pair} type Same<A: type> = Pair.<A, A>; function f<T: type extends Same.<_>>(x: T) {} f(new Pair.<uint8, string>());`);
});

test('existing any views and fixed any pattern entries are distinct', () => {
  const pair = 'class Pair<A: type, B: type> {} ';
  expect(evaluated(`${pair} function f<T: type extends Pair.<any, string>>(x: T) { return "yes"; } f(new Pair.<uint8, string>());`)).toBe('yes');
  expectThrown(`${pair} function f<T: type extends Pair.<any, _>>(x: T) {} f(new Pair.<uint8, string>());`);
});

test('deferred pattern features fail at declaration', () => {
  expectThrown('interface I<T: type> { value: T; } function f<T: type extends I.<_>>() {}', 'structural interface');
  expectThrown('class C<...Ts: [].<type>> {} function f<T: type extends C.<_>>() {}', 'variadic');
  expectThrown('let x: uint.<_>;');
});


test('intrinsic declarations bind only in explicitly higher-kinded positions', () => {
  expect(evaluated('function f<F<_>: type>() { return F.<64>; } String(f.<rational>() === rational64);')).toBe('true');
  expect(evaluated('function f<F<_>: type>() { return F.<float32>; } String(f.<complex>() === complex64);')).toBe('true');
  expectThrown('function f<F<_, _>: type>() {} f.<rational>();', 'takes');
  expectThrown('function f<F<_>: type>() { return F.<int32>; } f.<rational>();', 'integer width');
  expect(evaluated('class C<F<_>: type> { get() { return F.<64>; } } String(new C.<rational>().get() === rational64);')).toBe('true');
});


test('reflection reconstructs intrinsic applications without a bare family value', () => {
  expect(evaluated('const g = Reflect.getReflection(rational64).generic; String(g.base === "rational" && g.parameters[0].domain === "width-or-bigint" && Reflect.makeType({ kind: "generic", ...g }) === rational64);')).toBe('true');
  expectThrown('Reflect.makeType({ kind: "generic", base: "rational", arguments: [] });', 'requires type argument N');
});

test('generic constraint reflection round-trips and is not a concrete type', () => {
  expect(evaluated('function f<T: type extends rational.<_>>(x: T): T { return x; } const t = Reflect.typeOf(f); const n = Reflect.getReflection(t); String(n.signatures[0].typeParameters[0].constraint.kind === "family-pattern" && Reflect.makeType(n) === t);')).toBe('true');
  expectThrown('function f<T: type extends rational.<_>>(x: T): T { return x; } Reflect.makeType(Reflect.getReflection(Reflect.typeOf(f)).signatures[0].typeParameters[0].constraint);', 'constraint');
});

test('nominal ancestry and nested patterns retain their application arguments', () => {
  expect(evaluated('class Base<T: type> {} class Child extends Base.<uint8> {} function f<T: type extends Base.<_>>(x: T) { return "yes"; } f(new Child());')).toBe('yes');
  expect(evaluated('class A<T: type> {} class B<T: type> {} function f<T: type extends A.<B.<_>>>(x: T) { return "yes"; } f(new A.<B.<uint8>>());')).toBe('yes');
});


test('lexical declarations win over same-spelled intrinsic families', () => {
  expect(evaluated('type rational = string; let x: rational = "yes"; x;')).toBe('yes');
  expect(evaluated('class complex<T: type = string> {} String((type complex) === (type complex.<string>));')).toBe('true');
});

test('computed dependent defaults are evaluated forward after the candidate binds a hole', () => {
  const prefix = 'function build(T: type): type { return T; } class Pair<T: type, U: type = build(T)> {} function f<V: type extends Pair.<_>>(x: V) { return "yes"; } ';
  expect(evaluated(prefix + 'f(new Pair.<uint8>());')).toBe('yes');
  expectThrown(prefix + 'f(new Pair.<uint8, string>());');
  expect(evaluated(prefix + 'const t = Reflect.typeOf(f); String(Reflect.makeType(Reflect.getReflection(t)) === t);')).toBe('true');
});


for (const reverse of [false, true]) {
  test(`family constraint specificity is independent of order (${reverse})`, () => {
    const declarations = ['function f<T: type extends uint.<_>>(x: T) { return "broad"; }',
      'function f<T: type extends uint8>(x: T) { return "narrow"; }'];
    if (reverse) declarations.reverse();
    expect(evaluated(declarations.join(' ') + 'f(1 := uint8);')).toBe('narrow');
  });
  test(`incomparable family constraints stay ambiguous (${reverse})`, () => {
    const declarations = ['function f<T: type extends vector.<float32, _>>(x: T) { return "lane"; }',
      'function f<T: type extends vector.<_, 2>>(x: T) { return "count"; }'];
    if (reverse) declarations.reverse();
    expectThrown(declarations.join(' ') + 'f(vector.<float32, 2>(1, 2));', 'ambiguous');
  });
}

test('computed default viability precedes ranking and errors never become fallback', () => {
  const pair = 'class Pair<T: type, U: type = build(T)> {} ';
  const choices = 'function f<V: type extends Pair.<_>>(x: V) { return "equal"; } function f<V: type extends Pair.<_, _>>(x: V) { return "any"; } ';
  expect(evaluated('function build(T: type): type { return T; } ' + pair + choices + 'f(new Pair.<uint8, string>());')).toBe('any');
  expect(evaluated('function build(T: type): type { return T; } ' + pair + choices + 'f(new Pair.<uint8, uint8>());')).toBe('equal');
  expectThrown('function build(T: type): type { throw new TypeError("default failed"); } ' + pair + choices + 'f(new Pair.<uint8, string>());', 'default failed');
});

test('a wildcard does not capture a source-visible parameter name', () => {
  expect(evaluated('class Pair<A: type, B: type> {} function f<$family0: type, T: type extends Pair.<_, $family0>>(x: T) { return "yes"; } f.<string, Pair.<uint8, string>>(new Pair.<uint8, string>());')).toBe('yes');
});

test('intrinsic range witnesses include one-ended shapes', () => {
  expect(evaluated('function f<T: type extends RangeBounds.<_>>(x: T) { return "yes"; } f(1..);')).toBe('yes');
  expect(evaluated('String(Reflect.typeOf(1..) === type RangeFrom.<number>);')).toBe('true');
});

test('family constraints retain invariant reference locations', () => {
  expect(evaluated('function f<T: type extends uint.<_>>(ref x: T): T { return x; } let x: uint8 = 1; String(f.<uint8>(ref x));')).toBe('1');
  expectThrown('function f<T: type extends uint.<_>>(ref x: T) {} let x: uint16 = 1; f.<uint8>(ref x);', 'ref');
});

test('range annotation completeness is independent of metadata origin', () => {
  for (const suffix of ['default = { bounds: .. };', 'default = {};']) {
    expectThrown('type M = { bounds?: Range }; meta M { ' + suffix + ' subtype(a,b) { return true; } } type F = float64.<{ bounds: 0..<10 }>;', 'requires type argument T');
  }
  expect(evaluated('type M = { bounds: RangeBounds.<float64> }; meta M { default = { bounds: .. }; subtype(a,b) { return true; } } type F = float64.<{ bounds: .. }>; String(Reflect.makeType(Reflect.getReflection(F)) === F);')).toBe('true');
});


test('ordinary first-order nested applications apply defaults and diagnose omissions', () => {
  expect(evaluated('class A<T: type = uint8> {} class W<T: type> {} String((type W.<A>) === (type W.<A.<uint8>>));')).toBe('true');
  expectThrown('class A<T: type> {} class W<T: type> {} type Bad = W.<A>;', 'no argument and no default');
  expectThrown('class A<T: type> {} type Bad = A.<uint8, string>;', 'takes 1 type arguments');
});


test('ordinary lexical type values shadow intrinsic declarations', () => {
  expect(evaluated('const rational = string; let x: rational = "ok"; x;')).toBe('ok');
  expect(evaluated('function f(rational: type) { let x: rational = "ok"; return x; } f(string);')).toBe('ok');
  expect(evaluated('type complex = string; let x: complex = "ok"; x;')).toBe('ok');
  expect(evaluated('const Range = string; let x: Range = "ok"; x;')).toBe('ok');
});


test('range reflection exposes a declaration name and reconstructs complete defaults', () => {
  expect(evaluated('const g = Reflect.getReflection(type Range.<uint8>).generic; String(g.base === "Range" && g.arguments.length === 3 && Reflect.makeType({ kind: "generic", ...g }) === type Range.<uint8>);')).toBe('true');
  expectThrown('Reflect.makeType({ kind: "generic", base: "Range", arguments: [] });', 'requires type argument T');
});

test('computed defaults nested inside a type retain their declaration context', () => {
  const prefix = 'function build(T: type): type { return T; } class Pair<T: type, U: type = [].<(build(T))>> {} function f<V: type extends Pair.<_>>(x: V) { return "yes"; } ';
  expect(evaluated(prefix + 'f(new Pair.<uint8>());')).toBe('yes');
  expectThrown(prefix + 'f(new Pair.<uint8, [].<string>>());');
  expect(evaluated(prefix + 'const t = Reflect.typeOf(f); String(Reflect.makeType(Reflect.getReflection(t)) === t);')).toBe('true');
});

test('reapplying a concrete intrinsic alias still validates argument domains', () => {
  expectThrown('const R = rational64; R.<string>;', 'integer width');
  expect(evaluated('const R = rational64; String(R.<N: 32> === rational32);')).toBe('true');
});


test('a dependent default resolves builders in the class declaration scope', () => {
  for (const body of ['', 'constructor() {}']) {
    expect(evaluated('function build(T: type): type { return T; } class Pair<T: type, U: type = build(T)> {' + body + '} function run() { function build(T: type): type { return string; } function f<V: type extends Pair.<_>>(x: V) { return "yes"; } return f(new Pair.<uint8, uint8>()); } run();')).toBe('yes');
  }
});

test('numeric construction does not infer a required intrinsic argument', () => {
  expectThrown('let x: rational64 = rational(1, 3);', 'requires type argument N');
  expectThrown('int(1);');
  expect(evaluated('String(Reflect.typeOf(complex(1, 2)) === complex);')).toBe('true');
});


test('named family arguments are checked even when the declaration is unused', () => {
  const pair = 'class Pair<T: type, U: type = T> {} ';
  expect(evaluated(pair + 'function f<V: type extends Pair.<U: _, T: _>>(x: V) { return "yes"; } f(new Pair.<uint8, string>());')).toBe('yes');
  expectThrown(pair + 'function f<V: type extends Pair.<Bogus: _>>(x: V) {}', 'does not name a type parameter');
  expectThrown(pair + 'function f<V: type extends Pair.<U: _>>(x: V) {}', 'no argument and no default');
});
