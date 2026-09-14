import { expect, test } from 'vitest';
import { evaluated, expectEarlyError, expectThrownKind } from './harness.mts';

test('context supplies all three generator positions', () => {
  expect(evaluated('const g: Generator.<uint8, string, boolean> = do * { const ready: boolean = yield 1; return ready ? "yes" : "no"; }; const first = g.next(); const last = g.next(true); String(first.value) + last.value;')).toBe('1yes');
  expect(evaluated('const g: Generator.<number, void, void> = do * { yield 1; }; String(g.next().value);')).toBe('1');
});

test('return and argument positions supply the generator resume type', () => {
  const body = 'do * { const x: boolean = yield 1; return x ? "yes" : "no"; }';
  expect(evaluated(`function f(): Generator.<uint8, string, boolean> { return ${body}; } const g = f(); g.next(); g.next(true).value;`)).toBe('yes');
  expect(evaluated(`function f(g: Generator.<uint8, string, boolean>) { g.next(); return g.next(true).value; } f(${body});`)).toBe('yes');
});

test.each([
  'const g: Generator.<uint8, void, void> = do * { yield "s"; };',
  'const g: Generator.<uint8, void, void> = do * { yield 300; };',
  'const g: Generator.<uint8, uint8, void> = do * { yield 1; return "s"; };',
  'const g: Generator.<uint8, void, void> = do * { yield 1; return 1; };',
  'const g: AsyncGenerator.<uint8, void, void> = async do * { yield 300; };',
])('context checks the operands: %s', (source) => {
  expectEarlyError(source, 'StaticTypeError');
  expectEarlyError(`function unused() { ${source} }`, 'StaticTypeError');
});

test('generator return is independent of the enclosing function and nested functions', () => {
  expect(evaluated('function f(): string { const g: Generator.<uint8, uint8, void> = do * { function nested() { return "s"; } yield 1; return 2; }; g.next(); return String(g.next().value); } f();')).toBe('2');
  expect(evaluated('const g = do * { let x: uint8 = 1; yield x; return "done"; }; const a = g.next(); const b = g.next(); String(a.value) + b.value;')).toBe('1done');
});

test('unknown yields retain runtime enforcement', () => {
  expectThrownKind('let v: any = "s"; const g: Generator.<uint8, void, void> = do * { yield v; }; g.next();', 'TypeError');
  expectThrownKind('let v: any = "s"; const g: Generator.<uint8, uint8, void> = do * { yield 1; return v; }; g.next(); g.next();', 'TypeError');
});

test('yield star contributes the delegated yield and has the delegated return', () => {
  expect(evaluated('function* inner(): Generator.<uint8, string, void> { yield 1; return "done"; } const g: Generator.<uint8, string, void> = do * { return yield* inner(); }; const a = g.next(); const b = g.next(); String(a.value) + b.value;')).toBe('1done');
});
