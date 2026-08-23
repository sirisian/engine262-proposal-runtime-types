import { Parser, type ParserOptions } from './parser/Parser.mts';
import type { ExecutionContext } from './execution-context/ExecutionContext.mts';
import {
  CheckModule, CheckScript, PublishedReturnTypeOf, TakeNarrowingRequests,
} from './type-system/check.mts';
import { RegExpParser, type RegExpParserContext } from './parser/RegExpParser.mts';
import {
  SourceTextModuleRecord, SyntheticModuleRecord, type LoadedModuleRequestRecord, type ModuleRecordHostDefined,
} from './modules.mts';
import { JSStringValue, ObjectValue, Value } from './value.mts';
import { Q, type PlainCompletion, type ThrowCompletion } from './completion.mts';
import {
  ModuleRequests,
  ImportEntries,
  ExportEntries,
  OptionalIndirectExportEntries,
  ImportedLocalNames,
} from './static-semantics/all.mts';
import { kInternal } from './utils/internal.mts';
import { type Mutable } from './utils/language.mts';
import { JSStringSet } from './utils/container.mts';
import type { ParseNode } from './parser/ParseNode.mts';
import { ParseJSON } from './intrinsics/JSON.mts';
import { avoid_using_children } from './parser/utils.mts';
import { ReplacementDecoratorNames } from './static-semantics/ReplacementDecoratorNames.mts';
import { FirstReplacementEarlyError } from './static-semantics/ReplacementEarlyErrors.mts';
import { FirstEvaluabilityViolation } from './static-semantics/PreprocessorEvaluability.mts';
import { DECLINED, EXPANSION_LIMIT, ExpandSource, Expansion } from './static-semantics/Expansion.mts';
import { CreateTokenStream, TokenRecordsFrom, TokenStreamText } from './intrinsics/TokenStream.mts';
import { Call } from './abstract-ops/all.mts';
import { EnsureCompletion } from './completion.mts';
import { skipDebugger } from './evaluator.mts';
import { tokenizeText, TokensFromParse, type TokenRecord } from './parser/TokensOf.mts';
import { PrescanPreprocessorNames } from './parser/PrescanDecoratorModes.mts';
import { OverloadSignatureOf, SignaturesOf } from './abstract-ops/runtime-types.mts';
import { resolveOverload, type OverloadSignature } from './type-system/overloads.mts';
import { KindOfDecoratedNode, LabelOfDecoratedNode, SyntaxContextFor } from './syntax-context.mts';
import {
  ClearPreprocessorRefusal, LoadPreprocessorModule, PreprocessorExport, TakePreprocessorRefusal,
} from './preprocessor-loading.mts';
import { surroundingAgent, type GCMarker, Realm } from '#self';
import {
  CreateDefaultExportSyntheticModule,
  Throw,
} from '#self';

export { Parser, RegExpParser };

/**
 * `{ bound name -> 'parsed' | 'captured' }` for a source text's preprocessor
 * decorations.
 *
 * One question, and it is binary: IS THIS REGION'S TEXT ECMASCRIPT? A macro that
 * says nothing gets a parsed region - a Block, with its tokens threaded from the
 * parse - which is what a decorated block has always been. A macro whose region
 * is not ECMAScript declares `capture: true`, reads the text itself, and
 * delegates the ranges that are through `TokenStream.prototype.parse`.
 *
 * There is no set of grammar names for the engine to recognise any more, so
 * there is no unknown one to refuse. That check, and its error, are gone with
 * the grammars they policed.
 */
/**
 * The macro a preprocessor decoration names.
 *
 * `sec-preprocessor-modules` says a preprocessor module is fetched and evaluated
 * before the importing module is parsed, and that its exports are what a
 * decoration may be spelled with. So the module is LOADED and its export read -
 * which is what this does first.
 *
 * There is no fallback. `HostResolveReplacementDecorator` was how the engine
 * found a macro before any of this existed, and it appeared nowhere in the
 * specification - which is why a host had to implement both a module loader AND
 * a name-keyed registry to use the feature, and why that registry could not even
 * learn which module a decorator came from: the hook was handed the CONSUMING
 * module's specifier, never the import's.
 */
export function ResolveReplacementDecorator(
  source: string,
  specifier: string | undefined,
  name: string,
): ObjectValue | undefined {
  const imported = PrescanPreprocessorNames(source).get(name);
  if (imported !== undefined) {
    const realm = surroundingAgent.currentRealmRecord;
    const module = LoadPreprocessorModule(realm, realm as never, imported.Specifier);
    // A REFUSAL propagates; a miss does not. Turning every failure into "no
    // macro" is right for a host with no loader - it gets the parse it would
    // have got anyway - and wrong for a cycle, whose whole point is to be
    // reported. Swallowing it let compilation carry on into the assertion this
    // rule exists to replace.
    // A REFUSAL is recorded; a miss is not. Turning every failure into "no
    // macro" is right for a host with no loader - it gets the parse it would
    // have got anyway - and wrong for a cycle, whose whole point is to be
    // reported.
    // A failure here leaves the decoration alone. Only a CYCLE refuses, and it
    // records itself where it is detected - a host with no loader must still get
    // the parse it would have got.
    if ((module as { Type?: string }).Type === 'throw') {
      return undefined;
    }
    const exported = PreprocessorExport(module as never, imported.ExportName);
    if (exported instanceof ObjectValue) {
      return exported;
    }
  }
  void specifier;
  return undefined;
}

