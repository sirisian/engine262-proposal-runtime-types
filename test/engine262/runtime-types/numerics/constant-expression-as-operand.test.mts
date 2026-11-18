import { expect, test } from 'vitest';
import { evaluated, expectThrown, observeScript } from '../harness.mts';

/**
 * A constant expression written as an operand is read as the constant it is.
 *
 * #sec-contextual-types gives "an operand of a binary operator whose other operand has a known
 * value type" the type of the other operand, and gives "an arithmetic expression every operand of
 * which is compile-time evaluable" its position's type "applied to the expression's mathematical
 * value"; and a `const` bound to such an expression "behaves as if inlined"
 * (#sec-static-type-of-an-expression). So `z * 4 ** 2` is `z * 16`, and is what
 * `const K = 4 ** 2; z * K` is.
 *
 * Only the named form was read that way. The expression written in place was a Number beside the
 * typed operand: a TypeError where it computed, `z * 4 ** 2`, and a silent *false* where it
 * compared, `z === 2 + 1` for a `z` that is 3, with the `case 2 + 1:` beside it never selected.
 */

const early = (rule: string) => ({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule } });
/** What a script comes to: the text of its value, or the class of the error it ends in. */
const outcome = (source: string): string => {
  const observed = observeScript(source);
  if (observed.errorClass !== undefined) return `${observed.bodyEntered ? 'thrown' : 'early'} ${observed.errorClass}`;
  const value = (observed.completion as { Value?: { stringValue?(): string } }).Value;
  return value?.stringValue ? value.stringValue() : String(value);
};

test('arithmetic on literals beside a typed operand takes its type', () => {
  expect(evaluated('function f(z: uint32) { return z * 4 ** 2; } String(f(3));')).toBe('48');
  expect(evaluated('function f(z: uint32) { return z * (4 * 4); } String(f(3));')).toBe('48');
  expect(evaluated('function f(z: uint32) { return (4 * 4) * z; } String(f(3));')).toBe('48');
  expect(evaluated('function f(z: uint32) { return 4 ** 2 + z; } String(f(3));')).toBe('19');
  expect(evaluated('function f(z: uint32) { z = z * (2 + 2); return z; } String(f(3));')).toBe('12');
  expect(evaluated('function f(z: int32) { return z * -(4 * 4); } String(f(3));')).toBe('-48');
  expect(evaluated('const z: uint32 = 3; String(z * (4 * 4));')).toBe('48');
  // The result is of the operand's type, as it is beside a literal.
  expect(evaluated('function f(z: uint32) { const r = z * (4 * 4); return Reflect.typeOf(r) === uint32; } String(f(3));')).toBe('true');
  expect(evaluated('function f(z: float32) { return z * (1 / 4); } String(f(2));')).toBe('0.5');
  // The README's grid index, the sample that showed it.
  expect(evaluated('function at(x: uint32, y: uint32, z: uint32): uint32 { return x + y * 4 + z * 4 ** 2; } String(at(1, 2, 3));')).toBe('57');
});

test('the expression and a const bound to it agree at every position', () => {
  const cases: [string, string, string][] = [
    ['4 ** 2', 'uint32', '16'],
    ['2 + 1', 'uint8', '3'],
    ['-(1 + 2)', 'int16', '-3'],
    ['9007199254740992 + 1', 'uint64', '9007199254740993'],
    ['1 / 4', 'float32', '0.25'],
    ['0.5 * 3', 'float64', '1.5'],
    ['7 / 2', 'uint32', '3'],
  ];
  const positions = (operand: string, type: string, value: string) => [
    `function f(z: ${type}) { return z + ${operand}; } String(f(${value}));`,
    `function f(z: ${type}) { return ${operand} - z; } String(f(${value}));`,
    `function f(z: ${type}) { return z * ${operand}; } String(f(${value}));`,
    `function f(z: ${type}) { return z === ${operand}; } String(f(${value}));`,
    `function f(z: ${type}) { return ${operand} !== z; } String(f(${value}));`,
    `function f(z: ${type}) { return z <= ${operand}; } String(f(${value}));`,
    `function f(z: ${type}) { switch (z) { case ${operand}: return "hit"; default: return "miss"; } } f(${value});`,
    `function f(z: ${type}) { return Object.is(z, ${operand}); } String(f(${value}));`,
    // The other operand's type known only when it runs.
    `function f(z) { return z + ${operand}; } String(f(${type}(${value})));`,
    `function f(z) { return z === ${operand}; } String(f(${type}(${value})));`,
  ];
  for (const [expression, type, value] of cases) {
    const named = positions('K', type, value).map((source) => `const K = ${expression}; ${source}`);
    const written = positions(`(${expression})`, type, value);
    for (let i = 0; i < named.length; i += 1) {
      expect(outcome(written[i]), written[i]).toBe(outcome(named[i]));
    }
  }
  // And the answers are the right ones, not only the same ones.
  expect(evaluated('function f(z: uint8) { return z === 2 + 1; } String(f(3));')).toBe('true');
  expect(evaluated('function f(z: uint8) { switch (z) { case 2 + 1: return "hit"; default: return "miss"; } } f(3);')).toBe('hit');
  expect(evaluated('function f(z: uint8) { return Object.is(z, 2 + 1); } String(f(3));')).toBe('true');
  expect(evaluated('function f(z: uint32) { return z < 4 * 4; } String(f(3));')).toBe('true');
  expect(evaluated('function f(z) { return z * (4 * 4); } String(f(uint32(3)));')).toBe('48');
});

