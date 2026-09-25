import { expect, test } from 'vitest';
import { evaluated, expectEarlyError, expectThrown } from '../harness.mts';

/**
 * Plan section 3.8 and section 6.1, phase 4 step 2a: the run-time selection
 * of a specialized case for a direct explicit call, `f.<A>(x)`. The checker
 * still defers these calls (step 2b lifts it), so the tests reach the run time
 * through a callee typed `any`.
 */

const P = `function f<T: type>(x: T): string { return 'generic'; }
function f<uint8>(x: uint8): string { return 'uint8'; }
const g: any = f;`;

test('B1 and B2: an exact case beats the owner; no case falls back to the owner', () => {
  expect(evaluated(`${P} g.<uint8>(3);`)).toBe('uint8');
  expect(evaluated(`${P} g.<uint16>(3);`)).toBe('generic');
});

test('B3: a bodyless owner with no matching case is no viable overload', () => {
  const R = `function read<T: type>(): T; function read<boolean>(): boolean { return true; } const r: any = read;`;
  expect(evaluated(`${R} String(r.<boolean>());`)).toBe('true');
  expectThrown(`${R} r.<float16>();`, 'no overload of `r` applies to (float16): no case matches, and its owner has no body');
});

const PAIR = `function p<A: type, B: type>(): string { return 'owner'; }
function p<const T, T>(): string { return 'equal'; }
function p<uint32, _>(): string { return 'u32-first'; }`;

test('B5, B7 and B8: the most specific applicable case, whatever the source order', () => {
  const run = `const h: any = p; [h.<uint8, uint8>(), h.<uint32, string>(), h.<uint32, uint32>(), h.<string, uint8>(), h.<uint8, uint16>()].join(',');`;
  const both = `function p<uint32, uint32>(): string { return 'both'; }`;
  expect(evaluated(`${PAIR} ${both} ${run}`)).toBe('equal,u32-first,both,owner,owner');
  // C10: reversing the declarations changes nothing.
  const reversed = `function p<A: type, B: type>(): string { return 'owner'; } ${both}
    function p<uint32, _>(): string { return 'u32-first'; } function p<const T, T>(): string { return 'equal'; }`;
  expect(evaluated(`${reversed} ${run}`)).toBe('equal,u32-first,both,owner,owner');
});

test('B6: an incomparable overlap is an ambiguity naming both cases and the arguments', () => {
  expectThrown(`${PAIR} const h: any = p; h.<uint32, uint32>();`,
    '`p<const T, T>` and `p<uint32, _>` both apply to (uint.<32>, uint.<32>)');
  // Only the affected application: the others still select.
  expect(evaluated(`${PAIR} const h: any = p; h.<uint8, uint8>();`)).toBe('equal');
});

test('B10 and B11: a width-family capture binds its value; int and uint are distinct', () => {
  expect(evaluated(`function w<T: type>(v: T): string { return 'g'; }
    function w<uint.<const N>>(v: uint.<N>): string { return 'uint ' + String(N); }
    function w<int.<const N>>(v: int.<N>): string { return 'int ' + String(N); }
    const k: any = w; k.<uint.<12>>(1) + '|' + k.<int.<12>>(1);`)).toBe('uint 12|int 12');
});

test('B17: an alias selects as the type it names', () => {
  expect(evaluated(`${P} type Byte = uint8; g.<Byte>(3);`)).toBe('uint8');
});

test('B9: a standalone case the arguments match beats the owner', () => {
  expect(evaluated(`function s<A: type, B: type>(): string { return 'owner'; }
    function s<string>(): string { return 'standalone'; } const t: any = s; t.<string>();`)).toBe('standalone');
});

test('implicit calls still defer (step 4)', () => {
  expectThrown(`${P} g(3);`, 'selecting a specialized case is not supported yet');
});

// Step 2b: the checker selects too.
const F = `function f<T: type>(x: T): string { return 'generic'; }
function f<uint8>(x: uint8): string { return 'uint8'; }`;

test('step 2b: a direct explicit call selects statically, and runs', () => {
  expect(evaluated(`${F} f.<uint8>(3);`)).toBe('uint8');
  expect(evaluated(`${F} f.<uint16>(3);`)).toBe('generic');
  expect(evaluated(`${PAIR} function p<uint32, uint32>(): string { return 'both'; }
    [p.<uint8, uint8>(), p.<uint32, string>(), p.<uint32, uint32>(), p.<string, uint8>()].join(',');`)).toBe('equal,u32-first,both,owner');
});

test('step 2b: the call is typed as the chosen case returns, captures instantiated', () => {
  // A replacement's narrower return is the call's type.
  expect(evaluated(`function f<T: type>(x: T): string { return 'generic'; }
    function f<uint8>(x: uint8): 'u' { return 'u'; } const c: 'u' = f.<uint8>(3); c;`)).toBe('u');
  expect(evaluated(`function w<T: type>(v: T): T { return v; }
    function w<uint.<const N>>(v: uint.<N>): uint.<N> { return v; } const r: uint.<12> = w.<uint.<12>>(5); String(r);`)).toBe('5');
  expectEarlyError(`${F} const n: number = f.<uint8>(3);`, 'StaticTypeError');
});

test('step 2b: no viable overload and an ambiguity are static errors, even in a call statement', () => {
  const R = `function read<T: type>(): T; function read<boolean>(): boolean { return true; }`;
  expectEarlyError(`${R} read.<float16>();`, 'StaticTypeError');
  expectThrown(`${R} read.<float16>();`, 'no overload of `read` applies to (float16)');
  expectThrown(`${PAIR} p.<uint32, uint32>();`, '`p<const T, T>` and `p<uint32, _>` both apply');
});

