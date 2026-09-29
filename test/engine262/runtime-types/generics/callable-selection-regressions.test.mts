import { expect, test } from 'vitest';
import { evaluated, expectEarlyError, expectThrown } from '../harness.mts';

// Callable specialization: regressions at both boundaries.
test.each(['0, -0', '-0, 0'])('stored case bindings preserve signed zero (%s)', (order) => {
  const [first, second] = order.split(', ');
  expect(evaluated(`function f<string, N: number>(): number { return N; }
    const a: any = f.<string, ${first}>; const b: any = f.<string, ${second}>;
    String(a === b) + '|' + String(Object.is(a(), ${first})) + '|' + String(Object.is(b(), ${second}))
      + '|' + String(a === f.<string, ${first}>) + '|' + String(b === f.<string, ${second}>)
      + '|' + String(Object.is(f.<string, ${first}>(), a()));`)).toBe('false|true|true|true|true|true');
});

test('stored cases intern NaN and distinguish equally named nominal declarations and closures', () => {
  expect(evaluated(`function f<string, N: number>(): number { return N; }
    const a: any = f.<string, NaN>; const b: any = f.<string, NaN>;
    String(a === b) + '|' + String(Object.is(a(), NaN));`)).toBe('true|true');
  expect(evaluated(`function f<string, T: type>(): type { return T; }
    class C { x: uint8; } const outer = C; const a: any = f.<string, C>;
    { class C { x: uint8; } const b: any = f.<string, C>;
      globalThis.result = String(a === b) + '|' + String(a() === outer) + '|' + String(b() === C); }
    globalThis.result;`)).toBe('false|true|true');
  expect(evaluated(`function make() { function f<string, N: number>(): number { return N; } return f; }
    const a: any = make(); const b: any = make(); String(a.<string, 0> === b.<string, 0>);`)).toBe('false');
});

const ADDITIVE = `function f<T: type>(x: T): string { return 'generic'; }
  function f<uint8>(x: string): string { return 'string'; }`;

test.each(['f', 'g'])('explicit %s calls filter same-arity additive signatures', (callee) => {
  expect(evaluated(`${ADDITIVE} const g: any = f;
    ${callee}.<uint8>((3 := uint8)) + '|' + ${callee}.<uint8>('x');`)).toBe('generic|string');
});

test('no viable value signature rejects statically and at runtime', () => {
  expectEarlyError(`${ADDITIVE} f.<uint8>(true);`, 'StaticTypeError');
  expect(evaluated(`${ADDITIVE} const g: any = f;
    try { g.<uint8>(true); } catch (e) { String(e instanceof TypeError); }`)).toBe('true');
});

test.each(['f', 'g'])('incomparable cases with different value signatures select through %s', (callee) => {
  expect(evaluated(`function f<A: type, B: type>(x: boolean): string { return 'owner'; }
    function f<const T, T>(x: string): string { return 'equal'; }
    function f<uint32, _>(x: uint8): string { return 'fixed'; }
    const g: any = f;
    ${callee}.<uint32, uint32>('x') + '|' + ${callee}.<uint32, uint32>((3 := uint8));`)).toBe('equal|fixed');
});

test('explicit selection evaluates each value argument once, including spreads', () => {
  expect(evaluated(`${ADDITIVE} const g: any = f; let calls = 0;
    function arg(): uint8 { calls += 1; return (3 := uint8); }
    g.<uint8>(arg()) + '|' + g.<uint8>(...[arg()]) + '|' + String(calls);`)).toBe('generic|generic|2');
});

test.each(['f', 'g'])('owner defaults bind before %s selects a case', (callee) => {
  expect(evaluated(`function f<A: type = string, B: type = uint8>(): string { return 'owner'; }
    function f<string, uint8>(): string { return 'case'; } const g: any = f;
    ${callee}.<string>() + '|' + ${callee}.<A: string>() + '|' + ${callee}.<>()
      + '|' + ${callee}.<B: uint8>() + '|' + ${callee}.<string, uint8>();`)).toBe('case|case|case|case|case');
  expect(evaluated(`function f<A: type, B: type = A>(): string { return 'owner'; }
    function f<string, string>(): string { return 'case'; } const g: any = f;
    ${callee}.<string>() + '|' + ${callee}.<A: string>() + '|' + ${callee}.<string, string>();`)).toBe('case|case|case');
});

test.each([[false, true, 'fixed'], [true, false, 'equal'], [false, false, 'owner']])(
  'filters remove incomparable matches before ranking (%s, %s)', (equal, fixed, expected) => {
    expect(evaluated(`function p<A: type, B: type>(): string { return 'owner'; }
      function p<const T, T>(): string where ${equal} { return 'equal'; }
      function p<uint32, _>(): string where ${fixed} { return 'fixed'; }
      const g: any = p; g.<uint32, uint32>();`)).toBe(expected);
  },
);

test('true incomparable filters remain ambiguous; false filters cannot satisfy a bodyless owner', () => {
  expectThrown(`function p<A: type, B: type>(): string { return 'owner'; }
    function p<const T, T>(): string where true { return 'equal'; }
    function p<uint32, _>(): string where true { return 'fixed'; }
    const g: any = p; g.<uint32, uint32>();`, 'neither is more specific');
  expectThrown(`function p<A: type, B: type>(): string;
    function p<const T, T>(): string where false { return 'equal'; }
    function p<uint32, _>(): string where false { return 'fixed'; }
    const g: any = p; g.<uint32, uint32>();`, 'no overload');
});

