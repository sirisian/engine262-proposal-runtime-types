import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test('a declared numeric disposal member is rejected before acquisition', () => {
  expectStaticTypeError('class C { [Symbol.dispose]: uint8 = 1; } function unused(c: C) { using r: C = c; }');
  expectStaticTypeError('function unused(c: { [Symbol.dispose]: uint8 }) { using r: { [Symbol.dispose]: uint8 } = c; }');
  expectStaticTypeError('class C { get [Symbol.dispose](): uint8 { return 1; } } function unused(c: C) { using r: C = c; }');
});

test('disposal lookup includes inherited and specialized members', () => {
  expectStaticTypeError('class B { [Symbol.dispose]: uint8 = 1; } class C extends B {} function unused(c: C) { using r: C = c; }');
  expectStaticTypeError('class B<T: type> { [Symbol.dispose]: T; } function unused(c: B.<uint8>) { using r: B.<uint8> = c; }');
  expectStaticTypeError('class B<T: type> { [Symbol.dispose]: T; } class C extends B.<uint8> {} function unused(c: C) { using r: C = c; }');
});

test('computed object-type members retain the rest of their static shape', () => {
  expectStaticTypeError('function unused(c: { [Symbol.dispose]: uint8, name: string }) { let wrong: uint8 = c.name; }');
  expectStaticTypeError('function unused() { let c: { [Symbol.dispose]: uint8 } = { [Symbol.dispose]: "bad" }; }');
  expectStaticTypeError('type Duplicate = { [Symbol.dispose]: uint8, [Symbol.dispose]: uint8 };');
  expectStaticTypeError('function unused(c: { ["dispose"]: uint8 }) { let wrong: string = c.dispose; }');
  expectStaticTypeError('function unused() { let c: { 1: uint8 } = { 1: "bad" }; }');
  expect(ok('function unused(c: { [Symbol.dispose]: uint8, name: string }) { let name: string = c.name; }')).toBe(true);
});

test('callable and inherited disposal methods run once on block exit', () => {
  expect(evaluated('let log = ""; class B { [Symbol.dispose](): void { log += "d"; } } class C extends B {} { using r: C = new C(); log += "b"; } log;')).toBe('bd');
  expect(evaluated('let log = ""; { using r: { [Symbol.dispose]: () => void } = { [Symbol.dispose]() { log += "d"; } }; } log;')).toBe('d');
  expect(ok('class B<T: type> { [Symbol.dispose]: T; } class C extends B.<() => void> {} function unused(c: C) { using r: C = c; }')).toBe(true);
});

test('resource checking never executes a getter', () => {
  expect(evaluated('let reads = 0; class C { get [Symbol.dispose](): () => void { reads++; return () => {}; } } function unused(c: C) { using r: C = c; } String(reads);')).toBe('0');
});

test('unknown protocols, dynamic methods and nullish resources remain valid', () => {
  expect(evaluated('let disposed = 0; dynamic class C { x: uint8; } const c = new C(); c[Symbol.dispose] = () => { disposed++; }; { using r: C = c; } String(disposed);')).toBe('1');
  expect(ok('{ using r: object = { [Symbol.dispose]() {} }; using n: null = null; using u: undefined = undefined; }')).toBe(true);
  expect(ok('function unused(c: { [Symbol.dispose]: any }) { using r: { [Symbol.dispose]: any } = c; }')).toBe(true);
  expect(ok('function unused(c: { [Symbol.dispose]: uint8 } | null) { using r: { [Symbol.dispose]: uint8 } | null = c; }')).toBe(true);
  expect(ok('function unused(c: { [Symbol.dispose]: uint8 } | { [Symbol.dispose]: () => void }) { using r: { [Symbol.dispose]: uint8 } | { [Symbol.dispose]: () => void } = c; }')).toBe(true);
  expectThrownKind('{ let c: any = { [Symbol.dispose]: 1 }; using r: any = c; }', 'TypeError');
});