test('a mixed standalone case: selectors match, binders bind with defaults and bounds (B13, B14)', () => {
  const W = `function write<T: type>(v: T): string { return 'g'; }
    function write<string, LengthType: type extends uint8 = uint8>(v: string): string { return 'len ' + String(LengthType); }
    const k: any = write;`;
  expect(evaluated(`${W} k.<string>('s');`)).toBe('len uint.<8>');
  expectThrown(`${W} k.<string, int8>('s');`, 'does not satisfy the bound `uint8` of `LengthType`');
  expect(evaluated(`${W} k.<boolean>(true);`)).toBe('g');
});

test('a standalone case selects statically too, typed by its own signature (B9, B13, B14)', () => {
  expect(evaluated(`function s<A: type, B: type>(): string { return 'owner'; }
    function s<string>(): string { return 'standalone'; } s.<string>();`)).toBe('standalone');
  const W = `function write<T: type>(v: T): string { return 'g'; }
    function write<string, LengthType: type extends uint = uint16>(v: string): string { return 'len ' + String(LengthType); }`;
  expect(evaluated(`${W} write.<string>('s') + '|' + write.<string, uint8>('s');`)).toBe('len uint.<16>|len uint.<8>');
  expectEarlyError(`${W} write.<string, int8>('s');`, 'StaticTypeError');
  expectThrown(`${W} write.<string, int8>('s');`, 'int.<8> does not satisfy the bound `uint` of `LengthType`');
  // Value arguments are checked against the chosen case's own parameters.
  expectEarlyError(`${W} write.<string>(3);`, 'StaticTypeError');
  // Rule 8 beside a bodyless owner.
  expect(evaluated(`function read<T: type>(): T; function read<boolean>(): boolean { return true; }
    function read<string, LengthType: type extends uint = uint16>(): string { return 'str'; }
    read.<string>() + '|' + String(read.<boolean>());`)).toBe('str|true');
});

test('rule 4: a case whose value parameters cannot take the arguments does not apply', () => {
  const A = `function f<T: type>(x: T): string { return 'generic'; }
    function f<uint8>(x: uint8, extra: string): string { return 'additive'; }`;
  expect(evaluated(`${A} f.<uint8>(3);`)).toBe('generic');
  expect(evaluated(`${A} f.<uint8>(3, 'e');`)).toBe('additive');
  expect(evaluated(`${A} const g: any = f; g.<uint8>(3) + '|' + g.<uint8>(3, 'e');`)).toBe('generic|additive');
});

test('a bare family name is a bound, and only a bound', () => {
  const G = `function g<L: type extends uint>(): string { return 'ok'; }`;
  expect(evaluated(`${G} g.<uint8>() + g.<uint.<12>>();`)).toBe('okok');
  expectThrown(`${G} g.<int8>();`, 'is not assignable to "uint"');
  expectThrown(`${G} g.<string>();`, 'is not assignable to "uint"');
  // Not a type elsewhere: a value of unknown width has no layout.
  expectEarlyError('let x: uint = 3;', 'StaticTypeError');
});

// Step 3: named calls (plan section 3.8, rules 3 to 5; C03).
test('C1 and C5: an attached case borrows its owner\'s labels; named and positional select alike', () => {
  expect(evaluated(`${F} f.<T: uint8>(3) + '|' + f.<T: uint16>(3);`)).toBe('uint8|generic');
  expect(evaluated(`${F} const k: any = f; k.<T: uint8>(3) + '|' + k.<T: uint16>(3);`)).toBe('uint8|generic');
});

const MIXED = `function write<T: type>(v: T): string { return 'g'; }
  function write<float32, maximum: uint32, bits: uint32 = 16>(v: float32): string {
    return 'max=' + String(maximum) + ' bits=' + String(bits); }`;

test('C2: a mixed case\'s binders take their own labels; its selectors are positional', () => {
  expect(evaluated(`${MIXED} [write.<float32, maximum: 1024, bits: 18>(1.5), write.<float32, 1024, 18>(1.5),
    write.<float32, bits: 18, maximum: 1024>(1.5), write.<float32, maximum: 1024>(1.5)].join('|');`))
    .toBe('max=1024 bits=18|max=1024 bits=18|max=1024 bits=18|max=1024 bits=16');
  expect(evaluated(`${MIXED} const k: any = write; k.<float32, maximum: 1024, bits: 18>(1.5);`)).toBe('max=1024 bits=18');
  // A value binder admits a literal that fits its domain, and no other.
  expectThrown(`${MIXED} write.<float32, maximum: -1>(1.5);`, '-1 is not in the domain `uint32` of `maximum`');
  // A required binder left out: no case matches, and the owner does not take the label.
  expectThrown(`${MIXED} write.<float32, bits: 18>(1.5);`, 'no case matches, and its owner does not take these arguments');
});

test('C3 and C4: a pattern-only case takes no labels, and a capture\'s name is not a label', () => {
  expectThrown(`function g<uint8, string>(): string { return 'a'; } g.<A: uint8, B: string>();`,
    '`A` names no type parameter of `g`');
  expectThrown(`function h<uint.<const N>>(): string { return 'a'; } h.<N: 12>();`, '`N` names no type parameter of `h`');
  expectThrown(`${F} f.<U: uint8>(3);`, '`U` names no type parameter of `f`');
});