/**
 * Whether _macro_ is a replacement decorator, read from its WHOLE signature.
 *
 * `#sec-syntax-replacement`: "What a decorator RECEIVES is a TokenStream and
 * what it RETURNS is a token sequence". That pair is what identifies one, and it
 * is what this reads - a first parameter of `TokenStream` and a return of
 * `[].<Token>`. Neither half alone says much: plenty of functions take a stream,
 * and plenty return an array.
 */
function IsReplacementDecorator(
  signature: {
    Parameters?: readonly { Type?: { LibraryName?: string } }[],
    ReturnType?: { Kind?: string, Element?: { LibraryName?: string } },
  },
  macro: ObjectValue,
): boolean {
  const first = signature.Parameters?.[0];
  if (first?.Type?.LibraryName !== 'TokenStream') {
    return false;
  }
  // The DECLARED return, or the one the checker PUBLISHED for it. A macro may
  // write `: [].<Token>` and many do, but `linq` does not:
  //
  //   function linq(tokens: TokenStream, context: Reflect.Region) { … }
  //
  // and its return is inferred. `OverloadSignatureOf` fills `ReturnType` from the
  // ANNOTATION alone, so reading only that made an inferred return look like no
  // return at all - the macro was not identified, and its region was not
  // captured, for want of a line its author had no reason to write.
  //
  // The published type is what `EnforceReturnType` reads for the same reason, by
  // the same route.
  const code = (macro as { ECMAScriptCode?: { parent?: object } }).ECMAScriptCode;
  const ret = signature.ReturnType
    ?? (code?.parent ? PublishedReturnTypeOf(code.parent) as typeof signature.ReturnType : undefined);
  return ret?.Kind === 'array' && ret.Element?.LibraryName === 'Token';
}


/**
 * Whether _macro_ declares that it decorates a CAPTURED region.
 *
 * The signature says two things and they are separable, which is why both are
 * read from it rather than one being inferred from the other:
 *
 *   - `(TokenStream, …) => [].<Token>` says it is a replacement decorator at all;
 *   - a `Reflect.Region` CONTEXT says the region it takes is captured.
 *
 * A decorator with the first and not the second is an ordinary replacement
 * decorator over a parsed |Block|, which is what a macro declaring no `capture`
 * property was. The context is the SECOND parameter because
 * `#sec-syntax-replacement` fixes the calling convention as
 * `(tokens, context, args)`.
 */
function TakesARegionContext(macro: ObjectValue): boolean {
  // EVERY overload, not the one `OverloadSignatureOf` picks.
  //
  // `#sec-syntax-replacement`: "A name denotes one REPLACEMENT decorator ... A
  // name may nonetheless carry an ORDINARY decorator as well, since the two are
  // told apart by their signatures rather than by their arguments." So a name
  // may be `jsx` twice - once taking a TokenStream, once taking a class - and
  // reading a single signature would see whichever was declared last and miss
  // the macro half of it.
  //
  // `SignaturesOf` answers the set and establishes the declaring context itself,
  // which is what makes the type names in those signatures resolve as they would
  // where they were written.
  const all = EnsureCompletion(skipDebugger(SignaturesOf(macro))) as {
    Type: string,
    Value?: readonly {
      Parameters?: readonly { Type?: { LibraryName?: string } }[],
      ReturnType?: { Kind?: string, Element?: { LibraryName?: string } },
    }[],
  };
  const signatures = all.Type === 'normal' && all.Value !== undefined
    ? all.Value
    : [];
  const candidates = signatures.length > 0 ? signatures : SingleSignatureOf(macro);
  // Capture follows from BEING a replacement decorator, not from the context a
  // macro annotates. `#sec-preprocessor-modules`: "A replacement decorator's
  // region is captured, always, because it is a replacement decorator ...
  // Capture is not a mode a macro selects; it follows from what a replacement
  // decorator is."
  //
  // The context type used to decide it, and that made declaring the MODE the
  // same act as declaring which POSITIONS the macro takes: a macro annotating
  // `Reflect.Region` could not decorate a class, because the annotation is
  // enforced where the macro is called. Working around it meant a union
  // enumerating every position a macro might appear in - measured at EIGHTEEN,
  // and one more whenever the language gains a position.
  // `PLAN-region-context-removal` §20.
  return candidates.some((signature) => IsReplacementDecorator(signature, macro));
}

