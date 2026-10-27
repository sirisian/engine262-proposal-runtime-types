import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * Spec: #sec-vector-types.
 *
 * `vector.<T, N>` is "the sequences of exactly N values of T", with a cast
 * from T that fills every lane, so a call takes N lane values or one value.
 * The checker judged each lane's type but left the count to the run time,
 * which reported it after the body had begun.
 */

test('a lane count that fits neither form is refused before the body', () => {
  for (const source of ['const v = float32x4(1, 2, 3);', 'const v = float32x4(1, 2, 3, 4, 5);', 'const v = vector.<float32, 4>(1, 2, 3);']) {
    expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-vector-argument', phase: 'static' } });
  }
});

test('N lanes and the one-value cast are unchanged', () => {
  expect(evaluated('const v = float32x4(1, 2, 3, 4); String(v.lane.<3>());')).toBe('4');
  expect(evaluated('const v = float32x4(7); String(v.lane.<2>());')).toBe('7');
});
