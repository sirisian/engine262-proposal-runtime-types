import {
  Value, Descriptor, ObjectValue, JSStringValue, wellKnownSymbols, type Arguments,
  ReferenceValue, ReferenceRunValue,
} from '../value.mts';
import { Evaluate, type PlainEvaluator } from '../evaluator.mts';
import { Q, X } from '../completion.mts';
import { ConvertValue, soleSignatureParameterTypes } from '../abstract-ops/runtime-types.mts';
import { OutOfRange, isArray } from '../utils/language.mts';
import { registerTemplateArgument } from '../type-system/template-argument.mts';
import { TemplateStrings } from '../static-semantics/all.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { PrepareNamedArguments, CompleteNamedArguments, PositionalReferenceRuns, ReferenceRunsAdmitted, SetEmptyReferenceRuns, type ArgumentItem } from '../type-system/named-arguments.mts';
import { NamedCallArguments, NamedCallItemsOf, SetNamedParameterCounts } from '../abstract-ops/named-call.mts';
import { assignArguments, resolveOverloadChecked } from '../type-system/overloads.mts';
import { AssignRuntimeArguments } from '../abstract-ops/argument-distribution.mts';
import { RuntimeTypeOf, SpecializedFunctionSignatureOf } from '../type-system/runtime.mts';
import { anyType, type TypeRecord } from '../type-system/records.mts';
import {
  surroundingAgent,
  Assert,
  ArrayCreate,
  SetIntegrityLevel,
  ToString,
  GetIterator,
  GetValue,
  Get,
  GetMethod,
  EnumerableOwnProperties,
  Throw,
  F,
  IteratorStepValue,
} from '#self';

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
function* ArgumentListEvaluation_Arguments(Arguments: ParseNode.Arguments): PlainEvaluator<Arguments> {
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
      // 2. Let ref be the result of evaluating AssignmentExpression.
      const ref = Q(yield* Evaluate(AssignmentExpression));
      // 3. Let arg be ? GetValue(ref).
      const arg = Q(yield* GetValue(ref));
      // 4. Append arg to the end of precedingArgs.
      precedingArgs.push(arg);
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

export function ArgumentListEvaluation(ArgumentsOrTemplateLiteral: ParseNode.TemplateLiteral | ParseNode.Arguments) {
  switch (true) {
    case isArray(ArgumentsOrTemplateLiteral):
      return ArgumentListEvaluation_Arguments(ArgumentsOrTemplateLiteral);
    case ('type' in ArgumentsOrTemplateLiteral && ArgumentsOrTemplateLiteral.type === 'TemplateLiteral'):
      return ArgumentListEvaluation_TemplateLiteral(ArgumentsOrTemplateLiteral);
    default:
      throw OutOfRange.nonExhaustive(ArgumentsOrTemplateLiteral);
  }
}

/**
 * Whether an argument list uses a by-name argument form: a named argument
 * `name: expr`, or a spread of an object literal `...{ a: 1 }`. A named argument
 * always binds by name. A spread of an object literal binds each property by
 * parameter name (the README's object-spread argument), and is recognized by its
 * syntax so that an ordinary iterable spread, `...arr` or `...[1, 2]`, is left to
 * the positional path unchanged. A list with neither is evaluated positionally.
 */
export function hasNamedArguments(args: ParseNode.Arguments): boolean {
  return args.some((element) => {
    const type = (element as { type?: string }).type;
    if (type === 'NamedArgument') {
      return true;
    }
    if (type === 'AssignmentRestElement') {
      const inner = (element as ParseNode.AssignmentRestElement).AssignmentExpression;
      return (inner as { type?: string }).type === 'ObjectLiteral';
    }
    return false;
  });
}

/**
 * The parameters of a function as named-argument resolution reads them: each
 * parameter's name and whether it may be omitted (it is optional, has a default,
 * or is the rest parameter), with the index of a rest parameter where present. A
 * named or object-spread call may omit a parameter only where it may be omitted;
 * a required parameter left unfilled is an error, since named arguments skip
 * defaulted parameters rather than required ones.
 */
function parameterInfo(func: Value): { names: string[], omittable: boolean[], rests: boolean[], refs: boolean[], restIndex: number } {
  // A specialization is a builtin wrapper, not an ECMAScript closure with
  // FormalParameters. Its completed signature preserves names and omissions;
  // the original callee still owns ordinary parameter-default evaluation.
  const specialized = SpecializedFunctionSignatureOf(func);
  if (specialized) return parameterInfoOfSignature(specialized);
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
  let t = declaredType as { Kind?: string, Structure?: unknown, Signatures?: readonly SignatureInView[] } | undefined;
  if (t?.Kind === 'nominal') t = t.Structure as typeof t;
  return t?.Kind === 'function' && t.Signatures?.length ? t.Signatures : undefined;
}

/** Evaluate source-order argument items once, before an overload binds their names. */
export function* ArgumentListEvaluationItems(args: ParseNode.Arguments): PlainEvaluator<ArgumentItem<Value>[]> {
  if (!hasNamedArguments(args)) {
    const values = Q(yield* ArgumentListEvaluation_Arguments(args));
    return (NamedCallItemsOf(values) ?? values.map((value) => ({ value }))) as ArgumentItem<Value>[];
  }
  const items: ArgumentItem<Value>[] = [];
  const emptyRuns: number[] = [];
  const placePositional = (value: Value): void => {
    items.push({ value });
  };
  const placeNamed = (name: string, value: Value): void => {
    items.push({ name, value });
  };

  for (const element of args) {
    if ((element as { type?: string }).type === 'NamedArgument') {
      const named = element as ParseNode.NamedArgument;
      const ref = Q(yield* Evaluate(named.AssignmentExpression));
      const value = Q(yield* GetValue(ref));
      placeNamed(named.Name, value);
    } else if ((element as { type?: string }).type === 'AssignmentRestElement') {
      const { AssignmentExpression } = element as ParseNode.AssignmentRestElement;
      const spreadRef = Q(yield* Evaluate(AssignmentExpression));
      const spreadObj = Q(yield* GetValue(spreadRef));
      if (spreadObj instanceof ReferenceRunValue) {
        if (spreadObj.Locations.length === 0) emptyRuns.push(items.length);
        for (const location of spreadObj.Locations) items.push({ value: new ReferenceValue(location), referenceRun: true });
        continue;
      }
      // A plain object spread binds by parameter name; an iterable spread fills
      // positions in order. Distinguish by whether the value has an iterator.
      const method = spreadObj instanceof ObjectValue
        ? Q(yield* GetMethod(spreadObj, wellKnownSymbols.iterator))
        : Value.undefined;
      if (spreadObj instanceof ObjectValue && method === Value.undefined) {
        // Object spread: bind each own enumerable string-keyed property by name.
        const keys = Q(yield* EnumerableOwnProperties(spreadObj, 'key'));
        for (const key of keys) {
          const value = Q(yield* Get(spreadObj, key as JSStringValue));
          placeNamed((key as JSStringValue).stringValue(), value);
        }
      } else {
        const iteratorRecord = Q(yield* GetIterator(spreadObj, 'sync'));
        while (true) {
          const next = Q(yield* IteratorStepValue(iteratorRecord));
          if (next === 'done') {
            break;
          }
          placePositional(next);
        }
      }
    } else {
      const ref = Q(yield* Evaluate(element as ParseNode.AssignmentExpressionOrHigher));
      const value = Q(yield* GetValue(ref));
      placePositional(value);
    }
  }

  SetEmptyReferenceRuns(items, emptyRuns);
  return items;
}

/**
 * Evaluates an argument list that uses by-name forms and returns the positional
 * argument list to pass to the call, using the called function's parameter names.
 * A positional argument fills the next position. A named argument `name: expr`
 * fills the position of the parameter with that name, or the rest position onward
 * where the name is the rest parameter's. A spread of a plain object binds each
 * own enumerable property by parameter name; a spread of an iterable fills the
 * next positions in order, as an ordinary spread does. A position with no argument
 * is left absent for the callee's own default to fill; a named argument that
 * matches no parameter is a TypeError.
 */
export function* ArgumentListEvaluationNamed(args: ParseNode.Arguments, func: Value, signatureOrViews?: SignatureInView | readonly SignatureInView[], contextualType?: TypeRecord): PlainEvaluator<Arguments> {
  return Q(yield* BindCallArgumentItems(Q(yield* ArgumentListEvaluationItems(args)), func, signatureOrViews, contextualType));
}

/** The same binding for already-evaluated positional forwarding occurrences. */
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
  for (let i = 0; i < names.length; i += 1) {
    const values = placed.groups[i];
    if (values.length === 0 && !rests[i]) {
      if (!omittable[i]) {
        return Throw.TypeError('no argument for the required parameter $1', Value(names[i]));
      }
      // Positional forwarding supplies no placeholder for an omitted default.
      // Its zero count reaches ordinary final binding without changing arity.
      if (signature || items.some((item) => item.name !== undefined)) values.push(initials[i] ?? Value.undefined);
    }
    for (let value of values) {
      const type = types[i] as TypeRecord | undefined;
      if (signature && !rests[i] && type && type.Kind !== 'any'
          && !(value instanceof ObjectValue) && !(value instanceof ReferenceValue) && value !== Value.undefined) {
        value = Q(yield* ConvertValue(value, type));
      }
      result.push(value);
    }
  }
  if (!signature) SetNamedParameterCounts(result, func, placed.groups.map((group) => group.length));
  return result as Arguments;
}
