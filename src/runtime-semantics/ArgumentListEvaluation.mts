import {
  Value, Descriptor, ObjectValue, JSStringValue, wellKnownSymbols, type Arguments,
  ReferenceValue, ReferenceRunValue, UndefinedValue,
} from '../value.mts';
import { Evaluate, type PlainEvaluator } from '../evaluator.mts';
import { EnsureCompletion, Q, X } from '../completion.mts';
import { ConvertValue, soleSignatureParameterTypes } from '../abstract-ops/runtime-types.mts';
import { OutOfRange, isArray } from '../utils/language.mts';
import { registerTemplateArgument } from '../type-system/template-argument.mts';
import { TemplateStrings } from '../static-semantics/all.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { PrepareNamedArguments, CompleteNamedArguments, PositionalReferenceRuns, ReferenceRunsAdmitted, SetEmptyReferenceRuns, EmptyReferenceRunsOf, type ArgumentItem } from '../type-system/named-arguments.mts';
import { NamedCallArguments, NamedCallItemsOf, SetNamedParameterCounts, BuiltinNamedParametersOf } from '../abstract-ops/named-call.mts';
import { assignArguments, resolveOverloadChecked } from '../type-system/overloads.mts';
import { AssignRuntimeArguments } from '../abstract-ops/argument-distribution.mts';
import { RuntimeTypeOf, SpecializedFunctionSignatureOf, pushContextualType, popContextualType } from '../type-system/runtime.mts';
import { EvaluateResultValue, RetainArgumentResult, TransferResultDependency, SpreadConstructionOf, CaptureSpreadDataResult } from '../type-system/result-dependencies.mts';
import { anyType, type TypeRecord } from '../type-system/records.mts';
export { ArgumentContexts } from '../type-system/argument-construction.mts';
import {
  surroundingAgent,
  Assert,
  ArrayCreate,
  SetIntegrityLevel,
  ToString,
  GetIterator,
  GetIteratorFromMethod,
  IsComposite,
  IsArray,
  GetValue,
  Get,
  GetMethod,
  Throw,
  F,
  IteratorStepValue,
} from '#self';
import { BeginIteratorConstruction, CompleteIteratorConstruction, EndIteratorConstruction } from '../type-system/iteration-construction.mts';

/** https://tc39.es/ecma262/#sec-gettemplateobjec */
function GetTemplateObject(templateLiteral: ParseNode.TemplateLiteral) {
  // 1. Let realm be the current Realm Record.
  const realm = surroundingAgent.currentRealmRecord;
  // 2. Let templateRegistry be realm.[[TemplateMap]].
  const templateRegistry = realm.TemplateMap;
  // 3. For each element e of templateRegistry, do
  for (const e of templateRegistry) {
    // a. If e.[[Site]] is the same Parse Node as templateLiteral, then
    if (e.Site === templateLiteral) {
      // b. Return e.[[Array]].
      return e.Array;
    }
  }
  // 4. Let rawStrings be TemplateStrings of templateLiteral with argument true.
  const rawStrings = TemplateStrings(templateLiteral, true);
  // 5. Let cookedStrings be TemplateStrings of templateLiteral with argument false.
  const cookedStrings = TemplateStrings(templateLiteral, false);
  // 6. Let count be the number of elements in the List cookedStrings.
  const count = cookedStrings.length;
  // 7. Assert: count ≤ 232 - 1.
  Assert(count < (2 ** 32) - 1);
  // 8. Let template be ! ArrayCreate(count).
  const template = X(ArrayCreate(count));
  // 9. Let template be ! ArrayCreate(count).
  const rawObj = X(ArrayCreate(count));
  // 10. Let index be 0.
  let index = 0;
  // 11. Repeat, while index < count
  while (index < count) {
    // a. Let prop be ! ToString(𝔽(index)).
    const prop = X(ToString(F(index)));
    // b. Let cookedValue be the String value cookedStrings[index].
    const cookedValue = cookedStrings[index];
    // c. Call template.[[DefineOwnProperty]](prop, PropertyDescriptor { [[Value]]: cookedValue, [[Writable]]: false, [[Enumerable]]: true, [[Configurable]]: false }).
    X(template.DefineOwnProperty(prop, Descriptor({
      Value: cookedValue,
      Writable: Value.false,
      Enumerable: Value.true,
      Configurable: Value.false,
    })));
    // d. Let rawValue be the String value rawStrings[index].
    const rawValue = rawStrings[index];
    // e. Call rawObj.[[DefineOwnProperty]](prop, PropertyDescriptor { [[Value]]: rawValue, [[Writable]]: false, [[Enumerable]]: true, [[Configurable]]: false }).
    X(rawObj.DefineOwnProperty(prop, Descriptor({
      Value: rawValue,
      Writable: Value.false,
      Enumerable: Value.true,
      Configurable: Value.false,
    })));
    // f. Call rawObj.[[DefineOwnProperty]](prop, PropertyDescriptor { [[Value]]: rawValue, [[Writable]]: false, [[Enumerable]]: true, [[Configurable]]: false }).
    index += 1;
  }
  // 12. Perform SetIntegrityLevel(rawObj, frozen).
  X(SetIntegrityLevel(rawObj, 'frozen'));
  // 13. Perform SetIntegrityLevel(rawObj, frozen).
  X(template.DefineOwnProperty(Value('raw'), Descriptor({
    Value: rawObj,
    Writable: Value.false,
    Enumerable: Value.false,
    Configurable: Value.false,
  })));
  // 14. Perform SetIntegrityLevel(template, frozen).
  X(SetIntegrityLevel(template, 'frozen'));
  // 15. Append the Record { [[Site]]: templateLiteral, [[Array]]: template } to templateRegistry.
  templateRegistry.push({ Site: templateLiteral, Array: template });
  if (surroundingAgent.feature('runtime-types')) registerTemplateArgument(template, cookedStrings);
  // 16. Return template.
  return template;
}