/** The one signature of a function that declares no overloads. */
function SingleSignatureOf(macro: ObjectValue): readonly {
  Parameters?: readonly { Type?: { LibraryName?: string } }[],
  ReturnType?: { Kind?: string, Element?: { LibraryName?: string } },
}[] {
  const resolved = EnsureCompletion(skipDebugger(OverloadSignatureOf(macro, true))) as {
    Type: string,
    Value?: {
      Parameters?: readonly { Type?: { LibraryName?: string } }[],
      ReturnType?: { Kind?: string, Element?: { LibraryName?: string } },
    },
  };
  return resolved.Type === 'normal' && resolved.Value !== undefined ? [resolved.Value] : [];
}

function DecoratorGrammars(source: string, specifier: string | undefined): ReadonlyMap<string, string> {
  const grammars = new Map<string, string>();
  if (!surroundingAgent.feature('runtime-types')) {
    return grammars;
  }
  for (const name of PrescanPreprocessorNames(source).keys()) {
    const macro = ResolveReplacementDecorator(source, specifier, name);
    let captured = false;
    if (macro instanceof ObjectValue) {
      captured = TakesARegionContext(macro);
    }
    grammars.set(name, captured ? 'captured' : 'parsed');
  }
  return grammars;
}

/**
 * Parse a sub-range of a region's text and answer its tokens.
 *
 * The whole of `TokenStream.prototype.parse`. A macro delegating an
 * interpolation reaches here, and what it gets back are tokens THREADED FROM
 * THAT PARSE - so a regular expression is one token and a template literal is
 * one token, which is exactly what a macro re-lexing the slice cannot achieve.
 */
export function ParseRange(
  text: string,
  from: number,
  to: number,
  goal: 'expression' | 'statements',
  source: { URL: string | undefined, Macro: string | undefined, Generation: number, Text: string },
): readonly TokenRecord[] | string {
  const slice = text.slice(from, to);
  const result = wrappedParse<ParseNode>(
    { source: slice },
    (p) => (goal === 'expression'
      ? (p as unknown as { parseExpression(): ParseNode }).parseExpression()
      : (p as unknown as { parseScript(): ParseNode }).parseScript()),
  );
  if (Array.isArray(result)) {
    const first = result[0] as { message?: unknown } | undefined;
    return typeof first?.message === 'string' ? first.message : 'the range does not parse';
  }
  const log = (result as { tokenLog?: readonly { type: number, startIndex: number, endIndex: number, kind?: string }[] }).tokenLog ?? [];
  return TokensFromParse(log as never, slice, source as never, 0, slice.length);
}

export function wrappedParse<T>(init: ParserOptions, f: (parser: Parser) => T) {
  const p = new Parser({
    ...init,
    decoratorGrammars: init.decoratorGrammars ?? DecoratorGrammars(init.source, init.specifier),
  });

  try {
    const r = f(p);
    const errors = [];
    for (const error of p.earlyErrors) {
      errors.push(error);
    }
    if (errors.length > 0) {
      return errors;
    }
    // The parse's own token log travels with what it produced, so expansion can
    // give a macro the tokens the PARSE consumed rather than re-lexing the
    // source. `sec-tokensof`: "the lexical goal symbol at each position is the
    // one the enclosing parse used", which only the parse knows.
    if (r !== null && typeof r === 'object') {
      (r as { tokenLog?: unknown }).tokenLog = p.tokenLog;
    }
    return r;
  } catch (e) {
    if (e instanceof ObjectValue) return [e];
    throw e;
  }
}

export class ScriptRecord {
  readonly Realm: Realm;

  readonly ECMAScriptCode: ParseNode.Script;

  /** proposal-runtime-types #sec-type-names: fixed at parse (see `TypeNames.mts`). */
  readonly AdmitsTypeNames?: boolean;

  readonly LoadedModules: LoadedModuleRequestRecord[];

  readonly HostDefined: ParseScriptHostDefined;

  mark(m: GCMarker) {
    m(this.Realm);
  }

  constructor(record: Omit<ScriptRecord, 'mark'>) {
    this.ECMAScriptCode = record.ECMAScriptCode;
    this.Realm = record.Realm;
    this.LoadedModules = record.LoadedModules;
    this.HostDefined = record.HostDefined;
    this.AdmitsTypeNames = record.AdmitsTypeNames;
  }
}
export interface ParseScriptHostDefined {
  readonly specifier?: string | undefined;
  readonly [kInternal]?: {
    json?: boolean;
    /** only used in inspector.compileScript */ allowAllPrivateNames?: boolean;
    /** only used in inspector.compileScript */ allowAwait?: boolean;
  };
  scriptId?: string;
  readonly doNotTrackScriptId?: boolean;
}
/**
 * Parsing may need the realm: a parse error is reported as a SyntaxError
 * OBJECT, and constructing one reads %SyntaxError% from the running execution
 * context's realm. A caller that parses outside any execution context - which
 * a host embedding does when it compiles source before entering the realm -
 * therefore crashed the host on any malformed input, reading `Realm` of an
 * undefined context, instead of receiving the list of errors ParseScript
 * promises to return.
 *
 * The realm is already in hand here, so the parse runs on its context when
 * nothing else is running. `ManagedRealm.compileScript` does this around its
 * own call; doing it here as well makes every caller safe, including hosts
 * this implementation does not control.
 */
