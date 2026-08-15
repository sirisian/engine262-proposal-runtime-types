import {
  Value, ObjectValue, JSStringValue, NumberValue,
  type Arguments, type FunctionCallContext,
} from '../value.mts';
import { type ValueEvaluator } from '../completion.mts';
import type { TokenRecord, SpanRecord } from '../parser/TokensOf.mts';
import { R } from "../abstract-ops/all.mjs";
import { ParseRange } from '../parse.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import { surroundingAgent, Throw } from '#self';
import {
  OrdinaryObjectCreate,
  CreateBuiltinFunction,
  CreateDataPropertyOrThrow,
  CreateArrayFromList,
  Get,
  Descriptor,
  F, X,
  type OrdinaryObject,
  Realm,
} from '#self';

/**
 * proposal-runtime-types `sec-tokenstream-objects`: a TokenStream is what a
 * reflection's syntax-valued fields hold and what a replacement decorator
 * exchanges.
 *
 * A stream is an Array whose elements are Token objects, so a macro reaches for
 * `map`, `find` and `filter` rather than for a bespoke traversal. That is the
 * whole reason the representation is a flat list of records with delimited runs
 * grouped: the operations a macro actually performs are array operations.
 */

export interface TokenStreamObject extends OrdinaryObject {
  TokenRecords: readonly TokenRecord[];
}

export function isTokenStream(value: Value): value is TokenStreamObject {
  return value instanceof ObjectValue && 'TokenRecords' in value;
}

/** A Span Record as an object, for a macro that wants to know where a token came from. */
function SpanToObject(span: SpanRecord, realmRec: Realm): ObjectValue {
  const source = OrdinaryObjectCreate(realmRec.Intrinsics['%Object.prototype%']);
  X(CreateDataPropertyOrThrow(source, Value('url'), span.Source.URL === undefined ? Value.undefined : Value(span.Source.URL)));
  X(CreateDataPropertyOrThrow(source, Value('macro'), span.Source.Macro === undefined ? Value.undefined : Value(span.Source.Macro)));
  X(CreateDataPropertyOrThrow(source, Value('generation'), F(span.Source.Generation)));
  // The source TEXT, which a macro scanning a captured region needs and which
  // `toString()` cannot serve: that renders the TOKENS, so it differs from the
  // source by whatever is not a token - a comment, most obviously. A macro
  // indexing the rendering while `parse` indexes the source is off by exactly
  // those characters, which is a silent misdelegation rather than an error.
  X(CreateDataPropertyOrThrow(source, Value('text'), Value(span.Source.Text)));
  const obj = OrdinaryObjectCreate(realmRec.Intrinsics['%Object.prototype%']);
  X(CreateDataPropertyOrThrow(obj, Value('source'), source));
  X(CreateDataPropertyOrThrow(obj, Value('start'), F(span.Start)));
  X(CreateDataPropertyOrThrow(obj, Value('end'), F(span.End)));
  return obj;
}

/** A Token Record as an object. A `group`'s contents are a TokenStream in turn. */
export function TokenToObject(token: TokenRecord, realmRec: Realm): ObjectValue {
  // The object REMEMBERS its record. That is what lets a token a macro passed
  // through unchanged be recognised on the way back and reused rather than
  // rebuilt - which is how a region the macro did not touch keeps its span, and
  // therefore its formatting and its comments.
  const obj = OrdinaryObjectCreate(realmRec.Intrinsics['%Object.prototype%'], ['TokenRecord']);
  (obj as unknown as { TokenRecord: TokenRecord }).TokenRecord = token;
  X(CreateDataPropertyOrThrow(obj, Value('kind'), Value(token.Kind)));
  X(CreateDataPropertyOrThrow(obj, Value('value'), Value(token.Value)));
  X(CreateDataPropertyOrThrow(obj, Value('span'), SpanToObject(token.Span, realmRec)));
  X(CreateDataPropertyOrThrow(
    obj,
    Value('tokens'),
    token.Tokens === undefined ? Value.undefined : CreateTokenStream(token.Tokens, realmRec),
  ));
  return obj;
}