/** https://tc39.es/ecma262/#sec-template-literals-runtime-semantics-argumentlistevaluation */
//   TemplateLiteral : NoSubstitutionTemplate
//
// https://github.com/tc39/ecma262/pull/1402
//   TemplateLiteral : SubstitutionTemplate
function* ArgumentListEvaluation_TemplateLiteral(TemplateLiteral: ParseNode.TemplateLiteral): PlainEvaluator<Arguments> {
  switch (true) {
    case TemplateLiteral.TemplateSpanList.length === 1: {
      const templateLiteral = TemplateLiteral;
      const siteObj = GetTemplateObject(templateLiteral);
      return [siteObj] as Arguments;
    }

    case TemplateLiteral.TemplateSpanList.length > 1: {
      const templateLiteral = TemplateLiteral;
      const siteObj = GetTemplateObject(templateLiteral);
      const restSub = [];
      for (const Expression of TemplateLiteral.ExpressionList) {
        const subRef = Q(yield* Evaluate(Expression));
        const subValue = Q(yield* GetValue(subRef));
        restSub.push(subValue);
      }
      return [siteObj, ...restSub] as Arguments;
    }

    default:
      throw OutOfRange.nonExhaustive(TemplateLiteral);
  }
}

/** https://tc39.es/ecma262/#sec-argument-lists-runtime-semantics-argumentlistevaluation */
//   Arguments : `(` `)`
//   ArgumentList :
//     AssignmentExpression
//     `...` AssignmentExpression
//     ArgumentList `,` AssignmentExpression
//     ArgumentList `,` `...` AssignmentExpression
//
// (implicit)
//   Arguments :
//     `(` ArgumentList `)`
//     `(` ArgumentList `,` `)`
function* ArgumentListEvaluation_Arguments(Arguments: ParseNode.Arguments, contexts?: ReadonlyMap<object, TypeRecord>): PlainEvaluator<Arguments> {
  // Runtime spread mode depends on the evaluated value, including variables,
  // calls and properties. Keep the base-language/no-spread path allocation-light.
  if (surroundingAgent.feature('runtime-types')
      && Arguments.some((element) => element.type === 'AssignmentRestElement' || element.type === 'NamedArgument')) {
    const items = Q(yield* ArgumentListEvaluationItems(Arguments, contexts));
    if (items.some((item) => item.name !== undefined || item.referenceRun) || EmptyReferenceRunsOf(items).length) {
      return NamedCallArguments(items);
    }
    const values = items.map((item) => item.value);
    items.forEach((item, index) => RetainArgumentResult(values, index, item));
    return values as Arguments;
  }
  const precedingArgs: Value[] = [];
  let forwardedIndices: Set<number> | undefined;
  const emptyRuns: number[] = [];
  for (const element of Arguments) {
    if (element.type === 'AssignmentRestElement') {
      const { AssignmentExpression } = element;
      // 2. Let spreadRef be the result of evaluating AssignmentExpression.
      const spreadRef = Q(yield* Evaluate(AssignmentExpression));
      // 3. Let spreadObj be ? GetValue(spreadRef).
      const spreadObj = Q(yield* GetValue(spreadRef));
      // `...refs` FORWARDS a ref run - each location becomes a ref argument
      // of this call, the one way a run moves without any reference escaping.
      if (spreadObj instanceof ReferenceRunValue) {
        forwardedIndices ??= new Set();
        if (spreadObj.Locations.length === 0) emptyRuns.push(precedingArgs.length);
        for (const location of spreadObj.Locations) {
          const value = new ReferenceValue(location);
          precedingArgs.push(value);
          forwardedIndices.add(precedingArgs.length - 1);
        }
        continue;
      }
      // 4. Let iteratorRecord be ? GetIterator(spreadObj).
      const iteratorRecord = Q(yield* GetIterator(spreadObj, 'sync'));
      // 5. Repeat,
      while (true) {
        // a. Let next be ? IteratorStepValue(iteratorRecord).
        const next = Q(yield* IteratorStepValue(iteratorRecord));
        // b. If next is false, return list.
        if (next === 'done') {
          break;
        }
        // d. Append next as the last element of list.
        precedingArgs.push(next);
      }
    } else if ((element as { type?: string }).type === 'NamedArgument') {
      // A named argument does not reach the positional path: a call with named
      // arguments is evaluated by ArgumentListEvaluationNamed against the callee's
      // parameters. This branch keeps the positional evaluation total.
      Assert(false, 'named argument in positional argument evaluation');
    } else {
      const AssignmentExpression = element as ParseNode.AssignmentExpressionOrHigher;
      const result = EnsureCompletion(yield* EvaluateArgument(AssignmentExpression, contexts));
      if (result.Type !== 'normal') return result;
      precedingArgs.push(result.Value);
      RetainArgumentResult(precedingArgs, precedingArgs.length - 1, result);
      // 5. Return precedingArgs.
    }
  }
  if (forwardedIndices) {
    const items = precedingArgs.map((value, i) => ({ value, referenceRun: forwardedIndices.has(i) }));
    SetEmptyReferenceRuns(items, emptyRuns);
    return NamedCallArguments(items);
  }
  return precedingArgs as Arguments;
}

