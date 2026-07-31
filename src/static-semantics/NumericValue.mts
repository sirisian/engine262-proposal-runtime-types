import { Value } from '../value.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { IsBigIntContextLiteral, DecimalContextLiteralWidth } from '../type-system/check.mts';
import { CreateDecimalValue, ParseDecimalDigits } from '../intrinsics/Decimal.mts';
import { surroundingAgent } from '#self';

/**
 * proposal-runtime-types: a literal the checker read at `bigint` evaluates to
 * the BigInt its SOURCE TEXT denotes, not to the double the lexer produced.
 * The two have to agree - the checker admitted the literal on the strength of
 * the exact value, so the run time must produce it - and the double is already
 * wrong by then: `9007199254740993` is ...992 from the moment it is scanned
 * (F67). Every other literal is unaffected and answers exactly as before.
 */
export function NumericValue(node: ParseNode.NumericLiteral) {
  if (typeof node.value === 'number' && typeof node.SourceText === 'string' && IsBigIntContextLiteral(node)) {
    return Value(BigInt(node.SourceText.replace(/_/g, '')));
  }
  // A literal the checker read at a DECIMAL type evaluates to the decimal its
  // SOURCE TEXT denotes, and the reason is sharper than bigint's: the double is
  // not merely imprecise here, it cannot represent the answer at all. `1.0` and
  // `1.00` are ONE double and TWO decimals, so the cohort member exists only in
  // the text.
  const source = typeof node.SourceText === 'string' ? node.SourceText : undefined;
  const width = source !== undefined ? DecimalContextLiteralWidth(node) : undefined;
  if (width !== undefined && source !== undefined) {
    const digits = ParseDecimalDigits(source.replace(/_/g, ''));
    if (digits) {
      return CreateDecimalValue(digits.significand, digits.exponent, width, surroundingAgent.currentRealmRecord);
    }
  }
  return Value(node.value);
}