/** `sec-tokenstream-objects`: the stream over a List of Token Records. */
export function CreateTokenStream(records: readonly TokenRecord[], realmRec: Realm): TokenStreamObject {
  const array = X(CreateArrayFromList(records.map((t) => TokenToObject(t, realmRec)))) as unknown as TokenStreamObject;
  (array as { TokenRecords: readonly TokenRecord[] }).TokenRecords = records;
  // Defining a `__proto__` PROPERTY does not set the prototype - it defines an
  // own property of that name, and the stream kept inheriting
  // `Array.prototype.toString`, which answered `[object Object]` for every
  // token. The prototype is set, not defined.
  X(array.SetPrototypeOf(realmRec.Intrinsics['%TokenStream.prototype%']));
  return array;
}

/**
 * The source text the tokens were taken from, INCLUDING the trivia between
 * them.
 *
 * A run of tokens from one buffer is recovered by slicing from the first
 * token's start to the last token's end, so every comment and every space
 * between them comes back. **This is why no separate source-text field exists
 * on a reflection**: a second field would be a second way to say one thing, and
 * the two would have to agree forever.
 */
export function TokenStreamText(records: readonly TokenRecord[]): string {
  if (records.length === 0) {
    return '';
  }
  const pieces: string[] = [];
  let runStart: TokenRecord | undefined;
  let runEnd: TokenRecord | undefined;
  const flushRun = () => {
    if (runStart && runEnd) {
      pieces.push(runStart.Span.Source.Text.slice(runStart.Span.Start, runEnd.Span.End));
    }
    runStart = undefined;
    runEnd = undefined;
  };
  // A GROUP's [[Value]] is its OPENING DELIMITER, not its text, so comparing the
  // span's slice to [[Value]] never matches one - and the group fell to the
  // print branch, which emitted `{` and dropped everything it delimited. A
  // group is sliceable when its span begins with its delimiter.
  const isSliceable = (t: TokenRecord) => {
    // A created token is never sliced, whatever its span looks like. Asking only
    // whether the buffer at the span matches the value cannot tell the two
    // apart, because a created token's buffer is its own text and so always
    // matches - which is what suppressed every separator.
    if (t.Created) {
      return false;
    }
    const sliced = t.Span.Source.Text.slice(t.Span.Start, t.Span.End);
    return t.Kind === 'group' ? sliced.startsWith(t.Value) && sliced.length > t.Value.length : sliced === t.Value;
  };

  for (const t of records) {
    // **A RUN of tokens still carrying spans into one buffer is SLICED**, which
    // is what keeps a region the macro did not touch exactly as written -
    // formatting and comments included, since comments are not tokens and
    // anything re-emitted token by token would lose them.
    const continues = runEnd !== undefined
      && runEnd.Span.Source === t.Span.Source
      && isSliceable(t)
      && t.Span.Start >= runEnd.Span.End;
    if (continues) {
      runEnd = t;
      continue;
    }
    flushRun();
    if (isSliceable(t)) {
      runStart = t;
      runEnd = t;
      continue;
    }
    // A token the macro CREATED has no buffer to slice, so it is PRINTED. A
    // separator is required rather than cosmetic: `a` then `b` re-lexes to one
    // token without it, and so do `+`/`+` and `return`/`x`.
    //
    // A NEWLINE where the record says one preceded it, because newlines are
    // semantically significant through ASI - a space there would join a
    // statement to the one above it.
    pieces.push(t.LineTerminatorBefore ? '\n' : ' ');
    if (t.Kind === 'group' && t.Tokens !== undefined) {
      // A created group prints its delimiters around its contents, which are
      // printed in turn. The closing delimiter is the record's, not a token, so
      // it cannot be lost.
      const close = t.Value === '{' ? '}' : t.Value === '[' ? ']' : ')';
      pieces.push(t.Value, TokenStreamText(t.Tokens), close);
    } else {
      pieces.push(t.Value);
    }
  }
  flushRun();
  // The leading separator before a created token at the very start is not
  // wanted; every other one sits between two pieces.
  return pieces.join('').replace(/^[ \n]+/, '');
}