function withRealmContext<T>(realm: Realm, f: () => T): T {
  const managed = realm as Realm & { topContext?: ExecutionContext };
  if (managed.topContext === undefined
      || surroundingAgent.runningExecutionContext === managed.topContext) {
    return f();
  }
  surroundingAgent.executionContextStack.push(managed.topContext);
  try {
    return f();
  } finally {
    surroundingAgent.executionContextStack.pop(managed.topContext);
  }
}

/**
 * The realm is entered around the WHOLE of a parse, not just around the parse
 * itself.
 *
 * Everything after the parse needs a realm as much as the parse does: an early
 * error is a SyntaxError OBJECT and a type error is a TypeError object, and
 * constructing either reads the constructor from the running execution
 * context's realm. Wrapping only `wrappedParse` left every one of those
 * crashing the host on an empty stack - the very failure `withRealmContext`
 * exists to prevent, reintroduced by each rule added after it.
 */
export function ParseScript(sourceText: string, realm: Realm, hostDefined: ParseScriptHostDefined = {}): ScriptRecord | ObjectValue[] {
  return withRealmContext(realm, () => ParseScriptInRealm(sourceText, realm, hostDefined));
}

function ParseScriptInRealm(sourceText: string, realm: Realm, hostDefined: ParseScriptHostDefined): ScriptRecord | ObjectValue[] {
  // 1. Assert: sourceText is an ECMAScript source text (see clause 10).
  // 2. Parse sourceText using Script as the goal symbol and analyse the parse result for
  //    any Early Error conditions. If the parse was successful and no early errors were found,
  //    let body be the resulting parse tree. Otherwise, let body be a List of one or more
  //    SyntaxError objects representing the parsing errors and/or early errors. Parsing and
  //    early error detection may be interweaved in an implementation-dependent manner. If more
  //    than one parsing error or early error is present, the number and ordering of error
  //    objects in the list is implementation-dependent, but at least one must be present.
  const parseOptions = {
    source: sourceText,
    specifier: hostDefined.specifier,
    json: hostDefined[kInternal]?.json,
    allowAllPrivateNames: hostDefined[kInternal]?.allowAllPrivateNames,
  };
  // The realm is already entered by the caller above, so these read the
  // context rather than pushing one of their own.
  let body = wrappedParse(parseOptions, (p) => p.parseScript());
  if (Array.isArray(body) && hostDefined[kInternal]?.allowAwait) {
    body = wrappedParse(parseOptions, (p) => p.scope.with({ await: true }, () => p.parseScript()));
  }
  // 3. If body is a List of errors, return body.
  if (Array.isArray(body)) {
    const scriptId = hostDefined.doNotTrackScriptId ? undefined : surroundingAgent.addDynamicParsedSource(realm, sourceText);
    body.forEach((error) => Parser.decorateSyntaxErrorWithScriptId(error, scriptId));
    return body;
  }

  // The parent links are wired before the checker runs, since the checker reads
  // the shape a node sits in (whether a test decides a branch, for instance).
  setNodeParent(body, undefined);
  // proposal-runtime-types #sec-type-errors: the static checker's type errors
  // join the early-error list, as TypeError objects rather than SyntaxError
  // objects, which is the specification's deliberate divergence.
  if (surroundingAgent.feature('runtime-types')) {
    // A decoration on a STATEMENT is legal only where it names a replacement
    // decorator, and a Script has no preprocessor import - so any decorated
    // statement here is a runtime decoration of one, which has nothing to run
    // at. Checked in both parse paths because `eval` reaches this one.
    const decorated = FirstReplacementEarlyError(body);
    if (decorated?.kind === 'runtime-on-statement') {
      const scriptId = hostDefined.doNotTrackScriptId ? undefined : surroundingAgent.addDynamicParsedSource(realm, sourceText);
      const completion = Throw.SyntaxError('$1 does not name a replacement decorator, and a statement declares nothing for a decorator to run at', Value(decorated.name)) as ThrowCompletion;
      Parser.decorateSyntaxErrorWithScriptId(completion.Value as ObjectValue, scriptId);
      return [completion.Value as ObjectValue];
    }
    const typeErrors = CheckScript(body);
    // A3.3: where the walk RECORDED a narrowing request it ran without the
    // narrowing, so it both over-reports and under-reports and must not speak.
    // The checking pass re-walks with the resolutions and reports instead -
    // later, and by throwing rather than as an early error. A program that
    // recorded nothing is untouched and still reports here (A3.4).
    const suppressed = typeErrors.length > 0 && TakeNarrowingRequests(body).length > 0;
    if (typeErrors.length > 0 && !suppressed) {
      const scriptId = hostDefined.doNotTrackScriptId ? undefined : surroundingAgent.addDynamicParsedSource(realm, sourceText);
      typeErrors.forEach((error) => Parser.decorateSyntaxErrorWithScriptId(error, scriptId));
      return typeErrors;
    }
  }
  // 4. Return Script Record { [[Realm]]: realm, [[ECMAScriptCode]]: body, [[HostDefined]]: hostDefined }.
  const script = new ScriptRecord({
    Realm: realm,
    ECMAScriptCode: body,
    // proposal-runtime-types #sec-type-names: carried from the parse and fixed
    // for this text's lifetime.
    AdmitsTypeNames: body.admitsTypeNames === true,
    LoadedModules: [],
    HostDefined: hostDefined,
  });
  if (!hostDefined.doNotTrackScriptId) {
    surroundingAgent.addParsedSource(script);
  }
  return script;
}

