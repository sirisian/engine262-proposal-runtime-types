import isUnicodeIDStartRegex from '@unicode/unicode-17.0.0/Binary_Property/ID_Start/regex.js';
import isUnicodeIDContinueRegex from '@unicode/unicode-17.0.0/Binary_Property/ID_Continue/regex.js';
import isSpaceSeparatorRegex from '@unicode/unicode-17.0.0/General_Category/Space_Separator/regex.js';
import { UTF16SurrogatePairToCodePoint } from '../static-semantics/all.mts';
import {
  Assert, CallFrame, isErrorObject, isLeadingSurrogate, isTrailingSurrogate, ObjectValue, surroundingAgent,
  Throw,
  ThrowCompletion,
} from '../index.mts';
import type { ErrorObject } from '../intrinsics/Error.mts';
import { __ts_cast__ } from '../utils/language.mts';
import { getHostDefinedErrorDetails } from '../utils/stack.mts';
import {
  Token,
  TokenNames,
  TokenValues,
  KeywordLookup,
  isKeywordRaw,
} from './tokens.mts';
import type { Location, Position } from './ParseNode.mts';

export type Locatable =
  | TokenData
  | Position
  | Location
  | { readonly location: Location };

const isUnicodeIDStart = (c: string) => c && isUnicodeIDStartRegex.test(c);
const isUnicodeIDContinue = (c: string) => c && isUnicodeIDContinueRegex.test(c);
export const isDecimalDigit = (c: string) => c && /\d/u.test(c);
export const isHexDigit = (c: string) => c && /[\da-f]/ui.test(c);
const isOctalDigit = (c: string) => c && /[0-7]/u.test(c);
const isBinaryDigit = (c: string) => (c === '0' || c === '1');
export const isWhitespace = (c: string) => c && (/[\u0009\u000B\u000C\u0020\u00A0\uFEFF]/u.test(c) || isSpaceSeparatorRegex.test(c)); // eslint-disable-line no-control-regex
export const isLineTerminator = (c: string | number) => {
  // Line Separator (U+2028) and Paragraph Separator (U+2029)
  // Line Feed (U+000A) and Carriage Return (U+000D)
  if (typeof c === 'string') {
    return !!c && /[\r\n\u2028\u2029]/u.test(c);
  }
  return c === 0x2028 || c === 0x2029 || c === 0xa || c === 0xd;
};
const isRegularExpressionFlagPart = (c: string) => c && (isUnicodeIDContinue(c) || c === '$');
export const isIdentifierStart = (c: string) => SingleCharTokens[c] === Token.IDENTIFIER || isUnicodeIDStart(c);
export const isIdentifierPart = (c: string) => SingleCharTokens[c] === Token.IDENTIFIER || c === '\u{200C}' || c === '\u{200D}' || isUnicodeIDContinue(c);

const SingleCharTokens: { [key: string]: number } = {
  '__proto__': null!,
  '0': Token.NUMBER,
  '1': Token.NUMBER,
  '2': Token.NUMBER,
  '3': Token.NUMBER,
  '4': Token.NUMBER,
  '5': Token.NUMBER,
  '6': Token.NUMBER,
  '7': Token.NUMBER,
  '8': Token.NUMBER,
  '9': Token.NUMBER,
  'a': Token.IDENTIFIER,
  'b': Token.IDENTIFIER,
  'c': Token.IDENTIFIER,
  'd': Token.IDENTIFIER,
  'e': Token.IDENTIFIER,
  'f': Token.IDENTIFIER,
  'g': Token.IDENTIFIER,
  'h': Token.IDENTIFIER,
  'i': Token.IDENTIFIER,
  'j': Token.IDENTIFIER,
  'k': Token.IDENTIFIER,
  'l': Token.IDENTIFIER,
  'm': Token.IDENTIFIER,
  'n': Token.IDENTIFIER,
  'o': Token.IDENTIFIER,
  'p': Token.IDENTIFIER,
  'q': Token.IDENTIFIER,
  'r': Token.IDENTIFIER,
  's': Token.IDENTIFIER,
  't': Token.IDENTIFIER,
  'u': Token.IDENTIFIER,
  'v': Token.IDENTIFIER,
  'w': Token.IDENTIFIER,
  'x': Token.IDENTIFIER,
  'y': Token.IDENTIFIER,
  'z': Token.IDENTIFIER,
  'A': Token.IDENTIFIER,
  'B': Token.IDENTIFIER,
  'C': Token.IDENTIFIER,
  'D': Token.IDENTIFIER,
  'E': Token.IDENTIFIER,
  'F': Token.IDENTIFIER,
  'G': Token.IDENTIFIER,
  'H': Token.IDENTIFIER,
  'I': Token.IDENTIFIER,
  'J': Token.IDENTIFIER,
  'K': Token.IDENTIFIER,
  'L': Token.IDENTIFIER,
  'M': Token.IDENTIFIER,
  'N': Token.IDENTIFIER,
  'O': Token.IDENTIFIER,
  'P': Token.IDENTIFIER,
  'Q': Token.IDENTIFIER,
  'R': Token.IDENTIFIER,
  'S': Token.IDENTIFIER,
  'T': Token.IDENTIFIER,
  'U': Token.IDENTIFIER,
  'V': Token.IDENTIFIER,
  'W': Token.IDENTIFIER,
  'X': Token.IDENTIFIER,
  'Y': Token.IDENTIFIER,
  'Z': Token.IDENTIFIER,
  '$': Token.IDENTIFIER,
  '_': Token.IDENTIFIER,
  '\\': Token.IDENTIFIER,
  '.': Token.PERIOD,
  ',': Token.COMMA,
  ':': Token.COLON,
  ';': Token.SEMICOLON,
  '%': Token.MOD,
  '~': Token.BIT_NOT,
  '!': Token.NOT,
  '+': Token.ADD,
  '-': Token.SUB,
  '*': Token.MUL,
  '<': Token.LT,
  '>': Token.GT,
  '=': Token.ASSIGN,
  '?': Token.CONDITIONAL,
  '[': Token.LBRACK,
  ']': Token.RBRACK,
  '(': Token.LPAREN,
  ')': Token.RPAREN,
  '/': Token.DIV,
  '^': Token.BIT_XOR,
  '`': Token.TEMPLATE,
  '{': Token.LBRACE,
  '}': Token.RBRACE,
  '&': Token.BIT_AND,
  '|': Token.BIT_OR,
  '"': Token.STRING,
  '\'': Token.STRING,
  '#': Token.PRIVATE_IDENTIFIER,
  '@': Token.AT,
};

