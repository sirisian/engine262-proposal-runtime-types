import { expect, test } from 'vitest';
import { evaluated, expectEarlyError } from './harness.mts';

test.each(['[do { return 1; "m"; }]() {}', '[do { return 1; "m"; }] = 2;'])('computed class name refuses an enclosing return: %s', (element) => {
  expectEarlyError(`function f() { class C { ${element} } return 9; }`, 'SyntaxError');
  expectEarlyError(`function f() { class C { ${element} } return 9; } f();`, 'SyntaxError');
});

test('computed object names and nested function bodies retain their return targets', () => {
  expect(evaluated('function f() { const o = { [do { return 1; "m"; }]: 2 }; return 9; } String(f());')).toBe('1');
  expect(evaluated('class C { [do { function f() { return "m"; } f(); }]() {} } String(typeof new C().m);')).toBe('function');
  expect(evaluated('class C { [do { const o = { m() { return "m"; } }; o.m(); }]() {} } String(typeof new C().m);')).toBe('function');
  expect(evaluated('class C { [do { const g = do * { return "m"; }; g.next().value; }]() {} } String(typeof new C().m);')).toBe('function');
});