test('it is the expression\'s value that takes the type, exactly', () => {
  // Past the integers a Number holds, and in the families a Number cannot denote.
  expect(evaluated('function f(z: uint64) { return z + (9007199254740992 + 1); } String(f(0));')).toBe('9007199254740993');
  expect(evaluated('const z: decimal128 = 0.3; String(z + (0.1 + 0.2));')).toBe('0.6');
  expect(evaluated('const z: decimal128 = 0.3; String(z === 0.1 + 0.2);')).toBe('true');
  expect(evaluated('const z: rational64 = 1 / 3; String(z + 1 / 3);')).toBe('2/3');
  expect(evaluated('const z: rational64 = 1 / 3; String(z === 2 / 6);')).toBe('true');
  expect(evaluated('const b: bigint = 3n; String(b * (2 * 2));')).toBe('12');
  // Folded before it is typed, so the typed arithmetic's wrapping never applies to it.
  expect(evaluated('function f(z: uint8) { return 300 - 100 + z; } String(f(3));')).toBe('203');
  // Division beside an integer is the integer's (rational.md, "the context decides").
  expect(evaluated('function f(z: uint32) { return z * (7 / 2); } String(f(3));')).toBe('9');
  // Beside a vector the constant takes the lane type, and a class operator's parameter types it.
  expect(evaluated('const v = float32x4(1, 2, 3, 4); const r = v * (2 * 2); String(r.x) + "," + String(r.w);')).toBe('4,16');
  expect(evaluated('class V { x: float32 = 1; operator*(n: float32): float32 { return this.x * n; } } String(new V() * (4 * 4));')).toBe('16');
});

test('a value the type cannot hold is refused as the literal is', () => {
  expect(observeScript('function f(z: uint8) { return z + (200 + 100); }')).toMatchObject(early('rt-numeric-range'));
  expect(observeScript('function f(z: uint8) { return 200 + 100 + z; }')).toMatchObject(early('rt-numeric-range'));
  expect(observeScript('function f(z: uint32) { return 2 ** 40 * z; }')).toMatchObject(early('rt-numeric-range'));
  expect(observeScript('function f(z: uint32) { return z * -(4 * 4); }')).toMatchObject(early('rt-numeric-range'));
  expect(observeScript('class V { x: uint8 = 1; operator*(n: uint8): uint8 { return n; } } new V() * (200 + 100);')).toMatchObject(early('rt-numeric-range'));
  // The judgments of a literal operand read the expression's value as well.
  expect(observeScript('function f(z: uint8) { return z / (1 - 1); }')).toMatchObject(early('rt-zero-divisor'));
  expect(observeScript('function f(z: uint8) { return z << (4 + 4); }')).toMatchObject(early('rt-shift-distance'));
  expect(observeScript('class V { x: uint8 = 1; } new V() * (4 * 4);')).toMatchObject(early('rt-numeric-operator'));
  // In an equality a value the type cannot hold is equal to nothing of it.
  expect(evaluated('function f(z: uint8) { return z === 200 + 100; } String(f(44));')).toBe('false');
});

test('a signed constant is the constant under a sign', () => {
  expect(evaluated('const K = 16; function f(z: int32) { return z * -K; } String(f(3));')).toBe('-48');
  expect(evaluated('const K = 4 ** 2; function f(z: int32) { return z * -(K); } String(f(3));')).toBe('-48');
  expect(evaluated('const K = 9007199254740993; function f(z: int64) { return z + -K; } String(f(0));')).toBe('-9007199254740993');
  expect(evaluated('const K = 0.1; const z: decimal128 = 0.3; String(z + -K);')).toBe('0.2');
  expect(observeScript('const K = 16; function f(z: uint32) { return z * -K; }')).toMatchObject(early('rt-numeric-range'));
});