export function ArgumentListEvaluation(ArgumentsOrTemplateLiteral: ParseNode.TemplateLiteral | ParseNode.Arguments, contexts?: ReadonlyMap<object, TypeRecord>) {
  switch (true) {
    case isArray(ArgumentsOrTemplateLiteral):
      return ArgumentListEvaluation_Arguments(ArgumentsOrTemplateLiteral, contexts);
    case ('type' in ArgumentsOrTemplateLiteral && ArgumentsOrTemplateLiteral.type === 'TemplateLiteral'):
      return ArgumentListEvaluation_TemplateLiteral(ArgumentsOrTemplateLiteral);
    default:
      throw OutOfRange.nonExhaustive(ArgumentsOrTemplateLiteral);
  }
}

/**
 * Intrinsic interceptions without a named binding contract must not erase names
 * or forwarding provenance by reading the raw value array as positional input.
 * Their ordinary positional behavior remains unchanged.
 */
export function* PositionalArgumentListEvaluation(args: ParseNode.Arguments): PlainEvaluator<Arguments> {
  const values = Q(yield* ArgumentListEvaluation_Arguments(args));
  if (NamedCallItemsOf(values)) return Throw.TypeError('this call requires positional arguments');
  return values;
}

/**
 * The parameters of a function as named-argument resolution reads them: each
 * parameter's name and whether it may be omitted (it is optional, has a default,
 * or is the rest parameter), with the index of a rest parameter where present. A
 * named or object-spread call may omit a parameter only where it may be omitted;
 * a required parameter left unfilled is an error, since named arguments skip
 * defaulted parameters rather than required ones.
 */
