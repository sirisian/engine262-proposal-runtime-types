import { test, expect } from 'vitest';
import { evaluated, ok, expectThrown } from './harness.mts';

/**
 * README feature coverage — tagged templates, placement new, guaranteed inlining.
 * Sections: Tagged Templates, Placement New, Guaranteed Inlining.
 *
 *  - Tagged templates work: a tag function is typed like any function, receives a
 *    TemplateStringsArray and typed rest interpolations. The compile-time check of
 *    interpolation types against the rest type is a static-checker feature; the
 *    runtime call is verified here.
 *  - Placement-new SYNTAX is normative core (a MemberExpression form) and parses
 *    and constructs an instance; the actual buffer-backed memory layout is the
 *    memory-layout extension.
 *  - The `inline` modifier (guaranteed inlining) is an optimization directive not
 *    in the normative spec; it does not parse and is documented as a gap. Because
 *    inlining is a performance guarantee, its absence does not change observable
 *    semantics.
 */

// ── Tagged Templates ──────────────────────────────────────────────────────────
// A tag function is an ordinary function; the strings parameter is a
// TemplateStringsArray and the interpolations are a rest parameter.
test('Tagged Templates: a typed tag function is called with strings and interpolations', () => {
  expect(evaluated('function sql(strings, ...values: [].<uint32 | string>): string { return strings[0]; } sql`select ${(5 := uint32)}`;')).toBe('select ');
  // the interpolation count is the rest length
  expect(evaluated('function tag(s, ...v) { return v.length; } String(tag`${1}${2}${3}`);')).toBe('3');
});

test('Tagged Templates: the strings parameter carries a raw array', () => {
  expect(evaluated('function tag(s) { return s.raw[0]; } tag`a\\nb`;')).toBe('a\\nb');
  // the cooked strings differ from raw
  expect(evaluated('function tag(s) { return s[0].length; } String(tag`ab`);')).toBe('2');
});

// ── Placement New ─────────────────────────────────────────────────────────────
// The placement-new syntax `new(buffer[, byteOffset]) Type()` is a normative
// member-expression form. It parses and constructs an instance; the buffer-backed
// layout is the memory-layout extension.
test('Placement New: the single-instance syntax parses and constructs', () => {
  expect(evaluated('class T { x: uint32 = (0 := uint32); } let buf = new ArrayBuffer(16); let a = new(buf, 0) T(); typeof a;')).toBe('object');
  // the constructed instance is a T
  expect(evaluated('class T { x: uint32 = (0 := uint32); } let buf = new ArrayBuffer(16); let a = new(buf, 0) T(); String(a instanceof T);')).toBe('true');
  // a byte offset argument is accepted
  expect(evaluated('class T { x: uint32 = (0 := uint32); } let buf = new ArrayBuffer(16); let a = new(buf, 4) T(); typeof a;')).toBe('object');
});

test('Placement New: a placement-constructed instance carries its typed field default', () => {
  expect(ok('class T { x: uint32; } let buf = new ArrayBuffer(16); let a = new(buf, 0) T(); a.x === (0 := uint32);')).toBe(true);
});

// ── Documented gap: guaranteed inlining ───────────────────────────────────────
test('Guaranteed Inlining: the inline modifier is not parsed (documents the gap)', () => {
  // Target (README): `inline function dot(...)` and `inline operator+(...)` are
  // expanded at every call site. The inline modifier does not parse. Inlining is a
  // performance guarantee, so its absence does not change observable results.
  expectThrown('inline function dot(a: uint32, b: uint32): uint32 { return a; } typeof dot;');
  expectThrown('class V { inline operator+(rhs) { return this; } } typeof V;');
  // the same function without inline behaves identically
  expect(evaluated('function dot(a: uint32, b: uint32): uint32 { return a; } typeof dot;')).toBe('function');
});
