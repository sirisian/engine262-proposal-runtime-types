import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, settledAfterJobs } from '../harness.mts';

/**
 * Spec: #sec-type-rule-applicability (the invariance note), #sec-generic-types.
 *
 * `Promise.resolve` is written `(value: R): Promise.<R, any>`, `Promise.reject`
 * the same with its E, and `Array.of`, `Array.from`, `Promise.all`, `race`
 * and `any` are generic statics too. Written with a type argument they threw
 * "type arguments require a generic function" at evaluation, well-typed or
 * not, and were ~any~ to the checker. Now the run time honours the argument
 * (a typed promise validates its settlement; an array adopts `[].<T>`
 * storage), and the checker judges the argument boundary and the result.
 */

test('a mistyped argument is refused at the call', () => {
  expectStaticTypeError('Promise.resolve.<uint8>("s");');
  expectStaticTypeError('const s: string = "x"; Promise.resolve.<uint8>(s);');
  expectStaticTypeError('Promise.reject.<uint8>("s");');
  expectStaticTypeError('Array.of.<uint8>(1, "s");');
  expectStaticTypeError('Array.from.<uint8>(["s"]);');
  expectStaticTypeError('Promise.all.<uint8>(["s"]);');
  expectStaticTypeError('Promise.race.<uint8>([1, "s"]);');
});

test('the result carries the type argument', () => {
  expectStaticTypeError('let p: Promise.<string, any> = Promise.resolve.<uint8>(1);');
  expectStaticTypeError('let a: [].<string> = Array.of.<uint8>(1, 2);');
  expect(evaluated('let p: Promise.<uint8, any> = Promise.resolve.<uint8>(1); "ok";')).toBe('ok');
  expect(evaluated('let a: [].<uint8> = Array.of.<uint8>(1, 2); String(a[1]);')).toBe('2');
});

test('the run time honours the type argument where the checker cannot see', () => {
  expect(evaluated('let v: any = ["s"]; try { Array.from.<uint8>(v); } catch (e) { String(e instanceof TypeError); }')).toBe('true');
  expect(evaluated('const a = Array.of.<uint8>(1); try { a.push("s"); } catch (e) { String(e instanceof TypeError); }')).toBe('true');
  expect(settledAfterJobs('let v: any = "s"; Promise.resolve.<uint8>(v).then(() => { globalThis.settled = "fulfilled"; }, (e) => { globalThis.settled = String(e instanceof TypeError); });')).toBe('true');
  expect(settledAfterJobs('let v: any = 7; Promise.resolve.<uint8>(v).then((x) => { globalThis.settled = String(x); });')).toBe('7');
});

test('well-typed forms evaluate, and a non-generic static is still refused', () => {
  expect(evaluated('Promise.all.<uint8>([1, 2]); Promise.any.<uint8>([Promise.resolve(1)]); Promise.allSettled.<uint8>([1]); "ok";')).toBe('ok');
  expect(evaluated('Promise.reject.<uint8>(1).catch(() => {}); "ok";')).toBe('ok');
  expect(evaluated('String(Array.from.<uint8>([1, 2]).length);')).toBe('2');
  expectStaticTypeError('Object.keys.<uint8>({});');
});