export class TokenData {
  readonly type: Token;

  readonly startIndex: number;

  readonly endIndex: number;

  readonly line: number;

  readonly column: number;

  readonly hadLineTerminatorBefore: boolean;

  readonly name: string;

  readonly value: string | number | bigint | boolean | null;

  readonly escaped: boolean;

  constructor({
    type,
    startIndex,
    endIndex,
    line,
    column,
    hadLineTerminatorBefore,
    name,
    value,
    escaped,
  }: Pick<TokenData, 'type' | 'startIndex' | 'endIndex' | 'line' | 'column' | 'hadLineTerminatorBefore' | 'name' | 'value' | 'escaped'>) {
    this.type = type;
    this.startIndex = startIndex;
    this.endIndex = endIndex;
    this.line = line;
    this.column = column;
    this.hadLineTerminatorBefore = hadLineTerminatorBefore;
    this.name = name;
    this.value = value;
    this.escaped = escaped;
  }

  valueAsString() {
    Assert(typeof this.value === 'string');
    return this.value;
  }

  valueAsNumeric() {
    Assert(typeof this.value === 'number' || typeof this.value === 'bigint');
    return this.value;
  }

  valueAsBoolean() {
    Assert(typeof this.value === 'boolean');
    return this.value;
  }
}

export abstract class Lexer {
  protected abstract readonly source: string;

  protected abstract readonly decoratingSource?: string;

  protected currentToken!: TokenData; // NOTE: unsound definite assignment operator (`!`)

  protected peekToken!: TokenData; // NOTE: unsound definite assignment operator (`!`)

  protected peekAheadToken: TokenData | undefined;

  protected position = 0;

  protected get debug() {
    const e = { HostDefinedMessageString: '', HostDefinedStack: [] } satisfies Partial<ErrorObject>;
    this.decorateSyntaxError(e, this.position);
    return e.HostDefinedMessageString;
  }

  protected line = 1;

  protected columnOffset = 0;

  protected scannedValue!: string | number | Token | bigint | boolean; // NOTE: unsound definite assignment operator (`!`)

  protected lineTerminatorBeforeNextToken = false;

  protected positionForNextToken = 0;

  protected lineForNextToken = 0;

  protected columnForNextToken = 0;

  protected escapeIndex = -1;

  protected abstract readonly specifier?: string;

  earlyErrors = new Set<ErrorObject>();

  decorateSyntaxError(error: Pick<ErrorObject, 'HostDefinedMessageString' | 'HostDefinedStack'>, location: number | Locatable) {
    let startIndex: number;
    // @ts-ignore unused
    let endIndex: number;
    let line: number;
    let column: number | undefined;
    const decoratingSource = this.decoratingSource ?? this.source;
    // NON-SPEC: whether the offending position is the END of the input. A REPL
    // distinguishes source that is malformed from source that is merely
    // unfinished - the first should be reported, the second waited on - and
    // this is the only place that knows which it was.
    const atEndOfInput = typeof location === 'number'
      ? location >= decoratingSource.length
      : ('type' in location && location.type === Token.EOS);
    (error as { HostDefinedAtEndOfInput?: boolean }).HostDefinedAtEndOfInput = atEndOfInput;
    if (typeof location === 'number') {
      line = this.line;
      if (location === decoratingSource.length) {
        while (isLineTerminator(decoratingSource[location - 1])) {
          line -= 1;
          location -= 1;
        }
      }
      startIndex = location;
      endIndex = location + 1;
    } else if ('type' in location && location.type === Token.EOS) {
      line = this.line;
      startIndex = location.startIndex;
      while (isLineTerminator(decoratingSource[startIndex - 1])) {
        line -= 1;
        startIndex -= 1;
      }
      endIndex = startIndex + 1;
    } else {
      if ('location' in location && location.location) {
        location = location.location;
      }
      ({
        startIndex,
        endIndex,
        start: {
          line,
          column,
        } = location as Position, // NOTE: unsound cast
      } = location as Location); // NOTE: unsound cast
    }

    /*
       * Source looks like:
       *
       *  const a = 1;
       *  const b 'string string string'; // a string
       *  const c = 3;                  |            |
       *  |       |                     |            |
       *  |       | startIndex          | endIndex   |
       *  | lineStart                                | lineEnd
       *
       * Exception looks like:
       *
       *  const b 'string string string'; // a string
       *          ^^^^^^^^^^^^^^^^^^^^^^
       *  SyntaxError: unexpected token
      */

    let lineStart = startIndex;
    while (!isLineTerminator(decoratingSource[lineStart - 1]) && decoratingSource[lineStart - 1] !== undefined) {
      lineStart -= 1;
    }

    let lineEnd = startIndex;
    while (!isLineTerminator(decoratingSource[lineEnd]) && decoratingSource[lineEnd] !== undefined) {
      lineEnd += 1;
    }

    if (column === undefined) {
      column = startIndex - lineStart + 1;
    }

    const callFrame = new CallFrame();
    callFrame.columnNumber = column;
    callFrame.lineNumber = line;
    const decoration = `\
${this.specifier ? `${this.specifier}:${line}:${column}\n` : ''}${decoratingSource.slice(lineStart, lineEnd)}
${' '.repeat(startIndex - lineStart)}${'^'.repeat(Math.max(endIndex - startIndex, 1))}`;
    if (typeof error.HostDefinedMessageString === 'string') {
      error.HostDefinedMessageString += `\n${decoration}`;
    }
    error.HostDefinedStack = [callFrame];
  }