export function parameterInfo(func: Value): { names: string[], omittable: boolean[], rests: boolean[], refs: boolean[], restIndex: number } {
  // A specialization is a builtin wrapper, not an ECMAScript closure with
  // FormalParameters. Its completed signature preserves names and omissions;
  // the original callee still owns ordinary parameter-default evaluation.
  const specialized = SpecializedFunctionSignatureOf(func);
  if (specialized) return parameterInfoOfSignature(specialized);
  const builtin = BuiltinNamedParametersOf(func);
  if (builtin) return {
    names: builtin.map((p) => p.Name), omittable: builtin.map((p) => p.Optional === true),
    rests: builtin.map(() => false), refs: builtin.map(() => false), restIndex: -1,
  };
  const formals = ((func as { FormalParameters?: readonly ParseNode[] }).FormalParameters ?? []);
  const names: string[] = [];
  const omittable: boolean[] = [];
  const rests: boolean[] = [];
  const refs: boolean[] = [];
  let restIndex = -1;
  formals.forEach((p, i) => {
    const node = p as {
      type?: string,
      BindingIdentifier?: { name?: string },
      Optional?: boolean,
      Ref?: boolean,
      Initializer?: unknown,
      TypedInitializer?: unknown,
    };
    rests.push(node.type === 'BindingRestElement');
    refs.push(node.Ref === true);
    if (node.type === 'BindingRestElement') {
      restIndex = i;
      names.push(node.BindingIdentifier?.name ?? '');
      omittable.push(true);
    } else {
      names.push(node.BindingIdentifier?.name ?? '');
      const hasDefault = (node.Initializer !== undefined && node.Initializer !== null)
        || (node.TypedInitializer !== undefined && node.TypedInitializer !== null);
      omittable.push(node.Optional === true || hasDefault);
    }
  });
  return { names, omittable, rests, refs, restIndex };
}

/**
 * The same, read off a SIGNATURE in view rather than the callee's own parameter
 * list. #sec-named-arguments: a call is bound "to the parameters of the
 * selected signature"; where the callee is reached through a binding whose
 * declared type is a function type or an interface of call signatures, that type's
 * signature is the declaration the call site reads - the callee's own names are
 * not in view and need not agree (README, "Function Interfaces": "if an interface
 * is used then the name can be changed in the passed in function"). Its defaults
 * are what fill a skipped position, so the callee receives a full positional
 * list and its own defaults never engage. Several signatures are judged
 * against the same evaluated argument items before one mapping is selected.
 */
type SignatureInView = { Return?: TypeRecord | null, Parameters: readonly { Name: string, Type?: unknown, Optional: boolean, Rest: boolean, Ref?: boolean, Initial?: Value }[] };

function parameterInfoOfSignature(sig: SignatureInView): { names: string[], omittable: boolean[], rests: boolean[], refs: boolean[], restIndex: number, initials: (Value | undefined)[], types: unknown[] } {
  const names: string[] = [];
  const omittable: boolean[] = [];
  const rests: boolean[] = [];
  const refs: boolean[] = [];
  const initials: (Value | undefined)[] = [];
  const types: unknown[] = [];
  let restIndex = -1;
  sig.Parameters.forEach((p, i) => {
    names.push(p.Name);
    rests.push(p.Rest);
    refs.push(p.Ref === true);
    if (p.Rest) {
      restIndex = i;
    }
    omittable.push(p.Rest || p.Optional || p.Initial !== undefined);
    initials.push(p.Initial);
    types.push(p.Type);
  });
  return { names, omittable, rests, refs, restIndex, initials, types };
}

/** Callable views supply candidate names/defaults, never a replacement callee. */
export function signaturesInView(declaredType: unknown): readonly SignatureInView[] | undefined {
  type ViewType = { Kind?: string, Name?: string, Structure?: ViewType, Members?: readonly ViewType[], Signatures?: readonly SignatureInView[] };
  let t = declaredType as ViewType | undefined;
  const seen = new Set<ViewType>();
  while (t && !seen.has(t)) {
    seen.add(t);
    if (t.Kind === 'nominal') t = t.Structure;
    else if (t.Kind === 'union') {
      // Nullish members cannot supply a callable. The sole remaining view
      // still owns names/defaults after the caller proves it is present.
      // Several callable alternatives are not an overload group.
      const members = t.Members?.filter((m) => !(m.Kind === 'primitive' && (m.Name === 'undefined' || m.Name === 'null')));
      if (members?.length !== 1) return undefined;
      [t] = members;
    } else break;
  }
  return t?.Kind === 'function' && t.Signatures?.length ? t.Signatures : undefined;
}


function* EvaluateArgument(node: ParseNode.AssignmentExpressionOrHigher, contexts?: ReadonlyMap<object, TypeRecord>) {
  // Callers that already establish a context keep their ordinary behaviour.
  // An explicit map owns every argument position, including absent entries.
  if (contexts === undefined) return yield* EvaluateResultValue(node);
  pushContextualType(contexts.get(node) ?? null, node);
  try {
    return yield* EvaluateResultValue(node);
  } finally {
    popContextualType();
  }
}