test.each(['f', 'g'])('named pack runs and positional runs select identically through %s', (callee) => {
  expect(evaluated(`function f<...Ts: [].<type>>(): string { return 'owner'; }
    function f<uint8, uint16>(): string { return 'case'; } const g: any = f;
    ${callee}.<uint8, uint16>() + '|' + ${callee}.<Ts: uint8, uint16>()
      + '|' + ${callee}.<Ts: string, boolean>();`)).toBe('case|case|owner');
  expect(evaluated(`function f<...Ts: [].<type>, End: type>(): string { return 'owner'; }
    function f<uint8, uint16, string>(): string { return 'case'; } const g: any = f;
    ${callee}.<uint8, uint16, string>() + '|' + ${callee}.<Ts: uint8, uint16, End: string>();`)).toBe('case|case');
});

test.each(['f', 'g'])('candidate signatures preserve defaults, rest and named values through %s', (callee) => {
  expect(evaluated(`function f<T: type>(x: T): string { return 'owner'; }
    function f<uint8>(x: string = 'default'): string { return x; } const g: any = f;
    ${callee}.<uint8>() + '|' + ${callee}.<uint8>(undefined) + '|' + ${callee}.<uint8>(x: 'named');`)).toBe('default|default|named');
  expect(evaluated(`function f<T: type>(...x: [].<T>): string { return 'owner'; }
    function f<uint8>(...x: [].<string>): string { return 'strings'; } const g: any = f;
    ${callee}.<uint8>('a', 'b') + '|' + ${callee}.<uint8>((1 := uint8), (2 := uint8));`)).toBe('strings|owner');
});

test.each(['f', 'g'])('reference applicability through %s preserves storage and refuses conversion', (callee) => {
  expect(evaluated(`function f<T: type>(x: T): string { return 'owner'; }
    function f<uint8>(ref x: uint8): string { x += 1; return 'ref'; } const g: any = f;
    let n: uint8 = 3;
    ${callee}.<uint8>(n) + '|' + ${callee}.<uint8>(ref n) + '|' + String(n);`)).toBe('owner|ref|4');
  expect(evaluated(`function f<T: type>(x: T): string { return 'owner'; }
    function f<uint8>(ref x: uint16): string { x += 1; return 'wrong'; } const g: any = f;
    let n: uint8 = 3; ${callee}.<uint8>(ref n) + '|' + String(n);`)).toBe('owner|3');
});

test.each(['f', 'g'])('value defaults depend on earlier bound parameters through %s', (callee) => {
  expect(evaluated(`function f<N: uint32, M: uint32 = N>(): string { return 'owner'; }
    function f<4, 4>(): string { return 'case'; } const g: any = f;
    ${callee}.<4>() + '|' + ${callee}.<N: 4>() + '|' + ${callee}.<4, 4>();`)).toBe('case|case|case');
  expect(evaluated(`function f<T: type, N: uint64 = T.byteLength>(): string { return 'owner'; }
    function f<uint8, 1>(): string { return 'case'; } const g: any = f;
    ${callee}.<uint8>() + '|' + ${callee}.<T: uint8>() + '|' + ${callee}.<uint8, 1>();`)).toBe('case|case|case');
});

test('implicit replacement selection filters before ambiguity too', () => {
  expect(evaluated(`function p<A: type, B: type>(x: A, y: B): string { return 'owner'; }
    function p<const T, T>(x: T, y: T): string where false { return 'equal'; }
    function p<uint32, const U>(x: uint32, y: U): string { return 'fixed'; }
    const g: any = p; g((1 := uint32), (2 := uint32));`)).toBe('fixed');
});

test('incomparable filters use each method class and capture frame', () => {
  expect(evaluated(`class P<Bits: uint32> {
    p<A: type, B: type>(): string { return 'owner'; }
    p<const T, T>(): string where Bits > 32 { return 'equal'; }
    p<uint32, _>(): string where Bits <= 32 { return 'fixed'; }
  }
  const a: any = new P.<64>(); const b: any = new P.<16>();
  a.p.<uint32, uint32>() + '|' + b.p.<uint32, uint32>() + '|' + a.p.<uint32, uint32>();`)).toBe('equal|fixed|equal');
});

test('stored owner defaults and named pack runs preserve identity and reflection', () => {
  expect(evaluated(`function f<T: type = string>(): type { return T; }
    function f<uint8>(): type { return uint8; }
    const a: any = f.<>; const b: any = f.<T: string>;
    String(a === b) + '|' + String(a()) + '|' + Reflect.getReflection(a).selected.role;`)).toBe('true|string|owner');
  expect(evaluated(`function f<...Ts: [].<type>>(): string { return 'owner'; }
    function f<uint8, uint16>(): string { return 'case'; }
    const a: any = f.<uint8, uint16>; const b: any = f.<Ts: uint8, uint16>;
    String(a === b) + '|' + a() + '|' + b();`)).toBe('true|case|case');
});

test('filter memoization distinguishes signed-zero bindings', () => {
  expect(evaluated(`function f<N: number>(): string { return 'owner'; }
    function f<const N>(): string where Object.is(N, 0) { return 'positive'; }
    const g: any = f; g.<0>() + '|' + g.<-0>();`)).toBe('positive|owner');
});
