import { expect, test } from 'vitest';
import { evaluated, expectThrown, observeScript } from '../harness.mts';

/**
 * Question AN, AN1: a literal or constant beside an operand of the `bigint` type takes that type in
 * a comparison as it does in arithmetic.
 *
 * The specification says "`bigint` takes a plain integer literal like any other numeric type", and
 * that in a comparison a literal "still takes the other operand's type". The engine applied this to
 * `b * 3` and not to `b === 3`, so one constant had two values: `7 / 2` was 3 in `b * (7 / 2)` and
 * 3.5 in `b < 7 / 2`, and `b === 3` was always *false*, with `switch (b) { case 3: }` missing, or
 * refused as a test that can never succeed where `b` is a `const`. A literal that denotes no
 * integer, `b < 3.5`, keeps JavaScript's comparison of a BigInt with a Number, and code that names
 * no type keeps JavaScript's answers.
 *
 * And a literal is its value however it is spelled, as beside a `uint32`: `b * 3.0` is `b * 3n`,
 * where it was a TypeError, and `b * 3.5`, which JavaScript refuses every time it runs, is refused
 * before the program runs.
 */

const early = (rule: string) => ({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule } });
const F = 'function f(b: bigint) { return ';

test('an integer literal beside a bigint compares as that bigint', () => {
  expect(evaluated(`${F}String(b === 3) + String(b == 3) + String(b !== 3) + String(3 === b); } f(3n);`)).toBe('truetruefalsetrue');
  expect(evaluated(`${F}String(Object.is(b, 3)) + String(Object.is(3, b)); } f(3n);`)).toBe('truetrue');
  expect(evaluated(`${F}String(b === -3) + String(b === 3); } f(-3n);`)).toBe('truefalse');
  // The literal is read from its text, so a value past 2**53 is exact.
  expect(evaluated(`${F}String(b === 9007199254740993) + String(b === 9007199254740992); } f(9007199254740993n);`)).toBe('truefalse');
  // A named constant is its initializer written there; a spelling with a fraction or an exponent
  // that denotes an integer is that integer.
  expect(evaluated(`const K = 3; ${F}String(b === K) + String(b === 3.0) + String(b === 3e0) + String(b === 0x3); } f(3n);`)).toBe('truetruetruetrue');
  // A `const` annotated `bigint` holds its literal, and compares the same way.
  expect(evaluated('const b: bigint = 3n; String(b === 3) + String(b == 3);')).toBe('truetrue');
});

test('a constant beside a bigint is the integer it denotes, its division an integer division', () => {
  expect(evaluated(`${F}String(b * (7 / 2)) + String(b < 7 / 2) + String(b <= 7 / 2) + String(b === 7 / 2) + String(7 / 2 < b); } f(3n);`))
    .toBe('9falsetruetruefalse');
  expect(evaluated(`const H = 7 / 2; ${F}String(b < H) + String(b === H) + String(H); } f(3n);`)).toBe('falsetrue3.5');
  // A fraction among the literals makes the division exact, and `6.0 / 2` is 3.
  expect(evaluated(`${F}String(b === 6.0 / 2) + String(b * (6.0 / 2)); } f(3n);`)).toBe('true9');
});

test('a literal that denotes no integer keeps the comparison of a BigInt with a Number', () => {
  expect(evaluated(`${F}String(b < 3.5) + String(b > 2.5) + String(b === 3.5) + String(b < 7.0 / 2); } f(3n);`)).toBe('truetruefalsetrue');
});