/** Evaluate source-order argument items once, before an overload binds their names. */
export function* ArgumentListEvaluationItems(args: ParseNode.Arguments, contexts?: ReadonlyMap<object, TypeRecord>): PlainEvaluator<ArgumentItem<Value>[]> {
  const items: ArgumentItem<Value>[] = [];
  const emptyRuns: number[] = [];

  for (const element of args) {
    if ((element as { type?: string }).type === 'NamedArgument') {
      const named = element as ParseNode.NamedArgument;
      const result = EnsureCompletion(yield* EvaluateArgument(named.AssignmentExpression, contexts));
      if (result.Type !== 'normal') return result;
      items.push(TransferResultDependency(result, { name: named.Name, value: result.Value }));
    } else if ((element as { type?: string }).type === 'AssignmentRestElement') {
      const { AssignmentExpression } = element as ParseNode.AssignmentRestElement;
      const spreadResult = EnsureCompletion(yield* EvaluateArgument(AssignmentExpression, contexts));
      if (spreadResult.Type !== 'normal') return spreadResult;
      const spreadObj = spreadResult.Value;
      if (spreadObj instanceof ReferenceRunValue) {
        if (spreadObj.Locations.length === 0) emptyRuns.push(items.length);
        for (const location of spreadObj.Locations) items.push({ value: new ReferenceValue(location), referenceRun: true });
        continue;
      }
      // Tuple composites iterate by kind without an observable method lookup.
      // Other objects select exactly once; a nullish hook chooses named keys,
      // and a present non-callable hook throws rather than changing protocols.
      const tupleComposite = IsComposite(spreadObj) && IsArray(spreadObj) === Value.true;
      const method = spreadObj instanceof ObjectValue && !tupleComposite
        ? Q(yield* GetMethod(spreadObj, wellKnownSymbols.iterator))
        : Value.undefined;
      if (spreadObj instanceof ObjectValue && !tupleComposite && method === Value.undefined) {
        const construction = SpreadConstructionOf(spreadResult, spreadObj);
        const keys = Q(yield* spreadObj.OwnPropertyKeys());
        for (const key of keys) {
          if (!(key instanceof JSStringValue)) continue;
          const desc = Q(yield* spreadObj.GetOwnProperty(key));
          if (!(desc instanceof Descriptor) || desc.Enumerable !== Value.true) continue;
          const result = EnsureCompletion(yield* Get(spreadObj, key));
          if (result.Type !== 'normal') return result;
          CaptureSpreadDataResult(construction, key, result.Value, result);
          items.push(TransferResultDependency(result, { name: key.stringValue(), value: result.Value }));
        }
      } else {
        let iteratorRecord;
        if (method instanceof UndefinedValue) iteratorRecord = Q(yield* GetIterator(spreadObj, 'sync'));
        else iteratorRecord = Q(yield* GetIteratorFromMethod(spreadObj, method));
        const construction = spreadObj instanceof ObjectValue ? SpreadConstructionOf(spreadResult, spreadObj) : undefined;
        while (true) {
          const frame = BeginIteratorConstruction(iteratorRecord, spreadObj, construction);
          try {
            const next = EnsureCompletion(yield* IteratorStepValue(iteratorRecord));
            if (next.Type !== 'normal') return next;
            if (next.Value === 'done') break;
            CompleteIteratorConstruction(frame, next.Value, next);
            items.push(TransferResultDependency(next, { value: next.Value }));
          } finally {
            EndIteratorConstruction(frame);
          }
        }
      }
    } else {
      const result = EnsureCompletion(yield* EvaluateArgument(element as ParseNode.AssignmentExpressionOrHigher, contexts));
      if (result.Type !== 'normal') return result;
      items.push(TransferResultDependency(result, { value: result.Value }));
    }
  }

  SetEmptyReferenceRuns(items, emptyRuns);
  return items;
}

