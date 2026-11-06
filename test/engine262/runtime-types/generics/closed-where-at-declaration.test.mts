import { test, expect } from 'vitest';
import { observeScript } from '../harness.mts';

// #sec-generic-where: the clauses of a generic declaration the program applies
// are decided by its applications, closed clauses included, so a false one is
// unsatisfied at the clause; the declaration-time judgment of a closed clause
// applies only to a declaration the program never applies. An application
// whose arguments remain unbound defers its clauses.

const rule = (source: string): string | undefined => (observeScript(source).diagnostic as { rule?: string } | undefined)?.rule;

test('a closed false clause of a declaration nothing applies is refused at the declaration', () => {
  expect(rule("function f<T: type>(x: T) where 1 === 2 { return x; } 'declared';")).toBe('rt-impossible-test');
  expect(rule("class C<T: type> where 1 === 2 { } 'declared';")).toBe('rt-impossible-test');
  expect(rule("type A<T: type> = [T] where 1 === 2; 'declared';")).toBe('rt-impossible-test');
});

test('a closed false clause of an applied declaration is decided by its application', () => {
  expect(rule("function f<T: type>(x: T) where 1 === 2 { return x; } f.<uint8>(1); 'declared';")).toBe('rt-where-unsatisfied');
  expect(rule("class C<T: type> where 1 === 2 { } new C.<uint8>(); 'declared';")).toBe('rt-where-unsatisfied');
  expect(rule("type A<T: type> = [T] where 1 === 2; let a: A.<uint8> = [(1 := uint8)]; 'declared';")).toBe('rt-where-unsatisfied');
});