  static decorateSyntaxErrorWithScriptId(error: ObjectValue, scriptId: string | undefined) {
    const { callStack } = getHostDefinedErrorDetails(error);
    if (callStack?.[0] instanceof CallFrame) {
      callStack[0].scriptId = scriptId;
    }
  }

  // parseFailure(completion: ThrowCompletion): never;

  addEarlyError({ Value: error }: ThrowCompletion, location: Locatable = this.peek()) {
    if (!isErrorObject(error)) {
      throw new RangeError('Non-syntax error added as early error');
    }
    this.decorateSyntaxError(error, location);
    this.earlyErrors.add(error);
    return error;
  }

  abstract isStrictMode(): boolean;

  raise(error: ThrowCompletion, context: number | Locatable = this.peek()): never {
    if (!isErrorObject(error.Value)) {
      throw new RangeError('Non-syntax error thrown');
    }
    this.decorateSyntaxError(error.Value, context);
    throw error.Value;
  }

  unexpected(location: number | Locatable = this.peek()): never {
    this.raise(Throw.SyntaxError('Unexpected token'), location);
  }

  /** proposal-runtime-types: when positive, `>` never fuses into >> >= >>> etc. */
  protected noFuseGT = 0;

  /**
   * proposal-runtime-types: snapshot of all lexer token state, for the
   * bounded speculative parses the type grammar needs (array extents,
   * later arrow return annotations). Restoring is only valid when no
   * scope was pushed in between; TypeParser guards that with Scope#depth.
   */
  protected getLexerCheckpoint() {
    return {
      position: this.position,
      line: this.line,
      columnOffset: this.columnOffset,
      currentToken: this.currentToken,
      peekToken: this.peekToken,
      peekAheadToken: this.peekAheadToken,
      lineTerminatorBeforeNextToken: this.lineTerminatorBeforeNextToken,
      positionForNextToken: this.positionForNextToken,
      lineForNextToken: this.lineForNextToken,
      columnForNextToken: this.columnForNextToken,
      scannedValue: this.scannedValue,
      escapeIndex: this.escapeIndex,
      noFuseGT: this.noFuseGT,
    };
  }

  /**
   * proposal-runtime-types: resume lexing at _index_, discarding any token
   * already read ahead.
   *
   * A moded region is found by delimiter rather than by tokenizing - its
   * contents are not ECMAScript - so once its end is known the lexer has to be
   * placed past it. Line and column are recomputed from the source so that a
   * diagnostic after the region still reports where the developer wrote it.
   */
  protected resumeLexingAt(index: number) {
    this.position = index;
    this.peekAheadToken = undefined!;
    this.lineTerminatorBeforeNextToken = false;
    let line = 1;
    let lastBreak = -1;
    for (let i = 0; i < index; i += 1) {
      if (this.source[i] === '\n') {
        line += 1;
        lastBreak = i;
      }
    }
    this.line = line;
    this.columnOffset = lastBreak + 1;
    this.positionForNextToken = index;
    this.lineForNextToken = line;
    this.columnForNextToken = index - lastBreak;
    // The region consumed no tokens, so currentToken still describes whatever
    // preceded it and peekToken describes the region's opening delimiter. Both
    // are made to describe the region's END instead: `next()` copies peekToken
    // into currentToken, and `markLocationEnd` reads currentToken.endIndex - so
    // leaving either stale gives the ENCLOSING node a range that stops inside
    // the region, which the re-parse after expansion then fails on. In a
    // statement position nothing enclosing asked; in an expression position the
    // binding element did, and reported an undefined token far from the cause.
    const atEnd = {
      ...(this.peekToken ?? this.currentToken),
      startIndex: index,
      endIndex: index,
      line,
      column: index - lastBreak,
      hadLineTerminatorBefore: false,
    } as typeof this.peekToken;
    this.currentToken = atEnd;
    // peekToken must hold the REAL next token rather than be cleared. `peek()`
    // delegates to `next()`, and `next()` copies peekToken into currentToken -
    // so leaving it undefined destroys the priming above at the first peek, and
    // the enclosing node's `markLocationEnd` then reads an undefined token.
    this.peekToken = this.advance();
  }

  protected restoreLexerCheckpoint(cp: ReturnType<Lexer['getLexerCheckpoint']>) {
    this.position = cp.position;
    this.line = cp.line;
    this.columnOffset = cp.columnOffset;
    this.currentToken = cp.currentToken;
    this.peekToken = cp.peekToken;
    this.peekAheadToken = cp.peekAheadToken;
    this.lineTerminatorBeforeNextToken = cp.lineTerminatorBeforeNextToken;
    this.positionForNextToken = cp.positionForNextToken;
    this.lineForNextToken = cp.lineForNextToken;
    this.columnForNextToken = cp.columnForNextToken;
    this.scannedValue = cp.scannedValue;
    this.escapeIndex = cp.escapeIndex;
    this.noFuseGT = cp.noFuseGT;
  }