/**
 * As `ParseScript`: the realm is entered around the whole of the parse.
 *
 * The EXPANSION PHASE is why this matters here rather than only in principle.
 * It runs after the parse - resolving a decorator, loading and evaluating the
 * preprocessor module it names, building the token stream, and CALLING the
 * macro - and every one of those steps reads the current realm. A host that
 * compiles before entering the realm therefore crashed on any module using a
 * replacement decorator, which is every module that imports a macro: the
 * inspector's console takes the module goal precisely so that a preprocessor
 * import can be written there, so the one path macros must travel was the one
 * with no execution context on the stack.
 *
 * The recursive call for a re-expansion passes through here again and is free:
 * `withRealmContext` pushes nothing when the realm's context is already
 * running.
 *
 * The return type is written out rather than inferred. Splitting the body
 * introduced a CYCLE - `ParseModule` returns the arrow's result, the arrow
 * returns `ParseModuleInRealm`'s, and the re-expansion tail calls
 * `ParseModule` - and inference across it is circular (TS7023/TS7024), which
 * collapsed the type to `any` and took the inspector's call sites with it.
 * This is the type inference produced before the split.
 */
export function ParseModule(sourceText: string, realm: Realm, hostDefined: ModuleRecordHostDefined = {}): ObjectValue[] | SourceTextModuleRecord {
  return withRealmContext(realm, () => ParseModuleInRealm(sourceText, realm, hostDefined));
}

