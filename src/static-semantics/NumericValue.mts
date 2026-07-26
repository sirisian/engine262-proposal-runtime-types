import { Value } from '../value.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { IsBigIntContextLiteral } from '../type-system/check.mts';

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
  return Value(node.value);
}
