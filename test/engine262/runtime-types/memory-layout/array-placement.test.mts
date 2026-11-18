import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * Spec: #sec-type-arguments-and-placement-new-in-expression-position, the array form of placement
 * `new`: `new(buffer, byteOffset, byteElementLength) [N].<T>()` puts an array of a fixed extent on a
 * buffer, as `new(buffer, byteOffset) T()` puts one instance there. The README writes it so, and it
 * failed three ways: the bracket after `new (...)` continued the parenthesized expression, as
 * JavaScript reads `new (a)[0]()`, so the form constructed `(buffer, byteOffset)[10]`; an array type
 * had no placement; and a fixed-array field of a placed instance, an element of a window over fixed
 * arrays and a value class over an array could not be read or written on a buffer at all.
 *
 * A placed array is an array of its type whose elements are the buffer's bytes, at the byte offset
 * plus the index times the stride. The construction stores the elements it makes there, and bytes
 * between elements keep the buffer's contents.
 */
const B = 'const buffer = new ArrayBuffer(32); ';

test('an array of a fixed extent is placed on a buffer', () => {
  expect(evaluated(`${B}const a = new(buffer, 4) [4].<uint8>(); a[1] = 7;
    String(new Uint8Array(buffer)[5]) + "," + String(a.length) + "," + String(Array.isArray(a)) + "," + String(Reflect.typeOf(a));`))
    .toBe('7,4,true,[4].<uint.<8>>');
  // Read back through a second view of the bytes, and the other way.
  expect(evaluated(`${B}const a = new(buffer, 0) [4].<uint16>(); new Uint16Array(buffer)[2] = 513; String(a[2]);`)).toBe('513');
  // Placed at offset 0 by default.
  expect(evaluated(`${B}const a = new(buffer) [2].<uint8>(); a[0] = 3; String(new Uint8Array(buffer)[0]);`)).toBe('3');
  // It is the array a construction makes, in every other respect.
  expect(evaluated(`${B}const f = new [2].<uint8>(); const p = new(buffer) [2].<uint8>([1, 2]);
    String(Object.isExtensible(f) === Object.isExtensible(p)) + "," + String(p == new [2].<uint8>([1, 2])) + "," + JSON.stringify(p);`)).toBe('true,true,[1,2]');
});

test('the construction stores its elements, and the bytes between them keep their contents', () => {
  expect(evaluated(`${B}new Uint8Array(buffer).fill(255); new(buffer, 1) [2].<uint8>();
    Array.from(new Uint8Array(buffer).slice(0, 4)).join(",");`)).toBe('255,0,0,255');
  // A source of elements, as the array type's constructor takes one.
  expect(evaluated(`${B}const a = new(buffer, 2) [3].<uint8>([1, 2, 3]); Array.from(new Uint8Array(buffer).slice(2, 5)).join(",");`)).toBe('1,2,3');
  // A stride larger than the element leaves padding, which keeps the buffer's bytes.
  expect(evaluated(`${B}new Uint8Array(buffer).fill(255); const a = new(buffer, 0, 4) [4].<uint8>(); a[1] = 7;
    Array.from(new Uint8Array(buffer).slice(0, 8)).join(",");`)).toBe('0,255,255,255,7,255,255,255');
});

test('class elements are instances on the buffer', () => {
  const V = 'value class Vec2 { x: float32 = 0; y: float32 = 0; } ';
  expect(evaluated(`${B}${V}const a = new(buffer, 0) [4].<Vec2>(); a[1].x = 2.5; String(new Float32Array(buffer)[2]) + "," + String(a[1] instanceof Vec2);`))
    .toBe('2.5,true');
  // A whole element is stored field by field.
  expect(evaluated(`${B}${V}const a = new(buffer, 0) [2].<Vec2>(); a[1] = { x: 1, y: 2 } := Vec2; String(new Float32Array(buffer)[3]);`)).toBe('2');
  // A `ref` binding aliases an element and a plain one copies it, as for any array.
  expect(evaluated(`${B}${V}const a = new(buffer) [2].<Vec2>(); const ref e = a[1]; e.y = 3; String(new Float32Array(buffer)[3]);`)).toBe('3');
  expect(evaluated(`${B}${V}const a = new(buffer) [2].<Vec2>(); const e = a[1]; e.y = 3; String(new Float32Array(buffer)[3]);`)).toBe('0');
  // An element that holds an array, and an array of arrays, are arrays over their bytes too.
  expect(evaluated(`${B}value class G { data: [2].<uint8>; } const a = new(buffer) [2].<G>(); a[1].data[1] = 5; String(new Uint8Array(buffer)[3]);`)).toBe('5');
  expect(evaluated(`${B}const a = new(buffer) [2].<[2].<uint8>>(); a[1][0] = 4; String(new Uint8Array(buffer)[2]) + "," + String(Reflect.typeOf(a[1]));`))
    .toBe('4,[2].<uint.<8>>');
  // A 64-bit element is read back at its type.
  expect(evaluated(`${B}const a = new(buffer, 8) [2].<uint64>(); a[1] = 5; String(a[1]) + "," + String(new BigUint64Array(buffer)[2]);`)).toBe('5,5');
});