  advance(): TokenData {
    this.lineTerminatorBeforeNextToken = false;
    this.escapeIndex = -1;
    const type = this.nextToken();
    return new TokenData({
      type,
      startIndex: this.positionForNextToken,
      endIndex: this.position,
      line: this.lineForNextToken,
      column: this.columnForNextToken,
      hadLineTerminatorBefore: this.lineTerminatorBeforeNextToken,
      name: TokenNames[type],
      value: TokenValues[type] ?? this.scannedValue,
      escaped: this.escapeIndex !== -1,
    });
  }

  next() {
    this.currentToken = this.peekToken;
    if (this.peekAheadToken !== undefined) {
      this.peekToken = this.peekAheadToken;
      this.peekAheadToken = undefined;
    } else {
      this.peekToken = this.advance();
    }
    return this.currentToken;
  }

  peek() {
    if (this.peekToken === undefined) {
      this.next();
    }
    return this.peekToken;
  }

  peekAhead() {
    if (this.peekAheadToken === undefined) {
      this.peek();
      this.peekAheadToken = this.advance();
    }
    return this.peekAheadToken;
  }

  matches(token: string | Token, peek: TokenData) {
    if (typeof token === 'string') {
      if (peek.type === Token.IDENTIFIER && peek.value === token) {
        const escapeIndex = this.source.slice(peek.startIndex, peek.endIndex).indexOf('\\');
        if (escapeIndex !== -1) {
          return false;
        }
        return true;
      } else {
        return false;
      }
    }
    return peek.type === token;
  }

  test(token: string | Token) {
    return this.matches(token, this.peek());
  }

  testAhead(token: string | Token) {
    return this.matches(token, this.peekAhead());
  }

  eat(token: string | Token) {
    if (this.test(token)) {
      this.next();
      return true;
    }
    return false;
  }

  expect(token: string | Token) {
    if (this.test(token)) {
      return this.next();
    }
    return this.unexpected();
  }

  skipSpace() {
    loop: // eslint-disable-line no-labels
    while (this.position < this.source.length) {
      const c = this.source[this.position];
      switch (c) {
        case ' ':
        case '\t':
          this.position += 1;
          break;
        case '/':
          switch (this.source[this.position + 1]) {
            case '/':
              this.skipLineComment();
              break;
            case '*':
              this.skipBlockComment();
              break;
            default:
              break loop; // eslint-disable-line no-labels
          }
          break;
        default:
          if (isWhitespace(c)) {
            this.position += 1;
          } else if (isLineTerminator(c)) {
            this.position += 1;
            if (c === '\r' && this.source[this.position] === '\n') {
              this.position += 1;
            }
            this.line += 1;
            this.columnOffset = this.position;
            this.lineTerminatorBeforeNextToken = true;
            break;
          } else {
            break loop; // eslint-disable-line no-labels
          }
          break;
      }
    }
  }

  skipHashbangComment() {
    if (this.position === 0
        && this.source[0] === '#'
        && this.source[1] === '!') {
      this.skipLineComment();
    }
  }

  skipLineComment() {
    while (this.position < this.source.length) {
      const c = this.source[this.position];
      this.position += 1;
      if (isLineTerminator(c)) {
        if (c === '\r' && this.source[this.position] === '\n') {
          this.position += 1;
        }
        this.line += 1;
        this.columnOffset = this.position;
        this.lineTerminatorBeforeNextToken = true;
        break;
      }
    }
  }

  skipBlockComment() {
    const end = this.source.indexOf('*/', this.position + 2);
    if (end === -1) {
      this.raise(Throw.SyntaxError('Unterminated comment'), this.position);
    }
    this.position += 2;
    for (const match of this.source.slice(this.position, end).matchAll(/\r\n?|[\n\u2028\u2029]/ug)) {
      this.position = match.index!;
      this.line += 1;
      this.columnOffset = this.position;
      this.lineTerminatorBeforeNextToken = true;
    }
    this.position = end + 2;
  }

