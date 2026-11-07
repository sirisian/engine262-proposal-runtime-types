import { test, expect } from 'vitest';
import { evaluated, expectStaticTypeError, ok } from '../harness.mts';

// #sec-type-annotations: an annotation on a pattern annotates the value being
// destructured, and each name's type follows from the annotated type's
// members: a tuple's declared positions, an array's element type, nested
// patterns included. Each name is checked where it is bound, so a replaced
// iterator is refused there.

test('a tuple annotation types each position\'s name', () => {
  expectStaticTypeError('const [y]: [uint8] = [(1 := uint8)]; const s: string = y;');
  expectStaticTypeError('const t: [uint8] = [(1 := uint8)]; const [y]: [uint8] = t; const s: string = y;');
});

test('a pattern nested at a tuple position takes that position\'s members', () => {
  expectStaticTypeError('class P { start: uint8 = 1; } const p = new P(); const [{ start: x }]: [P] = [p]; const s: string = x;');
});

test('a name taken from a replaced member is checked against the member\'s type', () => {
  expect(evaluated(`const r: ClosedRange.<uint8> = 1..=2; Object.defineProperty(r, "start", { get() { return "wrong"; } });
    let refused = false; try { const [{ start: x }]: [ClosedRange.<uint8>] = [r]; String(x); } catch (e) { refused = e instanceof TypeError; }
    String(refused);`)).toBe('true');
});

test('an array annotation types each name by its element type, checked where it is bound', () => {
  expectStaticTypeError('const a: [].<uint8> = [(1 := uint8)]; const [z]: [].<uint8> = a; const s: string = z;');
  expect(evaluated(`const a: [].<uint8> = [(1 := uint8)]; const u: any = a; u[Symbol.iterator] = function* () { yield "s"; };
    let r = "none"; try { const [y]: [].<uint8> = a; r = typeof y; } catch (e) { r = e.constructor.name; } r;`)).toBe('TypeError');
  // Without an annotation on the pattern, storage alone infers nothing.
  expect(ok('const a: [].<uint8> = [(1 := uint8)]; const [z] = a; const s: string = z;')).toBe(true);
});
