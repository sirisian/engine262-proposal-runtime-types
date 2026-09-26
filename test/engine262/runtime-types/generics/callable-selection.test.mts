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

test('step 4b: an implicit call the checker sees selects statically, as the run time does', () => {
  expect(evaluated(`function f<T: type>(x: T): string { return 'generic ' + String(T); }
    function f<uint8>(x: uint8): string { return 'uint8'; }
    f((3 := uint8)) + '|' + f((3 := uint16)) + '|' + f('a');`)).toBe('uint8|generic uint.<16>|generic string');
  // D3 with a static argument is a static error.
  const R = `function read<T: type>(x: T): string; function read<boolean>(x: boolean): string { return 'b'; }`;
  expect(evaluated(`${R} read(true);`)).toBe('b');
  expectEarlyError(`${R} read(3.5);`, 'StaticTypeError');
  expectThrown(`${R} read(3.5);`, 'no overload of `read` applies to (number): no case matches, and its owner has no body');
  // D4 and D5.
  expect(evaluated(`function s<uint8>(x: uint8): string { return 'standalone'; }
    function s(x: string): string { return 'str'; } s((3 := uint8)) + '|' + s('a');`)).toBe('standalone|str');
  expect(evaluated(`function f<T: type>(x: T): string { return 'generic'; }
    function f<uint8>(x: uint8, extra: string): string { return 'additive'; }
    f((3 := uint8)) + '|' + f((3 := uint8), 'e');`)).toBe('generic|additive');
});