  nextToken() {
    this.skipSpace();

    // set token location info after skipping space
    this.positionForNextToken = this.position;
    this.lineForNextToken = this.line;
    this.columnForNextToken = this.position - this.columnOffset + 1;

    if (this.position >= this.source.length) {
      return Token.EOS;
    }
    const c = this.source[this.position];
    this.position += 1;
    const c1 = this.source[this.position];
    if (c.charCodeAt(0) <= 127) {
      const single = SingleCharTokens[c];
      switch (single) {
        case Token.LPAREN:
        case Token.RPAREN:
        case Token.LBRACE:
        case Token.RBRACE:
        case Token.LBRACK:
        case Token.RBRACK:
        case Token.SEMICOLON:
        case Token.COMMA:
        case Token.BIT_NOT:
        case Token.TEMPLATE:
          return single;
        case Token.AT:
          // proposal-runtime-types: the `@` token belongs to BOTH decorator
          // proposals, which are mutually exclusive (see the Agent). This
          // proposal's decorators are its own feature - identified by the type
          // of a context parameter, resolved by overloading, replacing by
          // return value - and share only the grammar, so the token is enabled
          // by either feature and the SEMANTICS are decided by which one is on.
          if (surroundingAgent.feature('decorators') || surroundingAgent.feature('runtime-types')) {
            return single;
          } else {
            return this.unexpected(single);
          }

        case Token.COLON:
          // : :=
          // https://github.com/sirisian/proposal-runtime-types #sec-type-punctuators
          if (c1 === '=' && surroundingAgent.feature('runtime-types')) {
            this.position += 1;
            return Token.COLON_EQ;
          }
          return Token.COLON;

        case Token.CONDITIONAL:
          // ? ?. ?? ??=
          // proposal-runtime-types (ranges.md, #sec-range-literals): `?.` is
          // already not the optional chaining punctuator before a decimal digit,
          // which is what keeps `a?.5:b` a conditional. Under the feature it is
          // likewise not the punctuator before a `.`, so `cond?..<b:c` is a
          // conditional whose consequent is a range. The extension changes no
          // existing program: `?.` followed by `.` is a Syntax Error under every
          // production that consumes the punctuator, which is why it is safe to
          // give that input a meaning it did not have.
          if (c1 === '.'
              && !isDecimalDigit(this.source[this.position + 1])
              && !(this.source[this.position + 1] === '.' && surroundingAgent.feature('runtime-types'))) {
            this.position += 1;
            return Token.OPTIONAL;
          }
          if (c1 === '?') {
            this.position += 1;
            if (this.source[this.position] === '=') {
              this.position += 1;
              return Token.ASSIGN_NULLISH;
            }
            return Token.NULLISH;
          }
          return Token.CONDITIONAL;

        case Token.LT:
          // < <= << <<= and, under the feature, <.. <..< <..=
          if (c1 === '=') {
            this.position += 1;
            return Token.LTE;
          }
          if (c1 === '<') {
            this.position += 1;
            if (this.source[this.position] === '=') {
              this.position += 1;
              return Token.ASSIGN_SHL;
            }
            return Token.SHL;
          }
          // proposal-runtime-types (ranges.md, #sec-range-literals): the exclusive
          // start of a range. Reached only when the second character is `.` AND the
          // third is `.` too, so `a < .5` still lexes `<` then a numeric literal,
          // and `<=`/`<<`/`<<=` above are decided before this is consulted. The
          // fourth character then separates `<..<` and `<..=` from `<..`, which is
          // why each is ONE token: `a <.. < b` does not assemble the open range,
          // it compares against the open-start from-range `a<..`.
          if (c1 === '.' && this.source[this.position + 1] === '.'
              && surroundingAgent.feature('runtime-types')) {
            this.position += 2;
            if (this.source[this.position] === '<') {
              this.position += 1;
              return Token.LT_DOT_DOT_LT;
            }
            if (this.source[this.position] === '=') {
              this.position += 1;
              return Token.LT_DOT_DOT_EQ;
            }
            return Token.LT_DOT_DOT;
          }
          return Token.LT;

        case Token.GT:
          // > >= >> >>= >>> >>>=
          // proposal-runtime-types: inside `.<`...`>` type argument or `<`...`>` type
          // parameter lists the parser sets noFuseGT so nested closers like `>>` split.
          if (this.noFuseGT > 0) {
            return Token.GT;
          }
          if (c1 === '=') {
            this.position += 1;
            return Token.GTE;
          }
          if (c1 === '>') {
            this.position += 1;
            if (this.source[this.position] === '>') {
              this.position += 1;
              if (this.source[this.position] === '=') {
                this.position += 1;
                return Token.ASSIGN_SHR;
              }
              return Token.SHR;
            }
            if (this.source[this.position] === '=') {
              this.position += 1;
              return Token.ASSIGN_SAR;
            }
            return Token.SAR;
          }
          return Token.GT;

        case Token.ASSIGN:
          // = == === =>
          if (c1 === '=') {
            this.position += 1;
            if (this.source[this.position] === '=') {
              this.position += 1;
              return Token.EQ_STRICT;
            }
            return Token.EQ;
          }
          if (c1 === '>') {
            this.position += 1;
            return Token.ARROW;
          }
          return Token.ASSIGN;

        case Token.NOT:
          // ! != !==
          if (c1 === '=') {
            this.position += 1;
            if (this.source[this.position] === '=') {
              this.position += 1;
              return Token.NE_STRICT;
            }
            return Token.NE;
          }
          return Token.NOT;

        case Token.ADD:
          // + ++ +=
          if (c1 === '+') {
            this.position += 1;
            return Token.INC;
          }
          if (c1 === '=') {
            this.position += 1;
            return Token.ASSIGN_ADD;
          }
          return Token.ADD;

        case Token.SUB:
          // - -- -=
          if (c1 === '-') {
            this.position += 1;
            return Token.DEC;
          }
          if (c1 === '=') {
            this.position += 1;
            return Token.ASSIGN_SUB;
          }
          return Token.SUB;

        case Token.MUL:
          // * *= ** **=
          if (c1 === '=') {
            this.position += 1;
            return Token.ASSIGN_MUL;
          }
          if (c1 === '*') {
            this.position += 1;
            if (this.source[this.position] === '=') {
              this.position += 1;
              return Token.ASSIGN_EXP;
            }
            return Token.EXP;
          }
          return Token.MUL;

        case Token.MOD:
          // % %=
          if (c1 === '=') {
            this.position += 1;
            return Token.ASSIGN_MOD;
          }
          return Token.MOD;

        case Token.DIV:
          // / /=
          if (c1 === '=') {
            this.position += 1;
            return Token.ASSIGN_DIV;
          }
          return Token.DIV;

        case Token.BIT_AND:
          // & && &= &&=
          if (c1 === '&') {
            this.position += 1;
            if (this.source[this.position] === '=') {
              this.position += 1;
              return Token.ASSIGN_AND;
            }
            return Token.AND;
          }
          if (c1 === '=') {
            this.position += 1;
            return Token.ASSIGN_BIT_AND;
          }
          return Token.BIT_AND;

        case Token.BIT_OR:
          // | || |= ||=
          if (c1 === '|') {
            this.position += 1;
            if (this.source[this.position] === '=') {
              this.position += 1;
              return Token.ASSIGN_OR;
            }
            return Token.OR;
          }
          if (c1 === '=') {
            this.position += 1;
            return Token.ASSIGN_BIT_OR;
          }
          // proposal-runtime-types #sec-pipeline-operator: `|>`. Scanned after
          // `||` and `|=` so neither is disturbed, and gated on the feature so
          // that `a | > b` and `a |> b` keep their current meanings with it off.
          if (c1 === '>' && surroundingAgent.feature('runtime-types')) {
            this.position += 1;
            return Token.PIPE_GT;
          }
          return Token.BIT_OR;

        case Token.BIT_XOR:
          // ^ ^=
          if (c1 === '=') {
            this.position += 1;
            return Token.ASSIGN_BIT_XOR;
          }
          return Token.BIT_XOR;

        case Token.PERIOD:
          // . ... NUMBER
          if (isDecimalDigit(c1)) {
            this.position -= 1;
            return this.scanNumber();
          }
          if (c1 === '.') {
            if (this.source[this.position + 1] === '.') {
              this.position += 2;
              return Token.ELLIPSIS;
            }
            // proposal-runtime-types (ranges.md, #sec-range-literals): `..`, `..<`,
            // and `..=` are three of the family's six tokens. A `.` followed by
            // another `.` is never a decimal point (handled in scanNumber), so
            // `1..<6` reaches here as `..<` between two numeric literals. The
            // third character decides among them; `.<` below is decided by the
            // SECOND character, so a type argument list and a range end can never
            // compete. Gated on the feature so the base grammar, where `1..<6` is
            // a Syntax Error of its own making, is unchanged.
            if (surroundingAgent.feature('runtime-types')) {
              if (this.source[this.position + 1] === '=') {
                this.position += 2;
                return Token.DOT_DOT_EQ;
              }
              if (this.source[this.position + 1] === '<') {
                this.position += 2;
                return Token.DOT_DOT_LT;
              }
              this.position += 1;
              return Token.DOT_DOT;
            }
          }
          // https://github.com/sirisian/proposal-runtime-types #sec-type-punctuators
          // `.<` begins a type argument list. A `.` before a digit was taken by
          // scanNumber above, so `1.<2` stays NumericLiteral `1.` followed by `<`.
          if (c1 === '<' && surroundingAgent.feature('runtime-types')) {
            this.position += 1;
            return Token.PERIOD_LT;
          }
          return Token.PERIOD;

        case Token.STRING:
          return this.scanString(c);

        case Token.NUMBER:
          this.position -= 1;
          return this.scanNumber();

        case Token.IDENTIFIER:
          this.position -= 1;
          return this.scanIdentifierOrKeyword();

        case Token.PRIVATE_IDENTIFIER:
          return this.scanIdentifierOrKeyword(true);

        default:
          this.unexpected(single);
      }
    }

    this.position -= 1;

    if (isLeadingSurrogate(c.charCodeAt(0)) || isIdentifierStart(c)) {
      return this.scanIdentifierOrKeyword();
    }

    return this.unexpected(this.position);
  }

