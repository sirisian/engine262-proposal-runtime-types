import { Parser } from './Parser.mts';
import { Token, TokenValues } from './tokens.mts';
import type { ParseNode } from './ParseNode.mts';

/**
 * proposal-runtime-types `sec-token-records`, `sec-tokensof`: the token stream
 * of a decorated construct.
 *
 * This is what a decorator READS of the syntax it decorates, and - once
 * replacement lands - what one RETURNS. It is deliberately below a syntax tree:
 * the lexical grammar is already normative and changes far more slowly than the
 * syntactic grammar, so a token vocabulary can be exposed without inventing one.
 */

/** `sec-source-reference-record`: which buffer a token's text lives in. */
export interface SourceRefRecord {
  /** The module's URL, for a token that was written. */
  readonly URL: string | undefined;
  /** The replacement decorator that produced it, or *undefined* if written. */
  readonly Macro: string | undefined;
  /** 0 for written source; n for the nth expansion that produced it. */
  readonly Generation: number;
  /**
   * The buffer itself.
   *
   * A Source Reference Record NAMES a buffer, so it must be able to produce
   * one: `toString` recovers the trivia between two tokens by slicing between
   * their spans, and there is nowhere else the text could come from. This is
   * what makes a separate source-text field on a reflection unnecessary - the
   * gap between adjacent spans IS the comments and whitespace.
   */
  readonly Text: string;
}

/** `sec-span-record`: where a token came from. */
export interface SpanRecord {
  readonly Source: SourceRefRecord;
  readonly Start: number;
  readonly End: number;
}

export type TokenKind =
  | 'identifier'
  | 'punctuator'
  | 'numeric'
  | 'string'
  | 'template'
  | 'regexp'
  | 'group';

/** `sec-token-records`. */
export interface TokenRecord {
  readonly Kind: TokenKind;
  /** The token's source text. For a `group`, the opening delimiter. */
  readonly Value: string;
  readonly Span: SpanRecord;
  /** For a `group`, the tokens it delimits; *undefined* otherwise. */
  readonly Tokens: readonly TokenRecord[] | undefined;
}

/**
 * The lexical form of a token, as `sec-token-records` names them.
 *
 * `regexp` and `punctuator` are DISTINCT KINDS, and the reason is specific to
 * this language: the lexical grammar is not context-free, and `InputElementDiv`
 * against `InputElementRegExp` resolves `/` differently. A token stream is
 * therefore parse-informed rather than purely lexical. Reading is unaffected -
 * the goal symbol was already chosen when the source was scanned - but a
 * replacement decorator that PRODUCES a `/` has to say which it means, and the
 * kind is where it says so. Resolving it by construction is what keeps the
 * engine from re-parsing a macro's output to find out.
 */
function kindOf(type: Token): TokenKind {
  switch (type) {
    case Token.IDENTIFIER:
    case Token.PRIVATE_IDENTIFIER:
      return 'identifier';
    case Token.NUMBER:
    case Token.BIGINT:
      return 'numeric';
    case Token.STRING:
      return 'string';
    case Token.TEMPLATE:
      return 'template';
    default:
      // Every keyword is an IdentifierName lexically, so `class` and `x` are one
      // kind here. A macro that cares which it has compares [[Value]]; a macro
      // that only moves tokens around does not have to know the keyword list,
      // which is the list most likely to grow.
      return /^[a-z]+$/.test(TokenValues[type] ?? '') ? 'identifier' : 'punctuator';
  }
}

const OPENERS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

/**
 * `sec-tokensof`: the Token Records of _node_'s source text.
 *
 * DELIMITED RUNS ARE GROUPED rather than flat, so a macro cannot produce
 * unbalanced output: the delimiters of a group are the record's, not two tokens
 * a producer has to remember to pair.
 *
 * The grouping here is a depth stack over an already-parsed construct, so the
 * delimiters are balanced by construction and the stack cannot underflow. That
 * is why this is not a second delimiter matcher competing with the parser's:
 * finding a boundary in UNPARSED text is a different problem, and it belongs to
 * expansion rather than here.
 */
export function TokensOf(node: ParseNode, source: SourceRefRecord): readonly TokenRecord[] {
  const text = sourceTextOf(node);
  if (text === undefined) {
    return [];
  }
  return tokenizeText(text, source, node.location?.startIndex ?? 0);
}

/** The exact source text a node matched. */
export function sourceTextOf(node: ParseNode): string | undefined {
  const loc = (node as { location?: { startIndex?: number, endIndex?: number, source?: string } }).location;
  if (!loc || loc.source === undefined || loc.startIndex === undefined || loc.endIndex === undefined) {
    return undefined;
  }
  return loc.source.slice(loc.startIndex, loc.endIndex);
}

/**
 * Tokenize a buffer into records. `offset` is added to every span index, so a
 * node's tokens carry positions in the MODULE rather than in the slice that was
 * lexed - which is what makes a span usable for a diagnostic.
 */
export function tokenizeText(text: string, source: SourceRefRecord, offset = 0): readonly TokenRecord[] {
  const parser = new Parser({ source: text, specifier: 'tokens-of' });
  const flat: { data: { type: Token, startIndex: number, endIndex: number }, text: string }[] = [];
  for (;;) {
    const t = parser.peek();
    if (t.type === Token.EOS) {
      break;
    }
    parser.next();
    flat.push({ data: t, text: text.slice(t.startIndex, t.endIndex) });
  }

  let index = 0;
  const build = (closer: string | undefined): TokenRecord[] => {
    const out: TokenRecord[] = [];
    while (index < flat.length) {
      const { data, text: raw } = flat[index];
      const span: SpanRecord = {
        Source: source,
        Start: data.startIndex + offset,
        End: data.endIndex + offset,
      };
      if (closer !== undefined && raw === closer) {
        index += 1;
        return out;
      }
      if (OPENERS[raw] !== undefined) {
        const openStart = data.startIndex + offset;
        index += 1;
        const inner = build(OPENERS[raw]);
        const closeEnd = index > 0 ? flat[index - 1].data.endIndex + offset : span.End;
        out.push({
          Kind: 'group',
          Value: raw,
          Span: { Source: source, Start: openStart, End: closeEnd },
          Tokens: inner,
        });
        continue;
      }
      index += 1;
      out.push({
        Kind: kindOf(data.type),
        Value: raw,
        Span: span,
        Tokens: undefined,
      });
    }
    return out;
  };
  return build(undefined);
}