test('a case label beside a bigint discriminant is the integer it denotes', () => {
  expect(evaluated('function f(b: bigint) { switch (b) { case 3: return "hit"; default: return "miss"; } } f(3n) + f(4n);')).toBe('hitmiss');
  expect(evaluated('function f(b: bigint) { switch (b) { case 7 / 2: return "hit"; default: return "miss"; } } f(3n);')).toBe('hit');
  expect(evaluated('function f(b: bigint) { switch (b) { case -3: return "hit"; default: return "miss"; } } f(-3n);')).toBe('hit');
  expect(evaluated('function f(b: bigint, c: boolean) { switch (b) { case (c ? 3 : 4): return "hit"; default: return "miss"; } } f(4n, false) + f(3n, true);')).toBe('hithit');
  expect(evaluated('const b: bigint = 3n; let r = "miss"; switch (b) { case 3: r = "hit"; } r;')).toBe('hit');
  expect(evaluated('const b: bigint = 3n; let r = "miss"; switch (b) { case 7 / 2: r = "hit"; } r;')).toBe('hit');
  // A label is judged at the value it denotes: one the discriminant cannot be, a repeat of an
  // earlier label, and a literal that is no bigint can never succeed.
  expect(observeScript('const b: bigint = 3n; switch (b) { case 4: break; }')).toMatchObject(early('rt-impossible-test'));
  expect(observeScript('function f(b: bigint) { switch (b) { case 3: return 1; case 3n: return 2; } return 0; }')).toMatchObject(early('rt-impossible-test'));
  expect(observeScript('function f(b: bigint) { switch (b) { case 3.5: return 1; } return 0; }')).toMatchObject(early('rt-impossible-test'));
});

test('a test against an integer literal narrows to that bigint', () => {
  expect(evaluated('function f(b: bigint) { if (b === 3) { const t: 3n = b; return String(t); } return "miss"; } f(3n) + f(4n);')).toBe('3miss');
  expect(evaluated('function f(b: bigint) { if (Object.is(b, 3)) return "hit"; return "miss"; } f(3n);')).toBe('hit');
  expect(observeScript('function f(b: bigint) { if (b === 3.5) return 1; return 0; }')).toMatchObject(early('rt-impossible-test'));
});

test('code that names no type keeps JavaScript\'s answers', () => {
  expect(evaluated('const b = 3n; String(b === 3) + String(b == 3) + String(b < 7 / 2);')).toBe('falsetruetrue');
  expect(evaluated('let b = 3n; String(b === 3) + String(Object.is(b, 3));')).toBe('falsefalse');
  expect(evaluated('const b: any = 3n; String(b === 3);')).toBe('false');
  expect(evaluated('const b = 3n; let r = "miss"; switch (b) { case 3: r = "hit"; } r;')).toBe('miss');
  // A BigInt the library makes, or a literal, carries no contract the program wrote.
  expect(evaluated('String(65n === 65) + String(BigInt(3) === 3) + String(Object.is(3n, 3));')).toBe('falsefalsefalse');
  expect(evaluated('const B = BigInt(3); function g() { return 3n; } String(B === 3) + String(g() === 3);')).toBe('falsefalse');
  // A function that declares its result does.
  expect(evaluated('function g(): bigint { return 3n; } String(g() === 3);')).toBe('true');
});

test('beside a bigint a literal is its value however it is spelled', () => {
  expect(evaluated(`${F}String(b * 3.0) + " " + String(b * 3e0) + " " + String(b * 2.5e1); } f(3n);`)).toBe('9 9 75');
  expect(evaluated(`const K = 3.0; ${F}String(b + K); } f(3n);`)).toBe('6');
  expect(evaluated('const k: bigint = 9007199254740993.0; String(k) + typeof k;')).toBe('9007199254740993bigint');
  expect(evaluated('const k: bigint = 6.0 / 2; String(k);')).toBe('3');
});

test('a literal or constant that denotes no integer is refused beside a bigint in arithmetic', () => {
  for (const source of [
    `${F}b * 3.5; }`,
    `${F}b - -0.5; }`,
    `${F}b * (7.0 / 2); }`,
    `const K = 3.5; ${F}b * K; }`,
    'const k: bigint = 7.0 / 2;',
  ]) {
    expect(observeScript(source), source).toMatchObject(early('rt-numeric-range'));
  }
  expectThrown(`${F}b * 3.5; }`, '"3.5" is not in the range of "bigint"');
});