  scanNumber() {
    const start = this.position;
    let base: 2 | 8 | 10 | 16 = 10;
    let nonDecimalPrefixLength = 2;
    let zeroLeading = false;
    let check = isDecimalDigit;
    if (this.source[this.position] === '0') {
      this.scannedValue = 0;
      this.position += 1;
      switch (this.source[this.position]) {
        case 'x':
        case 'X':
          base = 16;
          break;
        case 'o':
        case 'O':
          base = 8;
          break;
        case 'b':
        case 'B':
          base = 2;
          break;
        case '.':
        case 'e':
        case 'E':
          break;
        case 'n':
          this.position += 1;
          this.scannedValue = 0n;
          return Token.BIGINT;
        default: {
          if (!isDecimalDigit(this.source[this.position])) {
            // https://github.com/sirisian/proposal-runtime-types #sec-imaginary-literals
            if (this.source[this.position] === 'i' && surroundingAgent.feature('runtime-types')) {
              this.position += 1;
              if (isIdentifierStart(this.source[this.position])) {
                this.unexpected(this.position);
              }
              return Token.IMAGINARY; // scannedValue is already 0
            }
            return Token.NUMBER;
          }
          // Legacy octal literal (0123)
          if (this.isStrictMode()) {
            this.raise(Throw.SyntaxError('Legacy octal literal in strict mode'), start);
          }
          this.position -= 1;
          nonDecimalPrefixLength = 1;
          zeroLeading = true;
          const oldPos = this.position;
          base = 8;
          while (this.position < this.source.length) {
            const c = this.source[this.position];
            if (isDecimalDigit(c) && !isOctalDigit(c)) {
              base = 10;
              break;
            } else if (!isOctalDigit(c)) {
              // A single 0
              break;
            } else {
              this.position += 1;
            }
          }
          this.position = oldPos;
          break;
        }
      }
      check = {
        16: isHexDigit,
        10: isDecimalDigit,
        8: isOctalDigit,
        2: isBinaryDigit,
      }[base];
      if (base !== 10) {
        if (!check(this.source[this.position + 1])) {
          return Token.NUMBER;
        }
        this.position += 1;
      }
    }
    while (this.position < this.source.length) {
      const c = this.source[this.position];
      if (check(c)) {
        this.position += 1;
      } else if (c === '_') {
        if (zeroLeading) {
          this.raise(Throw.SyntaxError('Separator is not allowed after leading zero'), this.position);
        }
        if (!check(this.source[this.position + 1])) {
          this.unexpected(this.position + 1);
        }
        this.position += 1;
      } else {
        break;
      }
    }
    if (this.source[this.position] === 'n') {
      if (zeroLeading) {
        this.raise(Throw.SyntaxError('BigInt literal cannot have leading zero'), this.position);
      }
      const buffer = this.source.slice(start, this.position).replace(/_/g, '');
      this.position += 1;
      this.scannedValue = BigInt(buffer);
      return Token.BIGINT;
    }
    // proposal-runtime-types (ranges.md): a `.` is not the decimal point of a
    // numeric literal when the next character is also a `.`, so `1..<6` lexes as
    // `1`, `..<`, `6` rather than `1.` then `.<6`. Gated on the feature.
    if (base === 10 && this.source[this.position] === '.'
        && !(surroundingAgent.feature('runtime-types') && this.source[this.position + 1] === '.')) {
      this.position += 1;
      if (this.source[this.position] === '_') {
        this.unexpected(this.position);
      }
      while (this.position < this.source.length) {
        const c = this.source[this.position];
        if (isDecimalDigit(c)) {
          this.position += 1;
        } else if (c === '_') {
          if (!isDecimalDigit(this.source[this.position + 1])) {
            this.unexpected(this.position + 1);
          }
          this.position += 1;
        } else {
          break;
        }
      }
    }
    if (base === 10 && (this.source[this.position] === 'E' || this.source[this.position] === 'e')) {
      this.position += 1;
      if (this.source[this.position] === '_') {
        this.unexpected(this.position);
      }
      if (this.source[this.position] === '-' || this.source[this.position] === '+') {
        this.position += 1;
      }
      if (this.source[this.position] === '_') {
        this.unexpected(this.position);
      }
      while (this.position < this.source.length) {
        const c = this.source[this.position];
        if (isDecimalDigit(c)) {
          this.position += 1;
        } else if (c === '_') {
          if (!isDecimalDigit(this.source[this.position + 1])) {
            this.unexpected(this.position + 1);
          }
          this.position += 1;
        } else {
          break;
        }
      }
    }
    // https://github.com/sirisian/proposal-runtime-types #sec-imaginary-literals
    // DecimalImaginaryLiteral :: DecimalLiteral ImaginaryLiteralSuffix. Only the
    // decimal forms take the suffix, so hex, octal, binary, bigint, and legacy
    // octal fall through to the identifier-adjacency error below.
    if (base === 10 && !zeroLeading && this.source[this.position] === 'i' && surroundingAgent.feature('runtime-types')) {
      const imaginaryBuffer = this.source.slice(start, this.position).replace(/_/g, '');
      this.position += 1;
      if (isIdentifierStart(this.source[this.position])) {
        this.unexpected(this.position);
      }
      this.scannedValue = Number.parseFloat(imaginaryBuffer);
      return Token.IMAGINARY;
    }
    if (isIdentifierStart(this.source[this.position])) {
      this.unexpected(this.position);
    }
    const buffer = this.source
      .slice(base === 10 ? start : start + nonDecimalPrefixLength, this.position)
      .replace(/_/g, '');
    this.scannedValue = base === 10
      ? Number.parseFloat(buffer)
      : Number.parseInt(buffer, base);
    return Token.NUMBER;
  }

