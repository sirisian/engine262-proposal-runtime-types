import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * `String.fromUtf8`, `String.prototype.toUtf8`, `String.prototype.utf8Length`.
 *
 * A `string` has no layout - its size is a property of the value rather than of
 * the type (#sec-layout-properties) - so a string reaching a fixed-width record
 * or a wire format reaches it as bytes. These are the two conversions.
 *
 * Three rules govern them, and each is asserted below rather than assumed:
 *
 *   - the encoding is UTF-8 and the count is in BYTES, because a layout needs a
 *     byte count;
 *   - nothing TRUNCATES, which is #sec-literal-propagation's rule for a value a
 *     type cannot represent and is what keeps a fixed-width string away from
 *     `strncpy` and `CHAR(n)`;
 *   - only WELL-FORMED text encodes, an unpaired surrogate having no UTF-8
 *     encoding at all.
 */

test('`utf8Length` counts bytes, and `length` still counts code units', () => {
  expect(evaluated("String('hello'.utf8Length);")).toBe('5');
  expect(evaluated("String('\\u00e9'.utf8Length);")).toBe('2');
  expect(evaluated("String('\\u65e5'.utf8Length);")).toBe('3');
  expect(evaluated("String('\\u{1F600}'.utf8Length);")).toBe('4');
  // The pair that shows why a second count is needed at all: one astral code
  // point is two code units and four bytes, and a slot is sized in bytes.
  expect(evaluated("String('\\u{1F600}'.length) + '/' + String('\\u{1F600}'.utf8Length);")).toBe('2/4');
  expect(evaluated("String(''.utf8Length);")).toBe('0');
});

test('an unpaired surrogate has no UTF-8 encoding, and says so', () => {
  // A JavaScript string may hold one; UTF-8 has no sequence for it. Refused
  // rather than encoded as WTF-8 or replaced with U+FFFD, either of which would
  // let a value that cannot round-trip look as though it had.
  expectThrown("'\\uD800'.utf8Length;", 'unpaired surrogate');
  expectThrown("const b: [8].<uint8> = [0,0,0,0,0,0,0,0]; '\\uD800'.toUtf8(b);", 'unpaired surrogate');
  // `isWellFormed` is the question to ask first and `toWellFormed` is the
  // program's explicit escape - the same pair `hasLayout` and `byteLength` draw,
  // where the property that ANSWERS guards the property that ASSERTS.
  expect(evaluated("String('\\uD800'.isWellFormed());")).toBe('false');
  expect(evaluated("String('\\uD800'.toWellFormed().utf8Length);")).toBe('3');
});

test('the two conversions round-trip', () => {
  expect(evaluated(
    "const b: [4].<uint8> = [0,0,0,0]; const n = 'hi'.toUtf8(b);"
    + ' String.fromUtf8(b).slice(0, Number(n));',
  )).toBe('hi');
  // Every width, including the four-byte one a surrogate pair encodes to as ONE
  // sequence rather than two three-byte ones, which would be CESU-8.
  expect(evaluated(
    "const b: [8].<uint8> = [0,0,0,0,0,0,0,0]; '\\u{1F600}'.toUtf8(b);"
    + " String(String.fromUtf8(b).slice(0, 2) === '\\u{1F600}');",
  )).toBe('true');
  expect(evaluated("String(String.fromUtf8([]).length);")).toBe('0');
});

test('`toUtf8` returns the byte count, and writes through the target', () => {
  expect(evaluated("const b: [8].<uint8> = [0,0,0,0,0,0,0,0]; String(Number('hello'.toUtf8(b)));")).toBe('5');
  expect(evaluated("const b: [8].<uint8> = [0,0,0,0,0,0,0,0]; 'hi'.toUtf8(b);"
    + ' String(Number(b[0])) + "/" + String(Number(b[1]));')).toBe('104/105');
  // The count agrees with `utf8Length`, which is what lets a program ask whether
  // a value fits before it writes.
  expect(evaluated("const b: [8].<uint8> = [0,0,0,0,0,0,0,0];"
    + " String(Number('\\u65e5'.toUtf8(b)) === Number('\\u65e5'.utf8Length));")).toBe('true');
});

test('a value that does not fit is REFUSED, and nothing is written', () => {
  // #sec-literal-propagation: "a type error rather than a silent truncation".
  expectThrown("const b: [2].<uint8> = [0,0]; 'hello'.toUtf8(b);", 'do not fit');
  // The half that matters more than the throw: a partial write would leave a
  // record holding the front of one value and the back of another, which is
  // worse than either.
  expect(evaluated("const b: [2].<uint8> = [0,0]; try { 'hello'.toUtf8(b); } catch (e) {}"
    + ' String(Number(b[0])) + "/" + String(Number(b[1]));')).toBe('0/0');
  // A target with no room at all is the same refusal, not a silent no-op.
  expectThrown("const b: [0].<uint8> = []; 'x'.toUtf8(b);", 'do not fit');
});

test('`fromUtf8` is STRICT about what it decodes', () => {
  // Each refusal names its reason, because a decoder that accepted any of these
  // would let one code point have several spellings - which is a security bug
  // wherever a filter runs before a decoder.
  expectThrown('String.fromUtf8([0xC0, 0x80]);', 'overlong');      // U+0000 the long way
  expectThrown('String.fromUtf8([0xE0, 0x80, 0x80]);', 'overlong');
  expectThrown('String.fromUtf8([0xE6, 0x97]);', 'truncated');     // a 3-byte lead, 2 bytes given
  expectThrown('String.fromUtf8([0xED, 0xA0, 0x80]);', 'surrogate'); // CESU-8, a lone surrogate
  expectThrown('String.fromUtf8([0xFF]);', 'lead');
  expectThrown('String.fromUtf8([0x80]);', 'lead');                // a continuation with no lead
  expectThrown('String.fromUtf8([0xE6, 0x97, 0x41]);', 'continuation');
  // Not a byte at all.
  expectThrown('String.fromUtf8([300]);', 'is not a byte');
  expectThrown('String.fromUtf8([-1]);', 'is not a byte');
});

test('a zero byte decodes to U+0000, and padding is not this operation\'s business', () => {
  // #sec-layout-properties draws the line: trimming a zero-padded slot is a
  // property of a FORMAT, so it belongs to whatever overlays the bytes. The
  // codec decodes what it is given, which is what lets one codec serve a
  // zero-padded record, a length-prefixed wire format, and a tag with no padding
  // convention at all.
  expect(evaluated('String(String.fromUtf8([0x61, 0x00, 0x62]).length);')).toBe('3');
  expect(evaluated('String(String.fromUtf8([0x61, 0x00, 0x62]).charCodeAt(1));')).toBe('0');
});

test('the target may be any array-like of bytes', () => {
  // A `[N].<uint8>`, a `[].<uint8>` and an ordinary array all reach it, which is
  // what lets the same operation serve an owned slot and a view over a buffer.
  expect(evaluated("const b: [].<uint8> = [0,0,0,0]; String(Number('hi'.toUtf8(b)));")).toBe('2');
  expect(evaluated("const b = [0,0,0,0]; String(Number('hi'.toUtf8(b)));")).toBe('2');
  expect(evaluated('String(String.fromUtf8([104, 105]));')).toBe('hi');
});
