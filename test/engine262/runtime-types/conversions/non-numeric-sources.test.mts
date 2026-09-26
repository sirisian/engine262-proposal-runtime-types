import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind } from '../harness.mts';

/**
 * A non-numeric value is never a conversion source for a numeric type, and every
 * numeric type has one parse contract.
 *
 * #sec-convertvalue has no step for a string, a boolean, *null*, *undefined*, a
 * symbol or an object at a numeric target - only `string` and `boolean` targets
 * have a PrimitiveConvert step - so each reaches none and throws; and
 * #sec-parsing: "A `string` is deliberately not a conversion source for a numeric
 * type ... enforced at the explicit conversion too". `number` converted all of
 * them through ToNumber - `'' := number` was 0 and `[5] := number` 5 - and the
 * decimal types converted a string, where the other eighteen numeric types
 * refuse. `parse` and `tryParse` are the way from a string, at every type.
 */

const NUMERIC = ['int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64', 'bigint',
  'float16', 'float32', 'float64', 'number', 'float128', 'decimal32', 'decimal64', 'decimal128',
  'rational', 'complex64', 'complex128'];

// Known before the program runs to be non-numeric: refused then.
const STATIC_SOURCES: [string, string, string][] = [
  ['a string literal', '', "'5'"],
  ['a value typed string', "let v: string = '5';", 'v'],
  ['a boolean literal', '', 'true'],
];
// Known only when the program runs: refused then.
const DYNAMIC_SOURCES: [string, string][] = [
  ['a string value', "let v = '5';"], ['a String object', "let v = new String('5');"], ['a boolean value', 'let v = true;'],
  ['null', 'let v = null;'], ['undefined', 'let v = undefined;'], ['a symbol', 'let v = Symbol();'],
  ['an object', 'let v = {};'], ['an array', 'let v = [5];'],
];

/** Refused, before the program runs or while it does. */
function expectRefused(source: string): void {
  try {
    expectStaticTypeError(source);
    return;
  } catch {
    // not refused before the program runs; then it must throw while it does
  }
  expectThrownKind(source, 'TypeError');
}

// One test per type: the grid is 660 evaluations, and a single test holding
// them all ran close enough to the timeout to fail on a loaded machine.
for (const type of NUMERIC) {
  test(`a non-numeric source is refused at ${type}, in every spelling`, () => {
    for (const [name, declaration, expression] of STATIC_SOURCES) {
      expectStaticTypeError(`${declaration} ${type}(${expression});`);
      expectStaticTypeError(`${declaration} ${expression} := ${type};`);
      expectStaticTypeError(`${declaration} let x: ${type} = ${expression};`);
      void name;
    }
    for (const [name, declaration] of DYNAMIC_SOURCES) {
      expectRefused(`${declaration} ${type}(v);`);
      expectRefused(`${declaration} v := ${type};`);
      expectRefused(`${declaration} let x: ${type} = v;`);
      void name;
    }
  });
}

test('the other paths refuse a string too', () => {
  for (const type of NUMERIC) {
    expectRefused(`interface S { v: ${type} } let s = '5'; Composite.<S>({ v: s });`);
    expectRefused(`function f(x: ${type}) { return x; } let s = '5'; f(s);`);
    expectRefused(`let s = '5'; [s] := [].<${type}>;`);
  }
});

test('the non-numeric targets and the numeric sources are unchanged', () => {
  expect(evaluated("String(('5' := boolean), (0 := boolean));")).toBe('true');
  expect(evaluated("String([('5' := boolean), (0 := boolean), (null := boolean)]);")).toBe('true,false,false');
  expect(evaluated('String([(5 := string), (5n := string), (true := string)]);')).toBe('5,5,true');
  expect(evaluated('String([(5 := number), ((7 := uint8) := number), (2n ** 64n := number)]);')).toBe('5,7,18446744073709552000');
  expect(evaluated("String((7 := uint8) := decimal128);")).toBe('7');
});

test("JavaScript's own functions are untouched", () => {
  expect(evaluated("String([Number('5'), Number(''), Number('12abc'), Number(true), Number(null), Number([5])]);"))
    .toBe('5,0,NaN,1,0,5');
  expect(evaluated("String([BigInt('5'), BigInt(true)]);")).toBe('5,1');
  expectThrownKind('Number(Symbol());', 'TypeError');
  expect(evaluated("String([parseInt('12abc'), parseFloat('1.5x'), +'5']);")).toBe('12,1.5,5');
});

// One contract, measured at every numeric type: the grammar of the type's
// literal, white space, a sign, numeric separators; a SyntaxError for a string
// that is not a literal and a RangeError for one out of range; tryParse null
// for the SyntaxError and the RangeError for the other.
const INTEGER = ['int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64'];
const UNSIGNED = new Set(['uint8', 'uint16', 'uint32', 'uint64']);
const BINARY = ['float16', 'float32', 'float64', 'float128', 'number'];
const DECIMAL = ['decimal32', 'decimal64', 'decimal128'];
const COMPLEX = ['complex64', 'complex128'];

function expectedParse(type: string, input: string): string {
  // The integers read no fraction or exponent. A rational reads every decimal
  // literal, since each is a literal of the type: `1.5` is 3/2.
  const exact = INTEGER.includes(type) || type === 'bigint';
  const complex = COMPLEX.includes(type);
  const value = (v: string) => (complex ? `${v}+0i` : v);
  switch (input) {
    case '5': case ' 5 ': return value('5');
    case '1_000': return type === 'int8' || type === 'uint8' ? 'RangeError' : value('1000');
    case '1e2': return exact ? 'SyntaxError' : value('100');
    case '1.5': return exact ? 'SyntaxError' : value(type === 'rational' ? '3/2' : '1.5');
    case '12abc': case '': case '0x10': return 'SyntaxError';
    case '1e9999': return exact ? 'SyntaxError' : 'RangeError';
    case '-1': return UNSIGNED.has(type) ? 'RangeError' : (complex ? '-1+0i' : '-1');
    default: throw new Error(input);
  }
}
const run = (expression: string) => evaluated(`let r; try { r = String(${expression}); } catch (e) { r = e.constructor.name; } r;`);

for (const type of [...INTEGER, 'bigint', ...BINARY, ...DECIMAL, 'rational', ...COMPLEX]) {
  test(`parse and tryParse keep the one contract at ${type}`, () => {
    for (const input of ['5', ' 5 ', '1_000', '1e2', '1.5', '12abc', '', '0x10', '1e9999', '-1']) {
      const want = expectedParse(type, input);
      expect(run(`${type}.parse('${input}')`), `${type}.parse('${input}')`).toBe(want);
      expect(run(`${type}.tryParse('${input}')`), `${type}.tryParse('${input}')`).toBe(want === 'SyntaxError' ? 'null' : want);
    }
  });
}

test('the parse contract: number answers a Number, and a complex part is its component', () => {
  expect(evaluated("String(Reflect.typeOf(number.parse('5')));")).toBe('number');
  // A complex part is a value of its component: a float32 part overflows first.
  expect(run("complex64.parse('1e300')")).toBe('RangeError');
  expect(run("complex128.parse('1e300')")).toBe('1e+300+0i');
  expect(run("complex64.parse('1__0')")).toBe('SyntaxError');
});

test('a decimal parse keeps the cohort member', () => {
  expect(evaluated("String([decimal128.parse('1.50'), decimal128.parse('1.5')]);")).toBe('1.50,1.5');
});
