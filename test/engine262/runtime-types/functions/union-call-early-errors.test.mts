import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test.each([
  'type A = (x: uint8) => void; type B = (x: float32) => void; function unused(f: A | B) { f(true); }',
  'type A = (x: uint8) => void; type B = (x: string) => void; function unused(f: A | B, x: uint8) { f(x); }',
  'type A = (ref x: uint8) => void; type B = (ref x: float32) => void; function unused(f: A | B) { f(1); }',
  'type A = (x: uint8) => void; type B = (x: string) => void; function unused(f: A | B) { f(); }',
  'type A = (x: uint8, ...r: [].<uint8>) => void; type B = (x: float32, ...r: [].<float32>) => void; function unused(f: A | B, xs: [].<any>) { f(true, ...xs); }',
  'type A = () => uint8; type B = () => string; function unused(f: A | B) { let b: boolean = f(); }',
  'type A = () => uint8; type B = () => string; function unused(f: A | B) { let b: uint8 = f(); }',
  'interface A { (x: uint8): void; } interface B { (x: float32): void; } function unused(f: A | B) { f(true); }',
  'type A = (f: (x: uint8) => void) => void; type B = (f: (x: string) => void) => void; function unused(f: A | B) { f(x => { let n: uint8 = x; }); }',
])('validates each reachable function alternative: %s', expectStaticTypeError);

test('numeric literals follow the actual callee, in either union order', () => {
  for (const type of ['A | B', 'B | A']) {
    const declarations = `type A = (x: uint8) => string; type B = (x: float32) => string;
      function a(x: uint8): string { return String(x is uint8); }
      function b(x: float32): string { return String(x is float32); }
      function call(f: ${type}): string { return f(1); }`;
    expect(evaluated(`${declarations} call(a) + call(b);`)).toBe('truetrue');
  }
});

test('common results and default/rest/named arguments remain valid', () => {
  expect(ok('type A = (x: uint8) => void; type B = (x: float32) => void; function unused(f: A | B) { f(x: 1); }')).toBe(true);
  expect(ok('type A = (x?: uint8) => void; type B = (x?: float32) => void; function unused(f: A | B) { f(); }')).toBe(true);
  expect(ok('type A = (...xs: [].<uint8>) => void; type B = (...xs: [].<float32>) => void; function unused(f: A | B) { f(1, 2); }')).toBe(true);
  expect(ok('type A = () => uint8; type B = () => string; function unused(f: A | B) { let n: uint8 | string = f(); }')).toBe(true);
});

test('unknown arguments and callee retain runtime boundaries', () => {
  expect(ok('type A = (x: uint8) => void; type B = (x: float32) => void; function unused(f: A | B, value: any) { f(value); }')).toBe(true);
  expectThrownKind('function a(x: uint8): void {} function call(f: any) { f(true); } call(a);', 'TypeError');
});


test('contextual overload selection and generic inference stay independent per arm', () => {
  expect(ok('interface A { (x: uint8): uint8; (x: uint8): string; } type B = (x: uint8) => string; function use(f: A | B): string { return f(1); }')).toBe(true);
  expectStaticTypeError('interface A { (x: uint8): uint8; (x: uint8): string; } type B = (x: uint8) => boolean; function use(f: A | B): string { return f(1); }');
  expect(ok('type A = <T>(x: T) => T; type B = (x: uint8) => uint8; function use(f: A | B): uint8 { return f(1); }')).toBe(true);
});

test('contextual callbacks execute with either actual callee', () => {
  expect(ok(`type A = (f: (x: uint8) => uint8) => uint8; type B = (f: (x: float32) => float32) => float32;
    function a(f: (x: uint8) => uint8): uint8 { return f(1); }
    function b(f: (x: float32) => float32): float32 { return f(1); }
    function use(f: A | B): uint8 | float32 { return f(x => x); } use(a); use(b);`)).toBe(true);
});

test('a union of ref-returning callees still supplies a location', () => {
  expect(ok('type A = () => ref uint8; type B = () => ref string; function unused(f: A | B) { let ref p = f(); }')).toBe(true);
  expectStaticTypeError('type A = () => ref uint8; type B = () => string; function unused(f: A | B) { let ref p = f(); }');
});


test('contextual callback analysis includes reference write permissions', () => {
  const declarations = 'type A = (f: (x: { readonly v: uint8 }) => void) => void; type B = (f: (x: { v: uint8 }) => void) => void;';
  expectStaticTypeError(`${declarations} function unused(f: A | B) { f(x => { let ref p = x.v; p = 2; }); }`);
  expect(ok(`${declarations} function unused(f: A | B) { f(x => { let ref p = x.v; const n: uint8 = p; }); }`)).toBe(true);
});


test('reference-returning calls decay in value positions and preserve locations when borrowed', () => {
  expect(evaluated(`let n: uint8 = 1; let s: string = "s";
    function a(): ref uint8 { return ref n; } function b(): ref string { return ref s; }
    type A = () => ref uint8; type B = () => ref string;
    function read(f: A | B): string { const value: uint8 | string = f(); return String(value); }
    function borrow(f: A | B): string { let ref p = f(); return String(p); }
    const direct: uint8 = a();
    String(direct) + read(a) + read(b) + borrow(a) + borrow(b);`)).toBe('11s1s');
  expectStaticTypeError('type A = () => ref uint8; type B = () => ref string; function unused(f: A | B) { const value: boolean = f(); }');
});