test('the extent, the element type and the buffer are checked before anything is constructed', () => {
  expectThrown('const a = new(new ArrayBuffer(4), 2) [4].<uint8>();', 'the placement extent exceeds the buffer');
  expectThrown('const a = new(new ArrayBuffer(16), 0, 8) [3].<uint8>();', 'the placement extent exceeds the buffer');
  expectThrown('const a = new({}, 0) [4].<uint8>();', 'the first placement argument must be an ArrayBuffer');
  expectThrown('const a = new(new ArrayBuffer(16)) [2].<string>();', 'a placement allocation needs a type with a layout');
  expectThrown('const b = new ArrayBuffer(16); b.transfer(); const a = new(b) [2].<uint8>();', 'detached');
});

test('a placed array is live while its buffer covers it', () => {
  expect(evaluated(`const buffer = new ArrayBuffer(8, { maxByteLength: 16 }); const a = new(buffer, 4) [4].<uint8>();
    buffer.resize(6); let r = ""; try { a[0]; } catch (e) { r = e.constructor.name; }
    buffer.resize(8); a[0] = 1; r + "," + String(a[0]);`)).toBe('TypeError,1');
  // An array field keeps the liveness of the instance it is in.
  expect(evaluated(`${B}value class G { data: [2].<uint8>; } const g = new(buffer) G(); const ref d = g.data; buffer.transfer();
    let r = ""; try { d[0]; } catch (e) { r = e.message; } r;`)).toBe('this instance is placed on a detached buffer');
});

test('a binding copies a placed array as it copies any fixed array, and a new does not', () => {
  expect(evaluated(`${B}const a = new(buffer, 0) [2].<uint8>(); const c = a; c[0] = 5; String(new Uint8Array(buffer)[0]) + String(c[0]);`)).toBe('05');
});

test('a fixed-array field of a placed instance is its bytes', () => {
  const G = 'value class G { data: [4].<uint8>; n: uint8 = 0; } ';
  expect(evaluated(`${B}${G}const g = new(buffer, 0) G(); g.data[2] = 9; String(new Uint8Array(buffer)[2]) + "," + String(Reflect.typeOf(g.data));`))
    .toBe('9,[4].<uint.<8>>');
  expect(evaluated(`${B}${G}const g = new(buffer, 0) G(); g.data = [1, 2, 3, 4]; g.n = 5; Array.from(new Uint8Array(buffer).slice(0, 5)).join(",");`))
    .toBe('1,2,3,4,5');
  // Construction initializes the field there, as it does any other.
  expect(evaluated(`${B}new Uint8Array(buffer).fill(255); value class H { data: [2].<uint8> = [7, 8]; } new(buffer, 0) H();
    Array.from(new Uint8Array(buffer).slice(0, 3)).join(",");`)).toBe('7,8,255');
  // `@endian` on the field fixes the byte order of each element, as it does a scalar field's.
  expect(evaluated(`${B}value class P { @endian('big') ports: [2].<uint16>; } const p = new(buffer) P(); p.ports[1] = 258;
    Array.from(new Uint8Array(buffer).slice(0, 4)).join(",") + "," + String(p.ports[1]);`)).toBe('0,0,1,2,258');
});

test('an element of a window over fixed arrays is an array over its bytes', () => {
  expect(evaluated(`${B}const s = Span.<[4].<uint8>>(buffer); new Uint8Array(buffer)[5] = 3; String(s[1][1]) + "," + String(s.length);`)).toBe('3,8');
  expect(evaluated(`${B}const s = Span.<[4].<uint8>>(buffer); const ref row = s[2]; row[3] = 6; String(new Uint8Array(buffer)[11]);`)).toBe('6');
  expect(evaluated(`${B}const s = Span.<[2].<uint8>>(buffer); s[1] = [4, 5]; Array.from(new Uint8Array(buffer).slice(2, 4)).join(",");`)).toBe('4,5');
});

test('a value class over an array is placed as its base is', () => {
  const Q = 'value class Q extends [4].<float32> { get second(): float32 { return this[1]; } } ';
  expect(evaluated(`${B}${Q}const q = new(buffer, 0) Q(); q[1] = 2; String(new Float32Array(buffer)[1]) + "," + String(q.second) + "," + String(q instanceof Q);`))
    .toBe('2,2,true');
  expect(evaluated(`${B}${Q}const q = new(buffer, 0) Q(); String(Object.isExtensible(q) === Object.isExtensible(new Q())) + "," + String(Reflect.typeOf(q) === Q);`))
    .toBe('true,true');
});

test('a bracket after new (...) keeps its JavaScript meaning unless an array type follows', () => {
  expect(evaluated('class K { v = 3; } const a = [K]; String(new (a)[0]().v);')).toBe('3');
  expect(evaluated('class K { v = 3; } const a = [K]; const i = 0; String(new (a)[i]().v) + String((new (a)[0]).v);')).toBe('33');
  // A generic class held in an array is constructed with the element inside the parentheses; the
  // other spelling is the array form now, and its error says so.
  expect(evaluated('class G<T: type> { v: T | null = null; } const a = [G]; String(new (a[0]).<uint8>() instanceof G);')).toBe('true');
  expectThrown('class G<T: type> { v: T | null = null; } const a = [G]; new (a)[0].<uint8>();', '`new (a[i]).<T>()` constructs what `a[i]` holds');
});

test('an owned fixed array whose bytes were asked for is still an array of its type', () => {
  // `.buffer` gives an owned `[N].<T>` bytes, and it reported `Span.<uint.<8>>` from then on.
  expect(evaluated('const a = new [4].<uint8>(); a.buffer; String(Reflect.typeOf(a)) + "," + String(Array.isArray(a));')).toBe('[4].<uint.<8>>,true');
});
