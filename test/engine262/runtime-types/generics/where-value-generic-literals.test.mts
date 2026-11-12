import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * A value generic parameter is bound to the literal type of its argument's
 * value, so in a predicate it compares as that literal would: against a
 * typed value it takes that value's type, and against a plain number it
 * compares as a number.
 */

test('a value generic compares with a typed value as its literal would', () => {
  expect(evaluated("type Positive<N: uint32> = uint8 where this > N; let x: Positive.<1> = 2; 'ok';")).toBe('ok');
  // A value that is not a constant is compared when it crosses; a constant is decided where it is written.
  expect(evaluated("type Positive<N: uint32> = uint8 where this > N; function cross(z: any) { try { let x: Positive.<1> = z; return 'ran'; } catch (e) { return 'threw'; } } cross(0) + cross(2);")).toBe('threwran');
  expect(observeScript('type Positive<N: uint32> = uint8 where this > N; let x: Positive.<1> = 0;'))
    .toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-assignability' } });
  expect(evaluated('type Below<N: uint32> = uint32 where this < N; String((5 := uint32) is Below.<10>) + String((15 := uint32) is Below.<10>);')).toBe('truefalse');
  expect(evaluated('function f<N: uint32>(x: uint8): uint8 where x > N { return x; } String(f.<1>(2));')).toBe('2');
});

test('a value generic compares with a plain number as a number', () => {
  expect(evaluated(`class vec<T: type, N: uint32> {
    #lanes: [].<T>;
    constructor(xs: [].<T>) { this.#lanes = xs; }
    pick<...I: [].<uint32>>(): [].<T> where I.every((i) => i < N) { const out: [].<T> = []; for (let j = 0; j < I.length; j++) { out.push(this.#lanes[I[j]]); } return out; }
  }
  const v = new (vec.<float32, 4>)([1, 2, 3, 4]); v.pick.<3, 0>().join(',');`)).toBe('4,1');
});
