import { BigIntValue, NumberValue, Value, type ObjectValue } from '../value.mts';
import type { ThrowCompletion } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import {
  builtinTypeRecord, libraryTypeRecord, displayType, makePrimitive, voidType, type TypeRecord,
} from './records.mts';
import { IsAssignable } from './relations.mts';
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
  readonly aliases: Map<string, TypeRecord>;
  // Enum declarations in scope, by enum name, and the bindings known to hold an
  // enumerator of one, by variable name to enum name.
  readonly enums: Map<string, EnumInfo>;
  readonly enumBindings: Map<string, string>;
}


function widen(t: TypeRecord): TypeRecord {
  return t.Kind === 'literal' ? t.Base : t;
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
        && ['uint', 'int', 'float16', 'float32', 'float64'].includes(target.Name)
        && source.Value instanceof NumberValue
        && fitsNumericType(R(source.Value) as number, target.Name, target.Arguments)) {
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
  const classTypeMemo = new Map<ParseNode, Known>();
  const classTypesInProgress = new Set<ParseNode>();
  const classTypeOf = (name: string): Known => {
    const node = classNodes.get(name);
    return node ? instanceTypeOf(node) : null;
  };
  /** Construct signatures by class node, for checking `new C(...)` (F59). */
  const constructSignatures = new Map<ParseNode, { Parameters: Known[], Shapes: { Optional: boolean, Rest: boolean, HasDefault: boolean }[] }>();

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
        return builtinTypeRecord(name) ?? libraryTypeRecord(name) ?? lookupAlias(name) ?? classTypeOf(name);
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
        const Parameters = [];
        for (const p of node.FunctionTypeParameterList) {
          const pt = (p as { TypeAnnotation?: ParseNode.TypeAnnotation | null }).TypeAnnotation;
          const r = pt ? resolveType(pt.Type) : { Kind: 'any' as const };
          if (!r) {
            return null;
          }
          Parameters.push(r);
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

  const staticType = (node: ParseNode): Known => {
    switch (node.type) {
      case 'NumericLiteral':
        return { Kind: 'literal', Value: Value((node as { value: number }).value), Base: makePrimitive('number') };
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
        // A call's static type is the callee function type's return, when
        // known; the argument check happens in the walk.
        const callee = staticType((node as { CallExpression: ParseNode }).CallExpression);
        if (callee && callee.Kind === 'function' && callee.Signatures.length === 1) {
          return callee.Signatures[0].Return;
        }
        return null;
      }
      case 'MemberExpression': {
        const m = node as { MemberExpression?: ParseNode, IdentifierName?: { name: string } | null, Expression?: ParseNode | null };
        if (m.IdentifierName && m.MemberExpression) {
          const objType = structureOf(staticType(m.MemberExpression));
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
    const Properties: { key: string, type: TypeRecord, optional: boolean }[] = [];
    // Methods, accumulated per name because a method may be OVERLOADED exactly
    // as a function may (F59). A getter contributes its return type as the
    // property's type, since that is what reading the property yields; a setter
    // contributes nothing yet, and is the natural next step for checking a
    // store through an accessor.
    const methods = new Map<string, { Parameters: Known[], Return: Known, Shapes: { Optional: boolean, Rest: boolean, HasDefault: boolean }[], Untyped: boolean }[]>();
    const unusable = new Set<string>();
    let construct: { Parameters: Known[], Shapes: { Optional: boolean, Rest: boolean, HasDefault: boolean }[] } | null = null;
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
          const cparams: Known[] = [];
          const cshapes: { Optional: boolean, Rest: boolean, HasDefault: boolean }[] = [];
          let cusable = true;
          for (const p of md.UniqueFormalParameters ?? []) {
            if (p.type !== 'SingleNameBinding' && p.type !== 'BindingElement') {
              cusable = false;
              break;
            }
            const pp = p as { TypeAnnotation?: ParseNode.TypeAnnotation | null, Initializer?: ParseNode | null, Optional?: boolean };
            cparams.push(pp.TypeAnnotation ? resolveType(pp.TypeAnnotation.Type) : null);
            cshapes.push({ Optional: pp.Optional === true, Rest: false, HasDefault: !!pp.Initializer });
          }
          if (cusable) {
            construct = { Parameters: cparams, Shapes: cshapes };
          }
          continue;
        }
        if (md.PropertySetParameterList) {
          continue;
        }
        if (!md.UniqueFormalParameters) {
          // A getter: the property reads at its declared return type.
          const t = md.TypeAnnotation ? resolveType(md.TypeAnnotation.Type) : null;
          if (t) {
            Properties.push({ key, type: t, optional: false });
          }
          continue;
        }
        const Parameters: Known[] = [];
        const shapes: { Optional: boolean, Rest: boolean, HasDefault: boolean }[] = [];
        let usable = true;
        for (const p of md.UniqueFormalParameters) {
          if (p.type !== 'SingleNameBinding' && p.type !== 'BindingElement') {
            usable = false;
            break;
          }
          const pp = p as { TypeAnnotation?: ParseNode.TypeAnnotation | null, Initializer?: ParseNode | null, Optional?: boolean };
          Parameters.push(pp.TypeAnnotation ? resolveType(pp.TypeAnnotation.Type) : null);
          shapes.push({ Optional: pp.Optional === true, Rest: false, HasDefault: !!pp.Initializer });
        }
        if (!usable) {
          unusable.add(key);
          continue;
        }
        const Return = md.TypeAnnotation ? resolveType(md.TypeAnnotation.Type) : null;
        const Untyped = !md.TypeAnnotation && Parameters.every((t) => t === null);
        const sigs = methods.get(key) ?? [];
        sigs.push({ Parameters, Return, Shapes: shapes, Untyped });
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
    const heritage = (cls.ClassTail as { ClassHeritage?: ParseNode | null } | null | undefined)?.ClassHeritage;
    const baseName = heritage && (heritage as { type?: string, name?: string }).type === 'IdentifierReference'
      ? (heritage as { name: string }).name
      : null;
    const base = baseName ? classTypeOf(baseName) : null;
    const baseStructure = base && base.Kind === 'nominal'
      ? (base as unknown as { Structure?: { Kind: string, Properties: readonly { key: string, type: TypeRecord, optional: boolean }[] } }).Structure
      : null;
    const merged = baseStructure && baseStructure.Kind === 'object'
      ? [...baseStructure.Properties.filter((p) => !Properties.some((own) => own.key === p.key)), ...Properties]
      : Properties;
    const instance = {
      Kind: 'nominal',
      Declaration: n,
      Arguments: [],
      Structure: { Kind: 'object', Properties: merged, IndexSignatures: [] },
    } as unknown as Known;
    if (construct) {
      constructSignatures.set(n, construct);
    }
    return instance;
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
    const collected = new Map<string, { Parameters: Known[], Return: Known, Shapes: { Optional: boolean, Rest: boolean, HasDefault: boolean }[], Untyped: boolean }[]>();
    const rejected = new Set<string>();
    for (const n of list) {
      if (n.type !== 'FunctionDeclaration') {
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
      const Parameters: Known[] = [];
      const shapes: { Optional: boolean, Rest: boolean, HasDefault: boolean }[] = [];
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
        Parameters.push(pp.TypeAnnotation ? resolveType(pp.TypeAnnotation.Type) : null);
        shapes.push({ Optional: pp.Optional === true, Rest: false, HasDefault: !!pp.Initializer });
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
      const Untyped = !fn.TypeAnnotation && Parameters.every((t) => t === null);
      signatures.push({ Parameters, Return, Shapes: shapes, Untyped });
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
      }
    }
  };

  const declare = (name: string, t: Known) => {
    if (t) {
      frames[frames.length - 1].bindings.set(name, t);
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
      declare(b.BindingIdentifier.name, declared);
    } else if (b.Initializer) {
      walk(b.Initializer);
    }
  };

  const enterFunction = (params: readonly ParseNode[] | null | undefined, returnAnnotation: ParseNode.TypeAnnotation | null | undefined, body: ParseNode | readonly ParseNode[] | null | undefined, checkReturns: boolean) => {
    frames.push({ bindings: new Map(), aliases: new Map(), enums: new Map(), enumBindings: new Map() });
    returnTypes.push(checkReturns && returnAnnotation ? resolveType(returnAnnotation.Type) : null);
    for (const p of params ?? []) {
      if (p.type === 'SingleNameBinding' || p.type === 'BindingElement') {
        walkBindingElement(p);
      }
    }
    if (body) {
      walk(body);
    }
    returnTypes.pop();
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
        resolveType(ie.Type);
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
      case 'SwitchStatement': {
        // proposal-runtime-types (spec sec-enums, sec-narrowing): a switch over an
        // enumerator must label its cases with enumerators of that enum, and a
        // switch with no default must cover every enumerator. The discriminant is
        // enum-typed when it is a binding tracked as holding an enumerator.
        const disc = n.Expression;
        const discName = disc.type === 'IdentifierReference' ? (disc as { name: string }).name : null;
        const enumName = discName ? lookupEnumBinding(discName) : null;
        const info = enumName ? lookupEnum(enumName) : null;
        if (info) {
          const block = n.CaseBlock;
          const clauses: ParseNode.CaseClause[] = [
            ...(block.CaseClauses_a ?? []),
            ...(block.CaseClauses_b ?? []),
          ] as ParseNode.CaseClause[];
          const covered = new Set<string>();
          for (const clause of clauses) {
            const label = clause.Expression;
            // A valid label is `EnumName.Member`. Any other label in an enum
            // switch is not an enumerator of the enum and is a type error.
            let member: string | null = null;
            let labelEnum: string | null = null;
            if (label.type === 'MemberExpression') {
              const m = label as { MemberExpression?: ParseNode, IdentifierName?: { name: string } | null };
              if (m.MemberExpression && m.MemberExpression.type === 'IdentifierReference' && m.IdentifierName) {
                labelEnum = (m.MemberExpression as { name: string }).name;
                member = m.IdentifierName.name;
              }
            }
            if (member === null || labelEnum !== enumName || !info.names.includes(member)) {
              const shown = member !== null && labelEnum !== null ? `${labelEnum}.${member}` : 'a non-enumerator case';
              const completion = Throw.TypeError('$1 is not a case of enum $2', Value(shown), Value(enumName!)) as ThrowCompletion;
              errors.push(completion.Value as ObjectValue);
            } else {
              covered.add(member);
            }
          }
          const hasDefault = block.DefaultClause !== undefined && block.DefaultClause !== null;
          if (!hasDefault) {
            const missing = info.names.filter((nm) => !covered.has(nm));
            if (missing.length > 0) {
              const completion = Throw.TypeError('switch over enum $1 is missing $2 and has no default', Value(enumName!), Value(missing.join(', '))) as ThrowCompletion;
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
          let sig: { Parameters: readonly Known[] } | null = callee.Signatures.length === 1 ? callee.Signatures[0] : null;
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
              const candidates = callee.Signatures.map((s) => ({
                Parameters: ((s as unknown as { Shapes?: { Optional: boolean, Rest: boolean, HasDefault: boolean }[] }).Shapes ?? []).map((shape, i) => ({
                  Type: (s.Parameters[i] ?? { Kind: 'any' }) as TypeRecord,
                  ...shape,
                })),
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
              if (i < chosen.Parameters.length && arg.type !== 'AssignmentRestElement') {
                requireAssignable(staticTypeIn(arg, chosen.Parameters[i]), chosen.Parameters[i]);
              }
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
                const p = sig.Parameters[i];
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
      case 'AssignmentExpression': {
        const a = n as unknown as { LeftHandSideExpression: ParseNode, AssignmentExpression: ParseNode, AssignmentOperator: string };
        if (a.AssignmentOperator === '=' && a.LeftHandSideExpression.type === 'IdentifierReference') {
          const target = lookup((a.LeftHandSideExpression as { name: string }).name);
          requireAssignable(staticTypeIn(a.AssignmentExpression, target), target);
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
            target = prop ? prop.type : null;
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
        if (expr) {
          const context = returnTypes[returnTypes.length - 1] ?? null;
          requireAssignable(staticTypeIn(expr, context), context);
          walk(expr);
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
        enterFunction(n.ArrowParameters, n.TypeAnnotation ?? null, n.ConciseBody as never, true);
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
        // Return annotations of generator and async forms describe the
        // produced iterator or promise; those judgments arrive later.
        enterFunction((n as { FormalParameters?: readonly ParseNode[] }).FormalParameters ?? (n as { UniqueFormalParameters?: readonly ParseNode[] }).UniqueFormalParameters ?? (n as { ArrowParameters?: readonly ParseNode[] }).ArrowParameters, null, (n as { FunctionBody?: ParseNode }).FunctionBody ?? (n as { GeneratorBody?: ParseNode }).GeneratorBody ?? (n as { AsyncFunctionBody?: ParseNode }).AsyncFunctionBody ?? (n as { AsyncGeneratorBody?: ParseNode }).AsyncGeneratorBody ?? (n as { AsyncConciseBody?: ParseNode }).AsyncConciseBody, false);
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
