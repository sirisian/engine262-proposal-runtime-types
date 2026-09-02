// PLAN-variadic-and-named-generic-arguments.md Phase 4: a variadic parameter
// BINDS at an application (spec.emu #sec-bindtypearguments,
// #sec-variadic-parameters). The positional half is SequenceAssignment with the
// pack's element bound as the admits; a pack binds a tuple; a value pack reads
// in the body as a frozen array; spreads splice before binding; a named pack
// opens a run. Cases carry their Appendix A numbers.
import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

const V = 'class vec<T, N: uint32> { swizzle<...I: [].<uint32>>(): uint32 { return I.length; } pick<...I: [].<uint32>>(): uint32 { return I[1]; } }';

test('a value pack binds from positional arguments and reads as an array (D1, D3, H1)', () => {
  expect(evaluated(`${V} String(new vec.<uint8, 4>().swizzle.<0, 0, 0, 0>());`)).toBe('4');
  expect(evaluated(`${V} String(new vec.<uint8, 4>().swizzle.<0, 1>());`)).toBe('2');
  expect(evaluated(`${V} String(new vec.<uint8, 4>().pick.<7, 9>());`)).toBe('9');
});

test('an empty pack is the empty tuple (D4)', () => {
  expect(evaluated(`${V} String(new vec.<uint8, 4>().swizzle.<>());`)).toBe('0');
});

test('a tuple default fills an empty pack (E1; F-R closed)', () => {
  // F-R's cause was inference running before the explicit frame was consulted
  // and evaluating the default with the pack unbound; inference is now seeded
  // with the already-bound frame.
  expect(evaluated('function d<...I: [].<uint32> = [0, 1, 2]>(): uint32 { return I.length; } String(d.<>());')).toBe('3');
});

test('the value view is frozen and the same array on every read (H2, H3)', () => {
  expect(evaluated('function f<...I: [].<uint32>>(): boolean { return I === I && Object.isFrozen(I); } String(f.<1, 2>());')).toBe('true');
  expect(evaluated('function f<...I: [].<uint32>>(): uint32 { return I.every((i) => i < 3) ? 1 : 0; } String(f.<1, 2>());')).toBe('1');
});

test('the element bound admits and refuses; a fixed extent is enforced (D6, D7, E3)', () => {
  expectThrown('function f<...I: [].<uint32>>(): uint32 { return I.length; } f.<0, "x">();');
  expectThrown('function g<...I: [4].<uint8>>(): uint32 { return I.length; } g.<1, 2>();', 'not assignable');
  expect(evaluated('function g<...I: [4].<uint8>>(): uint32 { return I.length; } String(g.<1, 2, 3, 4>());')).toBe('4');
});

test('two packs split by their element bounds; a fixed parameter after a pack is reached (D10, D12)', () => {
  expect(evaluated('function two<...A: [].<uint32>, ...B: [].<string>>(): string { return String(A.length) + "/" + String(B.length); } two.<0, 1, "x">();')).toBe('2/1');
  expect(evaluated('function q<...I: [].<uint32>, N: uint32 = 4>(): uint32 { return N; } String(q.<0, 1, 2>());')).toBe('4');
  expect(evaluated('function s<...I: [].<uint32>, S: string>(): string { return S; } s.<0, 1, "tail">();')).toBe('tail');
});

test('a named pack opens a run; a name reaches past a greedy pack (D13, D14, OQ-5)', () => {
  const Q = 'function q<...I: [].<uint32>, N: uint32 = 4>(): string { return String(N) + "/" + String(I.length); }';
  expect(evaluated(`${Q} q.<0, 1, 2, N: 8>();`)).toBe('8/3');
  expect(evaluated(`${Q} q.<I: 0, 1, N: 8>();`)).toBe('8/2');
  expect(evaluated(`${Q} q.<N: 8>();`)).toBe('8/0');
});

test('a spread splices a tuple before binding, to one specialization (D20, D21)', () => {
  expect(evaluated('type Pair = [0, 1]; function f<...I: [].<uint32>>(): uint32 { return I.length; } String(f.<...Pair>());')).toBe('2');
  expect(evaluated('type Pair = [0, 1]; class W<...I: [].<uint32>> {} String(W.<...Pair> === W.<0, 1>);')).toBe('true');
  expectThrown('function f<...I: [].<uint32>>(): uint32 { return I.length; } function u(xs: [].<uint32>) { return f.<...[].<uint32>>(); } u([1]);', 'stated extent');
});

test('a type pack binds a tuple of types (D2)', () => {
  expect(evaluated('class T<...Ts> {} String(T.<uint8, string> === T.<uint8, string>);')).toBe('true');
  expect(evaluated('class T<...Ts> {} String(T.<uint8, string> === T.<string, uint8>);')).toBe('false');
});

test('a class with a pack in TYPE position and its own specialization agree (D30)', () => {
  expect(evaluated('class W<...I: [].<uint32>> { n(): uint32 { return I.length; } } let w: W.<0, 1> = new W.<0, 1>(); String(w.n());')).toBe('2');
});

test('a where clause over a pack is checked once, at specialization (H6)', () => {
  expect(evaluated('function f<...I: [].<uint32>>(): uint32 where I.every((i) => i < 4) { return I.length; } String(f.<0, 3>());')).toBe('2');
  expectThrown('function f<...I: [].<uint32>>(): uint32 where I.every((i) => i < 4) { return I.length; } f.<0, 4>();');
});