test('step 4b: the call is typed as the chosen declaration returns, and binds as it returns', () => {
  // A replacement's narrower return, and a capture in it; a contextual type
  // does not filter out the owner that routes to the replacement.
  expect(evaluated(`function f<T: type>(x: T): string { return 'g'; }
    function f<uint8>(x: uint8): 'u' { return 'u'; } const c: 'u' = f((3 := uint8)); c;`)).toBe('u');
  expect(evaluated(`function w<T: type>(v: T): string { return 'g'; }
    function w<uint.<const N>>(v: uint.<N>): uint.<N> { return v; } const r: uint.<12> = w((5 := uint.<12>)); String(r);`)).toBe('5');
  expect(evaluated(`function f<T: type>(x: T): string { return 'g'; }
    function f<uint8>(x: uint8): 'u' { return 'u'; } const c: string = f((3 := uint16)); c;`)).toBe('g');
  expectEarlyError(`function f<T: type>(x: T): string { return 'generic'; }
    function f<uint8>(x: uint8): string { return 'uint8'; } const n: number = f((3 := uint8));`, 'StaticTypeError');
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

// Step 4a: implicit calls, dispatched at run time (reached through `any`
// until the checker's half, step 4b, lifts the static deferral).
test('D1 and D2: the owner\'s inferred binding selects its replacement, else its body', () => {
  expect(evaluated(`function f<T: type>(x: T): string { return 'generic ' + String(T); }
    function f<uint8>(x: uint8): string { return 'uint8'; } const g: any = f;
    g((3 := uint8)) + '|' + g((3 := uint16)) + '|' + g('a');`)).toBe('uint8|generic uint.<16>|generic string');
  // A capture binds from the inferred binding.
  expect(evaluated(`function w<T: type>(v: T): string { return 'g'; }
    function w<uint.<const N>>(v: uint.<N>): string { return 'uint ' + String(N); } const k: any = w;
    k((5 := uint.<12>)) + '|' + k('s');`)).toBe('uint 12|g');
});

test('D3: a bodyless owner no replacement matches is no viable overload', () => {
  const R = `function read<T: type>(x: T): string; function read<boolean>(x: boolean): string { return 'b'; } const r: any = read;`;
  expect(evaluated(`${R} r(true);`)).toBe('b');
  expectThrown(`${R} r(3.5);`, 'no case matches, and its owner has no body');
});

test('D4 and D5: standalone and additive cases take part by their own value signatures', () => {
  expect(evaluated(`function s<uint8>(x: uint8): string { return 'standalone'; }
    function s(x: string): string { return 'str'; } const t: any = s; t((3 := uint8)) + '|' + t('a');`)).toBe('standalone|str');
  expect(evaluated(`function f<T: type>(x: T): string { return 'generic'; }
    function f<uint8>(x: uint8, extra: string): string { return 'additive'; } const g: any = f;
    g((3 := uint8)) + '|' + g((3 := uint8), 'e');`)).toBe('generic|additive');
});

// Step 5: first-class values (plan section 3.8, rules 4 and 5; C14).
const G = `function f<T: type>(x: T): string { return 'generic'; }
  function f<uint8>(x: uint8): 'u' { return 'u'; }`;

test('E1 and E4: a stored application selects its case, as a value and as a callback', () => {
  expect(evaluated(`${G} const g = f.<uint8>; const h = f.<uint16>; g(3) + '|' + h(3);`)).toBe('u|generic');
  expect(evaluated(`${G} [(3 := uint8)].map(f.<uint8>).join(',');`)).toBe('u');
  // A capture binds in the stored value.
  expect(evaluated(`function w<T: type>(v: T): string { return 'g'; }
    function w<uint.<const N>>(v: uint.<N>): string { return 'n=' + String(N); } const k = w.<uint.<12>>; k(1);`)).toBe('n=12');
});

test('E1, statically: a stored application has the chosen case\'s type', () => {
  expect(evaluated(`${G} const g = f.<uint8>; const c: 'u' = g(3); c;`)).toBe('u');
  expectEarlyError(`${G} const g = f.<uint8>; const n: number = g(3);`, 'StaticTypeError');
  expectEarlyError(`${G} const g = f.<uint8>; g('x');`, 'StaticTypeError');
  expectEarlyError(`function read<T: type>(): T; function read<boolean>(): boolean { return true; } const r = read.<float16>;`, 'StaticTypeError');
});

test('E2 and E3: one selection is one value; another closure\'s declaration is another', () => {
  expect(evaluated(`${G} String(f.<uint8> === f.<uint8>) + String(f.<T: uint8> === f.<uint8>) + String(f.<uint16> === f.<uint16>);`)).toBe('truetruetrue');
  expect(evaluated(`function mk() { function f<T: type>(x: T): string { return 'g'; } function f<uint8>(x: uint8): string { return 'u'; } return f.<uint8>; }
    const a = mk(); const b = mk(); String(a === b) + '|' + String(a === a);`)).toBe('false|true');
});

test('E5 and E7: a group\'s generic function value is its owner\'s: it reaches a replacement, never an additive case', () => {
  const APPLY = `function apply(fn: <U: type>(x: U) => string): string { return fn.<uint8>(3); }`;
  expect(evaluated(`function f<T: type>(x: T): string { return 'generic'; }
    function f<uint8>(x: uint8): string { return 'uint8'; } ${APPLY} apply(f);`)).toBe('uint8');
  expect(evaluated(`function f<T: type>(x: T): string { return 'generic'; }
    function f<uint8>(x: uint8, extra: string): string { return 'additive'; } ${APPLY} apply(f);`)).toBe('generic');
});

test('E6: a group of standalone cases alone has no generic function value; it is an ordinary overload set', () => {
  expectEarlyError(`function s<uint8>(x: uint8): string { return 'a'; } const h: <U: type>(x: U) => string = s;`, 'StaticTypeError');
  expect(evaluated(`function s<uint8>(x: uint8): string { return 'a'; } function s(x: string): string { return 'b'; }
    function use(fn: (x: string) => string): string { return fn('z'); } use(s);`)).toBe('b');
});

// Step 6: forwarding an open argument from a generic body (plan section 3.8,
// rule 7; D8).
const READ = `function read<T: type>(): T; function read<boolean>(): boolean { return true; }
  function read<uint8>(): uint8 { return (7 := uint8); }`;
const WRITE = `function write<uint.<const N>>(v: uint.<N>): string { return 'uint ' + String(N); }`;

test('F1 and B4: through an owner, checked once, selected per specialization', () => {
  expect(evaluated(`${READ} function fwd<T: type>(): T { return read.<T>(); }
    String(fwd.<boolean>()) + '|' + String(fwd.<uint8>());`)).toBe('true|7');
  // A binding no case matches, beside a bodyless owner, fails where it is applied.
  expectThrown(`${READ} function fwd<T: type>(): T { return read.<T>(); } fwd.<float16>();`,
    'no overload of `read` applies to (float16)');
});

test('F2: through a case the argument\'s bound proves applicable to every binding (D8)', () => {
  expect(evaluated(`${WRITE} function g<L: type extends uint>(v: L): string { return write.<L>(v); }
    g.<uint8>((3 := uint8)) + '|' + g.<uint.<12>>((5 := uint.<12>));`)).toBe('uint 8|uint 12');
  // A more specific case keeping the proven signature is reached by its bindings.
  expect(evaluated(`${WRITE} function write<uint8>(v: uint8): string { return 'eight'; }
    function g<L: type extends uint>(v: L): string { return write.<L>(v); }
    g.<uint8>((3 := uint8)) + '|' + g.<uint16>((3 := uint16));`)).toBe('eight|uint 16');
  // A case its parameters exclude (rule 4) is never reached, so it does not count.
  expect(evaluated(`${WRITE} function write<uint8>(v: uint8, extra: string): string { return 'x'; }
    function g<L: type extends uint>(v: L): string { return write.<L>(v); } g.<uint8>((3 := uint8));`)).toBe('uint 8');
});

test('F3: a more specific case a binding would reach with another signature is refused (D8)', () => {
  expectThrown(`${WRITE} function write<uint8>(v: string): string { return 'x'; }
    function g<L: type extends uint>(v: L): string { return write.<L>(v); }`,
  '`write.<L>` forwards through `write<uint.<const N>>`, but `write<uint8>`, which a binding of the argument would select, has another signature');
});

test('F4: no owner and no proving bound is refused', () => {
  expectThrown(`${WRITE} function g<T: type>(v: T): string { return write.<T>(v); }`,
    '`write.<T>` forwards an open argument, and no contract covers every binding');
});

test('standalone cases rank by specificity (section 6.1; rule 8)', () => {
  expect(evaluated(`${WRITE} function write<uint8>(v: uint8): string { return 'eight'; }
    write.<uint8>((3 := uint8)) + '|' + write.<uint16>((3 := uint16));`)).toBe('eight|uint 16');
});

// Step 7: methods and object literals (the rules of steps 2 to 6).
const METHODS = `class W { write<T: type>(v: T): string { return 'g'; }
  write<uint8>(v: uint8): 'u8' { return 'u8'; }
  write<uint.<const N>>(v: uint.<N>): string { return 'uint ' + String(N); } }`;

test('methods select as functions do: explicit, implicit, captures, statically and at run time', () => {
  expect(evaluated(`${METHODS} const w = new W(); w.write.<uint8>((3 := uint8)) + '|' + w.write.<uint.<12>>((5 := uint.<12>))
    + '|' + w.write.<string>('s') + '|' + w.write((3 := uint8)) + '|' + w.write('s');`)).toBe('u8|uint 12|g|u8|g');
  expect(evaluated(`${METHODS} const w: any = new W(); w.write.<uint8>((3 := uint8)) + '|' + w.write((5 := uint.<12>));`)).toBe('u8|uint 12');
  // The chosen declaration's type; a stored method application.
  expect(evaluated(`${METHODS} const w = new W(); const c: 'u8' = w.write((3 := uint8)); c;`)).toBe('u8');
  expectEarlyError(`${METHODS} const n: number = new W().write.<uint8>((3 := uint8));`, 'StaticTypeError');
  expect(evaluated(`${METHODS} const w: any = new W(); const g = w.write.<uint8>; g.call(w, (3 := uint8));`)).toBe('u8');
});

test('a method group reaches through inheritance, this, and super', () => {
  expect(evaluated(`${METHODS} class X extends W {} new X().write.<uint8>((3 := uint8)) + '|' + new X().write('s');`)).toBe('u8|g');
  expect(evaluated(`${METHODS} class Y extends W { go(): string {
    return this.write.<uint8>((3 := uint8)) + '|' + super.write.<uint.<9>>((1 := uint.<9>)); } } new Y().go();`)).toBe('u8|uint 9');
});

test('a bodyless method owner with no matching case is a static error', () => {
  expectEarlyError(`class R { read<T: type>(): T; read<boolean>(): boolean { return true; } } new R().read.<float16>();`, 'StaticTypeError');
});

test('object-literal methods select too', () => {
  expect(evaluated(`const o = { m<T: type>(x: T): string { return 'g'; }, m<uint8>(x: uint8): string { return 'u'; } };
    o.m.<uint8>(3) + '|' + o.m((3 := uint8)) + '|' + o.m('s');`)).toBe('u|u|g');
});

test('three same-named methods form one group, not nested sets', () => {
  expect(evaluated(`class V { m(a: string): string { return 's'; } m(a: number): string { return 'n'; } m(a: boolean): string { return 'b'; } }
    const v = new V(); v.m('x') + v.m(1) + v.m(true);`)).toBe('snb');
});

// Step 7b: class operators, selected by the right operand.
const OPS = `class V { x: float64; constructor(x: float64) { this.x = x; }
  operator +.<T: type>(rhs: T): string { return 'g'; }
  operator +.<uint8>(rhs: uint8): 'u' { return 'u'; }
  operator +.<uint.<const N>>(rhs: uint.<N>): string { return 'n' + String(N); } }`;

test('a binary operator selects by its right operand, statically and at run time', () => {
  expect(evaluated(`${OPS} const v = new V(1); String(v + (3 := uint8)) + '|' + String(v + (3 := uint16)) + '|' + String(v + 'a');`)).toBe('u|n16|g');
  expect(evaluated(`${OPS} const v: any = new V(1); String(v + (3 := uint8)) + '|' + String(v + 'a');`)).toBe('u|g');
  // The operation has the chosen declaration's type.
  expect(evaluated(`${OPS} const v = new V(1); const c: 'u' = v + (3 := uint8); c;`)).toBe('u');
  expectEarlyError(`${OPS} const n: number = new V(1) + (3 := uint8);`, 'StaticTypeError');
});

test('an operator without a right operand to select by is deferred; a bodyless operator owner is refused', () => {
  expectThrown(`class U { operator -.<T: type>(): string { return 'g'; } operator -.<uint8>(): string { return 'u'; } } -new U();`,
    "only a binary operator's right operand selects");
  expectThrown(`class R { operator +.<T: type>(rhs: T): string; operator +.<boolean>(rhs: boolean): string { return 'b'; } }`,
    "is a class operator's owner without a body");
});

// Step 7c: `where` filters (B12), receiverless extraction (E8), `super` forwarding (F5).
test('B12: a case whose where filter does not hold is not applicable; selection moves on', () => {
  const F = `function f<T: type>(x: T): string { return 'generic'; }
    function f<uint.<const N>>(x: uint.<N>): string where N > 8 { return 'wide ' + String(N); } const g: any = f;`;
  expect(evaluated(`${F} g.<uint.<12>>((1 := uint.<12>)) + '|' + g.<uint.<4>>((1 := uint.<4>))
    + '|' + g((1 := uint.<12>)) + '|' + g((1 := uint.<4>));`)).toBe('wide 12|generic|wide 12|generic');
  // A method's filter reads its class's parameters.
  expect(evaluated(`class P<Bits: uint32 = 64> { write<T: type>(v: T): string { return 'g'; }
    write<float64>(v: float64): string where Bits >= 64 { return 'f64'; } }
    const a: any = new P.<64>(); const b: any = new P.<32>(); a.write.<float64>(1.5) + '|' + b.write.<float64>(1.5);`)).toBe('f64|g');
  // The checker does not yet evaluate filters while it selects: it refuses.
  expectThrown(`function f<T: type>(x: T): string { return 'generic'; }
    function f<uint.<const N>>(x: uint.<N>): string where N > 8 { return 'wide'; } f.<uint.<12>>((1 := uint.<12>));`,
  'whose `where` filter is evaluated at run time, statically is not supported yet');
});

test('E8: an extracted method application binds no receiver', () => {
  expect(evaluated(`class W { tag: string = 'w'; write<T: type>(v: T): string { return 'g'; }
    write<boolean>(v: boolean): string { return this.tag; } }
    const w = new W(); const m = w.write.<boolean>;
    m.call(w, true) + '|' + String((() => { try { return m(true); } catch (e) { return 'no receiver'; } })());`)).toBe('w|no receiver');
});

test('F5: an owner override forwards through super, checked against the owner', () => {
  expect(evaluated(`class R { read<T: type>(): T; read<boolean>(): boolean { return true; } read<uint8>(): uint8 { return (7 := uint8); } }
    class A extends R { read<T: type>(): T { return super.read.<T>(); } }
    const a = new A(); String(a.read.<boolean>()) + '|' + String(a.read.<uint8>());`)).toBe('true|7');
});

// Step 8: reflection (C23; decision Q3, refined: declarations reflect from the value).
const RF = `function f<T: type>(x: T): string { return 'generic'; } function f<uint8>(x: uint8): string { return 'uint8'; }
  function f<uint.<const N>>(x: uint.<N>): string { return 'n'; }`;

test('H1 and H2: a group reflects its owner\'s contract; a selected case, its signature with captures bound', () => {
  expect(evaluated(`${RF} String(Reflect.typeOf(f)) + ' | ' + String(Reflect.typeOf(f.<uint8>)) + ' | ' + String(Reflect.typeOf(f.<uint.<12>>));`))
    .toBe('<T: type>(x: T) => string | (x: uint.<8>) => string | (x: uint.<12>) => string');
});

test('H3: a group value reflects one entry per declaration, with its role and generic slots', () => {
  expect(evaluated(`${RF} Reflect.getReflection(f).signatures.map((e) => e.role + '['
    + e.typeParameters.map((t) => String(t.name) + (t.pattern ? '=' + t.pattern : '')).join(',') + ']').join(' ');`))
    .toBe('owner[T] replacement[T=uint8] replacement[T=uint.<const N>]');
  // A type's reflection is unchanged: it still round-trips.
  expect(evaluated('String(Reflect.getReflection(uint8).kind);')).toBe('primitive');
});

test('H3b: a specialization value names the entry it selected, the owner\'s for a fallback', () => {
  expect(evaluated(`${RF} const s = Reflect.getReflection(f.<uint8>); s.selected.role + ':' + s.selected.typeParameters[0].pattern;`)).toBe('replacement:uint8');
  expect(evaluated(`function f<T: type>(x: T): string { return 'generic'; } function f<uint8>(x: uint8): string { return 'u'; }
    Reflect.getReflection(f.<uint16>).selected.role;`)).toBe('owner');
});

test('H3c: a standalone case\'s selector positions take no labels; a mixed case\'s binders do', () => {
  expect(evaluated(`function g<uint8, string>(): string { return 'a'; } function g<float32, bits: uint32>(): string { return 'm'; }
    Reflect.getReflection(g).signatures.map((e) => e.role + '[' + e.typeParameters.map((t) => String(t.name)).join(',') + ']').join(' ');`))
    .toBe('standalone[undefined,undefined] standalone[undefined,bits]');
});

// Step 9 (C24) groundwork: a case forwarding with its own capture.
test('a case forwards an argument over its own capture through the owner (rule 7)', () => {
  // `uint.<N>` over the enclosing case's `N` cannot be represented statically
  // (an open width); it is open, checked against the owner, selected per call.
  expect(evaluated(`class R { read<T: type>(): string; read<uint8>(): string { return 'u8'; }
    read<int.<const N>>(): string { return 'i' + String(N) + '>' + this.read.<uint.<N>>(); }
    read<uint.<const N>>(): string { return 'u' + String(N); } }
    const r = new R(); r.read.<int.<12>>() + '|' + r.read.<int.<8>>();`)).toBe('i12>u12|i8>u8');
});

// Step 9b: a generic class's bare name in its own body (decision B, #sec-generics).
test('P1, P4, P5, P7: the bare name in a type position is the class over its own parameters', () => {
  // P1: `return this` under a bare return type, for a non-default specialization.
  expect(evaluated(`class B<T: type = string> { v: T; constructor(v: T) { this.v = v; } self(): B { return this; } }
    String(Reflect.typeOf(new B.<uint8>((3 := uint8)).self()));`)).toBe('B.<uint.<8>>');
  // P4: with no defaults (an error before).
  expect(evaluated(`class Box<T: type> { v: T; constructor(v: T) { this.v = v; } self(): Box { return this; } }
    String(Reflect.typeOf(new Box.<uint8>((3 := uint8)).self()));`)).toBe('Box.<uint.<8>>');
  // P5: a static member, per specialization.
  expect(evaluated(`class S<T: type = string> { static make(): S { return new S(); } }
    String(Reflect.typeOf(S.<uint8>.make())) + '|' + String(Reflect.typeOf(S.make()));`)).toBe('S.<uint.<8>>|S.<string>');
  // P7: a nested function inside a member.
  expect(evaluated(`class W<T: type = string> { v: T; constructor(v: T) { this.v = v; }
    get(): string { const f = (): W => this; return String(Reflect.typeOf(f())); } }
    new W.<uint8>((1 := uint8)).get();`)).toBe('W.<uint.<8>>');
});

test('P2 and P12: a same-type parameter is this specialization; outside the body, the defaults', () => {
  expectEarlyError(`class N<T: type = string> { v: T; constructor(v: T) { this.v = v; } link(o: N): string { return 'ok'; } }
    new N.<uint8>((1 := uint8)).link(new N.<string>('x'));`, 'StaticTypeError');
  expect(evaluated(`class B<T: type = string> { v: T; constructor(v: T) { this.v = v; } }
    function outside(x: B): string { return String(Reflect.typeOf(x)); } outside(new B('s'));`)).toBe('B.<string>');
});

test('an open family application forwards through the case its family proves (D8)', () => {
  // `uint.<N>` over an enclosing case's capture is some `uint`; an owner-less
  // group's `uint.<const N>` case admits it.
  expect(evaluated(`class P { put<uint.<const N>>(v: uint.<N>): string { return 'u' + String(N); }
    put<int.<const N>>(v: int.<N>): string { return 'i' + String(N) + '>' + this.put.<uint.<N>>((0 := uint.<N>)); } }
    new P().put.<int.<12>>((1 := int.<12>));`)).toBe('i12>u12');
});

// Step 9c: a class's own VALUE parameter as an explicit construction argument.
test('new C.<S>() inside C is C over its own parameter, not the default', () => {
  // A value parameter's name is not a type; the checker dropped it and fell
  // back to the defaults, which B's own-parameter annotation exposed.
  expect(evaluated(`class C<S: uint32 = 7> { plain(): C { const v = new C.<S>(); return v; } }
    String(Reflect.typeOf(new C.<3>().plain()));`)).toBe('C.<3>');
  expectEarlyError('class C<S: uint32 = 7> { plain(): C.<7> { return new C.<S>(); } }', 'StaticTypeError');
});

// Step 9d: a case's captures in scope; widths in canonical form.
test('a conversion to a case capture\'s width types in the case\'s scope', () => {
  // `N` of `f<uint.<const N>>` was in no scope: a pattern-only case pushed none.
  expect(evaluated(`function f<T: type>(v: T): string { return 'g'; }
    function f<uint.<const N>>(v: uint.<N>): string { return 'u' + String(uint.<N>(v)); }
    f.<uint.<8>>((3 := uint8));`)).toBe('u3');
});

test('a value parameter bound to a (typed) number is a plain width: uint.<N> at N = 8 is uint.<8>', () => {
  // Was "uint.<8> is not assignable to uint.<8>": a literal record in the width.
  expect(evaluated('function h<N: uint32>(v: uint.<N>): string { return \'ok\'; } h.<8>((3 := uint8));')).toBe('ok');
});

// Step 9e: open-width conversions.
test('a conversion to an open width checks its range against the bound width', () => {
  // `uint.<N>(v)` ranged over a `uint.<literal 8>` record: nothing fit.
  expect(evaluated(`function g<N: uint32>(v: uint32): string { return String(uint.<N>(v)); }
    g.<8>(3) + '|' + g.<8>(300);`)).toBe('3|44');
});

test('a conversion reading a class parameter, in a method, is open (not closed)', () => {
  // The synthesized conversion node had no parent, so `B` looked closed.
  expect(evaluated(`class P<B: uint32 = 64> { f(v: uint32): string { return String(uint.<B>(v)); }
    g(): uint.<B> { return uint.<B>(1); } }
    new P.<16>().f(3) + '|' + String(new P.<16>().g());`)).toBe('3|1');
});

// Step 9g: a value parameter keeps its declared type in a type-level expression.
test('a computed extent divides as its parameters\' uint32 does, and defaults zero-filled', () => {
  // Was 2.875 ("not a type"): the frame bound the written literal untyped.
  expect(evaluated(`class P<S: uint32 = 16, B: uint32 = 64> { #b: [(S + B / 8 - 1) / (B / 8)].<uint.<B>>;
    n(): string { return String(this.#b.length) + ',' + String(this.#b[0]); } }
    new P().n() + '|' + new P.<1400, 64>().n() + '|' + new P.<16, 32>().n();`)).toBe('2,0|175,0|4,0');
});

test('an extent over an open parameter stays open until specialization', () => {
  // `[S + 1]` was evaluated with `S` open, which read as its name: "S1".
  expect(evaluated(`class P<S: uint32 = 16> { #b: [S + 1].<uint8>; n(): string { return String(this.#b.length); } }
    new P().n() + '|' + new P.<4>().n();`)).toBe('17|5');
});

// Step 9h: a shift's distance is a count, and a case's value binder is typed.
test('a shift takes a distance of any integer type, exactly; the result is the left type', () => {
  expect(evaluated('String((1 := uint64) << (3 := uint32)) + \':\' + String(Reflect.typeOf((1 := uint64) << (3 := uint32)));')).toBe('8:uint.<64>');
  // Forcing 256 into uint8 would shift by 0; the distance as written shifts all out.
  expect(evaluated('const k = (256 := uint32); String((1 := uint8) << k);')).toBe('0');
  expectEarlyError('String((1 := uint8) + (3 := uint16));', 'StaticTypeError');
});

test('a selected case\'s value binder keeps its declared type', () => {
  // `maximum: float32` bound from `.<float32, 4>` was a plain number.
  expect(evaluated(`class A { w<T: type>(v: T): string { return 'g'; }
    w<float32, maximum: float32>(v: float32): string { return String(Reflect.typeOf(maximum)) + ':' + String(v / maximum); } }
    new A().w.<float32, 4>((2 := float32));`)).toBe('float32:0.5');
});