/**
 * Read Token Records back out of whatever a macro returned.
 *
 * **A macro's return is usually NOT a TokenStream**: `tokens.map(...)` gives a
 * plain Array, because that is what `Array.prototype.map` does. Requiring a
 * macro to rebuild a stream would require it to know a representation it never
 * constructed, so a returned value is read STRUCTURALLY.
 *
 * **A token the macro passed through UNCHANGED is reused, not rebuilt.** The
 * object carries the record it came from, so a region the macro did not touch
 * keeps its span - and therefore its formatting and its comments, which are not
 * tokens and would be lost by anything re-emitted token by token. This is
 * `sec-applyreplacementdecorator`'s rule, not an optimisation: "a token the
 * decorator COPIED from what it was given keeps the Span it arrived with".
 */
export function TokenRecordsFrom(value: Value): readonly TokenRecord[] | undefined {
  if (isTokenStream(value)) {
    return value.TokenRecords;
  }
  if (!(value instanceof ObjectValue)) {
    return undefined;
  }
  const lengthValue = X(Get(value, Value('length')));
  if (!(lengthValue instanceof NumberValue)) {
    return undefined;
  }
  const out: TokenRecord[] = [];
  const length = Number(R(lengthValue));
  for (let i = 0; i < length; i += 1) {
    const element = X(Get(value, Value(String(i))));
    if (!(element instanceof ObjectValue)) {
      return undefined;
    }
    const carried = (element as unknown as { TokenRecord?: TokenRecord }).TokenRecord;
    if (carried !== undefined) {
      out.push(carried);
      continue;
    }
    const kind = X(Get(element, Value('kind')));
    const text = X(Get(element, Value('value')));
    if (!(kind instanceof JSStringValue) || !(text instanceof JSStringValue)) {
      return undefined;
    }
    const nested = X(Get(element, Value('tokens')));
    // A CREATED token is self-relative: the macro handed back a plain object, so
    // the original buffer is not among them. Keeping the original offsets while
    // the buffer is the token's own text means slicing past the end and getting
    // nothing - the shape that failed silently twice in this project.
    out.push({
      Kind: kind.stringValue() as TokenRecord['Kind'],
      Value: text.stringValue(),
      Span: {
        Source: {
          URL: undefined, Macro: undefined, Generation: 0, Text: text.stringValue(),
        },
        Start: 0,
        End: text.stringValue().length,
      },
      Tokens: nested instanceof ObjectValue ? TokenRecordsFrom(nested) : undefined,
      LineTerminatorBefore: false,
      // Marked as created. A self-relative span makes the printer's "can this be
      // sliced from its buffer?" test TRIVIALLY true - the buffer IS the value -
      // so every created token was mistaken for a preserved one and printed
      // without the separator it needs. `const` and `a` came out as `consta`,
      // and `function` and `f` as `functionf`, which does not parse. A preserved
      // token arrives through [[TokenRecord]] above and is not marked.
      Created: true,
    });
  }
  return out;
}

function* TokenStreamProto_toString(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  if (!isTokenStream(thisValue)) {
    return Throw.TypeError('$1 is not a token stream', thisValue);
  }
  return Value(TokenStreamText(thisValue.TokenRecords));
}

/**
 * `TokenStream.prototype.parse(start, end, goal)`: parse a sub-range of this
 * stream's source and answer its tokens.
 *
 * This is what lets a macro define a bespoke syntax without the engine knowing
 * anything about it. A macro captures its region, scans whatever it likes, and
 * delegates the one thing it CANNOT do: decide whether `/` begins a regular
 * expression or a division. That is not decidable lexically - after `}` it
 * depends on whether the brace closed a block or an object literal, which needs
 * a parse - so a macro re-lexing a slice gets four tokens where there is one
 * regular expression and no way to tell.
 *
 * Rust hands a macro a complete token stream and needs no such call, because its
 * lexical grammar is parse-INDEPENDENT. JavaScript's is not, which is why the
 * engine must offer this rather than leave a macro to re-implement the grammar -
 * the trade Rust makes, at the cost of `syn`.
 *
 * The parse inherits this region's context: [Yield], [Await], [Return] and
 * strictness come from where the region SITS, not from the macro. A macro has
 * nothing sensible to pass, and letting it pass anything invites parsing `await`
 * into a synchronous function.
 */
