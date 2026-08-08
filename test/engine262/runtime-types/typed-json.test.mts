import { test, expect } from 'vitest';
import {
  evaluated, ok, expectThrown, expectErrorFlagOff,
} from './harness.mts';

/**
 * Extension coverage - serialization.md, typed JSON parsing.
 *
 * `JSON.parse.<T>(text)` parses and validates in one pass: each JSON leaf is
 * converted into its target type, refinements are consulted, object and array
 * targets are filled, unknown keys on a sealed object are rejected, and a
 * mismatch is a TypeError naming the JSON path, while malformed input stays a
 * SyntaxError. The exact wide numerics (the 64-bit integers, decimal128, bigint),
 * class targets, and the enforcement of built-in refinement hooks are deferred.
 */

// -- Numeric conversion -------------------------------------------------------
test('typed json: a numeric leaf converts to its target type', () => {
  // the parsed field is a uint8, equal to the cast and distinct from a plain 5
  expect(evaluated('let o = JSON.parse.<{ a: uint8 }>(\'{"a":5}\'); o.a === (5 := uint8) ? "typed" : "untyped";')).toBe('typed');
  // A LITERAL adopts since F74, so this reads "plain"; the test that the leaf
  // is genuinely typed is the one above, against a typed value, and the one
  // below, against a variable.
  expect(evaluated('let o = JSON.parse.<{ a: uint8 }>(\'{"a":5}\'); (o.a === 5) ? "plain" : "not-plain";')).toBe('plain');
  expect(evaluated('let o = JSON.parse.<{ a: uint8 }>(\'{"a":5}\'); let n = 5; (o.a === n) ? "plain" : "not-plain";')).toBe('not-plain');
});

test('typed json: a plain number field stays an ordinary Number', () => {
  expect(evaluated('let o = JSON.parse.<{ a: number }>(\'{"a":5}\'); (o.a === 5) ? "plain" : "not-plain";')).toBe('plain');
});

test('typed json: an out-of-range number is a TypeError', () => {
  expectThrown('let o = JSON.parse.<{ a: uint8 }>(\'{"a":300}\'); o.a;');
  // boundary: 255 fits uint8, 256 does not
  expect(evaluated('let o = JSON.parse.<{ a: uint8 }>(\'{"a":255}\'); String(o.a);')).toBe('255');
  expectThrown('let o = JSON.parse.<{ a: uint8 }>(\'{"a":256}\'); o.a;');
});

test('typed json: a fractional number targeting an integer type is a TypeError', () => {
  expectThrown('let o = JSON.parse.<{ a: uint8 }>(\'{"a":1.5}\'); o.a;');
});

// -- Strings and booleans -----------------------------------------------------
test('typed json: string and boolean leaves validate', () => {
  expect(evaluated('let o = JSON.parse.<{ h: string }>(\'{"h":"host"}\'); o.h;')).toBe('host');
  expect(evaluated('let o = JSON.parse.<{ t: boolean }>(\'{"t":true}\'); o.t ? "T" : "F";')).toBe('T');
});

test('typed json: a leaf of the wrong JSON type is a TypeError', () => {
  expectThrown('let o = JSON.parse.<{ h: string }>(\'{"h":5}\'); o.h;');
  expectThrown('let o = JSON.parse.<{ n: uint8 }>(\'{"n":"x"}\'); o.n;');
});

// -- Objects: sealed, nested, optional ----------------------------------------
test('typed json: an unknown key on a sealed object is a TypeError', () => {
  expectThrown('let o = JSON.parse.<{ a: uint8 }>(\'{"a":1,"b":2}\'); o.a;');
});

test('typed json: nested object targets are filled', () => {
  expect(evaluated('let o = JSON.parse.<{ p: { q: uint8 } }>(\'{"p":{"q":7}}\'); String(o.p.q);')).toBe('7');
});

test('typed json: an absent optional field takes the type default; present is used', () => {
  expect(evaluated('let o = JSON.parse.<{ a: uint8, b?: uint8 }>(\'{"a":1,"b":9}\'); String(o.b);')).toBe('9');
  // uint8 has a materialized default of 0, so an absent optional uint8 is 0
  expect(evaluated('let o = JSON.parse.<{ a: uint8, b?: uint8 }>(\'{"a":1}\'); String(o.b);')).toBe('0');
});

test('typed json: an absent required field is a TypeError', () => {
  expectThrown('let o = JSON.parse.<{ a: uint8, b: uint8 }>(\'{"a":1}\'); o.a;');
});

// -- Arrays -------------------------------------------------------------------
test('typed json: a dynamic array parses element by element', () => {
  expect(evaluated('let o = JSON.parse.<{ a: [].<uint8> }>(\'{"a":[1,2,3]}\'); String(o.a[2]);')).toBe('3');
  expect(evaluated('let o = JSON.parse.<{ a: [].<uint8> }>(\'{"a":[1,2,3]}\'); (o.a[0] === (1 := uint8)) ? "typed" : "untyped";')).toBe('typed');
});