test('what is not a constant expression is still a value of its own type', () => {
  // A call, a `let`, and a binding of the `number` type are values, and do not take a type.
  expectThrown('function f(z: uint32) { return z * Math.pow(4, 2); } f(3);', 'different numeric types and do not mix');
  expectThrown('let K = 16; function f(z: uint32) { return z * (K * 1); } f(3);', 'do not mix');
  expect(observeScript('function f(z: uint32, n: number) { return z * (n * 2); }')).toMatchObject(early('rt-numeric-operator'));
  // The bitwise operators are not among the operators of a constant expression, named or written.
  expectThrown('function f(z: uint32) { return z & (0xF0 | 0x0F); } f(3);', 'do not mix');
  expectThrown('const K = 0xF0 | 0x0F; function f(z: uint32) { return z & K; } f(3);', 'do not mix');
  // Untyped code computes as it always has.
  expect(evaluated('function f(x) { return x * (4 * 4); } String(f(3)) + typeof f(3);')).toBe('48number');
  expect(evaluated('String("a" + (1 + 2)) + String(7 / 2 + 7 / 2);')).toBe('a37');
  expect(evaluated('const n: number = 3; String(n * (7 / 2));')).toBe('10.5');
});

test('the constants of the Math object take part as a const does', () => {
  // #sec-static-type-of-an-expression: they "participate as such a `const` does, since none of
  // them can be written as a literal that denotes it". One was read only as a bare operand.
  const pi32 = String(Math.fround(Math.PI));
  const tau32 = String(Math.fround(2 * Math.PI));
  expect(evaluated('function f(r: float32) { return r * Math.PI; } String(f(1));')).toBe(pi32);
  expect(evaluated('const TAU = 2 * Math.PI; function f(r: float32) { return r * TAU; } String(f(1));')).toBe(tau32);
  expect(evaluated('function f(r: float32) { return r * (2 * Math.PI); } String(f(1));')).toBe(tau32);
  expect(evaluated('const P = Math.PI; function f(r: float32) { return r * P; } String(f(1));')).toBe(pi32);
  expect(evaluated('function rad(deg: float32): float32 { return deg * (Math.PI / 180); } String(rad(180));')).toBe(pi32);
  expect(evaluated('function f(r: float32) { return r * -Math.PI; } String(f(1));')).toBe(`-${pi32}`);
  // At a position that wants a binary float it is the literal of its value.
  expect(evaluated('let k: float32 = Math.PI; String(Reflect.typeOf(k) === float32) + String(k);')).toBe(`true${pi32}`);
  expect(evaluated('let k: float32 = -Math.PI; String(k);')).toBe(`-${pi32}`);
  expect(evaluated('let k: float64 = Math.E; String(k);')).toBe(String(Math.E));
  expect(evaluated('const P = Math.PI; let k: float32 = P; String(k);')).toBe(pi32);
  expect(evaluated('function g(a: float32) { return a; } String(g(Math.PI));')).toBe(pi32);
  expect(evaluated('function g(): float32 { return Math.PI; } String(g());')).toBe(pi32);
  expect(evaluated('const a: [].<float32> = [Math.PI, 2 * Math.PI]; String(a[0]) + "," + String(a[1]);')).toBe(`${pi32},${tau32}`);
  expect(evaluated('function f(z: float32) { return z < Math.PI; } String(f(1));')).toBe('true');
  expect(evaluated('function f(z: float64) { return z === Math.PI; } String(f(Math.PI));')).toBe('true');
  // An integer position refuses it as it refuses any fraction, and a family a Number does not
  // denote exactly asks for a conversion.
  expect(observeScript('let k: uint32 = Math.PI;')).toMatchObject(early('rt-assignability'));
  expect(observeScript('let k: decimal128 = Math.PI;')).toMatchObject(early('rt-assignability'));
  // With no type wanted it is the Number it always was, and a Math the program declares is not it.
  expect(evaluated('const p = Math.PI; String(Reflect.typeOf(p) === number) + String(p === Math.PI);')).toBe('truetrue');
  expect(observeScript('function f(z: float32) { const Math = { PI: 3 }; return z * (2 * Math.PI); }')).toMatchObject(early('rt-numeric-operator'));
});
