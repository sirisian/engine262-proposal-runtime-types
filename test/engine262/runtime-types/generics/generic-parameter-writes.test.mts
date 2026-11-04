import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-type-parameters: a generic parameter, a value generic or a type
 * generic, is an immutable binding. An assignment, compound assignment,
 * update or destructuring assignment that targets one is an error where it
 * is written, in a `where` clause or in a body, whether or not anything
 * applies the declaration.
 */

const refused = (source: string) => expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-readonly-store' } });

test('a write to a generic parameter in a clause is refused', () => {
  refused("function f<N: uint32>(): void where (N = 0) === 0 {} 'ok';");
  refused("function f<N: uint32>(): void where N++ > 0 {} 'ok';");
  refused("function f<N: uint32>(): void where (N += 1) > 0 {} 'ok';");
  refused("function f<N: uint32>(): void where ([N] = [0]).length > 0 {} 'ok';");
});

test('a write to a generic parameter in a body is refused', () => {
  refused("function h<N: uint32>(): string { N = 0; return String(N); } 'ok';");
  refused("function h<N: uint32>(): string { [N] = [0]; return 'x'; } 'ok';");
  refused("class C<N: uint8> { m() { N = 1; return 1; } } 'ok';");
  refused("function t<T: type>(x: T) { T = x; return 1; } 'ok';");
});

test('reads, shadowing locals and other bindings are unaffected', () => {
  expect(evaluated('function h<N: uint32>(): string { return String(N); } h.<5>();')).toBe('5');
  expect(evaluated('function h<N: uint32>(): string { { let N = 0; N = 1; } return String(N); } h.<5>();')).toBe('5');
  expect(evaluated('let N = 7; function h(): string { N = 8; return String(N); } h();')).toBe('8');
  expect(evaluated('function f<N: uint32>(xs: [].<uint32>): number where xs.every((v) => { let w = v; w = w + 1; return w > N; }) { return 1; } String(f.<0>([1]));')).toBe('1');
});
