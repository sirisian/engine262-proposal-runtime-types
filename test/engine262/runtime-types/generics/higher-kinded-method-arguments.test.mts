import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind } from '../harness.mts';

const aliases = 'type Id<T: type> = T; type Pair<T: type> = [T, T]; ';
const method = 'm<W<_>: type>(): string { return String(type W.<uint8>); }';

test('a method argument binds a declaration in positional and named forms', () => {
  expect(evaluated(aliases + `class C { ${method} } new C().m.<Id>();`)).toBe('uint.<8>');
  expect(evaluated(aliases + `class C { ${method} } new C()["m"].<W: Pair>();`)).toBe('[uint.<8>, uint.<8>]');
});

test('static and inherited methods retain their higher-kinded argument context', () => {
  expect(evaluated(aliases + `class C { static ${method} } C.m.<Id>();`)).toBe('uint.<8>');
  expect(evaluated(aliases + `class B { ${method} } class C extends B {} new C().m.<Id>();`)).toBe('uint.<8>');
});

test('missing or wrong-arity declarations still fail at the available boundary', () => {
  const prefix = `class C { ${method} } `;
  expectStaticTypeError(prefix + 'new C().m();');
  expectStaticTypeError(prefix + 'type Two<A: type, B: type> = A; new C().m.<Two>();');
  expectThrownKind(prefix + 'const m: any = new C().m; m();', 'TypeError');
});
