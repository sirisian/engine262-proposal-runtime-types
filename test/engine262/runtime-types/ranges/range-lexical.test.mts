import {
  describe, test, expect,
} from 'vitest';
import {
  evaluated, evaluatedFlagOff, expectError, expectErrorFlagOff,
} from '../harness.mts';

/**
 * proposal-runtime-types (ranges.md "The Lexical Problem" and "Syntax";
 * #sec-range-literals): the range family's LEXICAL contract.
 *
 * The family is six tokens, each taken whole by longest match: `..`, `..<`,
 * `..=`, `<..`, `<..<`, and `<..=`. Every range that has an end marks whether it
 * includes it; a start is marked only where it is exclusive. There is no bare
 * `a..b` and no `..b`.
 *
 * Each is decided by a fixed lookahead, which is what lets them coexist with
 * everything already spelled from `.` and `<`. At a `.` the SECOND character
 * separates the type argument list `.<` from the rest of the family and the
 * third separates `...`, `..<`, and `..=` from `..`; at a `<` the second
 * separates `<=`, `<<`, and `<<=` from the family and the fourth separates
 * `<..<` and `<..=` from `<..`. So `.<` and `..<` are told apart before a third
 * character is read and can never compete, which is the correction ranges.md
 * records against an earlier draft that had ruled `..<` out on exactly that
 * supposed collision.
 *
 * This file owns what the LEXER decides. The rows below are the ones observable
 * without the parser knowing the four new tokens: that nothing which already
 * lexed has moved, and that the one base-adjacent change -- `?.` is not the
 * optional chaining punctuator before a `.` -- does what it says. The family's
 * own forms, the removed forms, the whitespace edges, precedence, and ASI are
 * the second half of the same vector document and land with the parser (E2 of
 * the engine plan); they are written out at the foot of this file, skipped, so
 * the contract reads whole and unskipping them is the next stage's first act.
 *
 * Everything is gated on `runtime-types`. Where the base grammar answers
 * differently with the feature off, the flag-off twin is asserted beside it:
 * the extension may give meaning to input that had none, and may not change
 * what an existing program means.
 */

// -- `.<` is untouched: the second character decides ---------------------------

test('a type argument list still lexes as `.<`', () => {
  expect(evaluated('let a: [].<uint8> = [1, 2]; String(a.length);')).toBe('2');
  expect(evaluated('let a: [].<[].<uint8>> = []; String(a.length);')).toBe('0');
});

test('generic application on a call still lexes as `.<`', () => {
  expect(evaluated('function id<T>(x: T): T { return x; } String(id.<uint8>(3));')).toBe('3');
});

// -- the numeric literal boundary ---------------------------------------------

test('a `.` before a non-`.` is still a decimal point, so `1.<2` is `1. < 2`', () => {
  // The two-dot carve-out in scanNumber is what frees `..`; it does not fire
  // here, so the numeric literal takes the point and `<` is relational. This is
  // pre-existing and holds with the feature off as well.
  expect(evaluated('String(1.<2);')).toBe('true');
  expect(evaluatedFlagOff('String(1.<2);')).toBe('true');
});

test('`...` still wins its triple after a numeric literal', () => {
  // `1...6` is `1` then the spread punctuator, which is a Syntax Error in an
  // expression position -- not a range with an extra dot.
  expectError('const x = 1...6;');
});

// -- the `<` family is decided before `<..` is considered ----------------------

test('`<=`, `<<`, and `<<=` keep their tokens', () => {
  expect(evaluated('String(1<=2);')).toBe('true');
  expect(evaluated('String(1<<2);')).toBe('4');
  expect(evaluated('let x = 1; x<<=2; String(x);')).toBe('4');
});

test('`<` before a `.` that is not followed by another `.` stays relational', () => {
  // `a < .5` needs the THIRD character to be a `.` before `<..` is taken, so a
  // fractional literal after a comparison is unaffected.
  expect(evaluated('String(1 < .5);')).toBe('false');
  expect(evaluatedFlagOff('String(1 < .5);')).toBe('false');
});

// -- the `?.` lookahead gains one character -----------------------------------

test('optional chaining and the digit carve-out are unchanged', () => {
  expect(evaluated('const o = { b: 7 }; String(o?.b);')).toBe('7');
  expect(evaluated('String(true?.5:2);')).toBe('0.5');
  expect(evaluatedFlagOff('const o = { b: 7 }; String(o?.b);')).toBe('7');
  expect(evaluatedFlagOff('String(true?.5:2);')).toBe('0.5');
});

test('`?.` is not the punctuator before a `.`, so a range may follow a `?`', () => {
  // Without the extension the `?.` would be taken and the trailing `.` would be
  // a Syntax Error. With it, this is a conditional whose consequent is the full
  // range. The spaced form is the same program and pins that spacing is not what
  // rescues it.
  expect(evaluated('String((true?..:2).start);')).toBe('undefined');
  expect(evaluated('String((true ? .. : 2).start);')).toBe('undefined');
});

