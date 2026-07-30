import { BigIntValue, NumberValue, Value, type ObjectValue, SymbolValue } from '../value.mts';
import type { ThrowCompletion } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import {
  builtinTypeRecord, libraryTypeRecord, displayType, makePrimitive, voidType, type TypeRecord, namedNumericLiteralRecord,
  parameter, type ParameterRecord, anyType as anyTypeRecord, generatorDeclaredType, generatorParameters,
  neverType, libraryTypeRecord as libraryType } from './records.mts';
import { CanonicalizeType } from './intern.mts';
import { Diverges } from './divergence.mts';
import { SameType, IsAssignable } from './relations.mts';
import {
  NarrowTo, NarrowFrom, nullishType, empty,
} from './narrowing.mts';
import { MetadataObjectFromType, fitsNumericType } from './runtime.mts';
import { resolveOverloadByTypes } from './overloads.mts';
import { wrapToType } from './arithmetic.mts';
import { isFloatTypeName, isIntegerTypeName, numericLibraryRows } from './numeric-signatures.mts';
import { inferRegExpLiteralType } from './regexp-inference.mts';
import { R, Throw } from '#self';

/**
 * proposal-runtime-types #sec-static-type-of-an-expression and #sec-type-errors
 * A post-parse walk computing the Static Type of expressions and raising the
 * specification's type errors. The Static Type of anything the checker does
 * not model is ~any~, so under the gradual rule silence is sound: an error is
 * raised only where both sides of a judgment are statically known. Scoping is
 * simplified to one frame per function; block-level shadowing inside one
 * function is approximated by overwriting, which cannot introduce a false
 * positive because an unknown type is ~any~.
 */

type Known = TypeRecord | null;

/**
 * proposal-runtime-types #sec-primitive-metadata: two parameterizations of one
 * base with different metadata are related only as the metadata subtype
 * judgment admits, and the judgment consults `subtype` hooks, which are user
 * code. This pass is synchronous and runs at parse, so it does not decide such
 * a pair; it DEFERS it, and the checking pass (check-pass.mts), which runs
 * after parse and before the source text evaluates (#sec-type-errors), judges
 * the deferred pairs where an effectful context exists. The obligations are
 * keyed by the root Parse Node so that pass retrieves exactly its own source
 * text's pairs.
 */
export interface DeferredMetadataCheck {
  readonly source: TypeRecord & { readonly Kind: 'parameterized' };
  readonly target: TypeRecord & { readonly Kind: 'parameterized' };
}
const deferredMetadataChecks = new WeakMap<object, readonly DeferredMetadataCheck[]>();

export function TakeDeferredMetadataChecks(root: object): readonly DeferredMetadataCheck[] {
  return deferredMetadataChecks.get(root) ?? [];
}

/**
 * #sec-primitive-metadata: "a metadata object whose own key no meta type
 * claims is a type error at the parameterization that writes it". The keys
 * are COLLECTED during the walk and adjudicated by the checking pass, because
 * claims register when a MetaDeclaration EVALUATES: deciding here would
 * reject a parameterization written above its meta type, which is legal.
 * Mirrors the deferred-metadata channel above (the plan's Phase 3, F44).
 */
export interface UnclaimedKeyCheck {
  readonly node: ParseNode;
  readonly display: string;
  readonly base: TypeRecord;
  readonly keys: readonly string[];
}
const unclaimedKeyChecks = new WeakMap<object, readonly UnclaimedKeyCheck[]>();

export function TakeUnclaimedKeyChecks(root: object): readonly UnclaimedKeyCheck[] {
  return unclaimedKeyChecks.get(root) ?? [];
}

/**
 * proposal-runtime-types #sec-overload-resolution: a call the checker resolved
 * to a numeric value family FROM ITS CONTEXT ALONE must execute that family's
 * row at run time, so the resolution is recorded per CallExpression node and
 * EvaluateCall reads it to type the literal arguments before the dispatch
 * wrapper selects a row. Recorded only where every argument is a numeric
 * literal the checker proved to fit, so the runtime wrap is lossless by
 * construction; everything else stays on the runtime's own dispatch, which is
 * the ~any~ path's backstop.
 */
const staticCallResolutions = new WeakMap<object, TypeRecord & { Kind: 'primitive' }>();

export function TakeStaticCallResolution(node: object): (TypeRecord & { Kind: 'primitive' }) | undefined {
  return staticCallResolutions.get(node);
}

// proposal-runtime-types (spec sec-enums): what the checker records about an enum
// declaration so a switch over an enum value can be checked: the member names in
// declaration order, to match a `case E.Member` label and to report a missing one.
interface EnumInfo {
  readonly names: readonly string[];
}

interface Frame {
  readonly bindings: Map<string, TypeRecord>;
  // The names this frame NARROWS rather than declares. sec-narrowing: "a
  // narrowed binding is invalidated by an assignment that leaves the narrowed
  // type", so an assignment has to find the DECLARED type to check against and
  // then drop the narrowing - which needs the two kinds of entry told apart
  // (F78).
  readonly narrowed?: Set<string>;
  readonly aliases: Map<string, TypeRecord>;
  // Enum declarations in scope, by enum name, and the bindings known to hold an
  // enumerator of one, by variable name to enum name.
  readonly enums: Map<string, EnumInfo>;
  readonly enumBindings: Map<string, string>;
}


function widen(t: TypeRecord): TypeRecord {
  return t.Kind === 'literal' ? t.Base : t;
}

/**
 * #sec-check-elision: "A check is required only where the static types do not
 * already establish the result." The checker proves that at a boundary and
 * records the annotation whose check may be skipped; the run time consults the
 * same set (F81).
 *
 * The condition is narrower than the clause's first bullet reads, and the
 * narrowing is the whole correctness argument. A LITERAL is assignable to
 * `uint8` and still needs converting - `let x: uint8 = 5` must produce a uint8
 * value, not the Number 5 - so assignability alone does not license skipping
 * the boundary. What licenses it is that the value is ALREADY of the target
 * type: a non-literal static type that is assignable needs no representation
 * change, so the boundary would return it unchanged.
 */
const elidableAnnotations = new WeakSet<object>();

/**
 * Whether a contextual type asks for a `bigint`, through a union as well as
 * directly: `let x: bigint | undefined = 9007199254740993` wants the same
 * reading as the bare annotation.
 */
function bigintTarget(t: TypeRecord): boolean {
  if (t.Kind === 'primitive') {
    return t.Name === 'bigint';
  }
  if (t.Kind === 'union') {
    return t.Members.some(bigintTarget);
  }
  return false;
}

/**
 * The exact mathematical value a numeric literal denotes, where it denotes an
 * integer, read from the source text. Returns *null* where the literal is not
 * an integer, where it is already a BigInt literal (which needs no help), or
 * where no source text was retained - an older parse node, or one this engine
 * synthesized.
 */
function exactBigIntOf(node: ParseNode.NumericLiteral): bigint | null {
  if (typeof node.value === 'bigint') {
    return null;
  }
  const text = node.SourceText;
  if (typeof text !== 'string' || text.length === 0) {
    return null;
  }
  // A separator is not part of the value; a fraction or an exponent means the
  // literal does not denote an integer, and BigInt() would throw rather than
  // answer. Legacy octal is excluded deliberately: `0755` denotes 493 in
  // sloppy mode and 755 to BigInt, and a literal whose reading depends on the
  // mode is not one to be clever with.
  const cleaned = text.replace(/_/g, '');
  if (!/^(0[xXoObB][0-9a-fA-F]+|[1-9][0-9]*|0)$/.test(cleaned)) {
    return null;
  }
  try {
    return BigInt(cleaned);
  } catch {
    return null;
  }
}

/** Numeric literals the checker read at `bigint`, consulted by NumericValue. */
const bigintLiterals = new WeakSet<object>();

export function IsBigIntContextLiteral(node: object): boolean {
  return bigintLiterals.has(node);
}

export function IsCheckElided(annotation: object): boolean {
  return elidableAnnotations.has(annotation);
}

export function CheckScript(script: ParseNode.Script): ObjectValue[] {
  return CheckStatementList(script.ScriptBody?.StatementList ?? null, script);
}

export function CheckModule(module: ParseNode.Module): ObjectValue[] {
  // Module items are a superset of statements; import/export wrappers are
  // walked structurally, and their inner declarations checked as usual.
  return CheckStatementList(module.ModuleBody?.ModuleItemList ?? null, module);
}