function* TokenStreamProto_parse([start = Value.undefined, end = Value.undefined, goal = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  if (!isTokenStream(thisValue)) {
    return Throw.TypeError('$1 is not a token stream', thisValue);
  }
  const records = thisValue.TokenRecords;
  const source = records.length > 0 ? records[0].Span.Source : undefined;
  if (source === undefined) {
    return Throw.TypeError('$1 is not a token stream', thisValue);
  }
  const text = source.Text;
  const from = start instanceof NumberValue ? R(start) : 0;
  const to = end instanceof NumberValue ? R(end) : text.length;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > text.length || from > to) {
    return Throw.RangeError('$1 is not a range of this stream', start);
  }
  const wanted = goal instanceof JSStringValue ? goal.stringValue() : 'expression';
  if (wanted !== 'expression' && wanted !== 'statements') {
    return Throw.TypeError('$1 does not name a goal symbol', goal);
  }
  const parsed = ParseRange(text, from, to, wanted, source);
  if (typeof parsed === 'string') {
    return Throw.SyntaxError('$1', Value(parsed));
  }
  return CreateTokenStream(parsed, surroundingAgent.currentRealmRecord);
}

let gensymCounter = 0;

/**
 * `sec-tokenstream.gensym`: an identifier that cannot collide.
 *
 * This is the hygiene mechanism. A replacement decorator uses it for every
 * identifier it INTRODUCES, so a macro's temporaries cannot capture a binding
 * at the position it is spliced into.
 *
 * It does NOT address a macro's REFERENCE to an identifier it did not create -
 * a macro naming `Date` still meets a shadowing `Date` - which no mechanism
 * short of syntax contexts on every binding addresses, and which the spans
 * make detectable even where they do not prevent it.
 *
 * The minted name is not a valid IdentifierName, so no source text can contain
 * it: collision is impossible by construction rather than by counting.
 */
function* TokenStream_gensym(args: Arguments): ValueEvaluator {
  const [hint] = args;
  const label = hint instanceof JSStringValue ? hint.stringValue() : 'tmp';
  gensymCounter += 1;
  const name = `%${label}:${gensymCounter}%`;
  const realmRec = surroundingAgent.currentRealmRecord;
  const text = name;
  const record: TokenRecord = {
    Kind: 'identifier',
    Value: name,
    Span: {
      Source: {
        URL: undefined, Macro: 'gensym', Generation: 0, Text: text,
      },
      Start: 0,
      End: text.length,
    },
    Tokens: undefined,
    LineTerminatorBefore: false,
  };
  return TokenToObject(record, realmRec);
}

export function bootstrapTokenStreamPrototype(realmRec: Realm): void {
  const proto = bootstrapPrototype(realmRec, [
    ['toString', TokenStreamProto_toString, 0],
    ['parse', TokenStreamProto_parse, 3],
  ], realmRec.Intrinsics['%Array.prototype%'], 'TokenStream');
  realmRec.Intrinsics['%TokenStream.prototype%'] = proto;
}

export function bootstrapTokenStream(realmRec: Realm): void {
  const ctor = CreateBuiltinFunction(
    function* tokenStream(_args: Arguments): ValueEvaluator {
      return Throw.TypeError('a token stream is produced by the engine, not constructed');
    },
    0,
    Value('TokenStream'),
    [],
    realmRec,
  );
  const gensym = CreateBuiltinFunction(
    function* gensym(args: Arguments): ValueEvaluator {
      return yield* TokenStream_gensym(args);
    },
    1,
    Value('gensym'),
    [],
    realmRec,
  );
  X(ctor.DefineOwnProperty(Value('gensym'), Descriptor({
    Value: gensym, Writable: Value.true, Enumerable: Value.false, Configurable: Value.true,
  })));
  X(ctor.DefineOwnProperty(Value('prototype'), Descriptor({
    Value: realmRec.Intrinsics['%TokenStream.prototype%'],
    Writable: Value.false,
    Enumerable: Value.false,
    Configurable: Value.false,
  })));
  realmRec.Intrinsics['%TokenStream%'] = ctor;
}