test('the `?.`-before-`.` extension gives meaning only to input that had none', () => {
  // Flag off, the same source is what it always was: a Syntax Error. The
  // extension is safe precisely because `?.` followed by `.` is rejected under
  // every production that consumes the punctuator.
  expectErrorFlagOff('String((true?..:2).start);');
  // And a `?.` followed by `.` that forms no range stays an error either way.
  expectError('const a = 1, b = 2; String(a?..b);');
  expectErrorFlagOff('const a = 1, b = 2; String(a?..b);');
});

// -- the feature gate ---------------------------------------------------------

test('with the feature off the base grammar keeps `1..toString()`', () => {
  // The one idiom the range operator costs. With the feature off it is still a
  // numeric literal `1.` followed by a member access, and evaluates to "1".
  expect(evaluatedFlagOff('1..toString();')).toBe('1');
});

test('with the feature off the new tokens are not tokens', () => {
  expectErrorFlagOff('const x = 1..<6;');
  expectErrorFlagOff('const x = 1<..<6;');
  expectErrorFlagOff('const x = 5<..;');
});

/**
 * The parser's half of the same vector document, transcribed from
 * STAGE-A-lexical-tests.md. Each token fixes both bounds and whether an end
 * follows, which is what let the follow-set heuristic go: a bare `..` is now
 * unambiguously the from form, so `a..b` needs no rejection code -- the range
 * finishes and the dangling operand is the ordinary unexpected-token error.
 */
describe('the family, its removed forms, and its edges', () => {
  test('the four two-endpoint forms', () => {
    expect(evaluated('(1..<6).end;')).toBe('6');
    expect(evaluated('(1..=6).end;')).toBe('6');
    expect(evaluated('(1<..<6).start;')).toBe('1');
    expect(evaluated('(1<..=6).end;')).toBe('6');
  });

  test('the open-ended forms', () => {
    expect(evaluated('(5<..).start;')).toBe('5');
    expect(evaluated('String((5<..).end);')).toBe('undefined');
    expect(evaluated('(..<6).end;')).toBe('6');
    expect(evaluated('(..=6).end;')).toBe('6');
    expect(evaluated('String((..).start);')).toBe('undefined');
  });

  test('numeric literals against the family', () => {
    expect(evaluated('(1..<.5).end;')).toBe('0.5');
    expect(evaluated('(1.5..<2.5).end;')).toBe('2.5');
    expect(evaluated('(-5..<5).start;')).toBe('-5');
  });

  test('the forms that are gone are Syntax Errors', () => {
    expectError('const a = 1, b = 2; const x = a..b;');
    expectError('const x = ..6;');
    expectError('const x = 1..6;');
    // `1..` is a complete from-range, so an identifier cannot continue it. The
    // idiom fails at the parse rather than at construction.
    expectError('1..toString();');
    expectError('const x = 1..x;');
  });

  test('whitespace is significant at the family edges', () => {
    // Each spaced form is a Syntax Error, and the reason is PRECEDENCE rather
    // than anything about the range value: a range binds looser than the
    // relational operators, so a range can never be a relational operand. None
    // of these is the range the unspaced form spells, and none of them is a
    // program at all.
    expectError('const a = 1, b = 2; String(a.. < b);');
    expectError('const a = 1, b = 2; String(a < ..);');
    expectError('const a = 1, b = 2; String(a <.. < b);');
    expectError('const a = 1, b = 2; a <.. = b;');
  });

  test('a PARENTHESIZED range is rejected as a relational operand', () => {
    // Parentheses put the range back under the relational operators, where the
    // base language would apply an ordinary object comparison and answer false.
    // It is rejected instead: a range does not implement `Ordered`, so the
    // comparison is meaningless, and answering it silently is worse than an
    // error because it is invisible.
    const kind = (src) => `let k = "none"; try { ${src} } catch (e) { k = e.constructor.name; } k;`;
    expect(evaluated(kind('const a = 1, b = 2; (a..) < b;'))).toBe('TypeError');
    expect(evaluated(kind('(0..<3) < 5;'))).toBe('TypeError');
  });

  test('neighbouring operators still win their tokens against the family', () => {
    // `<<` is taken before `<..` is considered, so this is `a << (..<b)`; the
    // shift then rejects a range operand on precedence, as above.
    expectError('const a = 1, b = 2; String(a<<..<b);');
  });

  test('the conditional takes a marked range as its consequent', () => {
    expect(evaluated('(true?..<5:2).end;')).toBe('5');
    expect(evaluated('(true?..=5:2).end;')).toBe('5');
  });

  test('the family is non-associative', () => {
    expectError('const x = 1..<2..<3;');
    expectError('const x = 1<..<2<..<3;');
  });

  test('precedence: ShortCircuit operands, member access, spread, pipeline', () => {
    expect(evaluated('const a = null, b = 1; ((a ?? b)..<3).start;')).toBe('1');
    expect(evaluated('const arr = [1, 2, 3]; (0..<arr.length).end;')).toBe('3');
    expect(evaluated('(0..<10).length;')).toBe('10');
    expect(evaluated('const a = [...0..<3]; a.join(",");')).toBe('0,1,2');
  });

  test('ASI: a line beginning with a family token continues the previous expression', () => {
    expect(evaluated('const r = 1\n..<6\nr.end;')).toBe('6');
    expect(evaluated('const s = 1\n<..\nString(s.start);')).toBe('1');
  });
});
