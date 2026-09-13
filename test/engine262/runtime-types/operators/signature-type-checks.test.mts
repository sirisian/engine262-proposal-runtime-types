import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

for (const reverse of [false, true]) {
  const rows = ['operator+(v: uint8): uint8 { return v; }', 'operator+(v: string): string { return v; }'];
  const declaration = `class M { ${reverse ? rows.reverse().join(' ') : rows.join(' ')} }`;
  test(`operator selection checks every signature, reverse order ${reverse}`, () => {
    expect(evaluated(`${declaration} const m: M = new M(); m + "s";`)).toBe('s');
    expect(evaluated(`${declaration} const m: M = new M(); String(m + 2);`)).toBe('2');
    expectStaticTypeError(`${declaration} function unused(m: M) { m + true; }`);
  });
}

test('a declared operator contributes its selected result', () => {
  const classes = 'class P { x: uint8 = 1; } class M { operator+(v: uint8): P { return new P(); } }';
  expectStaticTypeError(`${classes} function unused(m: M) { let s: string = m + 1; }`);
  expect(evaluated(`${classes} const m: M = new M(); const p: P = m + 1; String(p.x);`)).toBe('1');
});

test('inherited and generic operators keep their parameter and result types', () => {
  expectStaticTypeError('class B<T> { operator+(v: T): T { return v; } } class D extends B.<uint8> {} function unused(d: D) { d + "s"; }');
  expect(evaluated('class B<T> { operator+(v: T): T { return v; } } const b: B.<uint8> = new B.<uint8>(); String(b + 2);')).toBe('2');
});

test('operator overload resolution uses the contextual return type at runtime too', () => {
  expect(evaluated('class M { operator+(v: uint8): string { return "s"; } operator+(v: uint8): uint8 { return v; } } const m: M = new M(); const x: uint8 = (m + 2); String(x);')).toBe('2');
});

test('a declared compound can act through a readonly field without replacing it', () => {
  const declarations = 'class M { n: uint8 = 1; operator+=(v: uint8): string { this.n += v; return "ok"; } } class H { readonly m: M = new M(); }';
  expect(evaluated(`${declarations} const h: H = new H(); const result: string = (h.m += 2); result + ":" + String(h.m.n);`)).toBe('ok:3');
  expectStaticTypeError(`${declarations} function unused(h: H) { h.m += "s"; }`);
  expectStaticTypeError('class M { operator+(v: uint8): M { return this; } } class H { readonly m: M = new M(); } function unused(h: H) { h.m += 1; }');
});

for (const indices of ['300', '1, 300']) {
  test(`index signatures check every numeric argument: ${indices}`, () => {
    expectStaticTypeError(`class M { operator[](i: uint8): uint8 { return i; } operator[](i: uint8, j: uint8): uint8 { return j; } } function unused(m: M) { m[${indices}]; }`);
  });
}

test('an index getter contributes its result and keeps string properties ordinary', () => {
  const declaration = 'class M { operator[](i: uint8): uint8 { return i; } name(): string { return "name"; } }';
  expectStaticTypeError(`${declaration} function unused(m: M) { const s: string = m[0]; }`);
  expect(evaluated(`${declaration} const m: M = new M(); const n: uint8 = m[2]; m["name"]() + String(n);`)).toBe('name2');
});

test('an index setter checks its own signature without requiring a getter', () => {
  const declaration = 'class M { n: uint8 = 0; set operator[](i: uint8, v: uint8) { this.n = v; } }';
  expectStaticTypeError(`${declaration} function unused(m: M) { m[0] = "s"; }`);
  expectStaticTypeError(`${declaration} function unused(m: M) { m[300] = 1; }`);
  expect(evaluated(`${declaration} const m: M = new M(); m[0] = 2; String(m.n);`)).toBe('2');
});

test('an annotated reference index getter supplies the store type', () => {
  const declaration = 'class M { n: uint8 = 1; operator[](i: uint8): ref uint8 { return ref this.n; } }';
  expectStaticTypeError(`${declaration} function unused(m: M) { m[0] = "s"; }`);
  expect(evaluated(`${declaration} const m: M = new M(); m[0] = 2; String(m.n);`)).toBe('2');
});

test('unknown index and operator arguments remain runtime decisions', () => {
  expect(evaluated('class M { operator[](i: uint8): uint8 { return i; } } function read(m: M, i: any) { return m[i]; } String(read(new M(), 2));')).toBe('2');
  expect(evaluated('class M { operator+(v: uint8): uint8 { return v; } operator+(v: string): string { return v; } } function add(m: M, x: any) { return m + x; } add(new M(), "s");')).toBe('s');
});

test('index setter signatures also check destructuring and compound stores', () => {
  const declarations = 'class M { n: uint8 = 1; operator[](i: uint8): uint8 { return this.n; } set operator[](i: uint8, v: uint8) { this.n = v; } }';
  expectStaticTypeError(`${declarations} function unused(m: M) { [m[0]] = ["s"]; }`);
  expectStaticTypeError(`${declarations} function unused(m: M) { m[0] += "s"; }`);
  expect(evaluated(`${declarations} const m: M = new M(); [m[0]] = [2]; m[0] += 3; String(m.n);`)).toBe('5');
});

test('a compound fallback checks the binary operands and the stored result', () => {
  expectStaticTypeError('class M { operator+(x: uint8): string { return "s"; } } function unused(m: M) { m += 1; }');
  expectStaticTypeError('class M { operator+(x: uint8): M { return this; } } function unused(m: M) { m += "s"; }');
});

test('duplicate untyped operators retain the last body', () => {
  expect(evaluated('class M { operator+(x) { return 1; } operator+(x) { return 2; } } String(new M() + 0);')).toBe('2');
});

test.each(['bigint', 'float128', 'decimal64', 'rational', 'complex.<float64>', 'float32x4'])('index dispatch includes the numeric type %s', (type) => {
  const value = type === 'float32x4' ? 'float32x4(1, 1, 1, 1)' : `(1 := ${type})`;
  const declaration = `class M { operator[](i: ${type}): string { return "index"; } }`;
  expect(evaluated(`${declaration} const m: M = new M(); m[${value}];`)).toBe('index');
  expect(evaluated(`${declaration} const m = (new M() := any); m[${value}];`)).toBe('index');
  expectStaticTypeError(`class M { operator[](i: ${type}): uint8 { return 1; } } function unused(m: M, i: ${type}) { let s: string = m[i]; }`);
});
