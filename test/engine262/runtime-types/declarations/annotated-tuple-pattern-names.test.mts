import { test, expect } from 'vitest';
import { evaluated, expectStaticTypeError, ok } from '../harness.mts';

// #sec-type-annotations: an annotation on a pattern annotates the value being
// destructured, and each name's type follows from the annotated type's
// members; a tuple's members are its declared positions, nested patterns
// included. An array's indexed storage has no such members and does not
// constrain its replaceable iterator (#sec-static-flattening-contribution).

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

test('an array annotation does not type the names its iterator yields', () => {
  expect(ok('const a: [].<uint8> = [(1 := uint8)]; const [z]: [].<uint8> = a; const s: string = z;')).toBe(true);
});
