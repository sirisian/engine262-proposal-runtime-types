import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

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

test('implicit calls, named applications and the checker still defer (steps 2b, 3, 4)', () => {
  expectThrown(`${P} g(3);`, 'selecting a specialized case is not supported yet');
  expectThrown(`${P} g.<T: uint8>(3);`, 'is not supported yet');
  expectThrown(`function f<T: type>(x: T): string { return 'generic'; }
    function f<uint8>(x: uint8): string { return 'uint8'; } f.<uint8>(3);`, 'selecting a specialized case of `f` is not supported yet');
});
