import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * Round 5 follow-up, Q16: `Promise.allSettled.<T>` is typed as the inferred
 * call already was, a promise of an array of settled records
 * (`PromiseSettledResult`, standardlibrary.md: `status: string`, `value?: R`,
 * `reason?: E`), and it never rejects.
 */

test('the applied form is a promise of settled records', () => {
  expect(observeScript('let p: string = Promise.allSettled.<uint8>([1]);')).toMatchObject({ bodyEntered: false, diagnostic: { rule: 'rt-assignability' } });
  expect(observeScript('async function f() { const r = await Promise.allSettled.<uint8>([1]); let n: uint8 = r[0].status; return n; }')).toMatchObject({ bodyEntered: false, diagnostic: { rule: 'rt-assignability' } });
  expect(observeScript('async function f() { const r = await Promise.allSettled.<uint8>([1]); let v: string = r[0].value; return v; }')).toMatchObject({ bodyEntered: false, diagnostic: { rule: 'rt-assignability' } });
  expect(evaluated('async function f() { const r = await Promise.allSettled.<uint8>([1]); let s: string = r[0].status; return s; } "ok";')).toBe('ok');
  expect(evaluated('Promise.allSettled.<uint8>([1]); "ok";')).toBe('ok');
});
