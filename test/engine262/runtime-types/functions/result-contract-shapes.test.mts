import { expect, test } from 'vitest';
import { evaluated, observeScript, settledAfterJobs } from '../harness.mts';

/**
 * Round 5, Gap 7 and Q3 (#sec-generic-where): a result contract on a
 * generator constrains the generator's return value, and on an async function
 * the fulfilled value of its promise; both bodies run through their own
 * evaluators, which did not verify contracts at all. A literal return is
 * decided before the body on every shape.
 */

test('a generator return the contract rejects is the generator\'s throw', () => {
  expect(evaluated('let k: uint32 = 5; function* g(): Generator.<uint32, uint32, void> where return > 10 { yield 1; return k; } const it = g(); it.next(); try { it.next(); } catch (e) { String(e instanceof TypeError); }')).toBe('true');
  expect(evaluated('function* g(): Generator.<uint32, uint32, void> where return > 10 { yield 1; return 20; } const it = g(); it.next(); String(it.next().value);')).toBe('20');
  expect(observeScript('function* g(): Generator.<uint32, uint32, void> where return > 10 { yield 1; return 5; }')).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-return-contract' } });
});

test('an async return the contract rejects rejects the promise', () => {
  expect(settledAfterJobs('let k: uint32 = 5; async function f(): Promise.<uint32> where return > 10 { return k; } f().then(() => { globalThis.settled = "fulfilled"; }, (e) => { globalThis.settled = String(e instanceof TypeError); });')).toBe('true');
  expect(settledAfterJobs('async function f(): Promise.<uint32> where return > 10 { return 20; } f().then((v) => { globalThis.settled = String(v); });')).toBe('20');
  expect(observeScript('async function f(): Promise.<uint32> where return > 10 { return 5; } f();')).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-return-contract' } });
});