function ParseModuleInRealm(sourceText: string, realm: Realm, hostDefined: ModuleRecordHostDefined): ObjectValue[] | SourceTextModuleRecord {
  // 1. Assert: sourceText is an ECMAScript source text (see clause 10).
  // 2. Parse sourceText using Module as the goal symbol and analyse the parse result for
  //    any Early Error conditions. If the parse was successful and no early errors were found,
  //    let body be the resulting parse tree. Otherwise, let body be a List of one or more
  //    SyntaxError objects representing the parsing errors and/or early errors. Parsing and
  //    early error detection may be interweaved in an implementation-dependent manner. If more
  //    than one parsing error or early error is present, the number and ordering of error
  //    objects in the list is implementation-dependent, but at least one must be present.
  // A refusal belongs to the parse that is running. Clearing here is what keeps
  // one from reaching a later compile that has nothing to do with it - a global
  // that is only ever set and read leaks into every compile that follows.
  ClearPreprocessorRefusal();
  const body = wrappedParse<ParseNode.Module>({ source: sourceText, specifier: hostDefined.specifier }, (p) => p.parseModule());
  // 3. If body is a List of errors, return body.
  if (Array.isArray(body)) {
    const scriptId = hostDefined.doNotTrackScriptId ? undefined : surroundingAgent.addDynamicParsedSource(realm, sourceText);
    body.forEach((error) => Parser.decorateSyntaxErrorWithScriptId(error, scriptId));
    return body;
  }
  // The parent links are wired before the checker runs, since the checker reads
  // the shape a node sits in (whether a test decides a branch, for instance).
  setNodeParent(body, undefined);
  // proposal-runtime-types `sec-when-expansion-happens`: ReplacementDecoratorNames
  // is the GATE on the expansion phase, and it is computed here because this is
  // where the parsed module first exists and where the checker is about to run.
  //
  // **The ordering below is normative, not incidental.** `sec-decorator-
  // replacement` fixes expand-then-check: the checker must never see an
  // unexpanded decoration, and an implementation that checked first would reject
  // syntax a replacement decorator was about to produce. So the phase belongs
  // between the parse above and the `CheckModule` below - which is also why
  // load ordering is not separable from it, since a preprocessor module has to
  // have been evaluated before this point.
  //
  // A module whose names are EMPTY observes no phase at all: same parse, same
  // errors, same positions. That is the common case and it is what makes the
  // gate worth computing rather than always expanding.
  // A refusal recorded while resolving a decorator - a preprocessor cycle - is a
  // parse error, and this is where a parse answers with one.
  const refusal = TakePreprocessorRefusal();
  if (refusal !== undefined) {
    return [refusal];
  }
  const replacementNames = surroundingAgent.feature('runtime-types')
    ? ReplacementDecoratorNames(body)
    : [];
  (body as { ReplacementDecoratorNames?: readonly string[] }).ReplacementDecoratorNames = replacementNames;
  // `sec-replacement-decorators`, Static Semantics: Early Errors. Both are
  // computed from the module's own text and depend on nothing expansion
  // produces, so they are raised BEFORE the phase rather than inside it.
  // Run unconditionally: the statement rule applies to a module with NO
  // preprocessor import at all, where every decorated statement is a runtime
  // decoration of one.
  if (surroundingAgent.feature('runtime-types')) {
    // The unknown-GRAMMAR error is raised at the DECORATION, not here: a macro
    // declaring a grammar this implementation does not provide is only a problem
    // where a region is written with it, and the parser needs the answer at the
    // decoration anyway. Where the attribute was, the error had to be here,
    // because an import is all there was to report against.
    const early = FirstReplacementEarlyError(body);
    if (early) {
      const scriptId = hostDefined.doNotTrackScriptId ? undefined : surroundingAgent.addDynamicParsedSource(realm, sourceText);
      let completion;
      if (early.kind === 'shadowed') {
        completion = Throw.SyntaxError('$1 is a replacement decorator and cannot be shadowed', Value(early.name));
      } else if (early.kind === 'runtime-on-statement') {
        completion = Throw.SyntaxError('$1 does not name a replacement decorator, and a statement declares nothing for a decorator to run at', Value(early.name));
      } else {
        completion = Throw.SyntaxError('$1 is a replacement decorator and must be written outermost', Value(early.name));
      }
      completion = completion as ThrowCompletion;
      Parser.decorateSyntaxErrorWithScriptId(completion.Value as ObjectValue, scriptId);
      return [completion.Value as ObjectValue];
    }
  }
  // `sec-when-expansion-happens`: the phase runs HERE - after the parse above,
  // before the `CheckModule` below - and only when the gate is non-empty, so a
  // module using no replacement decorator observes no phase at all.
  if (replacementNames.length > 0) {
    // Run the decorators the host can resolve, and re-parse if any produced
    // something. The recursion is the fixpoint: a decoration the expansion
    // introduced is found by the next pass, and the depth is bounded.
    const expandedOnce = ExpandSource(
      sourceText,
      body,
      replacementNames,
      (name) => ResolveReplacementDecorator(sourceText, hostDefined.specifier, name),
      (from, to, mode) => {
        const slice = sourceText.slice(from, to);
        const source = {
          URL: hostDefined.specifier, Macro: undefined, Generation: 0, Text: slice,
        };
        // Outside a moded region the tokens come from the PARSE, where `/` and a
        // template literal are already resolved. Re-lexing the slice cannot tell
        // a regular expression from a division, and shreds a template into a
        // backtick, an identifier that exists in no source, and a group.
        const log = (body as { tokenLog?: readonly { type: number, startIndex: number, endIndex: number, kind?: string }[] }).tokenLog;
        if (mode === undefined && log !== undefined) {
          return CreateTokenStream(TokensFromParse(log as never, sourceText, source, from, to), realm);
        }
        // A CAPTURED region is tokenized with the ordinary lexical grammar, and
        // that is all a region ever needs from the engine now. A macro wanting a
        // different reading scans the text itself and delegates the ranges that
        // are ECMAScript through `TokenStream.prototype.parse` - which is what
        // let the JSX grammar leave the engine, it being the only thing that
        // ever needed a scanner of its own.
        return CreateTokenStream(tokenizeText(slice, source), realm);
      },
      (fn) => {
        // The macro's own source is on the function object, so evaluability is
        // checkable without loading anything. Parsed as a Script because a
        // function expression is not a Module.
        const source = (fn as { SourceText?: string })?.SourceText;
        if (typeof source !== 'string') {
          return undefined;
        }
        const parsed = wrappedParse<ParseNode.Script>({ source: `(${source})`, specifier: 'preprocessor' }, (pp) => pp.parseScript());
        if (Array.isArray(parsed)) {
          return undefined;
        }
        const violation = FirstEvaluabilityViolation(parsed);
        return violation ? `${violation.name} (${violation.why})` : undefined;
      },
      (fn, tokens, args, target) => {
        // `skipDebugger` drives the evaluator synchronously: expansion happens
        // before anything is running, so there is no context to suspend into.
        //
        // `(tokens, context, args?)`, matching a runtime decorator's
        // `(value, context)` in the position that carries the context.
        //
        // The context is `{ kind }` and nothing else. A replacement decorator
        // receives the TOKENS of what it decorates, so everything else a runtime
        // context carries syntactically - a name, `static`, a binding, a pattern
        // - is already in them, and a field beside a token stream is two ways to
        // say one thing.
        const kind = KindOfDecoratedNode(target);
        const context = kind === undefined
          ? Value.undefined
          : SyntaxContextFor(surroundingAgent.currentRealmRecord, kind, LabelOfDecoratedNode(target));
        const callArgs = args === undefined
          ? [tokens as Value, context as Value]
          : [tokens as Value, context as Value, args as Value];
        // Where the name carries SEVERAL overloads and none of them accepts
        // this position, there is no replacement to apply - the decoration is
        // declined rather than failed, and an ORDINARY overload of the same name
        // handles it at decoration time.
        //
        // Only where the name carries SEVERAL overloads: declining is meaningful
        // exactly when another overload may handle the position. A macro that is
        // a name's only declaration and does not accept where it is written is an
        // error, as it was - measured, extending this to a single declaration
        // fixed nothing and would have made a lone mismatched macro silent.
        //
        // Asked of resolution rather than inferred from the error it would
        // throw: "no overload matches" from a macro's own BODY is a real failure
        // and must stay one, and the two are indistinguishable by message.
        // `#sec-syntax-replacement`, and
        // `FINDING-overload-resolution-host-nominals.md` 9.3.
        const declared = EnsureCompletion(skipDebugger(SignaturesOf(fn as ObjectValue))) as {
          Type: string, Value?: readonly OverloadSignature[],
        };
        if (declared.Type === 'normal' && declared.Value !== undefined && declared.Value.length > 1
            && resolveOverload(declared.Value, callArgs as Value[], undefined).Kind === 'none') {
          return DECLINED;
        }
        const result = EnsureCompletion(skipDebugger(Call(fn as ObjectValue, Value.undefined, callArgs)));
        return result.Type === 'normal' ? result.Value : undefined;
      },
      (tokens) => {
        const records = tokens === undefined ? undefined : TokenRecordsFrom(tokens as Value);
        return records === undefined ? undefined : TokenStreamText(records);
      },
    );
    if (expandedOnce.failures.length > 0) {
      const failure = expandedOnce.failures[0];
      const scriptId = hostDefined.doNotTrackScriptId ? undefined : surroundingAgent.addDynamicParsedSource(realm, sourceText);
      const completion = (failure.kind === 'threw'
        ? Throw.SyntaxError('the replacement decorator $1 rejected what it decorates', Value(failure.name))
        : failure.kind === 'not-evaluable'
          ? Throw.SyntaxError('the replacement decorator $1 is not compile-time evaluable: it names $2', Value(failure.name), Value(failure.detail ?? ''))
          : Throw.SyntaxError('the replacement decorator $1 did not return tokens', Value(failure.name))) as ThrowCompletion;
      Parser.decorateSyntaxErrorWithScriptId(completion.Value as ObjectValue, scriptId);
      return [completion.Value as ObjectValue];
    }
    if (expandedOnce.expanded > 0 && expandedOnce.text !== sourceText) {
      // `??` binds LOOSER than `>`, so `depth ?? 0 > LIMIT` parses as
      // `depth ?? (0 > LIMIT)` — which is the depth itself once it is non-zero,
      // and every second pass tripped the limit. The parenthesis is the fix and
      // the bug was invisible in a single-pass test.
      const depth = (hostDefined as { expansionDepth?: number }).expansionDepth ?? 0;
      if (depth > EXPANSION_LIMIT) {
        const scriptId = hostDefined.doNotTrackScriptId ? undefined : surroundingAgent.addDynamicParsedSource(realm, sourceText);
        const limitError = Throw.SyntaxError('expansion exceeded the limit') as ThrowCompletion;
        Parser.decorateSyntaxErrorWithScriptId(limitError.Value as ObjectValue, scriptId);
        return [limitError.Value as ObjectValue];
      }
      return ParseModule(expandedOnce.text, realm, {
        ...hostDefined,
        expansionDepth: depth + 1,
      } as ModuleRecordHostDefined);
    }
    const expansion = Expansion(body, replacementNames);
    (body as { ExpansionResult?: unknown }).ExpansionResult = expansion;
    if (expansion.limitExceeded) {
      const scriptId = hostDefined.doNotTrackScriptId ? undefined : surroundingAgent.addDynamicParsedSource(realm, sourceText);
      const error = Throw.SyntaxError(
        'expansion of $1 exceeded the limit',
        Value(expansion.limitExceeded.name),
      ) as ThrowCompletion;
      Parser.decorateSyntaxErrorWithScriptId(error.Value as ObjectValue, scriptId);
      return [error.Value as ObjectValue];
    }
  }
  // proposal-runtime-types #sec-type-errors: the same checker gate as the
  // script goal, over module items.
  if (surroundingAgent.feature('runtime-types')) {
    const typeErrors = CheckModule(body);
    if (typeErrors.length > 0) {
      const scriptId = hostDefined.doNotTrackScriptId ? undefined : surroundingAgent.addDynamicParsedSource(realm, sourceText);
      typeErrors.forEach((error) => Parser.decorateSyntaxErrorWithScriptId(error, scriptId));
      return typeErrors;
    }
  }
  // 4. Let requestedModules be the ModuleRequests of body.
  const requestedModules = ModuleRequests(body);
  // 5. Let importEntries be ImportEntries of body.
  const importEntries = ImportEntries(body);
  // 6. Let importedBoundNames be ImportedLocalNames(importEntries).
  const importedBoundNames = new JSStringSet(ImportedLocalNames(importEntries));
  // 7. Let indirectExportEntries be a new empty List.
  const indirectExportEntries = [];
  // 8. Let localExportEntries be a new empty List.
  const localExportEntries = [];
  // 9. Let starExportEntries be a new empty List.
  const starExportEntries = [];
  // 10. Let exportEntries be ExportEntries of body.
  const exportEntries = ExportEntries(body);
  // 11. For each ExportEntry Record ee in exportEntries, do
  for (const ee of exportEntries) {
    // a. If ee.[[ModuleRequest]] is null, then
    if (ee.ModuleRequest === Value.null) {
      // i. If ee.[[LocalName]] is not an element of importedBoundNames, then
      if (!importedBoundNames.has(ee.LocalName)) {
        // 1. Append ee to localExportEntries.
        localExportEntries.push(ee);
      } else { // ii. Else,
        // 1. Let ie be the element of importEntries whose [[LocalName]] is the same as ee.[[LocalName]].
        const ie = importEntries.find((e) => e.LocalName.stringValue() === (ee.LocalName as JSStringValue).stringValue());
        // a. NOTE: This is a re-export of a single name.
        // b. Append the ExportEntry Record { [[ModuleRequest]]: ie.[[ModuleRequest]], [[ImportName]]: ie.[[ImportName]], [[LocalName]]: null, [[ExportName]]: ee.[[ExportName]] } to indirectExportEntries.
        indirectExportEntries.push({
          ModuleRequest: ie!.ModuleRequest,
          ImportName: ie!.ImportName,
          LocalName: Value.null,
          ExportName: ee.ExportName,
        });
      }
    } else if (ee.ImportName && ee.ImportName === 'all-but-default' && ee.ExportName === Value.null) { // b. Else if ee.[[ImportName]] is ~all-but-default~ and ee.[[ExportName]] is null, then
      // i. Append ee to starExportEntries.
      starExportEntries.push(ee);
    } else { // c. Else,
      // i. Append ee to indirectExportEntries.
      indirectExportEntries.push(ee);
    }
  }
  // Let optionalIndirectExportEntries be OptionalIndirectExportEntries of body.
  // (https://tc39.es/proposal-deferred-reexports/#sec-parsemodule)
  const optionalIndirectExportEntries = OptionalIndirectExportEntries(body);
  // 12. Return Source Text Module Record { [[Realm]]: realm, [[Environment]]: undefined, [[Namespace]]: undefined, [[Status]]: unlinked, [[EvaluationError]]: undefined, [[HostDefined]]: hostDefined, [[ECMAScriptCode]]: body, [[Context]]: empty, [[ImportMeta]]: empty, [[RequestedModules]]: requestedModules, [[ImportEntries]]: importEntries, [[LocalExportEntries]]: localExportEntries, [[IndirectExportEntries]]: indirectExportEntries, [[StarExportEntries]]: starExportEntries, [[DFSAncestorIndex]]: undefined }.
  const module = new (hostDefined.SourceTextModuleRecord || SourceTextModuleRecord)({
    Realm: realm,
    Environment: undefined,
    Namespace: undefined,
    Status: 'new',
    EvaluationError: undefined,
    HostDefined: hostDefined,
    ECMAScriptCode: body,
    Context: undefined,
    ImportMeta: undefined,
    RequestedModules: requestedModules,
    LoadedModules: [],
    ImportEntries: importEntries,
    LocalExportEntries: localExportEntries,
    IndirectExportEntries: indirectExportEntries,
    StarExportEntries: starExportEntries,
    OptionalIndirectExportEntries: optionalIndirectExportEntries,
    CycleRoot: undefined,
    HasTLA: body.hasTopLevelAwait ? Value.true : Value.false,
    AdmitsTypeNames: body.admitsTypeNames === true,
    AsyncEvaluationOrder: 'unset',
    TopLevelCapability: undefined,
    AsyncParentModules: [],
    DFSAncestorIndex: undefined,
    PendingAsyncDependencies: undefined,
    ModuleSource: undefined,
  });
  if (!hostDefined.doNotTrackScriptId) {
    surroundingAgent.addParsedSource(module);
  }
  return module;
}

