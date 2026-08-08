import { test, expect } from 'vitest';
import { evaluated, expectThrown, expectThrownFlagOff } from '../harness.mts';

/**
 * An array type written where an EXPRESSION is expected (spec
 * sec-array-and-tuple-types).
 *
 * `new [100].<uint8>()` constructs one and `class G extends [16].<uint8> { }`
 * derives from one - both forms the design writes (README "Multidimensional and
 * Jagged Array Support Via User-defined Index Operators", and the view form
 * beside it). The bracketed text is an array LITERAL where an expression is
 * expected, so before this the type arguments were evaluated and discarded and
 * both forms reported "[object Array] is not a constructor".
 *
 * An instance is an Array carrying its element type, which is what a typed
 * array is everywhere else here: the element store check, `length`, and the
 * methods of Array.prototype all apply to one without a second kind of object.
 */

test('an array type constructs', () => {
  // a fixed extent has that many elements, each the element type's default
  expect(evaluated('const a = new [4].<uint8>(); String(a.length);')).toBe('4');
  expect(evaluated('const a = new [4].<uint8>(); String(a[0]);')).toBe('0');
  expect(evaluated('const a = new [100].<uint8>(); String(a.length);')).toBe('100');
  // a dynamic one starts empty and grows
  expect(evaluated('const a = new [].<uint8>(); a.push(1); a.push(2); String(a.length);')).toBe('2');
  expect(evaluated('const a = new [].<uint8>(); String(a.length);')).toBe('0');
});

test('an instance carries its element type', () => {
  expect(evaluated('const a = new [4].<uint8>(); a[0] = 200; String(a[0]);')).toBe('200');
  // the store check reads the element type off the array
  expectThrown('const a = new [4].<uint8>(); a[0] = 300;');
  expect(evaluated('const a = new [4].<uint8>(); String(Array.isArray(a));')).toBe('true');
});

test('a class may derive from an array type', () => {
  expect(evaluated('class C extends [4].<uint8> {} const c = new C(); String(c.length);')).toBe('4');
  expect(evaluated('class C extends [4].<uint8> {} const c = new C();'
    + ' String(Array.isArray(c)) + "," + String(c instanceof C);')).toBe('true,true');
  // the subclass's own methods are reachable
  expect(evaluated('class C extends [4].<uint8> { first() { return this[0]; } }'
    + ' const c = new C(); c[0] = 7; String(c.first());')).toBe('7');
  // and so are the inherited array methods
  expect(evaluated('class C extends [4].<uint8> {} const c = new C(); c[0] = 3;'
    + ' String(c.map((v) => Number(v) * 2)[0]);')).toBe('6');
  // an element store through the subclass is checked the same way
  expectThrown('class C extends [4].<uint8> {} const c = new C(); c[0] = 300;');
  // a dynamic extent derives too
  expect(evaluated('class C extends [].<uint8> {} const c = new C(); c.push(1); String(c.length);')).toBe('1');
});

test('an array type denotes one constructor', () => {
  // the types are interned, and the constructor is the type's
  expect(evaluated('String(([4].<uint8>) === ([4].<uint8>));')).toBe('true');
  expect(evaluated('String(([4].<uint8>) === ([8].<uint8>));')).toBe('false');
  expect(evaluated('String(([4].<uint8>) === ([4].<uint16>));')).toBe('false');
});

test('an array type constructor requires new', () => {
  expectThrown('([4].<uint8>)();');
});

test('the annotation form is unaffected', () => {
  expect(evaluated('const a: [4].<uint8> = [1, 2, 3, 4]; String(a.length);')).toBe('4');
  expect(evaluated('const a: [].<uint8> = [1]; a.push(2); String(a.length);')).toBe('2');
});

test('an ordinary array literal is untouched', () => {
  expect(evaluated('const a = [4]; String(a.length) + "," + String(a[0]);')).toBe('1,4');
  expect(evaluated('const a = []; a.push(1); String(a.length);')).toBe('1');
});

test('the design\'s grid shape composes with the index accessor forms', () => {
  // an array-typed base, a two-index accessor, and a `ref` read direction
  // serving the write - the design's GridArray without its generic parameters
  expect(evaluated('class G extends [16].<uint8> {'
    + ' get operator[](x: uint32, y: uint32) { return ref this[y * 4 + x]; } }'
    + ' const g = new G(); g[2, 1] = 10; String(g[2, 1]);')).toBe('10');
  expect(evaluated('class G extends [16].<uint8> {'
    + ' get operator[](x: uint32, y: uint32) { return ref this[y * 4 + x]; } }'
    + ' const g = new G(); g[2, 1] = 10; String(g[6]);')).toBe('10');
});

test('an array type in expression position is inert with the feature off', () => {
  expectThrownFlagOff('new [4].<uint8>();');
});