  scanString(char: string) {
    let buffer = '';
    while (true) {
      if (this.position >= this.source.length) {
        this.raise(Throw.SyntaxError('Unterminated string literal'), this.position);
      }
      const c = this.source[this.position];
      if (c === char) {
        this.position += 1;
        break;
      }
      if (c === '\r' || c === '\n') {
        this.raise(Throw.SyntaxError('Unterminated string literal'), this.position);
      }
      this.position += 1;
      if (c === '\\') {
        const l = this.source[this.position];
        if (isLineTerminator(l)) {
          this.position += 1;
          if (l === '\r' && this.source[this.position] === '\n') {
            this.position += 1;
          }
          this.line += 1;
          this.columnOffset = this.position;
        } else {
          buffer += this.scanEscapeSequence();
        }
      } else {
        buffer += c;
      }
    }
    this.scannedValue = buffer;
    return Token.STRING;
  }

  scanEscapeSequence() {
    const c = this.source[this.position];
    switch (c) {
      case 'b':
        this.position += 1;
        return '\b';
      case 't':
        this.position += 1;
        return '\t';
      case 'n':
        this.position += 1;
        return '\n';
      case 'v':
        this.position += 1;
        return '\v';
      case 'f':
        this.position += 1;
        return '\f';
      case 'r':
        this.position += 1;
        return '\r';
      case 'x':
        this.position += 1;
        return String.fromCodePoint(this.scanHex(2));
      case 'u':
        this.position += 1;
        return String.fromCodePoint(this.scanCodePoint());
      default: {
        const lookahead = this.source[this.position + 1];
        if (c === '0' && !isDecimalDigit(lookahead)) {
          this.position += 1;
          return '\u{0000}';
        } else if (isDecimalDigit(c)) {
          if (this.isStrictMode()) {
            this.raise(Throw.SyntaxError('Illegal octal escape'), this.position);
          }
          const lookahead2 = this.source[this.position + 2];
          if (c === '0' && (lookahead === '8' || lookahead === '9')) {
            // LegacyOctalEscapeSequence :: 0 [lookahead ∈ { 8, 9 }]
            // evaluates to \u0000 + 8 or 9
            this.position += 2;
            return `\u{0000}${lookahead}`;
          } else if (c !== '0' && isOctalDigit(c) && !isOctalDigit(lookahead)) {
            // LegacyOctalEscapeSequence :: NonZeroOctalDigit [lookahead ∉ OctalDigit]
            // \1 is \u{0001}, etc...
            this.position += 1;
            return String.fromCodePoint(parseInt(c, 8));
          } else if ((c === '0' || c === '1' || c === '2' || c === '3') && isOctalDigit(lookahead) && !isOctalDigit(lookahead2)) {
            // LegacyOctalEscapeSequence :: ZeroToThree OctalDigit [lookahead ∉ OctalDigit]
            this.position += 2;
            return String.fromCodePoint(parseInt(c + lookahead, 8));
          } else if ((c === '4' || c === '5' || c === '6' || c === '7') && isOctalDigit(lookahead)) {
            // LegacyOctalEscapeSequence :: FourToSeven OctalDigit
            this.position += 2;
            return String.fromCodePoint(parseInt(c + lookahead, 8));
          } else if ((c === '0' || c === '1' || c === '2' || c === '3') && isOctalDigit(lookahead) && isOctalDigit(lookahead2)) {
            // LegacyOctalEscapeSequence ::  ZeroToThree OctalDigit OctalDigit
            this.position += 3;
            return String.fromCodePoint(parseInt(c + lookahead + lookahead2, 8));
          } else if (c === '8' || c === '9') {
            // NonOctalDecimalEscapeSequence
            // \8 or \9 is 8 or 9
            this.position += 1;
            return c;
          }
        }
        this.position += 1;
        return c;
      }
    }
  }