function CheckStatementList(statementList: readonly ParseNode[] | null, root: ParseNode): ObjectValue[] {
  const errors: ObjectValue[] = [];
  const deferred: DeferredMetadataCheck[] = [];
  const unclaimed: UnclaimedKeyCheck[] = [];
  const frames: Frame[] = [{ bindings: new Map(), aliases: new Map(), enums: new Map(), enumBindings: new Map() }];
  const returnTypes: Known[] = [];

  const report = (source: TypeRecord, target: TypeRecord) => {
    const completion = Throw.TypeError('$1 is not assignable to $2', Value(displayType(source)), Value(displayType(target))) as ThrowCompletion;
    errors.push(completion.Value as ObjectValue);
  };

  // #sec-contextual-types: a numeric literal whose value fits a numeric value
  // type is assignable to it; the boundary constructs the typed value. This is
  // the permanent contextual-typing rule (not a stopgap): after R1/R3 the value
  // space is genuinely distinct, and this is how a plain literal enters it.
  const literalFitsNumericType = (source: TypeRecord, target: TypeRecord): boolean => {
    if (source.Kind === 'literal' && target.Kind === 'primitive'
        && ['uint', 'int', 'float16', 'float32', 'float64', 'bigint'].includes(target.Name)
        && source.Value instanceof NumberValue
        && fitsNumericType(R(source.Value) as number, target.Name, target.Arguments)) {
      return true;
    }
    // A BigInt literal at `bigint` is the same rule with the other literal
    // kind: the value is already of the target type (F66).
    if (source.Kind === 'literal' && target.Kind === 'primitive' && target.Name === 'bigint'
        && source.Value instanceof BigIntValue) {
      return true;
    }
    if (target.Kind === 'union') {
      return target.Members.some((m) => literalFitsNumericType(source, m));
    }
    return false;
  };

  // Metadata erased: a ~parameterized~ record replaced by its base, through
  // unions and intersections. This is exactly the view resolveType gave before
  // it learnt to build ~parameterized~ records, and judging non-deferred shapes
  // on it keeps this pass's diagnostics byte-identical to what they were: the
  // one new judgment this cycle adds, the metadata subtype judgment, is the
  // checking pass's, not this one's.
  const eraseMetadata = (t: TypeRecord): TypeRecord => {
    if (t.Kind === 'parameterized') {
      return eraseMetadata(t.Base);
    }
    if (t.Kind === 'union' || t.Kind === 'intersection') {
      return { Kind: t.Kind, Members: t.Members.map(eraseMetadata) };
    }
    return t;
  };

  const requireAssignable = (source: Known, target: Known) => {
    if (!source || !target) {
      return;
    }
    // #sec-primitive-metadata: two parameterizations of one base. Structurally
    // equivalent metadata is one type and passes below; different metadata is
    // the metadata subtype judgment's question, which consults `subtype` hooks
    // (user code), so this synchronous pass defers the pair to the checking
    // pass rather than deciding it. A mixed position, a parameterization
    // meeting its bare base, is the construction boundary (F33) and stays
    // outside this pass, which the erasure below preserves.
    if (source.Kind === 'parameterized' && target.Kind === 'parameterized'
        && displayType(source.Base) === displayType(target.Base)) {
      if (!IsAssignable(source, target)) {
        deferred.push({ source, target } as DeferredMetadataCheck);
      }
      return;
    }
    const erasedSource = eraseMetadata(source);
    const erasedTarget = eraseMetadata(target);
    // #sec-contextual-types: a numeric literal within a numeric value type's
    // range converts losslessly at the boundary, so it is statically
    // assignable; the run-time boundary constructs the typed value.
    if (literalFitsNumericType(erasedSource, erasedTarget)) {
      return;
    }
    // A BigInt literal at a FLOAT family follows the checked rule the runtime
    // applies (F38): admitted exactly where the width represents it exactly,
    // an Early Error where it would round. An integer family stays reported:
    // exactness at the wide widths is the pinned prerequisite.
    // (Discriminated by the VALUE: staticType currently labels a BigInt
    // literal's Base as `number`, a mislabel F38 pins, so the Base name is
    // not the reliable half here.)
    if (erasedSource && erasedSource.Kind === 'literal'
        && erasedTarget && erasedTarget.Kind === 'primitive' && isFloatTypeName(erasedTarget.Name)
        && erasedSource.Value instanceof BigIntValue) {
      const big = R(erasedSource.Value) as bigint;
      const rounded = wrapToType(Number(big), erasedTarget);
      if (Number.isFinite(rounded) && BigInt(rounded) === big) {
        return;
      }
    }
    if (!IsAssignable(erasedSource, erasedTarget)) {
      report(erasedSource, erasedTarget);
    }
  };

  // #sec-overload-resolution over the numeric library's listing
  // (table-numeric-library-signatures), driven statically. The listing's
  // structure collapses the general algorithm: every signature takes its
  // numeric parameters at ONE type and no numeric value type is assignable to
  // another, so a typed argument names the only viable family, two different
  // typed arguments are viable at no signature, and with no typed argument the
  // contextual type (#sec-contextual-types) selects the family through the
  // return filter, which is R8's specialized call. The Number signature is
  // every listed function's default: resolution to it types nothing and
  // records nothing, so an untyped program stays exactly as silent as before.
  const numericFamilyOf = (t: Known): (TypeRecord & { Kind: 'primitive' }) | 'bigint' | null => {
    if (!t || t.Kind !== 'primitive') {
      return null;
    }
    if (isIntegerTypeName(t.Name) || isFloatTypeName(t.Name) || t.Name === 'number') {
      return t;
    }
    return t.Name === 'bigint' ? 'bigint' : null;
  };

  const mathCallName = (call: ParseNode): string | null => {
    const m = (call as { CallExpression?: ParseNode }).CallExpression as { type?: string, MemberExpression?: ParseNode, IdentifierName?: { name: string } | null } | undefined;
    if (!m || m.type !== 'MemberExpression' || !m.MemberExpression || !m.IdentifierName) {
      return null;
    }
    if (m.MemberExpression.type !== 'IdentifierReference' || (m.MemberExpression as unknown as { name: string }).name !== 'Math') {
      return null;
    }
    // A locally bound `Math` shadows the intrinsic and is not the listing's; a
    // REPLACED global `Math` is not detectable here, the same corner the
    // name-based builtin type resolution already lives with.
    if (lookup('Math')) {
      return null;
    }
    const name = m.IdentifierName.name;
    return numericLibraryRows.has(name) ? name : null;
  };

  const pushCallError = (message: string, ...values: Value[]) => {
    const raise = Throw.TypeError as unknown as (m: string, ...vs: Value[]) => ThrowCompletion;
    const completion = raise(message, ...values);
    errors.push(completion.Value as ObjectValue);
  };

  const resolvedNumericCalls = new WeakSet<object>();
  const checkNumericCall = (call: ParseNode, contextual: Known): Known => {
    const name = mathCallName(call);
    if (!name) {
      return null;
    }
    if (resolvedNumericCalls.has(call)) {
      return (staticCallResolutions.get(call) as Known) ?? null;
    }
    resolvedNumericCalls.add(call);
    const allArgs = (call as { Arguments?: readonly ParseNode[] }).Arguments ?? [];
    const argNodes = allArgs.filter((a) => a.type !== 'AssignmentRestElement');
    let family: (TypeRecord & { Kind: 'primitive' }) | null = null;
    let sawBigint = false;
    let mixed = false;
    const literals: { value: number, record: TypeRecord }[] = [];
    let everyArgProven = allArgs.length === argNodes.length;
    for (const a of argNodes) {
      const t = staticType(a);
      if (t && t.Kind === 'literal') {
        const base = t.Base;
        if (base.Kind === 'primitive' && base.Name === 'number' && t.Value instanceof NumberValue) {
          literals.push({ value: R(t.Value) as number, record: t });
        } else if (base.Kind === 'primitive' && base.Name === 'bigint') {
          sawBigint = true;
        } else {
          everyArgProven = false;
        }
        continue;
      }
      const fam = numericFamilyOf(t);
      if (fam === 'bigint') {
        sawBigint = true;
      } else if (fam && fam.Name !== 'number') {
        if (family && displayType(family) !== displayType(fam)) {
          mixed = true;
        } else {
          family = fam;
        }
      } else {
        // A `number`-typed value belongs to the untyped signature, and an
        // unknown argument is ~any~: neither names a family nor proves the
        // call for recording.
        everyArgProven = false;
      }
    }
    if (sawBigint) {
      // The bigint column resolves at run time this cycle; F37 pins it.
      return null;
    }
    if (mixed) {
      // "Every signature takes its numeric parameters at one type."
      pushCallError('$1 has no signature taking values of two numeric types', Value(`Math.${name}`));
      return null;
    }
    const ctxCandidate = numericFamilyOf(contextual);
    const ctxFamily = ctxCandidate === 'bigint' ? null : ctxCandidate;
    const row = numericLibraryRows.get(name)!;
    const chosen = family ?? (ctxFamily && ctxFamily.Name !== 'number' ? ctxFamily : null);
    if (!chosen) {
      // The Number signature: silent and unrecorded, as today.
      return null;
    }
    const rowExists = isIntegerTypeName(chosen.Name) ? row.integer !== undefined : (isFloatTypeName(chosen.Name) && row.float);
    if (!rowExists) {
      if (family) {
        pushCallError('$1 has no signature taking a value of type $2', Value(`Math.${name}`), Value(displayType(chosen)));
      } else {
        pushCallError('$1 has no signature returning $2', Value(`Math.${name}`), Value(displayType(chosen)));
      }
      return null;
    }
    const returned: TypeRecord = row.integer === 'imul' && isIntegerTypeName(chosen.Name)
      ? (builtinTypeRecord('int32') as TypeRecord)
      : chosen;
    if (ctxFamily && displayType(returned) !== displayType(ctxFamily)) {
      // The contextual filter of ResolveOverload: no viable signature returns
      // what the position requires. This also covers a `number` context over a
      // value-typed argument, since `number` is assignable from no value type.
      pushCallError('$1 has no signature returning $2', Value(`Math.${name}`), Value(displayType(ctxFamily)));
      return null;
    }
    let literalsFit = true;
    for (const lit of literals) {
      // #sec-literal-overload-ranking: a literal argument takes the chosen
      // parameter's type where it can represent it, and is a type error where
      // it cannot; the plan's out-of-range-literal Early Error, uniformly.
      if (!fitsNumericType(lit.value, chosen.Name, chosen.Arguments)) {
        report(lit.record, chosen);
        literalsFit = false;
      }
    }
    if (!family && everyArgProven && literalsFit && argNodes.length > 0 && literals.length === argNodes.length) {
      staticCallResolutions.set(call, chosen);
    }
    return returned;
  };

  /**
   * Each element of an array literal against the element type, and the arity
   * against a FIXED extent. A spread contributes an unknown number of elements
   * of an unknown type, so it stops both judgments rather than being guessed
   * at - the alternative is reporting an arity the program does not have.
   */
  const checkArrayLiteralAgainst = (node: ParseNode.ArrayLiteral, target: TypeRecord & { Kind: 'array' }) => {
    const elements = node.ElementList ?? [];
    let spread = false;
    let count = 0;
    for (const el of elements) {
      if (!el || typeof el !== 'object') {
        continue;
      }
      if ((el as ParseNode).type === 'SpreadElement') {
        spread = true;
        walk(el as ParseNode);
        continue;
      }
      if ((el as ParseNode).type === 'Elision') {
        count += 1;
        continue;
      }
      count += 1;
      requireAssignable(staticTypeIn(el as ParseNode, target.Element), target.Element);
      walk(el as ParseNode);
    }
    // "A fixed extent `[N].<T>` requires the literal to have length N", which
    // the run time already enforces and the checker could not see.
    if (!spread && typeof target.Extent === 'number' && count !== target.Extent) {
      report({ Kind: 'array', Element: target.Element, Extent: count }, target);
    }
  };

  /**
   * Each member of an object literal against the property the target declares.
   * A member the target does not declare is left alone here: the freshness rule
   * of #sec-literal-freshness makes it an error, and that judgment is a
   * different one from this - it belongs with the rule that states it, not
   * bolted onto the member check.
   */
  const checkObjectLiteralAgainst = (node: ParseNode.ObjectLiteral, target: TypeRecord & { Kind: 'object' }) => {
    for (const member of node.PropertyDefinitionList ?? []) {
      if (!member || (member as ParseNode).type !== 'PropertyDefinition') {
        walk(member as ParseNode);
        continue;
      }
      const def = member as unknown as {
        PropertyName?: { name?: string, value?: string } | null,
        AssignmentExpression?: ParseNode,
      };
      const key = memberKeyOf(def.PropertyName);
      const declared = key === undefined
        ? undefined
        : target.Properties.find((prop) => prop.key === key);
      if (declared && def.AssignmentExpression) {
        requireAssignable(staticTypeIn(def.AssignmentExpression, declared.type), declared.type);
      }
      if (def.AssignmentExpression) {
        walk(def.AssignmentExpression);
      }
    }
  };

  const staticTypeIn = (node: ParseNode | null | undefined, contextual: Known): Known => {
    if (!node) {
      return null;
    }
    if (node.type === 'CallExpression') {
      const resolved = checkNumericCall(node, contextual);
      if (resolved) {
        return resolved;
      }
    }
    // An ARRAY or OBJECT literal takes its contextual type apart and checks
    // its parts against it. This is F37's standing pin, and until now the only
    // check on a literal's contents was the RUNTIME boundary: `let a:
    // [].<uint8> = [1, 300]` inside a never-called function raised nothing at
    // all, while `let x: uint8 = 300` had been an Early Error since Phase 3.
    // The two are the same mistake written at different depths.
    //
    // Recursing through staticTypeIn rather than staticType is what makes the
    // parts behave like the whole: an element adopts the element type by the
    // literal rule, a nested literal takes its own contextual type apart in
    // turn, and a numeric literal at a `bigint` element reads its source text
    // exactly as it does at a binding (F85).
    if (node.type === 'ArrayLiteral' && contextual && contextual.Kind === 'array') {
      checkArrayLiteralAgainst(node as ParseNode.ArrayLiteral, contextual);
      return contextual;
    }
    if (node.type === 'ObjectLiteral' && contextual) {
      const shape = structureOf(contextual);
      if (shape && shape.Kind === 'object') {
        checkObjectLiteralAgainst(node as ParseNode.ObjectLiteral, shape);
        return contextual;
      }
    }
    // A numeric LITERAL at a `bigint` contextual position is read from its
    // SOURCE TEXT rather than from the double the lexer produced. The rule was
    // bounded at 2**53 and refused beyond it, which never corrupted but meant
    // the `n` suffix was still required exactly where it is most tedious - the
    // large constants (F67). #sec-literalvalueintype converts from "the
    // mathematical value denoted by the literal", and the text is where that
    // value still exists.
    //
    // Marked as well as typed: the checker's answer and the run time's value
    // have to agree, so the same test that admits the literal records that its
    // evaluation must produce the BigInt. That is the elidable-annotation
    // channel again - the checker knows something at a node, and the run time
    // consults the mark.
    if (node.type === 'NumericLiteral' && contextual && bigintTarget(contextual)) {
      const exact = exactBigIntOf(node as ParseNode.NumericLiteral);
      if (exact !== null) {
        bigintLiterals.add(node);
        return { Kind: 'literal', Value: Value(exact), Base: makePrimitive('bigint') };
      }
    }
    return staticType(node);
  };

  const lookup = (name: string): Known => {
    for (let i = frames.length - 1; i >= 0; i -= 1) {
      const t = frames[i].bindings.get(name);
      if (t) {
        return t;
      }
    }
    return null;
  };

  /**
   * The structural shape behind a type, where it has one: an object type is its
   * own, and a nominal type - a class or an interface - carries one in
   * [[Structure]]. Reading a member goes through here so that a class's fields
   * are visible WITHOUT making class assignability structural, which stays by
   * [[Declaration]] identity.
   */
  const structureOf = (t: Known): Known => {
    if (t && t.Kind === 'nominal') {
      const s = (t as unknown as { Structure?: TypeRecord }).Structure;
      return s ?? null;
    }
    return t;
  };

  /**
   * Class DECLARATIONS by name (F57), and their instance types built lazily and
   * memoized (F60). Lazily, because a class's structure now includes what it
   * INHERITS, and resolving heritage eagerly in declaration order would miss a
   * superclass declared later in the list or in an enclosing scope. The
   * in-progress set guards a heritage cycle, which is a ReferenceError at run
   * time but must not hang the checker.
   */
  const classNodes = new Map<string, ParseNode>();
  /**
   * Interface declarations by name, and their structures (F61). The checker
   * resolved an interface name in a type position to NOTHING, so
   * `function f(i: I) { i.k = 300 }` was unchecked entirely - a bigger gap than
   * the one this cycle set out to close, which was only that a class did not
   * pick up the members of an interface it implements.
   */
  const interfaceNodes = new Map<string, ParseNode>();
  /** `const k = Symbol(...)` bindings, by name: §6.6's unique symbol types. */
  const symbolConsts = new Map<string, ParseNode>();
  /**
   * One stable Symbol per symbol-`const` DECLARATION, minted for the checker's
   * own use. A Property Type Record's [[Key]] is "a String or a Symbol", so a
   * symbol-keyed member needs a Symbol to be keyed by - and a checker has no
   * access to the one the program will create at run time. Minting per
   * declaration gives the identity §6.6 asks for: two consts mint two symbols
   * and compare unequal, one const named twice resolves to one symbol and
   * compares equal, which is exactly the rule read where no value exists.
   */
  const symbolKeys = new Map<ParseNode, SymbolValue>();
  const symbolKeyFor = (declaration: ParseNode): SymbolValue => {
    let minted = symbolKeys.get(declaration);
    if (!minted) {
      minted = new SymbolValue(Value('symbol key'));
      symbolKeys.set(declaration, minted);
    }
    return minted;
  };
  /**
   * The comparable key a member name denotes: its literal text, or the minted
   * Symbol of the `const` a computed name resolves to. Shared by the interface
   * walk and the object-literal check so a declaration and a use agree by
   * construction rather than by two rules that must be kept in step (F58).
   */
  const memberKeyOf = (propertyName: { name?: string, value?: string, ComputedPropertyName?: { type?: string, name?: string } } | null | undefined): string | SymbolValue | undefined => {
    const literal = propertyName?.name ?? propertyName?.value;
    if (typeof literal === 'string') {
      return literal;
    }
    const computed = propertyName?.ComputedPropertyName;
    if (computed?.type === 'IdentifierReference' && typeof computed.name === 'string') {
      const declaration = symbolConsts.get(computed.name);
      if (declaration) {
        return symbolKeyFor(declaration);
      }
    }
    return undefined;
  };
  const interfaceTypeMemo = new Map<ParseNode, Known>();
  const interfaceTypeOf = (name: string): Known => {
    const node = interfaceNodes.get(name);
    if (!node) {
      return null;
    }
    const memo = interfaceTypeMemo.get(node);
    if (memo !== undefined) {
      return memo;
    }
    const decl = node as unknown as { InterfaceMemberList?: readonly ParseNode[] | null };
    const Properties: { key: string, type: TypeRecord, optional: boolean, writeType?: TypeRecord }[] = [];
    for (const member of decl.InterfaceMemberList ?? []) {
      if (member.type !== 'TypeMember') {
        continue;
      }
      const tm = member as unknown as {
        PropertyName?: { name?: string, value?: string } | null,
        Optional?: boolean,
        TypeAnnotation?: ParseNode.TypeAnnotation | null,
        MethodSignature?: { FunctionTypeParameterList?: readonly ParseNode[] | null, TypeAnnotation?: ParseNode.TypeAnnotation | null } | null,
      };
      const key = memberKeyOf(tm.PropertyName);
      if (key !== undefined && typeof key !== 'string') {
        // A SYMBOL-keyed member, keyed by the minted Symbol of the `const` its
        // computed name resolves to. Recorded like any other member from here
        // on, which is what lets a use site be compared against it.
        const memberType = tm.TypeAnnotation ? resolveType(tm.TypeAnnotation.Type) : null;
        if (memberType) {
          Properties.push({ key: key as unknown as string, type: memberType, optional: !!tm.Optional });
        }
        continue;
      }
      if (typeof key !== 'string') {
        // A COMPUTED key. §6.6 types one whose expression is a symbol literal -
        // a `const` bound to `Symbol(...)` - and nothing else can be typed at
        // all: a `let`, a parameter, or any other expression has no identity a
        // checker can compare. TypeScript refuses exactly this case ("A
        // computed property name in an interface must refer to an expression
        // whose type is a literal type or a 'unique symbol' type"), and
        // refusing is what makes the rule TOTAL - every member that is declared
        // is one the checker can judge, rather than some being declared and
        // unjudgeable, which reads as support.
        const computed = (tm.PropertyName as { ComputedPropertyName?: { type?: string, name?: string } } | null | undefined)?.ComputedPropertyName;
        // "a literal type OR a unique symbol type": a written string or number
        // is a literal type as much as a `const` symbol is, so `["s"]` and `[1]`
        // are as judgeable as `s` and `1` - they are the same member spelled
        // through brackets.
        const isWrittenLiteral = computed?.type === 'StringLiteral' || computed?.type === 'NumericLiteral';
        const namesSymbolConst = computed?.type === 'IdentifierReference'
          && typeof computed.name === 'string' && symbolConsts.has(computed.name);
        if (computed && !namesSymbolConst && !isWrittenLiteral) {
          const completion = Throw.TypeError('a computed member name must be a literal or a `const` bound to a Symbol') as ThrowCompletion;
          errors.push(completion.Value as ObjectValue);
        }
        continue;
      }
      if (tm.MethodSignature) {
        const Parameters: ParameterRecord[] = [];
        for (const p of tm.MethodSignature.FunctionTypeParameterList ?? []) {
          const ann = (p as { TypeAnnotation?: ParseNode.TypeAnnotation | null }).TypeAnnotation;
          Parameters.push(parameter((ann ? resolveType(ann.Type) : null) ?? anyTypeRecord));
        }
        const Return = tm.MethodSignature.TypeAnnotation ? resolveType(tm.MethodSignature.TypeAnnotation.Type) : null;
        Properties.push({
          key,
          type: { Kind: 'function', Signatures: [{ Parameters, Return, Untyped: false }] } as unknown as TypeRecord,
          optional: tm.Optional === true,
        });
        continue;
      }
      const t = tm.TypeAnnotation ? resolveType(tm.TypeAnnotation.Type) : null;
      if (t) {
        Properties.push({ key, type: t, optional: tm.Optional === true });
      }
    }
    const built = {
      Kind: 'nominal',
      Declaration: node,
      Arguments: [],
      Structure: { Kind: 'object', Properties, IndexSignatures: [] },
    } as unknown as Known;
    interfaceTypeMemo.set(node, built);
    return built;
  };
  const classTypeMemo = new Map<ParseNode, Known>();
  const classTypesInProgress = new Set<ParseNode>();
  const classTypeOf = (name: string): Known => {
    const node = classNodes.get(name);
    return node ? instanceTypeOf(node) : null;
  };
  /** Construct signatures by class node, for checking `new C(...)` (F59). */
  const constructSignatures = new Map<ParseNode, { Parameters: ParameterRecord[] }>();

  const lookupAlias = (name: string): Known => {
    for (let i = frames.length - 1; i >= 0; i -= 1) {
      const t = frames[i].aliases.get(name);
      if (t) {
        return t;
      }
    }
    return null;
  };

  // The enum declaration named `name`, if one is in scope.
  const lookupEnum = (name: string): EnumInfo | null => {
    for (let i = frames.length - 1; i >= 0; i -= 1) {
      const e = frames[i].enums.get(name);
      if (e) {
        return e;
      }
    }
    return null;
  };

  // The enum a binding holds an enumerator of, if it is known to.
  /**
   * The enumerators a `switch` covers, and which enum it is over.
   *
   * PLAN-do-expressions.md: extracted so that the coverage is computed ONCE.
   * It was inline in the SwitchStatement walk, which is where the diagnostics
   * are raised, and completionTypeOf needed the same answer - a second copy
   * would have been a second thing to keep in step, and the two would have
   * disagreed the first time either moved.
   */
  const switchEnumCoverage = (n: ParseNode): { enumName: string, names: readonly string[], covered: Set<string>, invalid: { shown: string }[] } | null => {
    const sw = n as { Expression?: ParseNode, CaseBlock?: { CaseClauses_a?: readonly ParseNode[], CaseClauses_b?: readonly ParseNode[], DefaultClause?: ParseNode | null } };
    const disc = sw.Expression;
    const discName = disc && disc.type === 'IdentifierReference' ? (disc as { name: string }).name : null;
    const enumName = discName ? lookupEnumBinding(discName) : null;
    const info = enumName ? lookupEnum(enumName) : null;
    if (!info || !enumName) {
      return null;
    }
    const clauses = [
      ...(sw.CaseBlock?.CaseClauses_a ?? []),
      ...(sw.CaseBlock?.CaseClauses_b ?? []),
    ];
    const covered = new Set<string>();
    const invalid: { shown: string }[] = [];
    for (const clause of clauses) {
      const label = (clause as { Expression?: ParseNode }).Expression;
      let member: string | null = null;
      let labelEnum: string | null = null;
      if (label && label.type === 'MemberExpression') {
        const m = label as { MemberExpression?: ParseNode, IdentifierName?: { name: string } | null };
        if (m.MemberExpression && m.MemberExpression.type === 'IdentifierReference' && m.IdentifierName) {
          labelEnum = (m.MemberExpression as { name: string }).name;
          member = m.IdentifierName.name;
        }
      }
      if (member === null || labelEnum !== enumName || !info.names.includes(member)) {
        invalid.push({ shown: member !== null && labelEnum !== null ? `${labelEnum}.${member}` : 'a non-enumerator case' });
      } else {
        covered.add(member);
      }
    }
    return {
      enumName, names: info.names, covered, invalid,
    };
  };

  /**
   * Whether a `switch` covers every value its discriminant can take.
   *
   * #sec-completiontypeof reads this to decide whether a switch tail
   * contributes `undefined`, and the design reserves the word to enums and
   * sealed hierarchies - deliberately narrower than the atoms a `match` reads,
   * so a switch over a `boolean` is not exhaustive for this purpose.
   */
  const switchCoversDiscriminant = (n: ParseNode): boolean => {
    const block = (n as { CaseBlock?: { DefaultClause?: ParseNode | null } }).CaseBlock;
    if (block?.DefaultClause) {
      return true;
    }
    const coverage = switchEnumCoverage(n);
    if (!coverage) {
      return false;
    }
    return coverage.names.every((nm) => coverage.covered.has(nm));
  };

  const lookupEnumBinding = (name: string): string | null => {
    for (let i = frames.length - 1; i >= 0; i -= 1) {
      const e = frames[i].enumBindings.get(name);
      if (e) {
        return e;
      }
    }
    return null;
  };

  // The statically resolvable subset of types: built-ins and aliases declared
  // in the program. An unresolvable type is unknown, and unknown is ~any~.
  const resolveType = (node: ParseNode.Type): Known => {
    switch (node.type) {
      case 'TypeReference': {
        if (node.TypeName.MemberNames.length > 0 || node.TypeArguments) {
          const args: (TypeRecord | number)[] = [];
          if (node.TypeName.MemberNames.length > 0) {
            return null;
          }
          for (const a of node.TypeArguments!.TypeArgumentList) {
            const r = resolveType(a);
            if (!r) {
              return null;
            }
            let arg: TypeRecord | number = r;
            if (r.Kind === 'literal' && r.Value instanceof NumberValue) {
              arg = R(r.Value);
            }
            args.push(arg);
          }
          // #sec-parameterized-types: a primitive whose one type argument is an
          // object type is a metadata parameterization, `float32.<{ m: 1 }>`.
          // Mirrors TypeNodeToTypeRecord so the checker and the runtime agree on
          // what the annotation means; before this, builtinTypeRecord dropped the
          // object argument and every parameterization looked to this pass like
          // its bare base, which is why the metadata subtype judgment had no
          // static site.
          if (args.length === 1 && typeof args[0] !== 'number' && (args[0] as TypeRecord).Kind === 'object') {
            const base = builtinTypeRecord(node.TypeName.IdentifierReference.name);
            if (base && base.Kind === 'primitive') {
              const metadata = MetadataObjectFromType(args[0] as TypeRecord);
              const record: TypeRecord = { Kind: 'parameterized', Base: base, Metadata: metadata };
              const keys = Object.keys(metadata as unknown as Record<string, unknown>);
              if (keys.length > 0) {
                unclaimed.push({ node, display: displayType(record), base, keys });
              }
              return record;
            }
          }
          // proposal-runtime-types: a parameterized type reference is a builtin
          // numeric (`int.<8>`) or a library type (`RegExp.<C, G>`, `Promise.<T>`,
          // `Map.<K, V>`). Without the library fallback a `RegExp.<C, G>` annotation
          // resolves to nothing here and its capture checking never runs.
          return builtinTypeRecord(node.TypeName.IdentifierReference.name, args)
            ?? libraryTypeRecord(node.TypeName.IdentifierReference.name, args);
        }
        const name = node.TypeName.IdentifierReference.name;
        return builtinTypeRecord(name) ?? libraryTypeRecord(name) ?? lookupAlias(name) ?? classTypeOf(name) ?? interfaceTypeOf(name) ?? namedNumericLiteralRecord(name);
      }
      case 'PredefinedType':
        return node.keyword === 'void' ? voidType : { Kind: 'literal', Value: Value.null, Base: makePrimitive('object') };
      case 'ParenthesizedType':
        return resolveType(node.Type);
      case 'UnionType':
      case 'IntersectionType': {
        const Members: TypeRecord[] = [];
        for (const m of node.Types) {
          const r = resolveType(m);
          if (!r) {
            return null;
          }
          Members.push(r);
        }
        return { Kind: node.type === 'UnionType' ? 'union' : 'intersection', Members };
      }
      case 'ArrayType': {
        if (node.ArrayExtent && node.ArrayExtent.type !== 'NumericLiteral') {
          return null;
        }
        const el = node.TypeArguments && node.TypeArguments.TypeArgumentList.length > 0 ? resolveType(node.TypeArguments.TypeArgumentList[0]) : { Kind: 'any' as const };
        if (!el) {
          return null;
        }
        return { Kind: 'array', Element: el, Extent: node.ArrayExtent ? (node.ArrayExtent as { value: number }).value : 'dynamic' };
      }
      case 'TupleType': {
        const Elements = [];
        for (const e of node.TupleElementList) {
          const r = resolveType(e.Type);
          if (!r) {
            return null;
          }
          Elements.push({ Type: r, Rest: e.Rest, Initial: 'none' as const });
        }
        return { Kind: 'tuple', Elements };
      }
      case 'FunctionType': {
        const Parameters: ParameterRecord[] = [];
        for (const p of node.FunctionTypeParameterList) {
          const pn = p as { TypeAnnotation?: ParseNode.TypeAnnotation | null, Type?: ParseNode.Type | null, Rest?: boolean, Optional?: boolean, BindingIdentifier?: { name?: string } };
          // An unnamed parameter stores its type in [[Type]] and a named one
          // behind [[TypeAnnotation]]; `...[].<uint8>` is the unnamed form, so
          // reading only the annotation lost its type and made it `any`.
          const pt = pn.TypeAnnotation ?? (pn.Type ? ({ Type: pn.Type } as ParseNode.TypeAnnotation) : null);
          const r = pt ? resolveType(pt.Type) : { Kind: 'any' as const };
          if (!r) {
            return null;
          }
          // PLAN-rest-parameters.md phase 0: a function TYPE's parameters carry
          // the same record a declaration's do, which is what lets a rest be
          // written in a type at all.
          Parameters.push(parameter(r, {
            Name: pn.BindingIdentifier?.name ?? '', Rest: pn.Rest === true, Optional: pn.Optional === true,
          }));
        }
        const Return = resolveType(node.ReturnType);
        return { Kind: 'function', Signatures: [{ Parameters, Return }] };
      }
      case 'ObjectType': {
        const Properties = [];
        for (const member of node.TypeMemberList) {
          if (member.type !== 'TypeMember') {
            return null;
          }
          const key = (member.PropertyName as { name?: string, value?: string }).name ?? (member.PropertyName as { value?: string }).value;
          if (typeof key !== 'string' || !member.TypeAnnotation) {
            return null;
          }
          const r = resolveType(member.TypeAnnotation.Type);
          if (!r) {
            return null;
          }
          Properties.push({ key, type: r, optional: member.Optional, readonly: member.Readonly });
        }
        return { Kind: 'object', Properties, IndexSignatures: [] };
      }
      case 'LiteralType': {
        if (node.kind === 'imaginary') {
          return null;
        }
        const raw = node.negated && typeof node.value === 'number' ? -node.value : node.value;
        const base = node.kind === 'number' ? makePrimitive('number') : node.kind === 'string' ? makePrimitive('string') : node.kind === 'boolean' ? makePrimitive('boolean') : makePrimitive('bigint');
        return { Kind: 'literal', Value: Value(raw as never), Base: base };
      }
      default:
        return null;
    }
  };

  /** #sec-do-expressions: `do {}` is `void 0`, a value, and not the ~void~ type. */
  const undefinedType: TypeRecord = makePrimitive('undefined');

  /**
   * The yielded and returned types of a generator body.
   *
   * A `yield*` contributes its operand's Y rather than the operand itself, and
   * a nested function boundary contributes nothing - its yields and returns are
   * its own.
   */
  const collectGeneratorTypes = (node: ParseNode | undefined, yielded: TypeRecord[], returned: TypeRecord[]): void => {
    if (!node || typeof node !== 'object') {
      return;
    }
    const n = node as { type?: string, AssignmentExpression?: ParseNode | null, hasStar?: boolean, Expression?: ParseNode | null };
    if (n.type === 'FunctionExpression' || n.type === 'FunctionDeclaration'
      || n.type === 'ArrowFunction' || n.type === 'GeneratorExpression'
      || n.type === 'GeneratorDeclaration' || n.type === 'AsyncFunctionExpression'
      || n.type === 'AsyncArrowFunction' || n.type === 'ClassExpression'
      || n.type === 'ClassDeclaration' || n.type === 'DoExpression') {
      return;
    }
    if (n.type === 'YieldExpression') {
      const operand = n.AssignmentExpression ? staticType(n.AssignmentExpression) : null;
      if (n.hasStar) {
        const delegated = generatorParameters(operand);
        if (delegated) {
          yielded.push(delegated.Yield);
        }
      } else if (operand) {
        yielded.push(operand);
      }
    }
    if (n.type === 'ReturnStatement' && n.Expression) {
      const t = staticType(n.Expression);
      if (t) {
        returned.push(t);
      }
    }
    for (const key of Object.keys(node)) {
      if (key === 'parent' || key === 'location') {
        continue;
      }
      const child = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(child)) {
        child.forEach((c) => collectGeneratorTypes(c as ParseNode, yielded, returned));
      } else if (child && typeof child === 'object' && 'type' in (child as object)) {
        collectGeneratorTypes(child as ParseNode, yielded, returned);
      }
    }
  };

  /**
   * The type of a statement list's completion value.
   *
   * PLAN-do-expressions.md phase 4, per #sec-completiontypeof: a union over the
   * TAILS, with divergence removing the paths that cannot produce one. Nothing
   * in it is new - divergence is phase 0's analysis, and the Early Errors of
   * #sec-do-expression-early-errors have already removed the forms whose
   * completion type would have been hard to state.
   */
  const completionTypeOf = (list: readonly ParseNode[] | undefined): Known => {
    if (!list || list.length === 0) {
      return undefinedType;
    }
    const last = list[list.length - 1] as ParseNode & {
      Expression?: ParseNode, StatementList?: readonly ParseNode[],
      Statement_a?: ParseNode, Statement_b?: ParseNode | null,
      LabelledItem?: ParseNode, Block?: { StatementList?: readonly ParseNode[] },
      Catch?: { Block?: { StatementList?: readonly ParseNode[] } } | null,
      CaseBlock?: { CaseClauses_a?: readonly ParseNode[], DefaultClause?: ParseNode | null, CaseClauses_b?: readonly ParseNode[] },
    };
    // A diverging tail contributes nothing, and a list all of whose paths
    // diverge is the empty union - `never` - which is a subtype of everything,
    // so `const port: uint16 = do { throw new E(); }` is accepted.
    if (Diverges(last, { switchCoversDiscriminant })) {
      return neverType;
    }
    const unionOf = (members: Known[]): Known => {
      const present = members.filter((m): m is TypeRecord => !!m);
      if (present.length !== members.length || present.length === 0) {
        return null;
      }
      return present.length === 1 ? present[0] : CanonicalizeType({ Kind: 'union', Members: present });
    };
    switch (last.type) {
      case 'ExpressionStatement':
        return last.Expression ? staticType(last.Expression) : undefinedType;
      case 'Block':
        return completionTypeOf(last.StatementList);
      case 'LabelledStatement':
        return completionTypeOf(last.LabelledItem ? [last.LabelledItem] : undefined);
      case 'IfStatement':
        if (!last.Statement_b) {
          // Refused by the Early Errors; the type is stated for completeness.
          return undefinedType;
        }
        return unionOf([
          completionTypeOf([last.Statement_a!]),
          completionTypeOf([last.Statement_b]),
        ]);
      case 'TryStatement': {
        const members: Known[] = [completionTypeOf(last.Block?.StatementList)];
        if (last.Catch?.Block) {
          members.push(completionTypeOf(last.Catch.Block.StatementList));
        }
        // A `finally` contributes nothing: its completion is discarded unless
        // it is abrupt.
        return unionOf(members);
      }
      case 'SwitchStatement': {
        const block = last.CaseBlock;
        const clauses = [
          ...(block?.CaseClauses_a ?? []),
          ...(block?.DefaultClause ? [block.DefaultClause] : []),
          ...(block?.CaseClauses_b ?? []),
        ];
        // A clause's trailing `break` has an EMPTY completion, so the value
        // falls back to the statement before it - that is what UpdateEmpty does
        // at run time, and `case E.A: 1; break;` completes with 1. Dropping it
        // here rather than in the general rule is deliberate: a `do` whose own
        // tail is a `break` genuinely diverges, since that break leaves the
        // expression, and only a clause's break is caught by its switch.
        const members = clauses.map((c) => {
          const list = (c as { StatementList?: readonly ParseNode[] }).StatementList ?? [];
          const trimmed = list.length > 0 && list[list.length - 1].type === 'BreakStatement'
            && !(list[list.length - 1] as { LabelIdentifier?: unknown }).LabelIdentifier
            ? list.slice(0, -1)
            : list;
          return completionTypeOf(trimmed);
        });
        // #sec-completiontypeof: an exhaustive switch takes no path where no
        // clause ran, so it contributes no `undefined`. Exhaustiveness here is
        // the SWITCH's, which this design reserves to enums and sealed
        // hierarchies and which is deliberately narrower than a `match`'s atoms
        // - a switch over a boolean covering true and false is not exhaustive
        // for this operation, and the clause says so.
        if (!switchCoversDiscriminant(last)) {
          members.push(undefinedType);
        }
        return unionOf(members);
      }
      default:
        return undefinedType;
    }
  };

  const staticType = (node: ParseNode): Known => {
    switch (node.type) {
      case 'DoExpression': {
        const d = node as ParseNode.DoExpression;
        if (!d.star) {
          return completionTypeOf(d.Block?.StatementList);
        }
        // #sec-do-generator-expressions: Y, R, and N are found rather than
        // declared, there being no annotation site. N is `void` unless a
        // contextual type supplies it, since nothing in a body determines what
        // a caller will send to `next`.
        const yielded: TypeRecord[] = [];
        const returned: TypeRecord[] = [];
        collectGeneratorTypes(d.GeneratorBody as ParseNode | undefined, yielded, returned);
        const Y = yielded.length === 0 ? neverType
          : (yielded.length === 1 ? yielded[0] : CanonicalizeType({ Kind: 'union', Members: yielded }));
        const R = returned.length === 0 ? voidType
          : (returned.length === 1 ? returned[0] : CanonicalizeType({ Kind: 'union', Members: returned }));
        return libraryType(d.async ? 'AsyncGenerator' : 'Generator', [Y, R, voidType]);
      }
      case 'NumericLiteral': {
        // A BIGINT literal is a literal of `bigint`, not of `number`. It was
        // labelled `number`, which F38 pinned as cosmetic - it is not: with
        // the base wrong, `let x: bigint = 65n` failed as "a literal type of
        // number is not assignable to bigint", so the `bigint` type could not
        // be used with an annotation AT ALL (F66).
        const v = (node as { value: number | bigint }).value;
        return typeof v === 'bigint'
          ? { Kind: 'literal', Value: Value(v), Base: makePrimitive('bigint') }
          : { Kind: 'literal', Value: Value(v), Base: makePrimitive('number') };
      }
      case 'StringLiteral':
        return { Kind: 'literal', Value: Value((node as { value: string }).value), Base: makePrimitive('string') };
      case 'BooleanLiteral':
        return { Kind: 'literal', Value: (node as { value: boolean }).value ? Value.true : Value.false, Base: makePrimitive('boolean') };
      case 'RegularExpressionLiteral': {
        // proposal-runtime-types (regexp.md): a regular expression literal's type
        // is `RegExp.<Captures, Groups>` inferred from its pattern.
        const rx = node as { RegularExpressionBody: string, RegularExpressionFlags: string };
        return inferRegExpLiteralType(rx.RegularExpressionBody, rx.RegularExpressionFlags);
      }
      case 'IdentifierReference':
        return lookup((node as { name: string }).name);
      case 'ParenthesizedExpression':
        return staticType((node as { Expression: ParseNode }).Expression);
      case 'TypedConversionExpression':
        return resolveType((node as unknown as { Type: ParseNode.Type }).Type);
      case 'CallExpression': {
        // proposal-runtime-types `sec-composite-types`: "The Static Type of a
        // call of the Composite function is the top composite type where the
        // call supplies no TypeArguments and no contextual type reaches it."
        // Without this the checker derives an ordinary object type for the
        // call, so `let c: Composite = Composite({x: 1})` was refused - the
        // runtime knew the value's type and the checker did not.
        const calleeNode = (node as { CallExpression?: ParseNode }).CallExpression;
        if (calleeNode?.type === 'IdentifierReference'
          && (calleeNode as { name?: string }).name === 'Composite') {
          // The TOP composite type, which states no shape - and a shapeless
          // type satisfies no specific interface, so `let i: I = Composite(...)`
          // is refused and `Composite.<I>({...})` is what a program writes.
          // That is the clause's rule read plainly, and it is also the design's
          // OWN advice: "an unannotated `Composite` call in typed code produces
          // `number` fields, and code that means anything else should say so at
          // the creation site". Deriving a shape from the argument was tried and
          // is not this rule; the shape belongs to the typed creation form,
          // where the type is stated rather than guessed.
          return makePrimitive('Composite', []);
        }
        // A call's static type is the callee function type's return, when
        // known; the argument check happens in the walk.
        const callee = staticType((node as { CallExpression: ParseNode }).CallExpression);
        // `a.map(cb)` returns an array of the CALLBACK'S return type, which is
        // why F79 left it ~any~ rather than guessing. The inference happens
        // HERE rather than through a channel: a declaration asks for its
        // initializer's type before the walk reaches the call, so a value
        // recorded during the walk would arrive too late (F80). It is readable
        // for a concise-bodied arrow, whose body IS the returned expression;
        // a block body needs return-type inference the checker does not have,
        // and stays ~any~ - imprecise rather than wrong.
        const mem = (node as { CallExpression?: ParseNode }).CallExpression;
        const calledName = mem && mem.type === 'MemberExpression'
          ? (mem as unknown as { IdentifierName?: { name: string } | null }).IdentifierName?.name
          : undefined;
        if (calledName === 'map' || calledName === 'flatMap') {
          const recv = mem && (mem as unknown as { MemberExpression?: ParseNode }).MemberExpression
            ? staticType((mem as unknown as { MemberExpression: ParseNode }).MemberExpression)
            : null;
          const cbArg = (node as { Arguments?: readonly ParseNode[] }).Arguments?.[0];
          if (recv && recv.Kind === 'array' && cbArg) {
            const returned = inferredReturnType(cbArg, [recv.Element, builtinTypeRecord('uint', [32]), recv]);
            if (returned) {
              // `flatMap` flattens ONE level, so a callback returning an array
              // contributes that array's elements and one returning a value
              // contributes the value. Reading the element off the callback's
              // return is the whole difference from `map`.
              const element = calledName === 'flatMap' && returned.Kind === 'array' ? returned.Element : returned;
              return { Kind: 'array', Element: element, Extent: 'dynamic' } as unknown as Known;
            }
          }
        }
        // The SET OPERATIONS whose result draws from BOTH sides: the design
        // writes `union<U>(other: Set.<U>): Set.<T | U>` and the same for
        // `symmetricDifference`. The result therefore depends on an ARGUMENT's
        // type, which a signature written at the member access cannot express -
        // the same reason `map` is handled here rather than there.
        //
        // Where the other side's element type is UNKNOWN, `T | U` is unknown
        // and the result is ~any~. That is not a miss to fix later: a union
        // with an untyped set really can hold anything, and answering
        // `Set.<T>` would be wrong rather than imprecise.
        if (calledName === 'union' || calledName === 'symmetricDifference') {
          const recv = mem && (mem as unknown as { MemberExpression?: ParseNode }).MemberExpression
            ? staticType((mem as unknown as { MemberExpression: ParseNode }).MemberExpression)
            : null;
          if (recv && recv.Kind === 'nominal' && recv.LibraryName === 'Set' && recv.Arguments.length > 0) {
            const otherNode = (node as { Arguments?: readonly ParseNode[] }).Arguments?.[0];
            const other = otherNode ? staticType(otherNode) : null;
            const mine = recv.Arguments[0];
            if (other && other.Kind === 'nominal' && other.LibraryName === 'Set'
                && other.Arguments.length > 0 && typeof mine !== 'number') {
              const theirs = other.Arguments[0];
              if (typeof theirs !== 'number') {
                const Members = SameType(mine as TypeRecord, theirs as TypeRecord)
                  ? [mine as TypeRecord]
                  : [mine as TypeRecord, theirs as TypeRecord];
                // Canonicalized, because assignability compares a nominal's
                // ARGUMENTS by SameType: an uncanonicalized union built here
                // and the one an annotation resolves to are the same type and
                // would not have compared equal, so the correct annotation for
                // the result would have been rejected.
                const element: TypeRecord = Members.length === 1 ? Members[0]! : { Kind: 'union', Members };
                return { Kind: 'nominal', Declaration: recv.Declaration, Arguments: [element], LibraryName: 'Set' } as unknown as Known;
              }
            }
            return null;
          }
        }
        if (callee && callee.Kind === 'function' && callee.Signatures.length === 1) {
          return callee.Signatures[0].Return;
        }
        return null;
      }
      case 'YieldExpression': {
        // PLAN-do-expressions.md phase 1, #sec-generator-types. A `yield`
        // evaluates to what the caller sends to `next`, which is the enclosing
        // generator's N; a `yield*` evaluates to what the DELEGATED generator
        // RETURNED, which is its R. The second is the rule everyone gets
        // backwards, and it follows from the run time: `yield*` drives the
        // operand to completion and takes its return value.
        const y = node as { hasStar?: boolean, AssignmentExpression?: ParseNode | null };
        if (y.hasStar) {
          const operand = y.AssignmentExpression ? staticType(y.AssignmentExpression) : null;
          const delegated = generatorParameters(operand);
          return delegated ? delegated.Return : null;
        }
        const enclosing = generatorParameters(generatorTypes[generatorTypes.length - 1] ?? null);
        return enclosing ? enclosing.Next : null;
      }
      case 'MemberExpression': {
        const m = node as { MemberExpression?: ParseNode, IdentifierName?: { name: string } | null, Expression?: ParseNode | null };
        if (m.IdentifierName && m.MemberExpression) {
          const receiver = staticType(m.MemberExpression);
          // A method of a TYPED ARRAY takes the element type. The design gives a
          // typed collection element-typed method signatures, and the run time
          // enforces them (F68/F69); the checker knowing them is what turns
          // `a.includes(70000)` from a run-time RangeError into the Early Error
          // a statically determinable mistake deserves (F70).
          if (receiver && receiver.Kind === 'array') {
            // "The Static Type of a member access reading the `length` property
            // of an array is `uint32`" - the specification says so and the run
            // time has done it since F54; this is the static half, which had
            // been open since the first verification pass (F79).
            if ((m.IdentifierName as { name: string }).name === 'length') {
              return builtinTypeRecord('uint', [32]);
            }
            const sig = arrayMethodSignature((m.IdentifierName as { name: string }).name, receiver.Element, receiver);
            if (sig) {
              return sig;
            }
          }
          // The same for a typed COLLECTION, which reaches the checker as the
          // nominal its annotation resolved to, carrying its type arguments.
          if (receiver && receiver.Kind === 'nominal' && receiver.Arguments.length > 0
              && (receiver.LibraryName === 'Set' || receiver.LibraryName === 'Map'
                || receiver.LibraryName === 'WeakSet' || receiver.LibraryName === 'WeakMap')) {
            const sig = collectionMethodSignature(
              receiver.LibraryName,
              (m.IdentifierName as { name: string }).name,
              receiver.Arguments,
              receiver,
            );
            if (sig) {
              return sig;
            }
          }
          const objType = structureOf(receiver);
          if (objType && objType.Kind === 'object') {
            const prop = objType.Properties.find((p) => p.key === (m.IdentifierName as { name: string }).name);
            return prop ? prop.type : null;
          }
        }
        return null;
      }
      case 'NewExpression': {
        // `new C()` produces an instance of C, so the class's instance type is
        // the expression's type - which is what lets `new C().x` be read at the
        // field's declared type (F59).
        const target = (node as { MemberExpression?: ParseNode }).MemberExpression;
        if (target && target.type === 'IdentifierReference') {
          return classTypeOf((target as { name: string }).name);
        }
        return null;
      }
      case 'IsExpression':
        return makePrimitive('boolean');
      case 'TemplateLiteral':
        return makePrimitive('string');
      default:
        return null; // ~any~
    }
  };

  /**
   * A DECLARED function's signature, which the checker did not have: function
   * types were built only from FunctionType annotations, so `function f(v:
   * uint8) {}` put nothing in scope and no call to it was argument-checked at
   * all (F55 measured this; F56 fixes it). A parameter with no annotation is
   * ~any~, which makes the signature usable even when only some parameters are
   * typed, and a rest parameter suppresses the signature entirely rather than
   * inviting an arity mistake.
   */
  /**
   * A class's INSTANCE type. Until now a class name in a type position resolved
   * to nothing, so `function f(c: C) { c.x = 300 }` was unchecked, no field's
   * type was visible, and every value of a class type was ~any~ to the checker
   * (F57). The record is NOMINAL - assignability compares [[Declaration]]
   * identity, so two classes with the same fields stay distinct - and it
   * carries the declared fields as its [[Structure]], which is the same channel
   * an interface already uses. Private fields are deliberately absent: they are
   * not reachable through a member expression from outside, and the store to
   * one is checked at run time by its own path.
   */
  const instanceTypeOf = (n: ParseNode): Known => {
    const memo = classTypeMemo.get(n);
    if (memo !== undefined) {
      return memo;
    }
    if (classTypesInProgress.has(n)) {
      return null;
    }
    classTypesInProgress.add(n);
    try {
      const built = classInstanceType(n);
      classTypeMemo.set(n, built);
      return built;
    } finally {
      classTypesInProgress.delete(n);
    }
  };

  const classInstanceType = (n: ParseNode): Known => {
    const cls = n as unknown as {
      BindingIdentifier?: { name: string } | null,
      ClassTail?: { ClassBody?: readonly ParseNode[] | null } | null,
    };
    const Properties: { key: string, type: TypeRecord, optional: boolean, writeType?: TypeRecord }[] = [];
    // Methods, accumulated per name because a method may be OVERLOADED exactly
    // as a function may (F59). A getter contributes its return type as the
    // property's type, since that is what reading the property yields; a setter
    // contributes nothing yet, and is the natural next step for checking a
    // store through an accessor.
    const methods = new Map<string, { Parameters: ParameterRecord[], Return: Known, Untyped: boolean }[]>();
    const unusable = new Set<string>();
    let construct: { Parameters: ParameterRecord[] } | null = null;
    const accessorKeys = new Set<string>();
    const getterKeys = new Set<string>();
    const setterTypes = new Map<string, TypeRecord>();
    for (const el of cls.ClassTail?.ClassBody ?? []) {
      if (el.type === 'MethodDefinition') {
        const md = el as unknown as {
          TypeAnnotation?: ParseNode.TypeAnnotation | null,
          static?: boolean,
          ClassElementName?: { type?: string, name?: string, value?: string } | null,
          UniqueFormalParameters?: readonly ParseNode[] | null,
          PropertySetParameterList?: readonly ParseNode[] | null,
        };
        const key = md.ClassElementName?.name ?? md.ClassElementName?.value;
        if (md.static || typeof key !== 'string' || md.ClassElementName?.type === 'PrivateIdentifier') {
          continue;
        }
        if (key === 'constructor') {
          // The constructor is the class's CONSTRUCT signature, not a member of
          // the instance shape: `c.constructor` is the class, and typing it as
          // a method taking the constructor's parameters would be wrong twice
          // over. It is collected separately, for `new C(...)` (F59).
          const cparams: ParameterRecord[] = [];
          let cusable = true;
          for (const p of md.UniqueFormalParameters ?? []) {
            if (p.type !== 'SingleNameBinding' && p.type !== 'BindingElement') {
              cusable = false;
              break;
            }
            const pp = p as { TypeAnnotation?: ParseNode.TypeAnnotation | null, Initializer?: ParseNode | null, Optional?: boolean };
            cparams.push(parameter((pp.TypeAnnotation ? resolveType(pp.TypeAnnotation.Type) : null) ?? anyTypeRecord, {
              Name: (p as { BindingIdentifier?: { name?: string } }).BindingIdentifier?.name ?? '',
              Optional: pp.Optional === true || !!pp.Initializer,
            }));
          }
          if (cusable) {
            construct = { Parameters: cparams };
          }
          continue;
        }
        if (md.PropertySetParameterList) {
          // A setter gives the property its WRITE type, which is what a store
          // through the accessor must satisfy. It is kept apart from the read
          // type because a getter and setter pair may legitimately differ, and
          // before this a store through a setter was unchecked entirely while a
          // store to a field of the same name was caught (F61).
          const sp = md.PropertySetParameterList[0] as { TypeAnnotation?: ParseNode.TypeAnnotation | null } | undefined;
          const t = sp?.TypeAnnotation ? resolveType(sp.TypeAnnotation.Type) : null;
          if (t) {
            setterTypes.set(key, t);
          }
          continue;
        }
        if (!md.UniqueFormalParameters) {
          // A getter: the property reads at its declared return type.
          const t = md.TypeAnnotation ? resolveType(md.TypeAnnotation.Type) : null;
          if (t) {
            Properties.push({ key, type: t, optional: false });
            getterKeys.add(key);
          }
          continue;
        }
        const Parameters: ParameterRecord[] = [];
        const annotated: Known[] = [];
        let usable = true;
        for (const p of md.UniqueFormalParameters) {
          if (p.type !== 'SingleNameBinding' && p.type !== 'BindingElement') {
            usable = false;
            break;
          }
          const pp = p as { TypeAnnotation?: ParseNode.TypeAnnotation | null, Initializer?: ParseNode | null, Optional?: boolean };
          const resolved = pp.TypeAnnotation ? resolveType(pp.TypeAnnotation.Type) : null;
          annotated.push(resolved);
          Parameters.push(parameter(resolved ?? anyTypeRecord, { Optional: pp.Optional === true || !!pp.Initializer }));
        }
        if (!usable) {
          unusable.add(key);
          continue;
        }
        const Return = md.TypeAnnotation ? resolveType(md.TypeAnnotation.Type) : null;
        const Untyped = !md.TypeAnnotation && annotated.every((t) => t === null);
        const sigs = methods.get(key) ?? [];
        sigs.push({ Parameters, Return, Untyped });
        methods.set(key, sigs);
        continue;
      }
      if (el.type !== 'FieldDefinition') {
        continue;
      }
      const f = el as unknown as {
        TypeAnnotation?: ParseNode.TypeAnnotation | null,
        static?: boolean,
        ClassElementName?: { type?: string, name?: string, value?: string } | null,
      };
      if (f.static || !f.TypeAnnotation) {
        continue;
      }
      const key = f.ClassElementName?.name ?? f.ClassElementName?.value;
      if (typeof key !== 'string' || f.ClassElementName?.type === 'PrivateIdentifier') {
        continue;
      }
      const t = resolveType(f.TypeAnnotation.Type);
      if (t) {
        Properties.push({ key, type: t, optional: false });
        // An `accessor` is a FieldDefinition carrying the marker, and it is the
        // one member kind whose OVERRIDE is invariant - recorded here because
        // the Properties list keeps a type per key and no member kind.
        if ((f as { accessor?: boolean }).accessor === true) {
          accessorKeys.add(key);
        }
      }
    }
    for (const [key, writeType] of setterTypes) {
      const existing = Properties.find((p) => p.key === key);
      if (existing) {
        (existing as { writeType?: TypeRecord }).writeType = writeType;
      } else {
        // Setter with no getter: the property is write-only as far as the
        // checker can see, so its read type is its write type.
        Properties.push({ key, type: writeType, optional: false, writeType });
      }
    }
    for (const [key, Signatures] of methods) {
      if (unusable.has(key) || Properties.some((p) => p.key === key)) {
        continue;
      }
      Properties.push({ key, type: { Kind: 'function', Signatures } as unknown as TypeRecord, optional: false });
    }
    // #sec-typed-classes: a subclass's instances have their superclass's
    // members too, so the inherited shape is merged UNDER the class's own
    // declarations - an override wins, which is what the prototype chain does
    // at run time (F60). Only a heritage clause naming a class is followed; an
    // expression like `class B extends mixin(A)` leaves the base unknown, and
    // an unknown base contributes nothing rather than guessing.
    // An `implements` clause contributes members too: a class that satisfies an
    // interface has that interface's members, and the checker could not see one
    // the class did not also declare itself (F61). Merged UNDER both the class's
    // own declarations and its heritage, since either is more specific.
    const implemented = (cls.ClassTail as { ImplementsClause?: readonly ParseNode[] | null } | null | undefined)?.ImplementsClause ?? [];
    for (const ref of implemented) {
      const iname = (ref as { TypeName?: { IdentifierReference?: { name?: string }, MemberNames?: readonly unknown[] } }).TypeName;
      const nm = iname?.MemberNames && iname.MemberNames.length > 0 ? undefined : iname?.IdentifierReference?.name;
      if (typeof nm !== 'string') {
        continue;
      }
      const it = interfaceTypeOf(nm);
      const istruct = it && it.Kind === 'nominal'
        ? (it as unknown as { Structure?: { Kind: string, Properties: readonly { key: string, type: TypeRecord, optional: boolean }[] } }).Structure
        : null;
      if (istruct && istruct.Kind === 'object') {
        for (const p of istruct.Properties) {
          if (!Properties.some((own) => own.key === p.key)) {
            Properties.push(p);
          }
        }
      }
    }
    // README, the accessor rules: "The within-class rule still applies to the
    // resulting pair, so the derived setter must also accept everything the
    // derived getter can return." Stated there of a DERIVED pair, but it is a
    // rule about any pair: a property whose getter yields a value its own setter
    // would refuse cannot round-trip, and `o.x = o.x` does not type.
    //
    // Assignability is exactly the right relation, INCLUDING for numerics, and
    // that took three cycles to see. Two of them treated `get x(): uint8` with
    // `set x(v: uint32)` as a legal pair the rule would wrongly refuse - but
    // README is explicit that "a value of one value type never implicitly
    // becomes a value of another. `uint8` does not widen to `uint16`", the rule
    // Rust, Swift, and Go use. So that pair genuinely does not round-trip and
    // the refusal is correct. What made it look wrong was the SUBCLASS case,
    // which was a real gap and is fixed.
    for (const [skey, stype] of setterTypes) {
      const getter = Properties.find((prop) => prop.key === skey);
      if (getter?.type && stype && !IsAssignable(getter.type, stype)) {
        report(getter.type, stype);
      }
    }
    const heritage = (cls.ClassTail as { ClassHeritage?: ParseNode | null } | null | undefined)?.ClassHeritage;
    const baseName = heritage && (heritage as { type?: string, name?: string }).type === 'IdentifierReference'
      ? (heritage as { name: string }).name
      : null;
    const base = baseName ? classTypeOf(baseName) : null;
    const baseStructure = base && base.Kind === 'nominal'
      ? (base as unknown as { Structure?: { Kind: string, Properties: readonly { key: string, type: TypeRecord, optional: boolean }[] } }).Structure
      : null;
    // AN ACCESSOR OVERRIDE IS INVARIANT, which README does not say and which
    // falls out of the two variance rules it does state meeting on ONE
    // declaration. A `get`/`set` pair may refine its halves separately - "a
    // derived getter may refine its type covariantly", "a derived setter is
    // contravariant" - but an `accessor` generates both halves from a single
    // annotation, so narrowing it breaks the setter (the base accepted more)
    // and widening it breaks the getter (the base promised less). Both
    // directions refused leaves equality.
    //
    // Checked with SameType rather than assignability in both directions
    // deliberately: it is the relation the rule actually names, and it does not
    // inherit whatever the assignability relation currently makes of subclasses
    // and numeric widths.
    if (baseStructure && baseStructure.Kind === 'object') {
      // README: "A derived getter may refine its type COVARIANTLY under the
      // same conversion free rule that governs method returns." So the derived
      // getter's type must be a subtype of the base's - every caller of the
      // base's getter still receives what it was promised.
      //
      // JUDGED ONLY WHERE THE RELATION IS SOUND, which today is between two
      // CLASS types. IsSubtype has no primitive case at all, so it reports a
      // numeric refinement as unrelated in both directions, and a rule that
      // trusted it would refuse `get x(): uint8` overriding `get x(): uint32` -
      // legal, and the exact false positive that kept the within-class rule out
      // twice. Numeric refinement is left unjudged rather than judged wrongly;
      // what unblocks it is a primitive case carrying the design's table of
      // free conversions.
      for (const key of getterKeys) {
        const own = Properties.find((prop) => prop.key === key);
        const inherited = baseStructure.Properties.find((prop) => prop.key === key);
        // Judged for every pair of types, not only class ones. Cycle 141
        // restricted this to nominals believing a numeric refinement would be
        // wrongly refused; README settles that one value type never implicitly
        // becomes another, so a differing numeric IS a failed refinement and
        // the restriction was unnecessary.
        if (own?.type && inherited?.type && !IsAssignable(own.type, inherited.type)) {
          report(own.type, inherited.type);
        }
      }
      // README: "A derived setter is CONTRAVARIANT: it must accept every value
      // the base setter accepts, and may accept more." So the BASE's write type
      // must be assignable to the derived's - the direction that makes a
      // narrowing (`set r(v: Dog)` over `set r(v: Animal)`) the error and a
      // widening legal, which is the reverse of the getter rule above.
      const baseSetters = (base as { SetterTypes?: Map<string, TypeRecord> } | null)?.SetterTypes;
      if (baseSetters) {
        for (const [skey, ownWrite] of setterTypes) {
          const inheritedWrite = baseSetters.get(skey);
          if (inheritedWrite && ownWrite && !IsAssignable(inheritedWrite, ownWrite)) {
            report(inheritedWrite, ownWrite);
          }
        }
      }
      for (const key of accessorKeys) {
        const own = Properties.find((prop) => prop.key === key);
        const inherited = baseStructure.Properties.find((prop) => prop.key === key);
        if (own?.type && inherited?.type && !SameType(own.type, inherited.type)) {
          report(own.type, inherited.type);
        }
      }
    }
    const merged = baseStructure && baseStructure.Kind === 'object'
      ? [...baseStructure.Properties.filter((p) => !Properties.some((own) => own.key === p.key)), ...Properties]
      : Properties;
    const instance = {
      Kind: 'nominal',
      Declaration: n,
      Arguments: [],
      Structure: { Kind: 'object', Properties: merged, IndexSignatures: [] },
      // The class this one extends, so the subtype relation has a chain to
      // walk. Nominal, not structural: two unrelated empty classes stay
      // unrelated, which is the point of the classes being nominal at all.
      Base: base ?? undefined,
      // The WRITE type of each setter, which a derived class needs to check
      // its own setters against and which the Structure cannot carry: a
      // property has one type there, and a getter already claims it. Carried
      // for the same reason as Base - a relation the record does not hold
      // cannot be decided.
      SetterTypes: setterTypes.size > 0 ? new Map(setterTypes) : undefined,
    } as unknown as Known;
    if (construct) {
      constructSignatures.set(n, construct);
    }
    return instance;
  };

  /**
   * The signatures of the array methods that take or return the ELEMENT type.
   * Only the ones with a fixed leading parameter are given here: `push` and
   * `unshift` take a rest parameter, and the checker's argument loop would
   * check only their first argument, which is worse than leaving them to the
   * run time that already enforces them correctly (F70).
   */
  /**
   * The narrowing forms of sec-narrowing that speak about a BINDING, read off a
   * test expression. Returns the binding's name, the type the test establishes,
   * and whether the sense is inverted, or undefined where the test says nothing
   * the checker can use (F75).
   */
  const narrowingFactOf = (expr: ParseNode): { name: string, type: TypeRecord, negated: boolean, sense?: 'true' | 'false' } | undefined => {
    let e = expr;
    let negated = false;
    // `!(...)` inverts the sense; a parenthesized test is the test.
    for (;;) {
      if (e.type === 'ParenthesizedExpression') {
        e = (e as unknown as { Expression: ParseNode }).Expression;
        continue;
      }
      if (e.type === 'UnaryExpression' && (e as unknown as { operator?: string }).operator === '!') {
        negated = !negated;
        e = (e as unknown as { UnaryExpression: ParseNode }).UnaryExpression;
        continue;
      }
      break;
    }
    if (e.type === 'IsExpression') {
      const ie = e as unknown as {
        Expression: ParseNode, Type: ParseNode | null,
        Pattern?: { type?: string, Type?: ParseNode } | null,
      };
      if (ie.Expression.type !== 'IdentifierReference') {
        return undefined;
      }
      // proposal-runtime-types `sec-is-pattern`: "a |Type| is one |MatchPattern|
      // form, so every existing `is` keeps its parse AND ITS MEANING" - and its
      // meaning to the CHECKER is the narrowing it drives. Routing every `is`
      // through a pattern node without seeing through a bare TYPE pattern made
      // narrowing stop: the test still answered correctly at run time and
      // narrowed nothing, which is the promise half-kept. A pattern that is NOT
      // a bare type narrows nothing yet - phase five - and that is the pin.
      // A `not` over a bare type NEGATES the narrowing rather than abandoning
      // it: `v is not uint8` leaves `v` everything it was except `uint8` in the
      // true branch, which is what union subtraction can represent. Combinators
      // over non-type patterns still narrow nothing, since "a failed structural
      // pattern narrows nothing" and negation types do not exist here.
      let patternNode = ie.Pattern as { type?: string, Type?: ParseNode, Operand?: { type?: string, Type?: ParseNode } } | null | undefined;
      let patternNegated = negated;
      while (patternNode?.type === 'MatchNotPattern') {
        patternNegated = !patternNegated;
        patternNode = patternNode.Operand as typeof patternNode;
      }
      const asType = ie.Type ?? (patternNode?.type === 'MatchTypePattern' ? patternNode.Type : null);
      if (!asType) {
        return undefined;
      }
      const t = resolveType(asType as ParseNode.Type);
      return t ? { name: (ie.Expression as unknown as { name: string }).name, type: t, negated: patternNegated } : undefined;
    }
    // `a && b` implies its LEFT operand only where the whole is true, and
    // `a || b` implies the left is false only where the whole is false. So a
    // conjunction narrows the branch it guards and a disjunction narrows the
    // other one, and neither says anything about the branch it does not imply
    // (F77).
    if (e.type === 'LogicalANDExpression') {
      const l = narrowingFactOf((e as unknown as { LogicalANDExpression: ParseNode }).LogicalANDExpression);
      return l ? { ...l, negated: l.negated !== negated, sense: negated ? 'false' : 'true' } : undefined;
    }
    if (e.type === 'LogicalORExpression') {
      const l = narrowingFactOf((e as unknown as { LogicalORExpression: ParseNode }).LogicalORExpression);
      return l ? { ...l, negated: l.negated !== negated, sense: negated ? 'true' : 'false' } : undefined;
    }
    if (e.type === 'EqualityExpression') {
      const eq = e as unknown as { operator: string, EqualityExpression: ParseNode, RelationalExpression: ParseNode };
      // `!==` and `!=` are the same fact with the sense inverted, which is why
      // the forms below need writing only once.
      const inverted = eq.operator === '!==' || eq.operator === '!=';
      const loose = eq.operator === '==' || eq.operator === '!=';
      const sides: [ParseNode, ParseNode][] = [
        [eq.EqualityExpression, eq.RelationalExpression],
        [eq.RelationalExpression, eq.EqualityExpression],
      ];
      for (const [subject, against] of sides) {
        // `typeof x === "string"`: the string names the type.
        if (subject.type === 'UnaryExpression' && (subject as unknown as { operator?: string }).operator === 'typeof') {
          const operand = (subject as unknown as { UnaryExpression: ParseNode }).UnaryExpression;
          if (operand.type !== 'IdentifierReference' || against.type !== 'StringLiteral') {
            continue;
          }
          const t = typeofStringToType((against as unknown as { value: string }).value);
          if (t) {
            return { name: (operand as unknown as { name: string }).name, type: t, negated: negated !== inverted };
          }
          continue;
        }
        if (subject.type !== 'IdentifierReference') {
          continue;
        }
        const name = (subject as unknown as { name: string }).name;
        // `x === null` and `x === undefined`, and the LOOSE forms, which test
        // for either: `x == null` is the idiom for "nullish" and narrows to
        // both, which is what nullishType is for.
        if (against.type === 'NullLiteral' || (against.type === 'IdentifierReference' && (against as unknown as { name: string }).name === 'undefined')) {
          const t = loose
            ? nullishType()
            : (against.type === 'NullLiteral'
              ? { Kind: 'literal' as const, Value: Value.null, Base: makePrimitive('object') }
              : makePrimitive('undefined'));
          return { name, type: t as TypeRecord, negated: negated !== inverted };
        }
        // `x === 5` and `x === 'a'`: the literal names a literal type.
        if (against.type === 'NumericLiteral' || against.type === 'StringLiteral' || against.type === 'BooleanLiteral') {
          const lit = staticType(against);
          if (lit) {
            return { name, type: lit as TypeRecord, negated: negated !== inverted };
          }
        }
      }
      // A DISCRIMINANT: `x.kind === 'a'` over a union of object types keeps the
      // members whose `kind` admits that literal. The subject is a property
      // access rather than a binding, and what narrows is the OBJECT, which is
      // what makes a tagged union usable (F77).
      for (const [subject, against] of sides) {
        if (subject.type !== 'MemberExpression') {
          continue;
        }
        const me = subject as unknown as { MemberExpression?: ParseNode, IdentifierName?: { name: string } | null };
        if (!me.MemberExpression || me.MemberExpression.type !== 'IdentifierReference' || !me.IdentifierName) {
          continue;
        }
        const objName = (me.MemberExpression as unknown as { name: string }).name;
        const key = me.IdentifierName.name;
        const objType = lookup(objName);
        if (!objType || objType.Kind !== 'union') {
          continue;
        }
        const discriminant = staticType(against);
        if (!discriminant) {
          continue;
        }
        const kept = objType.Members.filter((m) => {
          const shape = structureOf(m as Known);
          if (!shape || shape.Kind !== 'object') {
            return false;
          }
          const prop = shape.Properties.find((pp) => pp.key === key);
          return prop ? IsAssignable(discriminant as TypeRecord, prop.type) : false;
        });
        if (kept.length === 0 || kept.length === objType.Members.length) {
          continue;
        }
        return {
          name: objName,
          type: CanonicalizeType({ Kind: 'union', Members: kept }),
          negated: inverted !== false ? inverted : false,
        };
      }
    }
    return undefined;
  };

  /**
   * Walk a test and the two branches it guards, with the binding the test
   * speaks about narrowed in each. Shared by `if`, `while`, and the conditional
   * operator, which differ only in what they guard (F76).
   */
  const walkGuarded = (test: ParseNode, whenTrueNode: ParseNode | null, whenFalseNode: ParseNode | null) => {
    const fact = narrowingFactOf(test);
    walk(test);
    if (!fact) {
      walk(whenTrueNode);
      walk(whenFalseNode);
      return;
    }
    const source = lookup(fact.name) ?? ({ Kind: 'any' } as TypeRecord);
    const whenTrue = fact.negated ? NarrowFrom(source, fact.type) : NarrowTo(source, fact.type);
    const whenFalse = fact.negated ? NarrowTo(source, fact.type) : NarrowFrom(source, fact.type);
    // sec-narrowing: "It is a type error to apply a narrowing form where the
    // test can never succeed or can never fail, since the branch it guards is
    // then dead code the program did not intend." The checker had this rule and
    // reached it only for a test over a TYPE, never for one over a binding,
    // which is the shape a program writes (F76).
    // The dead-branch rule reasons from the STATIC type, so it applies only
    // where membership is a stable fact about the value. It is not, for an
    // object type or a refinement: sec-isoftype says in as many words that the
    // object case "is checked at the boundary but not afterwards", so a binding
    // of an object type can stop satisfying it through mutation, and a `where`
    // predicate is re-evaluated on every test. The suite has the case that
    // proves it - `let p: Pos = ...; p.a = 0; p is Pos` is *false* at run time
    // while the static type still says `Pos` - and reporting that branch as
    // dead would have contradicted a documented behaviour (F76). So the rule
    // fires for the kinds whose membership a value cannot lose.
    const decidable = (t: TypeRecord): boolean => t.Kind === 'primitive' || t.Kind === 'literal'
      || (t.Kind === 'union' && t.Members.every(decidable));
    if (source.Kind !== 'any' && !fact.sense && decidable(source) && decidable(fact.type)) {
      if (whenTrue === empty) {
        const completion = Throw.TypeError('the $1 test can never succeed, so the branch it guards is dead code', Value(displayType(fact.type))) as ThrowCompletion;
        errors.push(completion.Value as ObjectValue);
      } else if (whenFalse === empty) {
        const completion = Throw.TypeError('the $1 test can never fail, so the branch it guards is dead code', Value(displayType(fact.type))) as ThrowCompletion;
        errors.push(completion.Value as ObjectValue);
      }
    }
    if (whenTrueNode) {
      pushBlock(() => {
        if (whenTrue !== empty && fact.sense !== 'false') {
          declareNarrowed(fact.name, whenTrue as Known);
        }
        walk(whenTrueNode);
      });
    }
    if (whenFalseNode) {
      pushBlock(() => {
        if (whenFalse !== empty && fact.sense !== 'true') {
          declareNarrowed(fact.name, whenFalse as Known);
        }
        walk(whenFalseNode);
      });
    }
  };

  /** The type a `typeof` string names, for the narrowing form that tests one. */
  const typeofStringToType = (s: string): TypeRecord | null => {
    switch (s) {
      case 'string': return makePrimitive('string');
      case 'number': return makePrimitive('number');
      case 'boolean': return makePrimitive('boolean');
      case 'bigint': return makePrimitive('bigint');
      case 'symbol': return makePrimitive('symbol');
      case 'undefined': return makePrimitive('undefined');
      case 'object': return makePrimitive('object');
      default: return null;
    }
  };

  /**
   * A method of a typed COLLECTION takes its key and value positions at the
   * declared types, which sec-array-defaults-and-stores states beside the
   * array's element positions and which the run time enforces. The checker
   * knowing them is what turns `s.add(300)` on a `Set.<uint8>` from a run-time
   * RangeError into the Early Error a statically determinable mistake
   * deserves - the same step the array methods took in F70, and the reason a
   * collection's methods were the array methods' one remaining asymmetry.
   *
   * The signatures are the DESIGN's own, written out in the weak-reference
   * section of the README rather than invented here: `add(value: T): Set.<T>`,
   * `has(value: T): boolean`, `delete(value: T): boolean`, and for the keyed
   * form `get(key: K): V | undefined`, `set(key: K, value: V): Map.<K, V>`.
   * The `undefined` in `get`'s return is the design's and is load-bearing: a
   * lookup that finds nothing answers *undefined*, so `let x: uint8 = m.get(k)`
   * is a mistake the types can see.
   */
  /**
   * Whether a function body's straight-line exit is a `return` with a value.
   *
   * This is the second half of the return-boundary condition and the half that
   * is easy to forget: a function whose every explicit return is proven can
   * STILL fall off the end, and falling off the end hands back *undefined*,
   * which no numeric or object annotation admits. Requiring the body to end in
   * a `return` makes that path impossible without a control-flow graph.
   *
   * It is deliberately syntactic and therefore conservative. A body ending in
   * `if (c) return a; else return b;` is not elided even though both arms
   * return, and a CONCISE arrow body is not elided at all - it has no
   * ReturnStatement node to prove. Both are misses rather than errors: the
   * boundary runs and the program is correct, which is the right direction to
   * be wrong in when the alternative is skipping a check that was needed.
   */
  const endsWithReturn = (body: ParseNode | readonly ParseNode[] | null | undefined): boolean => {
    if (!body) {
      return false;
    }
    const list = Array.isArray(body)
      ? body as readonly ParseNode[]
      : (body as { FunctionStatementList?: readonly ParseNode[], StatementList?: readonly ParseNode[] }).FunctionStatementList
        ?? (body as { StatementList?: readonly ParseNode[] }).StatementList;
    if (!list || list.length === 0) {
      return false;
    }
    const last = list[list.length - 1]!;
    return last.type === 'ReturnStatement' && !!(last as { Expression?: ParseNode | null }).Expression;
  };

  /**
   * The RETURN TYPE of a function literal written at a call, inferred from its
   * body with the parameters bound to the types the position supplies.
   *
   * F80 could read a CONCISE arrow body, whose body IS the returned
   * expression, and left a BLOCK body at ~any~ - so `a.map(x => x)` flowed and
   * `a.map(x => { return x; })` did not, which is the same function written
   * two ways. This is the machinery that closes it, and it is the join of the
   * body's `return` expressions:
   *
   *  - Every `return` inside the literal contributes the Static Type of its
   *    expression. A `return` with NO expression contributes *undefined*.
   *  - A body that can complete without returning also contributes
   *    *undefined*, since falling off the end answers it. `endsWithReturn` is
   *    the same conservative test the return-boundary elision uses (F82): a
   *    body ending in `if (c) return a; else return b;` is treated as able to
   *    complete, which loses precision and cannot lose soundness.
   *  - If any contribution is UNKNOWN the whole inference is unknown, because
   *    a union containing an unknown arm is unknown. Answering the other arms
   *    would state more than the body supports.
   *  - Returns inside a NESTED function belong to that function and are not
   *    collected; the walk stops at every function form.
   */
  const inferredReturnType = (fn: ParseNode, parameterTypes: readonly Known[]): Known => {
    const params = (fn as { ArrowParameters?: readonly ParseNode[], FormalParameters?: readonly ParseNode[] }).ArrowParameters
      ?? (fn as { FormalParameters?: readonly ParseNode[] }).FormalParameters;
    if (fn.type !== 'ArrowFunction' && fn.type !== 'FunctionExpression') {
      // A generator or async literal's result is an iterator or a promise, not
      // the returned value; those judgments are not this operation's business.
      return null;
    }
    const declareParameters = () => {
      let i = 0;
      for (const prm of params ?? []) {
        if (prm.type === 'SingleNameBinding' && (prm as ParseNode.SingleNameBinding).BindingIdentifier) {
          const annotated = (prm as { TypeAnnotation?: ParseNode.TypeAnnotation | null }).TypeAnnotation;
          // An ANNOTATION wins over the position, since the program said what
          // it wanted; the position fills a parameter that said nothing.
          const t = annotated ? resolveType(annotated.Type) : (parameterTypes[i] ?? null);
          declare((prm as ParseNode.SingleNameBinding).BindingIdentifier!.name, t);
        }
        i += 1;
      }
    };

    // A concise arrow body: the expression IS the return. Two wrapper nodes
    // deep - `ConciseBody` holds an `ExpressionBody` which holds it (F80).
    let body = (fn as { ConciseBody?: ParseNode, FunctionBody?: ParseNode }).ConciseBody
      ?? (fn as { FunctionBody?: ParseNode }).FunctionBody;
    if (body && body.type === 'ConciseBody') {
      body = (body as unknown as { ExpressionBody: ParseNode }).ExpressionBody;
    }
    if (body && body.type === 'ExpressionBody') {
      body = (body as unknown as { AssignmentExpression: ParseNode }).AssignmentExpression;
    }
    if (!body) {
      return null;
    }
    if (body.type !== 'FunctionBody') {
      return pushBlock(() => {
        declareParameters();
        return staticType(body!);
      });
    }

    const list = (body as unknown as { FunctionStatementList?: readonly ParseNode[] }).FunctionStatementList;
    if (!list) {
      return null;
    }
    return pushBlock(() => {
      declareParameters();
      const contributions: TypeRecord[] = [];
      let unknown = false;
      const collect = (n: ParseNode | null | undefined): void => {
        if (!n || typeof n !== 'object' || unknown) {
          return;
        }
        if (n.type === 'ArrowFunction' || n.type === 'FunctionExpression' || n.type === 'FunctionDeclaration'
          || n.type === 'GeneratorExpression' || n.type === 'GeneratorDeclaration'
          || n.type === 'AsyncFunctionExpression' || n.type === 'AsyncFunctionDeclaration'
          || n.type === 'AsyncArrowFunction' || n.type === 'MethodDefinition'
          || n.type === 'ClassDeclaration' || n.type === 'ClassExpression') {
          return;
        }
        if (n.type === 'ReturnStatement') {
          const expr = (n as { Expression?: ParseNode | null }).Expression;
          if (!expr) {
            contributions.push(makePrimitive('undefined'));
            return;
          }
          const t = staticType(expr);
          if (!t) {
            unknown = true;
            return;
          }
          contributions.push(widen(t));
          return;
        }
        for (const key of Object.keys(n)) {
          if (key === 'parent' || key === 'location' || key === 'strict') {
            continue;
          }
          const child = (n as unknown as Record<string, unknown>)[key];
          if (Array.isArray(child)) {
            for (const c of child) {
              collect(c as ParseNode);
            }
          } else if (child && typeof child === 'object' && 'type' in (child as object)) {
            collect(child as ParseNode);
          }
        }
      };
      for (const st of list) {
        collect(st);
      }
      if (unknown) {
        return null;
      }
      if (!endsWithReturn(body)) {
        contributions.push(makePrimitive('undefined'));
      }
      if (contributions.length === 0) {
        return null;
      }
      const Members: TypeRecord[] = [];
      for (const c of contributions) {
        if (!Members.some((m) => SameType(m, c))) {
          Members.push(c);
        }
      }
      return Members.length === 1 ? Members[0]! : { Kind: 'union', Members };
    });
  };

  const collectionMethodSignature = (library: string, name: string, args: readonly (TypeRecord | number)[], receiver: TypeRecord): Known => {
    const boolType = makePrimitive('boolean');
    const anyType = { Kind: 'any' as const };
    const shapes = (types: readonly TypeRecord[], optionalFrom: number): ParameterRecord[] => types.map((t, i) => parameter(t, { Optional: i >= optionalFrom }));
    const arg = (i: number): TypeRecord => {
      const a = args[i];
      return a === undefined || typeof a === 'number' ? anyType as TypeRecord : a;
    };
    const sig = (Parameters: TypeRecord[], Return: TypeRecord, optionalFrom = Parameters.length) => ({
      Kind: 'function',
      Signatures: [{ Parameters: shapes(Parameters, optionalFrom), Return, Untyped: false }],
    } as unknown as Known);
    if (library === 'Set' || library === 'WeakSet') {
      const element = arg(0);
      switch (name) {
        case 'add': return sig([element], receiver);
        case 'has':
        case 'delete': return sig([element], boolType);
        // The design's set operations. `intersection` and `difference` draw
        // ONLY from `this`, so the result keeps the receiver's element type
        // whatever the other side holds - which is why they can be written
        // here while `union` and `symmetricDifference` cannot.
        //
        // The `other` parameter is left ~any~ rather than typed `Set.<U>`.
        // The design writes a generic parameter, and this checker has no way
        // to say "a Set of any element type" without deciding assignability
        // between two parameterizations of one nominal, which is a rule the
        // specification has not stated. An under-approximation admits what the
        // design admits and declines to invent the rest; the run time refuses
        // a non-Set as it always did.
        case 'intersection':
        case 'difference': return sig([anyType as TypeRecord], receiver);
        case 'isSubsetOf':
        case 'isSupersetOf':
        case 'isDisjointFrom': return sig([anyType as TypeRecord], boolType);
        default: return null;
      }
    }
    const key = arg(0);
    const value = arg(1);
    switch (name) {
      // The design writes the lookup as `V | undefined`, and a union is how the
      // checker says it: a `Map.<K, V>` that does not hold the key answers
      // *undefined*, so a binding of type V is not what a lookup produces.
      case 'get': return sig([key], { Kind: 'union', Members: [value, makePrimitive('undefined')] } as TypeRecord);
      case 'set': return sig([key, value], receiver);
      case 'has':
      case 'delete': return sig([key], boolType);
      // `getOrInsert` postdates the design's listing, so its return is read off
      // its own semantics rather than quoted: it answers the value it found or
      // the one it inserted, and never *undefined*.
      case 'getOrInsert': return sig([key, value], value);
      default: return null;
    }
  };

  const arrayMethodSignature = (name: string, element: TypeRecord, receiver: TypeRecord): Known => {
    const anyType = { Kind: 'any' as const };
    const numberType = makePrimitive('number');
    const boolType = makePrimitive('boolean');
    const shapes = (types: readonly TypeRecord[], optionalFrom: number): ParameterRecord[] => types.map((t, i) => parameter(t, { Optional: i >= optionalFrom }));
    switch (name) {
      case 'includes':
        return { Kind: 'function', Signatures: [{ Parameters: shapes([element, numberType], 1), Return: boolType, Untyped: false }] } as unknown as Known;
      case 'indexOf':
      case 'lastIndexOf':
        return { Kind: 'function', Signatures: [{ Parameters: shapes([element, numberType], 1), Return: numberType, Untyped: false }] } as unknown as Known;
      case 'fill':
        return { Kind: 'function', Signatures: [{ Parameters: shapes([element, numberType, numberType], 1), Return: anyType, Untyped: false }] } as unknown as Known;
      case 'at':
        return { Kind: 'function', Signatures: [{ Parameters: shapes([numberType], 1), Return: element, Untyped: false }] } as unknown as Known;
      // A result drawn from the receiver's own elements is an array of the same
      // element type: `filter` selects, `slice` copies a range, `reverse` and
      // `sort` reorder, `concat` joins. `map` is NOT here - its element type is
      // the callback's return, which needs the callback typed first, and
      // claiming the receiver's type would be wrong rather than merely
      // imprecise (F79).
      // The methods that take a CALLBACK: its first parameter is the element,
      // its second the index at `uint32`, its third the array itself. Writing
      // that as a function type is what lets the call site push those types
      // into the literal's parameters (F80).
      case 'forEach':
      case 'map':
      case 'find':
      case 'findIndex':
      case 'findLast':
      case 'findLastIndex':
      case 'some':
      case 'every': {
        const callback = {
          Kind: 'function',
          Signatures: [{
            Parameters: shapes([element, builtinTypeRecord('uint', [32]) ?? numberType, receiver], 1),
            Return: anyType,
            Untyped: false,
          }],
        } as unknown as TypeRecord;
        const result = name === 'map' ? anyType : (name === 'find' || name === 'findLast' ? element : anyType);
        return { Kind: 'function', Signatures: [{ Parameters: shapes([callback, anyType], 1), Return: result, Untyped: false }] } as unknown as Known;
      }
      case 'filter': {
        // Selects from the receiver's own elements, so the result keeps the
        // element type AND the callback sees it.
        const callback = {
          Kind: 'function',
          Signatures: [{
            Parameters: shapes([element, builtinTypeRecord('uint', [32]) ?? numberType, receiver], 1),
            Return: anyType,
            Untyped: false,
          }],
        } as unknown as TypeRecord;
        return { Kind: 'function', Signatures: [{ Parameters: shapes([callback, anyType], 1), Return: receiver, Untyped: false }] } as unknown as Known;
      }
      case 'slice':
      case 'reverse':
      case 'sort':
      case 'toReversed':
      case 'toSorted':
      case 'concat':
        return { Kind: 'function', Signatures: [{ Parameters: shapes([anyType, anyType], 0), Return: receiver, Untyped: false }] } as unknown as Known;
      default:
        return null;
    }
  };

  const declareFunctionSignatures = (list: readonly ParseNode[]) => {
    // OVERLOADS ACCUMULATE. A name may be declared more than once - that is
    // this proposal's function overloading - so the signatures are collected
    // per name and declared together. Declaring one at a time let the last
    // declaration clobber the earlier ones, which turned every call matching
    // an earlier overload into a spurious Early Error (measured, cycle 50).
    // The argument check at a call site fires only for a SINGLE-signature
    // type, so an overloaded name keeps resolving where it did before, at run
    // time, until the checker learns to rank signatures.
    const collected = new Map<string, { Parameters: ParameterRecord[], Return: Known, Untyped: boolean }[]>();
    const rejected = new Set<string>();
    for (const n of list) {
      // PLAN-do-expressions.md phase 1, #sec-generator-types. A generator
      // declaration was skipped entirely, so a call of one had no type at all.
      // It is collected now, and its annotation is read by the shorthand: a
      // bare `T` is the YIELD type of a `Generator.<T, void, void>`.
      const isGenerator = n.type === 'GeneratorDeclaration' || n.type === 'AsyncGeneratorDeclaration';
      const isAsyncGenerator = n.type === 'AsyncGeneratorDeclaration';
      if (n.type !== 'FunctionDeclaration' && !isGenerator) {
        continue;
      }
      const fn = n as unknown as {
        BindingIdentifier?: { name: string } | null,
        FormalParameters?: readonly ParseNode[] | null,
        TypeAnnotation?: ParseNode.TypeAnnotation | null,
      };
      const name = fn.BindingIdentifier?.name;
      if (!name) {
        continue;
      }
      const Parameters: ParameterRecord[] = [];
      const annotated: Known[] = [];
      let usable = true;
      for (const p of fn.FormalParameters ?? []) {
        if (p.type !== 'SingleNameBinding' && p.type !== 'BindingElement') {
          // A rest or destructuring parameter: no arity to check against, so
          // the whole name is left untyped rather than half-described.
          usable = false;
          break;
        }
        const pp = p as {
          TypeAnnotation?: ParseNode.TypeAnnotation | null,
          Initializer?: ParseNode | null,
          Optional?: boolean,
        };
        const resolved2 = pp.TypeAnnotation ? resolveType(pp.TypeAnnotation.Type) : null;
        annotated.push(resolved2);
        Parameters.push(parameter(resolved2 ?? anyTypeRecord, {
          Name: (p as { BindingIdentifier?: { name?: string } }).BindingIdentifier?.name ?? '',
          Optional: pp.Optional === true || !!pp.Initializer,
        }));
      }
      if (!usable) {
        rejected.add(name);
        continue;
      }
      const Return = fn.TypeAnnotation ? resolveType(fn.TypeAnnotation.Type) : null;
      const signatures = collected.get(name) ?? [];
      // #sec-overload-resolution's [[Untyped]]: a signature with no annotation
      // anywhere is the catch-all that ranks last. Declaring a return type is
      // what makes a zero-parameter function typed, which the clause spells
      // out.
      let declared = Return;
      if (isGenerator) {
        declared = generatorDeclaredType(Return, isAsyncGenerator);
        if (declared === null) {
          // An AsyncGenerator annotation on a synchronous generator, or the
          // reverse: the annotation names the wrong protocol.
          const completion = Throw.TypeError('a $1 annotation is not a $2', Value(isAsyncGenerator ? 'Generator' : 'AsyncGenerator'), Value(isAsyncGenerator ? 'AsyncGenerator' : 'Generator')) as ThrowCompletion;
          errors.push(completion.Value as ObjectValue);
          declared = Return;
        }
      }
      const Untyped = !fn.TypeAnnotation && annotated.every((t) => t === null);
      signatures.push({ Parameters, Return: declared, Untyped });
      collected.set(name, signatures);
    }
    for (const [name, Signatures] of collected) {
      if (rejected.has(name)) {
        continue;
      }
      declare(name, { Kind: 'function', Signatures } as unknown as Known);
    }
    // Class instance types are recorded over the same list, so a class may be
    // named as a type anywhere in it.
    for (const n of list) {
      if (n.type === 'ClassDeclaration') {
        const name = (n as unknown as { BindingIdentifier?: { name: string } | null }).BindingIdentifier?.name;
        if (name) {
          classNodes.set(name, n);
        }
      } else if (n.type === 'InterfaceDeclaration') {
        const name = (n as unknown as { BindingIdentifier?: { name: string } | null }).BindingIdentifier?.name;
        if (name) {
          interfaceNodes.set(name, n);
        }
      }
    }
    // FORCE each class's instance type, once the whole list is recorded so a
    // class may still name one declared later.
    //
    // The member walk is where a class's own declarations are judged, and it
    // had been reached only ON DEMAND - when something asked for the class's
    // type. A class that nothing references was never walked, so a rule checked
    // there fired only if the program happened to mention the class elsewhere,
    // which is no rule at all. `instanceTypeOf` memoizes, so forcing it here
    // runs the walk exactly once per class and every later demand is a cache
    // hit: the errors below are reported once, not once per reference.
    // typeprogramming.md §6.6: "a declared `const s = Symbol()` used in type
    // position IS the unique symbol type, without a keyword". A checker has no
    // VALUES, so that identity is carried by the DECLARATION - two consts are
    // two types, and one const named twice is one type, which is exactly what
    // §6.6's identity rule means where no symbol can be held.
    for (const n of list) {
      if (n.type !== 'LexicalDeclaration' || (n as ParseNode.LexicalDeclaration).LetOrConst !== 'const') {
        continue;
      }
      for (const binding of (n as ParseNode.LexicalDeclaration).BindingList) {
        const b = binding as unknown as {
          BindingIdentifier?: { name?: string } | null,
          Initializer?: { type?: string, CallExpression?: { type?: string, name?: string } } | null,
        };
        const bound = b.BindingIdentifier?.name;
        const callee = b.Initializer?.type === 'CallExpression' ? b.Initializer.CallExpression : undefined;
        if (typeof bound === 'string' && callee?.type === 'IdentifierReference' && callee.name === 'Symbol') {
          symbolConsts.set(bound, binding);
        }
      }
    }
    for (const n of classNodes.values()) {
      instanceTypeOf(n);
    }
    // An interface's member walk is lazy for the same reason the class one was,
    // and a rule checked there needs the same forcing: an interface nothing
    // references would never be walked, so its computed keys would never be
    // judged.
    for (const n of interfaceNodes.values()) {
      interfaceTypeOf((n as unknown as { BindingIdentifier?: { name: string } }).BindingIdentifier?.name ?? '');
    }
  };

  /** Record a NARROWING of a name, which an assignment may later invalidate. */
  const declareNarrowed = (name: string, t: Known) => {
    if (!t) {
      return;
    }
    const frame = frames[frames.length - 1] as Frame & { narrowed?: Set<string> };
    frame.bindings.set(name, t as TypeRecord);
    ((frame as { narrowed?: Set<string> }).narrowed ??= new Set()).add(name);
  };

  /**
   * The type a name was DECLARED with, ignoring any narrowing in force. An
   * assignment is checked against this, because the declared type is what the
   * binding may hold; the narrowing is a fact about the current value and the
   * assignment is what ends it (F78).
   */
  const lookupDeclared = (name: string): Known => {
    for (let i = frames.length - 1; i >= 0; i -= 1) {
      const f = frames[i] as Frame & { narrowed?: Set<string> };
      if (f.narrowed?.has(name)) {
        continue;
      }
      const t = f.bindings.get(name);
      if (t !== undefined) {
        return t;
      }
    }
    return null;
  };

  /** Drop any narrowing of a name, which an assignment to it invalidates. */
  const invalidateNarrowing = (name: string) => {
    for (let i = frames.length - 1; i >= 0; i -= 1) {
      const f = frames[i] as Frame & { narrowed?: Set<string> };
      if (f.narrowed?.has(name)) {
        f.bindings.delete(name);
        f.narrowed.delete(name);
      }
    }
  };

  const declare = (name: string, t: Known) => {
    if (t) {
      frames[frames.length - 1].bindings.set(name, t);
    }
  };

  /**
   * Declare what a pattern binds, at the type the pattern established.
   *
   * An ANNOTATED binding types as its annotation - `let x: uint8` makes `x` a
   * `uint8` - which is the narrowing a pattern can always justify. An
   * UNANNOTATED binding is left undeclared rather than declared as `any`, so it
   * resolves outward the way any other free name does; typing it as the
   * SUBJECT's narrowed type is the remaining work, and declaring `any` here
   * would silently look like that work was done.
   */
  const declareMatchPatternBindings = (pattern: ParseNode.MatchPattern | null, positionType?: Known): void => {
    if (!pattern) {
      return;
    }
    switch (pattern.type) {
      case 'MatchBindingPattern':
        if (pattern.TypeAnnotation) {
          // An ANNOTATED binding types as its annotation, which is the
          // narrowing the pattern itself justifies.
          const t = resolveType(pattern.TypeAnnotation);
          if (t) {
            declare(pattern.Name, t);
          }
        } else if (positionType) {
          // An UNANNOTATED binding types as the SUBJECT at that position - "a
          // binding always matches", so it establishes nothing about the value
          // beyond what the position already said. Left undeclared where the
          // position's type is unknown rather than declared as `any`, since
          // `any` would look exactly like this work having been done.
          declare(pattern.Name, positionType);
        }
        break;
      case 'MatchOrPattern':
      case 'MatchAndPattern':
        // A combinator does not change the POSITION, so both sides see the
        // same type. `and` could narrow the right side by the left, which is
        // the refinement still outstanding.
        declareMatchPatternBindings(pattern.Left, positionType);
        declareMatchPatternBindings(pattern.Right, positionType);
        break;
      case 'MatchNotPattern':
        declareMatchPatternBindings(pattern.Operand, positionType);
        break;
      case 'MatchObjectPattern':
        // The subject's type is WALKED ALONGSIDE the pattern: each member's
        // sub-pattern sees the type of the property it names, so `{ a: let n }`
        // against `{ a: uint8 }` types `n` as `uint8`. Passing the whole
        // subject type down would have typed `n` as the OBJECT, which is worse
        // than leaving it loose - it would be confidently wrong.
        pattern.Properties.forEach((prop) => {
          let memberType: Known = null;
          const shape = positionType && positionType.Kind === 'object'
            ? positionType
            : (positionType as { Structure?: TypeRecord } | undefined)?.Structure;
          if (shape && shape.Kind === 'object') {
            const declared = shape.Properties.find((pr) => pr.key === prop.Key);
            memberType = declared ? (declared.type as Known) : null;
          }
          declareMatchPatternBindings(prop.Pattern, memberType ?? undefined);
        });
        break;
      case 'MatchArrayPattern':
        // A TUPLE subject types each element by POSITION; an array subject
        // types every element the same. An extractor's elements come from a
        // matcher's return and are not typed here - "that narrowing is a claim
        // the matcher's author makes", and this walk has no claim to read.
        pattern.Elements.forEach((el, index) => {
          let elementType: Known = null;
          if (positionType && positionType.Kind === 'tuple') {
            const slot = positionType.Elements[index];
            elementType = slot ? (slot.Type as Known) : null;
          } else if (positionType && positionType.Kind === 'array') {
            elementType = positionType.Element as Known;
          }
          declareMatchPatternBindings(el, elementType ?? undefined);
        });
        break;
      case 'MatchExtractorPattern':
        pattern.Elements.forEach((el) => declareMatchPatternBindings(el));
        break;
      default:
        break;
    }
  };


  // The enum a binding should be tracked as holding, from its initializer or its
  // type annotation. `let e = E.Member` and `let e: E` both make `e` enum-typed;
  // `E.Member` is a MemberExpression on an enum name, and `E` as an annotation is
  // a TypeReference to an enum name.
  const enumOfInitializer = (init: ParseNode | null | undefined): string | null => {
    if (!init) {
      return null;
    }
    let node: ParseNode = init;
    if (node.type === 'ParenthesizedExpression') {
      node = (node as { Expression: ParseNode }).Expression;
    }
    if (node.type === 'MemberExpression') {
      const m = node as { MemberExpression?: ParseNode, IdentifierName?: { name: string } | null };
      if (m.MemberExpression && m.MemberExpression.type === 'IdentifierReference' && m.IdentifierName) {
        const enumName = (m.MemberExpression as { name: string }).name;
        const info = lookupEnum(enumName);
        if (info && info.names.includes(m.IdentifierName.name)) {
          return enumName;
        }
      }
    }
    return null;
  };

  const enumOfAnnotation = (ann: ParseNode.TypeAnnotation | null | undefined): string | null => {
    if (!ann) {
      return null;
    }
    const t = ann.Type;
    if (t.type === 'TypeReference') {
      const tr = t as unknown as { TypeName: { IdentifierReference: { name: string }, MemberNames: readonly unknown[] }, TypeArguments?: unknown };
      if (tr.TypeName.MemberNames.length === 0 && !tr.TypeArguments) {
        const name = tr.TypeName.IdentifierReference.name;
        if (lookupEnum(name)) {
          return name;
        }
      }
    }
    return null;
  };

  const walkBindingElement = (b: ParseNode.SingleNameBinding | ParseNode.BindingElement) => {
    if (b.type === 'SingleNameBinding' && b.BindingIdentifier) {
      const declared = b.TypeAnnotation ? resolveType(b.TypeAnnotation.Type) : null;
      if (b.TypeAnnotation && declared && b.Initializer) {
        const source = staticType(b.Initializer);
        // Not `any`, not a literal, and assignable: the value is already of the
        // target type, so the boundary has nothing to do (F81).
        if (source && source.Kind !== 'any' && source.Kind !== 'literal' && IsAssignable(source, declared)) {
          elidableAnnotations.add(b.TypeAnnotation);
        }
      }
      // proposal-runtime-types (spec sec-enums): a parameter annotated with an enum
      // type holds an enumerator, so a switch over it can be checked.
      const boundEnum = enumOfAnnotation(b.TypeAnnotation) ?? enumOfInitializer(b.Initializer);
      if (boundEnum) {
        frames[frames.length - 1].enumBindings.set(b.BindingIdentifier.name, boundEnum);
      }
      if (b.Initializer) {
        requireAssignable(staticTypeIn(b.Initializer, declared), declared);
        walk(b.Initializer);
      }
      // An OPTIONAL parameter may not be supplied, so its type includes
      // `undefined`. The checker had it as the bare annotation, which made
      // `b === undefined` a test that can never succeed - invisible until the
      // dead-branch diagnostic started reporting such tests, and then reported
      // against a program that was right (F76). A parameter with a DEFAULT is
      // not optional in this sense: it is always bound to something.
      const optional = (b as unknown as { Optional?: boolean }).Optional === true && !b.Initializer;
      declare(b.BindingIdentifier.name, optional && declared
        ? (CanonicalizeType({ Kind: 'union', Members: [declared, makePrimitive('undefined')] }) as Known)
        : declared);
    } else if (b.Initializer) {
      walk(b.Initializer);
    }
  };

  /**
   * The parameter types a function LITERAL takes from the position it is
   * written in: `a.forEach(x => ...)` on a `[].<uint8>` gives `x` the element
   * type. Recorded at the call site, keyed by the literal's node, and consulted
   * when the walk reaches it - the same channel shape the numeric overload
   * resolution uses, because a contextual type has to travel from where it is
   * known to where it is needed (F80).
   */
  const contextualParameterTypes = new Map<ParseNode, readonly Known[]>();
  /** A callback's inferred return type, keyed by the CALL that passed it. */
  const callbackReturnTypes = new Map<ParseNode, TypeRecord>();

  /**
   * #sec-check-elision at the RETURN boundary. The binding boundary could be
   * decided at the annotation, because a binding has one initializer; a return
   * annotation is shared by every `return` in the function, so the decision is
   * a property of the FUNCTION and not of any one statement. This stack
   * records, per function being walked, whether every return seen so far hands
   * back a value already of the declared type.
   *
   * The condition is F81's, unchanged: not ~any~, not a literal, and
   * assignable. A literal is assignable to `uint8` and still must be
   * CONVERTED, so `return 5` from a `(): uint8` needs its boundary; a binding
   * of type `uint8` does not.
   */
  const returnsProven: boolean[] = [];

  /**
   * The enclosing generator's declared type, for `yield` to read its N.
   *
   * PLAN-do-expressions.md phase 1. It cannot live in `returnTypes`: a `return`
   * inside a generator sets the generator's R rather than producing the
   * generator, so checking one against `Generator.<Y, R, N>` would be checking
   * it against the wrong thing. That is why the generator forms enter with a
   * null return annotation, and why the type they DO have needs its own frame.
   */
  const generatorTypes: Known[] = [];

  const enterFunction = (params: readonly ParseNode[] | null | undefined, returnAnnotation: ParseNode.TypeAnnotation | null | undefined, body: ParseNode | readonly ParseNode[] | null | undefined, checkReturns: boolean, contextual?: readonly Known[], generatorType?: Known) => {
    frames.push({ bindings: new Map(), aliases: new Map(), enums: new Map(), enumBindings: new Map() });
    returnTypes.push(checkReturns && returnAnnotation ? resolveType(returnAnnotation.Type) : null);
    generatorTypes.push(generatorType ?? null);
    returnsProven.push(true);
    let index = 0;
    for (const p of params ?? []) {
      if (p.type === 'SingleNameBinding' || p.type === 'BindingElement') {
        const fromContext = contextual?.[index];
        const annotated = (p as { TypeAnnotation?: ParseNode.TypeAnnotation | null }).TypeAnnotation;
        walkBindingElement(p);
        // An ANNOTATION wins over the context, since the program said what it
        // wanted; the context fills a parameter that said nothing.
        if (fromContext && !annotated && p.type === 'SingleNameBinding' && (p as ParseNode.SingleNameBinding).BindingIdentifier) {
          declare((p as ParseNode.SingleNameBinding).BindingIdentifier!.name, fromContext);
        }
      }
      index += 1;
    }
    if (body) {
      walk(body);
    }
    const proven = returnsProven.pop();
    const declaredReturn = returnTypes[returnTypes.length - 1];
    if (checkReturns && returnAnnotation && declaredReturn && proven
        && endsWithReturn(body)) {
      elidableAnnotations.add(returnAnnotation);
    }
    returnTypes.pop();
    generatorTypes.pop();
    frames.pop();
  };

  const pushBlock = <T,>(f: () => T): T => {
    // A block or switch introduces a scope; a binding declared inside shadows
    // an outer one without disturbing it. Overwriting in the same frame stays
    // sound because an unknown type is any.
    frames.push({ bindings: new Map(), aliases: new Map(), enums: new Map(), enumBindings: new Map() });
    try {
      return f();
    } finally {
      frames.pop();
    }
  };

  /**
   * The type an expression in a narrowing position DENOTES, when it denotes one.
   * The right operand of `instanceof` is an expression, so it may name a built-in
   * type or a type alias, in which case the narrowing rows apply, or it may be an
   * ordinary constructor, in which case there is no Static Type to narrow against
   * and the form is left alone.
   */
  const typeDenotedBy = (node: ParseNode | null | undefined): Known => {
    if (!node || node.type !== 'IdentifierReference') {
      return null;
    }
    const name = (node as { name: string }).name;
    return lookupAlias(name) ?? builtinTypeRecord(name);
  };

  /**
   * proposal-runtime-types (README, explicit resource management): a `using`
   * declaration's declared type must be one whose values can carry a disposal
   * method, since the declaration promises to dispose what it binds. A value type
   * and `void` never can, so annotating a resource with one is a mistake the
   * checker reports; `never` is the empty union and falls out of the union arm. `null` and `undefined` ARE admitted, because the
   * declaration permits them at runtime and registers nothing.
   *
   * This is the direction of the README's rule rather than its exact form. The
   * precise statement is that the declared type must include `[Symbol.dispose]`,
   * which cannot be checked yet because the type grammar has no symbol-keyed
   * member: `{ [Symbol.dispose](): void }` is rejected with "a computed member name
   * is not supported yet", so no type can declare the method to be looked for.
   * Rejecting every object type instead would make the annotation unusable, so the
   * checker catches what it provably can and the exact membership check waits on
   * that grammar.
   */
  const canCarryDisposal = (t: TypeRecord): boolean => {
    switch (t.Kind) {
      case 'any':
        return true;
      case 'union':
        return (t as { Members: readonly TypeRecord[] }).Members.some(canCarryDisposal);
      case 'literal': {
        const v = (t as { Value: unknown }).Value;
        return v === Value.null || v === Value.undefined;
      }
      case 'primitive':
      case 'void':
        return false;
      default:
        return true;
    }
  };

  /**
   * Whether a test sits where it decides a branch: the condition of `if`, `while`,
   * `do`, or `for`, the test of a conditional expression, or inside a parenthesis
   * or a `!` over one of those. The operands of `&&` and `||` guard in a weaker
   * sense and the specification does not name them, so they are left out of this
   * pass along with a test written as an ordinary Boolean value.
   */
  const guardsABranch = (node: ParseNode): boolean => {
    let child: ParseNode = node;
    let parent = (child as { parent?: ParseNode }).parent;
    while (parent) {
      switch (parent.type) {
        case 'IfStatement':
        case 'WhileStatement':
        case 'DoWhileStatement':
        case 'ConditionalExpression':
          return (parent as unknown as Record<string, unknown>).Expression === child
            || (parent as unknown as Record<string, unknown>).ShortCircuitExpression === child;
        case 'ForStatement':
          return (parent as unknown as Record<string, unknown>).Expression_b === child;
        case 'ParenthesizedExpression':
        case 'UnaryExpression':
          child = parent;
          parent = (parent as { parent?: ParseNode }).parent;
          continue;
        default:
          return false;
      }
    }
    return false;
  };

  /**
   * Report a narrowing form whose test cannot succeed, or cannot fail. Both are
   * type errors: the branch guarded is dead code the program did not intend. A
   * type the checker does not know is ~any~, which narrows to itself in both
   * directions and so never reports.
   */
  const reportImpossibleTest = (s: TypeRecord, t: TypeRecord, form: string, isGuard: boolean) => {
    // The specification states this rule about the BRANCHES a narrowing form
    // decides: a test that can never succeed, or can never fail, leaves a branch
    // that can never be taken, and that is dead code the program did not intend.
    // Where the form decides no branch, the same test is merely a question with a
    // constant answer, which a program may legitimately ask, so it is left alone.
    if (!isGuard) {
      return;
    }
    if (NarrowTo(s, t) === empty) {
      const completion = Throw.TypeError('the $1 test can never succeed, so the branch it guards is dead code', Value(form)) as ThrowCompletion;
      errors.push(completion.Value as ObjectValue);
      return;
    }
    if (NarrowFrom(s, t) === empty) {
      const completion = Throw.TypeError('the $1 test can never fail, so the branch it guards is dead code', Value(form)) as ThrowCompletion;
      errors.push(completion.Value as ObjectValue);
    }
  };

  const walk = (node: ParseNode | readonly ParseNode[] | null | undefined): void => {
    if (!node) {
      return;
    }
    if (Array.isArray(node)) {
      // Function declarations are hoisted, so a call may precede the
      // declaration. Their signatures are declared over the whole list before
      // any of it is walked, which is what lets `f(300)` above `function
      // f(v: uint8) {}` be the Early Error it should be (F56).
      declareFunctionSignatures(node as readonly ParseNode[]);
      node.forEach((n) => walk(n));
      return;
    }
    const n = node as ParseNode;
    switch (n.type) {
      // proposal-runtime-types (spec, narrowing): it is a type error to apply a
      // narrowing form whose test can never succeed or can never fail, those being
      // the branches for which NarrowTo or NarrowFrom is ~empty~, since the branch
      // guarded is dead code the program did not intend.
      case 'LexicalDeclaration': {
        // proposal-runtime-types (README, explicit resource management): the type
        // declared for a resource must be one that can be disposed.
        const decl = n as ParseNode.LexicalDeclaration;
        if (decl.LetOrConst === 'using') {
          for (const binding of decl.BindingList) {
            const ann = (binding as { TypeAnnotation?: ParseNode.TypeAnnotation }).TypeAnnotation;
            if (!ann) {
              continue;
            }
            const declared = resolveType(ann.Type);
            if (declared && !canCarryDisposal(declared)) {
              const completion = Throw.TypeError('a using declaration cannot be typed $1, whose values carry no disposal method', Value(displayType(declared))) as ThrowCompletion;
              errors.push(completion.Value as ObjectValue);
            }
          }
        }
        walk(decl.BindingList);
        return;
      }
      case 'IsExpression': {
        // The type OPERAND is resolved so an expression-position
        // parameterization is collected for the unclaimed-key adjudication:
        // `x is T.<{ ... }>` writes the parameterization as surely as an
        // annotation does. F44 claimed the type-meta pin had flipped; it had
        // not, because this position was never resolved, and F45 closes that
        // by resolving it here and at the bare cast below.
        const ie = n as ParseNode.IsExpression;
        walk(ie.Expression as ParseNode);
        const iePattern = ie.Pattern as { type?: string, Type?: ParseNode } | null | undefined;
        const ieType = ie.Type ?? (iePattern?.type === 'MatchTypePattern' ? iePattern.Type : null);
        if (ieType) {
          resolveType(ieType as ParseNode.Type);
        }
        return;
      }
      case 'TypedConversionExpression': {
        const tc = n as ParseNode.TypedConversionExpression;
        walk(tc.Expression as ParseNode);
        resolveType(tc.Type);
        return;
      }
      case 'RelationalExpression': {
        const rel = n as ParseNode.RelationalExpression;
        if (rel.operator === 'instanceof' && rel.RelationalExpression) {
          const s = staticType(rel.RelationalExpression as ParseNode);
          const t = typeDenotedBy(rel.ShiftExpression as ParseNode);
          if (s && t) {
            reportImpossibleTest(s, t, 'instanceof', guardsABranch(rel as ParseNode));
          }
        }
        walk(rel.RelationalExpression as ParseNode);
        walk(rel.ShiftExpression as ParseNode);
        return;
      }
      case 'CoalesceExpression': {
        const co = n as ParseNode.CoalesceExpression;
        const s = staticType(co.CoalesceExpressionHead as ParseNode);
        if (s) {
          reportImpossibleTest(s, nullishType(), '??', true);
        }
        walk(co.CoalesceExpressionHead as ParseNode);
        walk(co.BitwiseORExpression as ParseNode);
        return;
      }
      case 'Block':
      case 'CaseBlock':
        pushBlock(() => {
          for (const key of Object.keys(n)) {
            if (key === 'parent' || key === 'location' || key === 'strict' || key === 'sourceText') {
              continue;
            }
            const child = (n as unknown as Record<string, unknown>)[key];
            if (Array.isArray(child) || (child && typeof child === 'object' && 'type' in (child as object))) {
              walk(child as ParseNode);
            }
          }
        });
        return;
      case 'TypeAliasDeclaration': {
        const resolved = resolveType(n.Type);
        if (resolved) {
          frames[frames.length - 1].aliases.set(n.BindingIdentifier.name, resolved);
        }
        return;
      }
      case 'EnumDeclaration': {
        // proposal-runtime-types (spec sec-enums): record the enum's member names
        // so a switch over one of its enumerators can be checked for exhaustiveness.
        const names = n.EnumMemberList.map((m) => m.IdentifierName.name);
        frames[frames.length - 1].enums.set(n.BindingIdentifier.name, { names });
        return;
      }
      case 'MatchExpression': {
        // proposal-runtime-types `sec-match-exhaustiveness`: "A `match` over an
        // enum-typed or sealed-class-typed subject is exhaustive under the same
        // rules a `switch` is, and this clause adds no new ones - it SHARES
        // them." So this reads the same enum-name table the `SwitchStatement`
        // case does rather than building a second one.
        const me = n as ParseNode.MatchExpression;
        walk(me.Expression as ParseNode);
        const subjectType = staticType(me.Expression as ParseNode);
        me.Clauses.forEach((clause) => {
          // proposal-runtime-types `sec-match-narrowing`: an arm sees what its
          // pattern ESTABLISHED. A clause is its own scope - "a fresh
          // declarative environment per clause" at run time - so the checker
          // gives it a frame and declares the pattern's bindings in it, which is
          // what stops one arm's binding from leaking into the next.
          frames.push({ bindings: new Map(), aliases: new Map(), enums: new Map(), enumBindings: new Map() });
          // The SUBJECT's static type is what a top-level binding takes.
          // Computed once for the whole `match`, since every clause matches the
          // same subject.
          declareMatchPatternBindings(clause.Pattern, subjectType);
          if (clause.Guard) {
            // The guard sees the bindings, which is what makes it a refinement
            // of this clause rather than a second, independent test.
            walk(clause.Guard as ParseNode);
          }
          walk(clause.Body as ParseNode);
          frames.pop();
        });
        const subject = me.Expression;
        const subjectName = subject.type === 'IdentifierReference' ? (subject as { name: string }).name : null;
        const matchEnumName = subjectName ? lookupEnumBinding(subjectName) : null;
        const matchInfo = matchEnumName ? lookupEnum(matchEnumName) : null;
        if (matchInfo) {
          const covered = new Set<string>();
          let hasDefault = false;
          for (const clause of me.Clauses) {
            if (clause.Pattern === null) {
              hasDefault = true;
              continue;
            }
            // "A GUARDED ARM PROVES NOTHING, since the checker does not evaluate
            // guards" - so a guarded clause does not count towards coverage
            // however exhaustive its pattern looks.
            if (clause.Guard) {
              continue;
            }
            const pattern = clause.Pattern;
            if (pattern.type !== 'MatchTypePattern') {
              continue;
            }
            // `E.A` as a PATTERN is a |TypeReference| whose |TypeName| carries
            // an IdentifierReference and a list of MemberNames - NOT the
            // MemberExpression shape a switch CASE LABEL has, which is an
            // expression. The same enumerator spelled in the two positions
            // reaches the checker as two different node shapes, and reading the
            // label shape here found nothing: every clause looked uncovered and
            // an exhaustive `match` was reported as missing every member.
            const label = pattern.Type as unknown as {
              TypeName?: { IdentifierReference?: { name?: string }, MemberNames?: readonly { name: string }[] },
            };
            const typeName = label.TypeName;
            const labelEnum = typeName?.IdentifierReference?.name;
            const members = typeName?.MemberNames ?? [];
            if (labelEnum === matchEnumName && members.length === 1) {
              const member = members[0]!.name;
              if (matchInfo.names.includes(member)) {
                covered.add(member);
              }
            }
          }
          if (!hasDefault) {
            const missing = matchInfo.names.filter((nm) => !covered.has(nm));
            if (missing.length > 0) {
              const completion = Throw.TypeError('match over enum $1 is missing $2 and has no default', Value(matchEnumName!), Value(missing.join(', '))) as ThrowCompletion;
              errors.push(completion.Value as ObjectValue);
            }
          }
        }
        return;
      }
      case 'SwitchStatement': {
        // proposal-runtime-types (spec sec-enums, sec-narrowing): a switch over an
        // enumerator must label its cases with enumerators of that enum, and a
        // switch with no default must cover every enumerator. The discriminant is
        // enum-typed when it is a binding tracked as holding an enumerator.
        const coverage = switchEnumCoverage(n);
        if (coverage) {
          // A valid label is `EnumName.Member`. Any other label in an enum
          // switch is not an enumerator of the enum and is a type error.
          for (const { shown } of coverage.invalid) {
            const completion = Throw.TypeError('$1 is not a case of enum $2', Value(shown), Value(coverage.enumName)) as ThrowCompletion;
            errors.push(completion.Value as ObjectValue);
          }
          const hasDefault = n.CaseBlock.DefaultClause !== undefined && n.CaseBlock.DefaultClause !== null;
          if (!hasDefault) {
            const missing = coverage.names.filter((nm) => !coverage.covered.has(nm));
            if (missing.length > 0) {
              const completion = Throw.TypeError('switch over enum $1 is missing $2 and has no default', Value(coverage.enumName), Value(missing.join(', '))) as ThrowCompletion;
              errors.push(completion.Value as ObjectValue);
            }
          }
        }
        // Walk the discriminant and case bodies as usual.
        walk(n.Expression);
        walk(n.CaseBlock);
        return;
      }
      case 'LexicalBinding':
      case 'VariableDeclaration': {
        if (n.BindingIdentifier) {
          // proposal-runtime-types (spec sec-enums): track a binding that holds an
          // enumerator, from `let e = E.Member` or `let e: E`, so a switch over it
          // can be checked.
          const boundEnum = enumOfAnnotation(n.TypeAnnotation)
            ?? enumOfInitializer(n.Initializer)
            ?? (n.TypedInitializer ? enumOfInitializer(n.TypedInitializer.AssignmentExpression) : null);
          if (boundEnum) {
            frames[frames.length - 1].enumBindings.set(n.BindingIdentifier.name, boundEnum);
          }
          if (n.TypedInitializer) {
            const inferred = staticType(n.TypedInitializer.AssignmentExpression);
            declare(n.BindingIdentifier.name, inferred ? widen(inferred) : null);
            walk(n.TypedInitializer.AssignmentExpression);
            return;
          }
          const declared = n.TypeAnnotation ? resolveType(n.TypeAnnotation.Type) : null;
          if (n.TypeAnnotation && declared && n.Initializer) {
            const src = staticType(n.Initializer);
            if (src && src.Kind !== 'any' && src.Kind !== 'literal' && IsAssignable(src, declared)) {
              elidableAnnotations.add(n.TypeAnnotation);
            }
          }
          if (n.Initializer) {
            requireAssignable(staticTypeIn(n.Initializer, declared), declared);
            walk(n.Initializer);
          }
          declare(n.BindingIdentifier.name, declared);
          return;
        }
        walk(n.Initializer);
        return;
      }
      case 'CallExpression': {
        // With no context from the position: the diagnostics of the numeric
        // resolution (mixed families, a family with no row, an unfitting
        // literal beside a typed argument) apply at every call site.
        checkNumericCall(n, null);
        const c = n as { CallExpression: ParseNode, Arguments?: readonly ParseNode[] };
        const callee = staticType(c.CallExpression);
        if (callee && callee.Kind === 'function' && Array.isArray(c.Arguments)) {
          let sig: { Parameters: readonly ParameterRecord[] } | null = callee.Signatures.length === 1 ? callee.Signatures[0] : null;
          if (!sig && callee.Signatures.length > 1) {
            // #sec-overload-resolution, statically: rank the declared
            // signatures against the argument types by the SHARED resolver, so
            // the checker selects the row the run time would (F58). An
            // argument whose static type is unknown is ~any~, and the clause
            // says such a resolution is performed at run time, so the whole
            // call is left to the run time rather than guessed at.
            // A LITERAL type never reaches the run time - `7` is a plain
            // Number there - so the static types are erased to what the
            // resolver would see before ranking, and the literal's own fit
            // against the chosen parameter is then the ordinary assignability
            // check below. Without this every literal argument resolved to
            // ~none~ (F58).
            const argTypes = c.Arguments.map((a) => {
              if (a.type === 'AssignmentRestElement') {
                return null;
              }
              const t = staticType(a);
              return t && t.Kind === 'literal' ? t.Base : t;
            });
            if (argTypes.every((t) => t !== null)) {
              // PLAN-rest-parameters.md phase 0: the parameters ARE the records
              // now, so the zip of a Shapes sidecar with a type list is gone.
              const candidates = callee.Signatures.map((s) => ({
                Parameters: s.Parameters,
                Function: Value.undefined as unknown as Value,
                Untyped: (s as unknown as { Untyped?: boolean }).Untyped === true,
              }));
              const resolution = resolveOverloadByTypes(candidates as never, argTypes as TypeRecord[]);
              if (resolution.Kind === 'none') {
                // "It is a type error if ResolveOverload returns ~none~."
                const completion = Throw.TypeError('no declared signature accepts an argument of type $1', Value(displayType(argTypes[0] as TypeRecord))) as ThrowCompletion;
                errors.push(completion.Value as ObjectValue);
              } else if (resolution.Kind === 'ambiguous') {
                // "and it is a type error if it returns ~ambiguous~."
                const completion = Throw.TypeError('the call is ambiguous between two declared signatures') as ThrowCompletion;
                errors.push(completion.Value as ObjectValue);
              } else if (resolution.Kind === 'resolved') {
                const index = candidates.indexOf(resolution.Signature as never);
                sig = index >= 0 ? callee.Signatures[index] : null;
              }
            }
          }
          if (sig) {
            const chosen = sig;
            c.Arguments.forEach((arg, i) => {
              if (i >= chosen.Parameters.length || arg.type === 'AssignmentRestElement') {
                return;
              }
              const param = chosen.Parameters[i]?.Type;
              // A FUNCTION LITERAL in a position whose type is a function type
              // takes that type's parameters as its own, which is how a
              // callback learns the element type (F80). Recorded here and read
              // when the walk reaches the literal.
              if (param && param.Kind === 'function' && param.Signatures.length === 1
                  && (arg.type === 'ArrowFunction' || arg.type === 'FunctionExpression')) {
                contextualParameterTypes.set(arg, param.Signatures[0].Parameters.map((pr) => pr.Type) as readonly Known[]);
                // `map`'s result element type is the CALLBACK'S RETURN, which
                // is why it could not be claimed before the callback was typed
                // (F79 left it ~any~ deliberately). It is readable for a
                // concise-bodied arrow, whose body IS the returned expression,
                // with the callback's parameters in scope. A block-bodied
                // callback needs return-type inference the checker does not
                // have, and stays ~any~ - imprecise rather than wrong (F80).
                if (arg.type === 'ArrowFunction') {
                  const arrow = arg as unknown as { ConciseBody?: ParseNode, ArrowParameters?: readonly ParseNode[] };
                  const body = arrow.ConciseBody;
                  if (body && body.type !== 'FunctionBody') {
                    pushBlock(() => {
                      param.Signatures[0].Parameters.forEach((pr, pi) => {
                        const pt = pr.Type;
                        const p = arrow.ArrowParameters?.[pi];
                        if (pt && p && p.type === 'SingleNameBinding' && (p as ParseNode.SingleNameBinding).BindingIdentifier) {
                          declare((p as ParseNode.SingleNameBinding).BindingIdentifier!.name, pt);
                        }
                      });
                      const returned = staticType(body);
                      if (returned) {
                        callbackReturnTypes.set(c as unknown as ParseNode, returned);
                      }
                    });
                  }
                }
                return;
              }
              requireAssignable(staticTypeIn(arg, param), param);
            });
          }
        }
        walk(c.CallExpression);
        walk(c.Arguments);
        return;
      }
      case 'NewExpression': {
        const ne = n as unknown as { MemberExpression?: ParseNode, Arguments?: readonly ParseNode[] | null };
        const target = ne.MemberExpression;
        if (target && target.type === 'IdentifierReference' && Array.isArray(ne.Arguments)) {
          const instance = classTypeOf((target as { name: string }).name);
          const decl = instance && instance.Kind === 'nominal'
            ? (instance as unknown as { Declaration: ParseNode }).Declaration
            : null;
          const sig = decl ? constructSignatures.get(decl) : undefined;
          if (sig) {
            ne.Arguments.forEach((arg, i) => {
              if (i < sig.Parameters.length && arg.type !== 'AssignmentRestElement') {
                const p = sig.Parameters[i]?.Type;
                if (p) {
                  requireAssignable(staticTypeIn(arg, p), p);
                }
              }
            });
          }
        }
        walk(ne.MemberExpression);
        walk(ne.Arguments);
        return;
      }
      case 'LogicalANDExpression':
      case 'LogicalORExpression': {
        // The RIGHT operand is evaluated only where the left decided a way, so
        // it sees the binding narrowed - `x !== null && x.f` is the idiom this
        // exists for (F77). A disjunction narrows by the complement, since its
        // right operand runs where the left was false.
        const lg = n as unknown as { LogicalANDExpression?: ParseNode, LogicalORExpression?: ParseNode, BitwiseORExpression?: ParseNode, LogicalANDExpression_b?: ParseNode };
        const isAnd = n.type === 'LogicalANDExpression';
        const left = (isAnd ? lg.LogicalANDExpression : lg.LogicalORExpression) as ParseNode;
        const right = (isAnd
          ? lg.BitwiseORExpression
          : (n as unknown as { LogicalANDExpression: ParseNode }).LogicalANDExpression) as ParseNode;
        walkGuarded(left, isAnd ? right : null, isAnd ? null : right);
        return;
      }
      case 'ConditionalExpression': {
        // `t ? a : b` guards its two arms exactly as an `if` guards two
        // statements, so the same fact applies (F76).
        const c = n as unknown as { ShortCircuitExpression: ParseNode, AssignmentExpression_a: ParseNode, AssignmentExpression_b: ParseNode };
        walkGuarded(c.ShortCircuitExpression, c.AssignmentExpression_a, c.AssignmentExpression_b);
        return;
      }
      case 'WhileStatement': {
        // A `while` test guards its body on every iteration.
        const w = n as unknown as { Expression: ParseNode, Statement: ParseNode };
        walkGuarded(w.Expression, w.Statement, null);
        return;
      }
      case 'IfStatement': {
        // PHASE 4 of the checker plan: a test refines a binding's type in the
        // branch it guards. Without this the checker rejected the very idiom
        // the `is` operator exists for - `if (x is uint8) { let y: uint8 = x; }`
        // was a type error, because `x` kept its union type inside the branch
        // (F75). The narrowing operations themselves already existed; nothing
        // consulted them for a BINDING.
        const s = n as unknown as { Expression: ParseNode, Statement_a: ParseNode, Statement_b?: ParseNode | null };
        walkGuarded(s.Expression, s.Statement_a, s.Statement_b ?? null);
        return;
      }
      case 'AssignmentExpression': {
        const a = n as unknown as { LeftHandSideExpression: ParseNode, AssignmentExpression: ParseNode, AssignmentOperator: string };
        if (a.AssignmentOperator === '=' && a.LeftHandSideExpression.type === 'IdentifierReference') {
          // Checked against the DECLARED type, not the narrowed one: a binding
          // of `uint8 | string` may be assigned a string inside a branch that
          // narrowed it to `uint8`, and doing so ENDS the narrowing rather than
          // being an error (F78).
          const name = (a.LeftHandSideExpression as { name: string }).name;
          const target = lookupDeclared(name);
          requireAssignable(staticTypeIn(a.AssignmentExpression, target), target);
          invalidateNarrowing(name);
        } else if (a.AssignmentOperator === '=' && a.LeftHandSideExpression.type === 'MemberExpression') {
          // #table-check-sites rows 4 and 5, statically: a store whose target
          // has a known typed property or element type is the same shape as a
          // store to an annotated binding, so it is an Early Error where the
          // static types settle it and the run-time check remains the backstop
          // for the ~any~ path (F56). A class instance has no structural type
          // here, so `c.x = 300` for a class-typed `c` still waits on the
          // checker learning class field types.
          const m = a.LeftHandSideExpression as unknown as { MemberExpression?: ParseNode, IdentifierName?: { name: string } | null, Expression?: ParseNode | null };
          const objType = m.MemberExpression ? structureOf(staticType(m.MemberExpression)) : null;
          let target: Known = null;
          if (objType && objType.Kind === 'object' && m.IdentifierName) {
            const prop = objType.Properties.find((p) => p.key === (m.IdentifierName as { name: string }).name);
            // A store satisfies the property's WRITE type where one is declared
            // separately, which is what a setter's parameter gives (F61).
            target = prop ? ((prop as { writeType?: TypeRecord }).writeType ?? prop.type) : null;
          } else if (objType && objType.Kind === 'object' && m.Expression) {
            // A SYMBOL-keyed store, `m[k] = v`. The computed expression names a
            // symbol `const`, so it resolves to the same minted key the
            // declaration was recorded under - which is the whole point of
            // minting per declaration rather than per mention.
            const computed = m.Expression as { type?: string, name?: string };
            const declaration = computed.type === 'IdentifierReference' && typeof computed.name === 'string'
              ? symbolConsts.get(computed.name)
              : undefined;
            if (declaration) {
              const symbolKey = symbolKeyFor(declaration) as unknown as string;
              const prop = objType.Properties.find((p) => p.key === symbolKey);
              target = prop ? ((prop as { writeType?: TypeRecord }).writeType ?? prop.type) : null;
            }
          } else if (objType && objType.Kind === 'array' && m.Expression) {
            target = objType.Element;
          }
          if (target) {
            requireAssignable(staticTypeIn(a.AssignmentExpression, target), target);
          }
        }
        walk(a.LeftHandSideExpression);
        walk(a.AssignmentExpression);
        return;
      }
      case 'ReturnStatement': {
        const expr = (n as { Expression?: ParseNode | null }).Expression;
        const context = returnTypes[returnTypes.length - 1] ?? null;
        if (expr) {
          requireAssignable(staticTypeIn(expr, context), context);
          // The elision condition, per return. A `return` with NO expression
          // hands back *undefined*, which is the same unproven case as falling
          // off the end and is handled below.
          if (returnsProven.length > 0 && context) {
            const source = staticTypeIn(expr, context);
            if (!(source && source.Kind !== 'any' && source.Kind !== 'literal' && IsAssignable(source, context))) {
              returnsProven[returnsProven.length - 1] = false;
            }
          }
          walk(expr);
        } else if (returnsProven.length > 0 && context) {
          returnsProven[returnsProven.length - 1] = false;
        }
        return;
      }
      case 'FieldDefinition': {
        if (n.Initializer && n.TypeAnnotation) {
          const declared = resolveType(n.TypeAnnotation.Type);
          requireAssignable(staticTypeIn(n.Initializer, declared), declared);
        }
        walk(n.Initializer);
        return;
      }
      case 'FunctionDeclaration':
      case 'FunctionExpression':
        enterFunction(n.FormalParameters, n.TypeAnnotation ?? null, n.FunctionBody, true);
        return;
      case 'ArrowFunction':
        enterFunction(n.ArrowParameters, n.TypeAnnotation ?? null, n.ConciseBody as never, true, contextualParameterTypes.get(n));
        return;
      case 'MethodDefinition':
        enterFunction(n.UniqueFormalParameters, n.TypeAnnotation ?? null, n.FunctionBody, true);
        return;
      case 'GeneratorDeclaration':
      case 'GeneratorExpression':
      case 'AsyncFunctionDeclaration':
      case 'AsyncFunctionExpression':
      case 'AsyncGeneratorDeclaration':
      case 'AsyncGeneratorExpression':
      case 'AsyncArrowFunction':
      case 'GeneratorMethod':
      case 'AsyncMethod':
      case 'AsyncGeneratorMethod':
        // Return annotations of the ASYNC forms describe the promise a call
        // produces, and that judgment still arrives later. A GENERATOR's
        // annotation is read now (#sec-generator-types): it does not become the
        // frame's return type, since a `return` inside sets the generator's R,
        // but it is carried so that a `yield` can read the N it declares.
        {
          const gen = n.type === 'GeneratorDeclaration' || n.type === 'GeneratorExpression' || n.type === 'GeneratorMethod'
            || n.type === 'AsyncGeneratorDeclaration' || n.type === 'AsyncGeneratorExpression' || n.type === 'AsyncGeneratorMethod';
          const isAsyncGen = n.type === 'AsyncGeneratorDeclaration' || n.type === 'AsyncGeneratorExpression' || n.type === 'AsyncGeneratorMethod';
          const ann = (n as { TypeAnnotation?: ParseNode.TypeAnnotation | null }).TypeAnnotation;
          const declared = gen ? generatorDeclaredType(ann ? resolveType(ann.Type) : null, isAsyncGen) : null;
          enterFunction((n as { FormalParameters?: readonly ParseNode[] }).FormalParameters ?? (n as { UniqueFormalParameters?: readonly ParseNode[] }).UniqueFormalParameters ?? (n as { ArrowParameters?: readonly ParseNode[] }).ArrowParameters, null, (n as { FunctionBody?: ParseNode }).FunctionBody ?? (n as { GeneratorBody?: ParseNode }).GeneratorBody ?? (n as { AsyncFunctionBody?: ParseNode }).AsyncFunctionBody ?? (n as { AsyncGeneratorBody?: ParseNode }).AsyncGeneratorBody ?? (n as { AsyncConciseBody?: ParseNode }).AsyncConciseBody, false, undefined, declared);
        }
        return;
      default: {
        for (const key of Object.keys(n)) {
          if (key === 'parent' || key === 'location' || key === 'strict' || key === 'sourceText') {
            continue;
          }
          const child = (n as unknown as Record<string, unknown>)[key];
          if (Array.isArray(child) || (child && typeof child === 'object' && 'type' in (child as object))) {
            walk(child as ParseNode);
          }
        }
      }
    }
  };

  walk(statementList);
  deferredMetadataChecks.set(root, deferred);
  unclaimedKeyChecks.set(root, unclaimed);
  return errors;
}
