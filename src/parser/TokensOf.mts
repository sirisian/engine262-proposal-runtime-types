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
  | 'group'
  // proposal-runtime-types: a whole JSX element, recorded by the parse as one
  // span and expanded by the mode's scanner. It never survives into a macro's
  // stream as this kind - TokensFromParse turns it into a `group`.
  | 'jsx';

/** `sec-token-records`. */
export interface TokenRecord {
  readonly Kind: TokenKind;
  /** The token's source text. For a `group`, the opening delimiter. */
  readonly Value: string;
  readonly Span: SpanRecord;
  /** For a `group`, the tokens it delimits; *undefined* otherwise. */
  readonly Tokens: readonly TokenRecord[] | undefined;
  /**
   * Whether a LineTerminator preceded this token in its source.
   *
   * **Newlines are semantically significant in JavaScript through ASI**, so a
   * printer that emits a space where the source had a newline can change what a
   * program means. A separator is enough to keep two tokens from merging; it is
   * not enough to keep a statement from joining the one above it.
   */
  readonly LineTerminatorBefore: boolean;

  /**
   * Whether a macro CREATED this token rather than handing back one it received.
   *
   * A created token is PRINTED, with a separator before it; a preserved one is
   * SLICED from the buffer it came from, which is what keeps an untouched run
   * exactly as written, comments included.
   */
  readonly Created?: boolean;
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
export function TokensOf(node: ParseNode | null | undefined, url?: string): readonly TokenRecord[] {
  const text = sourceTextOf(node);
  if (text === undefined) {
    return [];
  }
  // [[Text]] is the node's own text and spans index into IT, so a span always
  // slices back to its token. `location.startIndex` would place the spans in
  // the module instead - which reads better in a diagnostic but breaks
  // `toString`, since the text a span indexes would no longer be the text the
  // record carries. The module offset belongs on the Source Reference Record
  // when expansion needs it, not on the spans.
  const source: SourceRefRecord = {
    URL: url, Macro: undefined, Generation: 0, Text: text,
  };
  return tokenizeText(text, source);
}

/**
 * The exact source text a node matched.
 *
 * Every parse node carries `sourceText` - the whole buffer it was parsed from,
 * which is the retention `Function.prototype.toString` already requires - and
 * `location` gives the node's extent within it. An earlier draft read a
 * `location.source` that does not exist, so this returned *undefined* for every
 * node and `TokensOf` returned an empty List.
 */
export function sourceTextOf(node: ParseNode | null | undefined): string | undefined {
  if (node === null || node === undefined) {
    return undefined;
  }
  // `sourceText` is ALREADY the node's own text, not the buffer it was cut
  // from. Two earlier drafts sliced it by `location`, which are indices into the
  // MODULE - so the slice ran past the end of a short string and produced `''`,
  // and every stream came back empty while every field looked present.
  const n = node as { sourceText?: string };
  return typeof n.sourceText === 'string' ? n.sourceText : undefined;
}

/**
 * Tokenize a buffer into records. `offset` is added to every span index, so a
 * node's tokens carry positions in the MODULE rather than in the slice that was
 * lexed - which is what makes a span usable for a diagnostic.
 */
export function tokenizeText(text: string, source: SourceRefRecord, offset = 0): readonly TokenRecord[] {
  const parser = new Parser({ source: text, specifier: 'tokens-of' });
  const flat: { data: { type: Token, startIndex: number, endIndex: number, hadLineTerminatorBefore?: boolean }, text: string }[] = [];
  for (;;) {
    const t = parser.peek();
    if (t.type === Token.EOS) {
      break;
    }
    parser.next();
    flat.push({ data: t, text: text.slice(t.startIndex, t.endIndex) });
  }

  return groupRuns(flat, source, offset);
}

/**
 * How a `jsx` span is turned into tokens.
 *
 * Set by the mode scanner rather than imported, because the scanner already
 * imports this module for `tokenizeText` - the interpolations inside a JSX
 * element are ECMAScript and are tokenized by it.
 */
let expandJSX: (text: string, source: SourceRefRecord, offset: number) => readonly TokenRecord[] = () => [];

export function SetJSXExpander(f: (text: string, source: SourceRefRecord, offset: number) => readonly TokenRecord[]) {
  expandJSX = f;
}

/** An entry the grouping step can consume, from a fresh lex or from the parse log. */
interface FlatToken {
  readonly data: { type: Token, startIndex: number, endIndex: number, hadLineTerminatorBefore?: boolean };
  readonly text: string;
  readonly kind?: TokenKind;
}

/**
 * The Token Records of _flat_, with delimited runs grouped.
 *
 * Shared by the two ways tokens are produced. `tokenizeText` re-lexes a source
 * slice, which is right for a MODED region - it has no parse to draw on.
 * `TokensFromParse` reads what the parse consumed, which is right for
 * everything else: `sec-tokensof` says "the lexical goal symbol at each position
 * is the one the enclosing parse used", and a re-lex cannot honour that.
 */
function groupRuns(flat: readonly FlatToken[], source: SourceRefRecord, offset: number): readonly TokenRecord[] {
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
      const openHadNewline = (data as { hadLineTerminatorBefore?: boolean }).hadLineTerminatorBefore === true;
        index += 1;
        const inner = build(OPENERS[raw]);
        const closeEnd = index > 0 ? flat[index - 1].data.endIndex + offset : span.End;
        out.push({
          Kind: 'group',
          Value: raw,
          Span: { Source: source, Start: openStart, End: closeEnd },
          Tokens: inner,
          LineTerminatorBefore: openHadNewline,
        });
        continue;
      }
      index += 1;
      const kind = flat[index - 1].kind ?? kindOf(data.type);
      // A `jsx` entry is a whole element, recorded by the parse as one span
      // because its child text is not ECMAScript. It becomes the element's
      // STRUCTURE here - expanded at whatever depth it sits, since a component's
      // JSX is inside a function body inside a declaration.
      if (kind === 'jsx') {
        out.push({
          Kind: 'group',
          Value: raw,
          Span: span,
          Tokens: expandJSX(raw, source, span.Start),
          LineTerminatorBefore: (data as { hadLineTerminatorBefore?: boolean }).hadLineTerminatorBefore === true,
        });
        continue;
      }
      out.push({
        Kind: kind,
        Value: raw,
        Span: span,
        Tokens: undefined,
        LineTerminatorBefore: (data as { hadLineTerminatorBefore?: boolean }).hadLineTerminatorBefore === true,
      });
    }
    return out;
  };
  return build(undefined);
}

/**
 * The Token Records of the source range [_from_, _to_), taken from what the
 * PARSE consumed rather than re-lexed.
 *
 * A regular expression and a template literal are each one token here, because
 * the parse decided they were. Re-lexing the same text cannot: the lexical
 * grammar is not context-free, so `/ab/g` comes back as `/`, `ab`, `/`, `g` -
 * indistinguishable from a division - and `` `a${x}b` `` as a backtick, the
 * identifier `a$` and a group.
 */
export function TokensFromParse(
  log: readonly { type: Token, startIndex: number, endIndex: number, kind?: string }[],
  text: string,
  source: SourceRefRecord,
  from: number,
  to: number,
): readonly TokenRecord[] {
  const flat: FlatToken[] = [];
  for (const entry of log) {
    if (entry.startIndex >= from && entry.endIndex <= to) {
      flat.push({
        data: {
          type: entry.type, startIndex: entry.startIndex - from, endIndex: entry.endIndex - from,
        },
        text: text.slice(entry.startIndex, entry.endIndex),
        kind: entry.kind as TokenKind | undefined,
      });
    }
  }
  return groupRuns(flat, source, 0);
}