/** https://tc39.es/ecma262/#sec-parsejsonmodule */
export function ParseJSONModule(source: JSStringValue): PlainCompletion<SyntheticModuleRecord> {
  const parseResult = Q(ParseJSON(source.stringValue()));
  return CreateDefaultExportSyntheticModule(parseResult.Value);
}

export function setNodeParent(node: ParseNode, parent: ParseNode | undefined) {
  (node as Mutable<ParseNode.BaseParseNode>).parent = parent;
  for (const child of avoid_using_children(node)) {
    if (!child.parent) {
      setNodeParent(child, node);
    }
  }
}

/** https://tc39.es/ecma262/#sec-parsepattern */
export function ParsePattern(patternText: string, u: boolean, v: boolean) {
  const parse = (flags: RegExpParserContext) => {
    try {
      const p = new RegExpParser(patternText);
      return p.scope(flags, () => p.parsePattern());
    } catch (e) {
      if (e instanceof ObjectValue) return [e];
      throw e;
    }
  };
  if (v && u) {
    return [Throw.SyntaxError('RegExp flags "v" and "u" cannot be used together').Value];
  } else if (v) {
    return parse({ UnicodeMode: true, UnicodeSetsMode: true, NamedCaptureGroups: true });
  } else if (u) {
    return parse({ UnicodeMode: true, NamedCaptureGroups: true });
  } else {
    return parse({ NamedCaptureGroups: true });
  }
}