  scanCodePoint() {
    if (this.source[this.position] === '{') {
      this.position += 1;
      const end = this.source.indexOf('}', this.position);
      if (end === -1) {
        this.raise(Throw.SyntaxError('Invalid code point'), this.position);
      }
      const code = this.scanHex(end - this.position);
      this.position += 1;
      if (code > 0x10FFFF) {
        this.raise(Throw.SyntaxError('Invalid code point'), this.position);
      }
      return code;
    }
    return this.scanHex(4);
  }

  scanHex(length: number) {
    if (length <= 0) {
      this.raise(Throw.SyntaxError('Invalid code point'), this.position);
    }
    let n = 0;
    for (let i = 0; i < length; i += 1) {
      const c = this.source[this.position];
      if (isHexDigit(c)) {
        this.position += 1;
        n = (n * 16) + Number.parseInt(c, 16);
      } else {
        this.unexpected(this.position);
      }
    }
    return n;
  }

  scanIdentifierOrKeyword(isPrivate = false) {
    let buffer = '';
    let escapeIndex = -1;
    let check = isIdentifierStart;
    while (this.position < this.source.length) {
      const c = this.source[this.position];
      const code = c.charCodeAt(0);
      if (c === '\\') {
        if (escapeIndex === -1) {
          escapeIndex = this.position;
        }
        this.position += 1;
        if (this.source[this.position] !== 'u') {
          this.raise(Throw.SyntaxError('Invalid Unicode escape'), this.position);
        }
        this.position += 1;
        const raw = String.fromCodePoint(this.scanCodePoint());
        if (!check(raw)) {
          this.raise(Throw.SyntaxError('Invalid Unicode escape'), this.position);
        }
        buffer += raw;
      } else if (isLeadingSurrogate(code)) {
        const lowSurrogate = this.source.charCodeAt(this.position + 1);
        if (!isTrailingSurrogate(lowSurrogate)) {
          this.raise(Throw.SyntaxError('Invalid Unicode escape'), this.position);
        }
        const codePoint = UTF16SurrogatePairToCodePoint(code, lowSurrogate);
        const raw = String.fromCodePoint(codePoint);
        if (!check(raw)) {
          this.raise(Throw.SyntaxError('Invalid Unicode escape'), this.position);
        }
        this.position += 2;
        buffer += raw;
      } else if (check(c)) {
        buffer += c;
        this.position += 1;
      } else {
        break;
      }
      check = isIdentifierPart;
    }
    if (!isPrivate && isKeywordRaw(buffer)) {
      if (escapeIndex !== -1) {
        this.scannedValue = buffer;
        return Token.ESCAPED_KEYWORD;
      }
      return KeywordLookup[buffer];
    } else {
      this.scannedValue = buffer;
      this.escapeIndex = escapeIndex;
      return isPrivate ? Token.PRIVATE_IDENTIFIER : Token.IDENTIFIER;
    }
  }

  scanRegularExpressionBody() {
    let inClass = false;
    let buffer = this.peek().type === Token.ASSIGN_DIV ? '=' : '';
    while (true) {
      if (this.position >= this.source.length) {
        this.raise(Throw.SyntaxError('Unterminated regular expression'), this.position);
      }
      const c = this.source[this.position];
      switch (c) {
        case '[':
          inClass = true;
          this.position += 1;
          buffer += c;
          break;
        case ']':
          if (inClass) {
            inClass = false;
          }
          buffer += c;
          this.position += 1;
          break;
        case '/':
          this.position += 1;
          if (!inClass) {
            this.scannedValue = buffer;
            return;
          }
          buffer += c;
          break;
        case '\\':
          buffer += c;
          this.position += 1;
          if (isLineTerminator(this.source[this.position])) {
            this.raise(Throw.SyntaxError('Unterminated regular expression'), this.position);
          }
          buffer += this.source[this.position];
          this.position += 1;
          break;
        default:
          if (isLineTerminator(c)) {
            this.raise(Throw.SyntaxError('Unterminated regular expression'), this.position);
          }
          this.position += 1;
          buffer += c;
          break;
      }
    }
  }

  scanRegularExpressionFlags() {
    let buffer = '';
    while (true) {
      if (this.position >= this.source.length) {
        this.scannedValue = buffer;
        return;
      }
      const c = this.source[this.position];
      if (isRegularExpressionFlagPart(c) && 'dgimsuyv'.includes(c)) {
        if (buffer.includes(c)) {
          this.raise(Throw.SyntaxError('Duplicate regular expression flag "$1"', c), this.position);
        }
        this.position += 1;
        buffer += c;
      } else {
        this.scannedValue = buffer;
        return;
      }
    }
  }
}
