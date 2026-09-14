import { expect, test } from 'vitest';
import { evaluated, expectEarlyError } from '../harness.mts';

test('every potentially selected catch participates in fallthrough', () => {
  expectEarlyError('function f(value: any): uint8 { try { throw value; } catch (e: uint8) { return 1; } catch (e: string) {} }', 'SyntaxError');
  expectEarlyError('function f(value: any): uint8 { try { throw value; } catch (e: uint8) { return 1; } catch (e: string) { return 2; } catch (e) {} }', 'SyntaxError');
});

test('total handlers and an abrupt finally do not fall through', () => {
  expect(evaluated('function f(value: any): uint8 { try { throw value; } catch (e: uint8) { return 1; } catch (e: string) { return 2; } } String(f("bad"));')).toBe('2');
  expect(evaluated('function f(value: any): uint8 { try { throw value; } catch (e: uint8) { return 1; } catch (e: string) {} finally { return 2; } } String(f("bad"));')).toBe('2');
});

test('nested switch and loop breaks do not leave the surrounding loop', () => {
  expect(evaluated('function f(): uint8 { while (true) { switch (1) { default: break; } return 1; } } String(f());')).toBe('1');
  expect(evaluated('function f(): uint8 { for (;;) { while (true) { break; } return 1; } } String(f());')).toBe('1');
  expect(evaluated('function f(): uint8 { while (true) { inner: { break inner; } return 1; } } String(f());')).toBe('1');
  expectEarlyError('function f(): uint8 { outer: while (true) { switch (1) { default: break outer; } return 1; } }', 'SyntaxError');
});