/** Bind once-evaluated named contributions or reference forwarding occurrences. */
export function* BindCallArgumentItems(items: readonly ArgumentItem<Value>[], func: Value, signatureOrViews?: SignatureInView | readonly SignatureInView[], contextualType?: TypeRecord): PlainEvaluator<Arguments> {
  let signature: SignatureInView | undefined;
  let selectedGroups: readonly number[][] | undefined;
  if (Array.isArray(signatureOrViews)) {
    if (signatureOrViews.length === 1) signature = signatureOrViews[0];
    else {
      const candidates = signatureOrViews.map((s) => ({ Parameters: s.Parameters, ReturnType: s.Return ?? undefined, Function: Value.undefined }));
      const resolution = Q(yield* resolveOverloadChecked(candidates as never, items.map((item) => item.value), contextualType, items));
      if (resolution.Kind === 'none') return Throw.TypeError('no overload of $1 matches these arguments', func);
      if (resolution.Kind === 'ambiguous') return Throw.TypeError('the call to $1 is ambiguous between overloads', func);
      signature = signatureOrViews[candidates.indexOf(resolution.Signature as never)];
      selectedGroups = resolution.Groups;
    }
  } else signature = signatureOrViews as SignatureInView | undefined;
  if (!signature && (func as { OverloadFunctions?: readonly Value[] }).OverloadFunctions?.length) {
    return NamedCallArguments(items);
  }
  const info = signature ? parameterInfoOfSignature(signature) : { ...parameterInfo(func), initials: [] as (Value | undefined)[], types: [] as unknown[] };
  const { names, omittable, rests, refs, initials } = info;
  const types = signature ? info.types : (Q(yield* soleSignatureParameterTypes(func)) ?? []);

  const parameters = names.map((Name, i) => ({
    Name, Rest: rests[i], Ref: refs[i], Optional: omittable[i], Type: (types[i] ?? anyType) as TypeRecord,
  }));
  const plan = PrepareNamedArguments(parameters, items);
  let counts: readonly number[] | null = null;
  if (!plan.error && !selectedGroups) {
    const slots = plan.remaining.map(({ p }) => p);
    if (plan.positional.some((value) => value instanceof ReferenceValue) || slots.some((p) => p.Ref || p.Type.Kind === 'reference')) {
      counts = Q(yield* AssignRuntimeArguments(slots, plan.positional, PositionalReferenceRuns(items)));
    } else {
      const argumentTypes = plan.positional.map((value): TypeRecord => {
        const type = RuntimeTypeOf(value);
        return value instanceof ObjectValue ? type : { Kind: 'literal', Base: type, Value: value };
      });
      counts = assignArguments(slots, argumentTypes);
    }
  }
  const placed = selectedGroups ? { groups: selectedGroups.map((group) => group.map((i) => items[i].value)), error: undefined } : CompleteNamedArguments(plan, counts);
  if (placed.error === 'unknown-name') {
    return Throw.TypeError('no parameter named $1 for this call', Value(placed.name!));
  }
  if (placed.error) {
    return Throw.TypeError('the named arguments do not satisfy the signature in view');
  }
  const indexPlan = PrepareNamedArguments(parameters, items.map((item, i) => ({ ...item, value: i })));
  const indexGroups = selectedGroups ?? CompleteNamedArguments(indexPlan, counts).groups;
  if (!ReferenceRunsAdmitted(parameters, items, indexGroups)) {
    return Throw.TypeError('$1', Value('a ref rest binds no array: forward it into a ref rest parameter'));
  }
  const result: Value[] = [];
  const nativeOmissions = !signature && BuiltinNamedParametersOf(func) !== undefined;
  const lastSupplied = placed.groups.findLastIndex((group) => group.length > 0);
  for (let i = 0; i < names.length; i += 1) {
    const values = placed.groups[i];
    if (values.length === 0 && !rests[i]) {
      if (!omittable[i]) {
        return Throw.TypeError('no argument for the required parameter $1', Value(names[i]));
      }
      // Native algorithms can distinguish absence from explicit undefined
      // (reduce's initial accumulator). Only interior gaps need placeholders.
      // A declared callable view still owns its existing default/arity rules.
      if (nativeOmissions && i > lastSupplied) continue;
      // Positional forwarding supplies no placeholder for an omitted default.
      // Its zero count reaches ordinary final binding without changing arity.
      if (signature || items.some((item) => item.name !== undefined)) values.push(initials[i] ?? Value.undefined);
    }
    for (let offset = 0; offset < values.length; offset += 1) {
      let value = values[offset];
      const type = types[i] as TypeRecord | undefined;
      if (signature && !rests[i] && type && type.Kind !== 'any'
          && !(value instanceof ObjectValue) && !(value instanceof ReferenceValue) && value !== Value.undefined) {
        value = Q(yield* ConvertValue(value, type));
      }
      result.push(value);
      const sourceIndex = indexGroups[i][offset];
      if (sourceIndex !== undefined && items[sourceIndex].value === value) {
        RetainArgumentResult(result, result.length - 1, items[sourceIndex]);
      }
    }
  }
  if (!signature) SetNamedParameterCounts(result, func, placed.groups.map((group) => group.length));
  return result as Arguments;
}
