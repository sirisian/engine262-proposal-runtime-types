import {
  Value, ObjectValue, JSStringValue,
  type Arguments, type FunctionCallContext,
} from '../value.mts';
import { type ValueEvaluator } from '../completion.mts';
import type { TokenRecord, SpanRecord } from '../parser/TokensOf.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import { surroundingAgent, Throw } from '#self';
import {
  OrdinaryObjectCreate,
  CreateBuiltinFunction,
  CreateDataPropertyOrThrow,
  CreateArrayFromList,
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
  const obj = OrdinaryObjectCreate(realmRec.Intrinsics['%Object.prototype%']);
  X(CreateDataPropertyOrThrow(obj, Value('source'), source));
  X(CreateDataPropertyOrThrow(obj, Value('start'), F(span.Start)));
  X(CreateDataPropertyOrThrow(obj, Value('end'), F(span.End)));
  return obj;
}

/** A Token Record as an object. A `group`'s contents are a TokenStream in turn. */
export function TokenToObject(token: TokenRecord, realmRec: Realm): ObjectValue {
  const obj = OrdinaryObjectCreate(realmRec.Intrinsics['%Object.prototype%']);
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
  let out = '';
  let runStart: TokenRecord | undefined;
  let runEnd: TokenRecord | undefined;
  const flush = () => {
    if (runStart && runEnd) {
      out += runStart.Span.Source.Text.slice(runStart.Span.Start, runEnd.Span.End);
    }
    runStart = undefined;
    runEnd = undefined;
  };
  for (const t of records) {
    // Tokens of one buffer are contiguous, so a run can be sliced whole. A
    // token from a different buffer - one a macro produced - begins a new run,
    // since there is no trivia between two buffers to recover.
    if (runEnd && runEnd.Span.Source !== t.Span.Source) {
      flush();
    }
    if (!runStart) {
      runStart = t;
    }
    runEnd = t;
  }
  flush();
  return out;
}

function* TokenStreamProto_toString(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  if (!isTokenStream(thisValue)) {
    return Throw.TypeError('$1 is not a token stream', thisValue);
  }
  return Value(TokenStreamText(thisValue.TokenRecords));
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
  };
  return TokenToObject(record, realmRec);
}

export function bootstrapTokenStreamPrototype(realmRec: Realm): void {
  const proto = bootstrapPrototype(realmRec, [
    ['toString', TokenStreamProto_toString, 0],
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
