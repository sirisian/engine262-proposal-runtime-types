import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * A hierarchy of value type classes gives each concrete class its OWN array, at
 * its own stride. This is what a pool wants: `[N].<A>` and `[N].<B>` are two
 * separate contiguous runs, neither of which needs a slice, because each is
 * typed at a class whose width is known.
 *
 * None of this was observable until `[N].<B>` stopped aborting the engine - see
 * `classes/subclass-value-defaults.test.mts` for that defect. These pin the
 * layout the fix makes reachable, so a later change to slicing, assignability or
 * the default rule cannot quietly move it.
 */

const AB = 'class A { x: uint32 = 0; } class B extends A { y: uint32 = 0; } ';
const ABC = `${AB}class C extends B { z: uint32 = 0; } `;

test('each class in the hierarchy reports its own width', () => {
  expect(evaluated(`${ABC}A.byteLength + '/' + B.byteLength + '/' + C.byteLength;`)).toBe('4/8/12');
  expect(evaluated(`${ABC}A.isPlainData + '/' + B.isPlainData + '/' + C.isPlainData;`)).toBe('true/true/true');
  expect(evaluated(`${ABC}A.alignment + '/' + B.alignment + '/' + C.alignment;`)).toBe('4/4/4');
});

test('an owned array is N times its element width', () => {
  // The stride, read directly off the array's own type.
  expect(evaluated(`${ABC}const p: [4].<A>; String(Reflect.typeOf(p).byteLength);`)).toBe('16');
  expect(evaluated(`${ABC}const p: [4].<B>; String(Reflect.typeOf(p).byteLength);`)).toBe('32');
  expect(evaluated(`${ABC}const p: [4].<C>; String(Reflect.typeOf(p).byteLength);`)).toBe('48');
});

test('a window over the same bytes counts elements at each stride', () => {
  // 48 bytes is 12 A's, 6 B's or 4 C's. The independent confirmation that the
  // widths above are what storage actually uses, not just what is reported.
  expect(evaluated(`${ABC}String(Span.<A>(new ArrayBuffer(48)).length);`)).toBe('12');
  expect(evaluated(`${ABC}String(Span.<B>(new ArrayBuffer(48)).length);`)).toBe('6');
  expect(evaluated(`${ABC}String(Span.<C>(new ArrayBuffer(48)).length);`)).toBe('4');
});

test('both fields of a subclass element read and write', () => {
  expect(evaluated(`${AB}const p: [4].<B>; p[0].x = 7; p[0].y = 9;
    String(p[0].x) + '/' + String(p[0].y);`)).toBe('7/9');
  expect(evaluated(`${ABC}const p: [2].<C>; p[1].x = 1; p[1].y = 2; p[1].z = 3;
    String(p[1].x) + '/' + String(p[1].y) + '/' + String(p[1].z);`)).toBe('1/2/3');
});

test('elements are independent of each other and of the base pool', () => {
  expect(evaluated(`${AB}const p: [3].<B>; p[0].y = 1; p[2].y = 3;
    String(p[0].y) + '/' + String(p[1].y) + '/' + String(p[2].y);`)).toBe('1/0/3');
  expect(evaluated(`${AB}const pa: [2].<A>; const pb: [2].<B>; pa[0].x = 1; pb[0].x = 2;
    String(pa[0].x) + '/' + String(pb[0].x);`)).toBe('1/2');
});

test('an element of a subclass array is that subclass', () => {
  // Not sliced to the base: the array is typed at `B`, so its elements are B's.
  expect(evaluated(`${AB}const p: [2].<B>;
    String(p[0] instanceof B) + '/' + String(p[0] instanceof A);`)).toBe('true/true');
  expect(evaluated(`${AB}const p: [2].<B>; String(Reflect.typeOf(p[0]) === B);`)).toBe('true');
});

test('a window over a subclass array element writes through', () => {
  expect(evaluated(`${AB}const s = Span.<B>(new ArrayBuffer(24));
    const ref e = s[1]; e.x = 5; String(s[1].x);`)).toBe('5');
});