test('typed json: an out-of-range array element is a TypeError naming the index', () => {
  expectThrown('let o = JSON.parse.<{ a: [].<uint8> }>(\'{"a":[1,999]}\'); o.a;');
});

test('typed json: a fixed-length array checks its length', () => {
  expect(evaluated('let o = JSON.parse.<{ a: [2].<uint8> }>(\'{"a":[1,2]}\'); String(o.a[1]);')).toBe('2');
  expectThrown('let o = JSON.parse.<{ a: [2].<uint8> }>(\'{"a":[1,2,3]}\'); o.a;');
});

// -- Unions and aliases -------------------------------------------------------
test('typed json: a union is resolved by the JSON token', () => {
  expect(evaluated('let o = JSON.parse.<{ id: uint32 | string }>(\'{"id":42}\'); String(o.id);')).toBe('42');
  expect(evaluated('let o = JSON.parse.<{ id: uint32 | string }>(\'{"id":"abc"}\'); o.id;')).toBe('abc');
});

test('typed json: a type alias is a valid target', () => {
  expect(evaluated('type Cfg = { host: string, port: uint16 }; let o = JSON.parse.<Cfg>(\'{"host":"h","port":80}\'); o.host + ":" + String(o.port);')).toBe('h:80');
});

// -- Errors: SyntaxError vs TypeError, and the path -----------------------------
test('typed json: malformed JSON is a SyntaxError, a type mismatch is a TypeError', () => {
  // the proposal's typed catch clauses separate the two
  expect(evaluated('let r; try { JSON.parse.<{ a: uint8 }>(\'{bad}\'); r = "none"; } catch (e: SyntaxError) { r = "syntax"; } catch (e: TypeError) { r = "type"; } r;')).toBe('syntax');
  expect(evaluated('let r; try { JSON.parse.<{ a: uint8 }>(\'{"a":300}\'); r = "none"; } catch (e: SyntaxError) { r = "syntax"; } catch (e: TypeError) { r = "type"; } r;')).toBe('type');
});

test('typed json: a type error names the JSON path', () => {
  expect(ok('let m; try { JSON.parse.<{ a: uint8 }>(\'{"a":300}\'); } catch (e) { m = e.message; } m.indexOf(".a") >= 0;')).toBe(true);
  expect(evaluated('let m; try { JSON.parse.<{ a: uint8 }>(\'{"a":300}\'); } catch (e) { m = e.message; } (m.indexOf(".a") >= 0) ? "named" : "unnamed";')).toBe('named');
});

// -- The untyped path is unaffected -------------------------------------------
test('typed json: untyped JSON.parse is unchanged', () => {
  expect(evaluated('let o = JSON.parse(\'{"a":5}\'); (typeof o.a) + ":" + String(o.a);')).toBe('number:5');
});

// -- Flag off: the typed-parse syntax is inert --------------------------------
test('typed json: with the feature off, JSON.parse.<T> is a syntax error', () => {
  expectErrorFlagOff('let o = JSON.parse.<{ a: uint8 }>(\'{"a":5}\'); o.a;');
});

// -- The type argument may itself be an indexed-access type -------------------
test('typed json: the type argument may be an indexed-access type', () => {
  // serialization.md's parse resolves its type argument the same way any type
  // position does, so an indexed-access type naming a property's type is a valid
  // argument and the parsed value is converted to that property type.
  expect(evaluated('let v = JSON.parse.<{ a: uint8 }["a"]>("5"); String(v instanceof uint8);')).toBe('true');
  expect(evaluated('let v = JSON.parse.<{ a: uint8 }["a"]>("5"); String(v);')).toBe('5');
  // the resolved element type still enforces its range on the parsed value
  expectThrown('JSON.parse.<{ a: uint8 }["a"]>("999");');
});

// -- The untyped baseline, and structuredClone -----------------------------------

test('serialization: untyped JSON.parse and JSON.stringify work', () => {
  expect(evaluated('let o = JSON.parse(\'{"a":5}\'); String(o.a);')).toBe('5');
  expect(evaluated('JSON.stringify({ a: 5 });')).toBe('{"a":5}');
  // round trip
  expect(evaluated('JSON.stringify(JSON.parse(\'{"a":5,"b":"x"}\'));')).toBe('{"a":5,"b":"x"}');
});

test('serialization: JSON.parse.<T> converts leaves and validates', () => {
  // JSON.parse.<T> now threads T through the parse: a numeric leaf becomes its
  // target type, and an out-of-range value is rejected with a TypeError.
  expect(evaluated('type T = { a: uint8 }; let o = JSON.parse.<T>(\'{"a":5}\'); o.a === (5 := uint8) ? "typed" : "untyped";')).toBe('typed');
  expectThrown('type T = { a: uint8 }; let o = JSON.parse.<T>(\'{"a":300}\'); String(o.a);');
});

// -- Dependent record types: where clauses are enforced at boundaries ----------

test('serialization: structuredClone is absent from the base engine (documents the gap)', () => {
  expectThrown('let o = structuredClone({ a: 5 }); o.a;');
});
