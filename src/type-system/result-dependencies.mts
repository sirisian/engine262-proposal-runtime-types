import { anyType, makePrimitive, mentionsTypeParameter, type TypeRecord, type PropertyTypeRecord, type SignatureRecord } from './records.mts';
import { SameArgumentList, SameType } from './relations.mts';
import { ObjectValue, ReferenceRecord, JSStringValue, EnvironmentRecord, RefBindingHolder,
  EnsureCompletion, Evaluate, GetValue, IsDataDescriptor, type PropertyKeyValue, SymbolValue, NormalCompletion, type Value,
  type ValueEvaluator, type ParseNode, IsSymbolicPropertyKey, InitializedSymbolKey,
  ClassFamilyOf, NumberValue, isTypedNumber, Value as MakeValue } from '#self';

// These keys are internal completions, immutable bindings or data descriptors, never returned values,
// function values or shared syntax. A forwarded dependency is only a candidate
// until the receiving function's own result admission succeeds.
const accepted = new WeakMap<object, TypeRecord>();
const forwarded = new WeakMap<object, TypeRecord>();
const receivers = new WeakMap<ReferenceRecord, TypeRecord>();
// Construction evidence is a ledger of source contributions, not a snapshot of
// current member values. A decorator can change backing before admission.
const constructions = new WeakMap<ObjectValue, Map<string | SymbolValue, { type?: TypeRecord, keyDependency?: SymbolValue }>>();
// A construction can supply a key without supplying a value contract, notably
// for an accessor. This is distinct from a checked member whose target is any.
const keyOnly = new WeakSet<PropertyTypeRecord>();

/** A construction choice is a request for admission, never evidence that it
 * succeeded. It belongs to an evaluation result, not to the returned value. */
type ConstructionPath = { object: ObjectValue, key: PropertyKeyValue, descriptor: object, value: Value };
export type ConstructionSelection = {
  value: ObjectValue, context: TypeRecord, member: TypeRecord, path?: readonly ConstructionPath[],
};
export type ConstructionSelections = readonly ConstructionSelection[];
const constructionSelections = new WeakMap<object, ConstructionSelections>();
const aggregateSelections = new WeakMap<ObjectValue, Map<string | SymbolValue, {
  key: PropertyKeyValue, descriptor: object, value: Value, selections: ConstructionSelections,
}>>();
export function ConstructionSelectionsOf(result: object | undefined): ConstructionSelections | undefined {
  return result && constructionSelections.get(result);
}
export function PreferredConstructionAlternative(value: Value, context: TypeRecord,
  selections?: ConstructionSelections): TypeRecord | undefined {
  if (context.Kind !== 'union') return undefined;
  const choice = selections?.find((entry) => entry.value === value && SameType(entry.context, context)
    && entry.path?.every((step) => {
      const current = step.object.properties.get(step.key);
      return current === step.descriptor && IsDataDescriptor(current) && current.Value === step.value;
    }) !== false);
  return choice?.member;
}
export function BeginConstructionSelections(object: ObjectValue): void {
  aggregateSelections.set(object, new Map());
}
export function EndConstructionSelections(object: ObjectValue): void {
  aggregateSelections.delete(object);
}
export function CompleteConstructionSelections<T extends object>(object: ObjectValue, result: T,
  own?: ConstructionSelection): T {
  const selections: ConstructionSelection[] = own ? [own] : [];
  for (const entry of aggregateSelections.get(object)?.values() ?? []) {
    const current = object.properties.get(entry.key);
    // Ordinary replacement/deletion or a decorator cannot attach a child
    // construction's choice to a different receiving descriptor/value.
    if (current === entry.descriptor && IsDataDescriptor(current) && current.Value === entry.value) {
      const step = { object, key: entry.key, descriptor: entry.descriptor, value: entry.value };
      selections.push(...entry.selections.map((selection) => ({ ...selection, path: [...(selection.path ?? []), step] })));
    }
  }
  if (selections.length) constructionSelections.set(result, selections);
  return result;
}

// Argument and parameter receipts belong to a particular invocation. Ordinary
// reads of the same value never consult these tables.
const argumentResults = new WeakMap<readonly (Value | undefined)[], Map<number, { value: Value, result: object }>>();
const iteratorResults = new WeakMap<object, object>();
const parameterResults = new WeakMap<object, { value: Value | undefined, result: object }>();

export function RetainArgumentResult(args: readonly (Value | undefined)[], index: number, result: object | undefined): void {
  const value = args[index];
  if (!value || !result || !ConstructionSelectionsOf(result)?.length) return;
  let entries = argumentResults.get(args);
  if (!entries) argumentResults.set(args, entries = new Map());
  entries.set(index, { value, result });
}
export function ArgumentResultOf(args: readonly (Value | undefined)[], index: number): object | undefined {
  const entry = argumentResults.get(args)?.get(index);
  return entry?.value === args[index] ? entry?.result : undefined;
}
export function CopyArgumentResults<T extends readonly (Value | undefined)[]>(from: readonly (Value | undefined)[], to: T,
  indices?: readonly number[]): T {
  for (let index = 0; index < to.length; index += 1) {
    const source = indices?.[index] ?? index;
    if (source >= 0 && from[source] === to[index]) RetainArgumentResult(to, index, ArgumentResultOf(from, source));
  }
  return to;
}
export function RetainIteratorArgument(record: object, result: object | undefined): void {
  if (result) iteratorResults.set(record, result);
  else iteratorResults.delete(record);
}
export function TakeIteratorArgument<T extends { Type: string }>(record: object, result: T): T {
  const source = iteratorResults.get(record);
  iteratorResults.delete(record);
  return source && result.Type === 'normal'
    ? TransferResultDependency(source, result) : result;
}
export function RetainParameterConstruction(reference: ReferenceRecord, result: object): void {
  if (!(reference.Base instanceof EnvironmentRecord) || !(reference.ReferencedName instanceof JSStringValue)) return;
  const binding = RefBindingHolder(reference.Base, reference.ReferencedName)?.bindings.get(reference.ReferencedName);
  if (binding && !binding.refLocation && ConstructionSelectionsOf(result)?.length) {
    parameterResults.set(binding, { value: binding.value, result });
  }
}
// FunctionDeclarationInstantiation alone moves this initialization into its
// separate body-variable binding; an ordinary read never performs this move.
export function MoveParameterConstruction(from: object | undefined, to: object | undefined): void {
  if (!from || !to) return;
  const receipt = parameterResults.get(from);
  parameterResults.delete(from);
  if (receipt) parameterResults.set(to, receipt);
}
export function InvalidateParameterConstruction(binding: object): void {
  parameterResults.delete(binding);
}
export function TakeParameterConstruction(binding: object | undefined, value: Value): object | undefined {
  if (!binding) return undefined;
  const receipt = parameterResults.get(binding);
  parameterResults.delete(binding);
  return receipt?.value === value ? receipt?.result : undefined;
}

function propertyIdentity(key: PropertyKeyValue): string | SymbolValue {
  return key instanceof JSStringValue ? key.stringValue() : key;
}

function sourceNominal(type: TypeRecord | undefined): type is Extract<TypeRecord, { Kind: 'nominal' }> {
  return type?.Kind === 'nominal'
    && (type.Declaration.type === 'ClassDeclaration' || type.Declaration.type === 'ClassExpression');
}

/** Complete matching nominal and Symbol-key dependencies in a private view. */
export function InstantiateReturnDependency(type: TypeRecord, completion?: object): TypeRecord {
  const dependency = completion && forwarded.get(completion);
  const seen = new Map<TypeRecord, Map<TypeRecord | undefined, TypeRecord>>();
  const signatureSeen = new Map<TypeRecord, Map<TypeRecord | undefined, TypeRecord>>();
  const argumentSeen = new Map<TypeRecord, Map<TypeRecord | undefined, TypeRecord>>();
  const argumentSignatureSeen = new Map<TypeRecord, Map<TypeRecord | undefined, TypeRecord>>();
  const complete = (target: TypeRecord, evidence: TypeRecord | undefined, signature = false, argument = false): TypeRecord => {
    if (!argument && target.Kind !== 'object' && target.Kind !== 'function' && target.Kind !== 'union' && !sourceNominal(target)) return target;
    const memo = argument ? (signature ? argumentSignatureSeen : argumentSeen) : (signature ? signatureSeen : seen);
    let alternatives = memo.get(target);
    if (!alternatives) memo.set(target, alternatives = new Map());
    const prior = alternatives.get(evidence);
    if (prior) return prior;
    const copy = { ...target };
    alternatives.set(evidence, copy);
    if (!argument && target.Kind === 'union' && sourceNominal(evidence)) {
      // An admitted producer result can complete the selected contribution's
      // local family. Other arms may belong to activations that never ran.
      // This is evidence from a checked boundary, never from the returned value;
      // the receiving boundary still checks the value against the completed arm.
      for (const member of target.Members) {
        const completed = complete(member, evidence, signature);
        if (sourceNominal(completed) && completed.Constructor === evidence.Constructor
          && completed.DeclarationIdentity === evidence.DeclarationIdentity
          && SameArgumentList([completed], [evidence], [])) {
          alternatives.set(evidence, completed);
          return completed;
        }
      }
      alternatives.set(evidence, target);
      return target;
    }
    if (sourceNominal(target) && sourceNominal(copy)) {
      const parameters = (target.Declaration as ParseNode.ClassDeclaration).TypeParameters?.TypeParameterList ?? [];
      if (!signature) {
        // A compact number in a TYPE parameter position already means the
        // literal Number type. Its domain cannot come from a replacement.
        copy.Arguments = target.Arguments.map((argument, i) => typeof argument === 'number' && parameters[i] && !parameters[i].IsValueParameter
          ? { Kind: 'literal', Value: MakeValue(argument), Base: makePrimitive('number') } : argument);
      }
      const unresolved = copy.Arguments.some((argument, i) => argument !== target.Arguments[i]) ? copy : target;
      // A known generic family is not yet a completed application: its
      // arguments can still contain a producer-local declaration dependency.
      // Retain that family as an authority check before completing arguments.
      const familyOnly = target.Constructor instanceof ObjectValue && target.Arguments.length > 0
        && ClassFamilyOf(target.Constructor) === target.Constructor;
      if ((target.Constructor && !familyOnly) || !sourceNominal(evidence)
        || evidence.Declaration !== target.Declaration || !(evidence.Constructor instanceof ObjectValue)
        || (familyOnly && ClassFamilyOf(evidence.Constructor) !== target.Constructor)
        || (target.DeclarationIdentity && target.DeclarationIdentity !== evidence.DeclarationIdentity)
        || (!signature && target.Arguments.some((argument) => typeof argument !== 'number' && mentionsTypeParameter(argument)))) {
        alternatives.set(evidence, unresolved);
        return unresolved;
      }
      // Complete nested declaration dependencies before comparing arguments.
      // Equal source syntax alone never replaces an already completed argument.
      const arguments_ = copy.Arguments.map((argument, i) => {
        const supplied = evidence.Arguments[i];
        // An explicit application can retain an unconverted Number literal
        // where construction uses a compact number. Both describe this exact
        // value; only a VALUE parameter's checked domain can reify the literal.
        const literalNumber = typeof argument !== 'number' && parameters[i]?.IsValueParameter
          && argument.Kind === 'literal' && argument.Value instanceof NumberValue && !isTypedNumber(argument.Value);
        if (typeof argument !== 'number' && !literalNumber) return complete(argument, typeof supplied === 'number' ? undefined : supplied, signature, true);
        // eslint-disable-next-line @engine262/mathematical-value -- compare the exact checking-time Number, including negative zero
        const number = typeof argument === 'number' ? argument : ((argument as Extract<TypeRecord, { Kind: 'literal' }>).Value as NumberValue).numberValue();
        // A compact checking-time number denotes this exact argument, not an
        // untyped substitute for a value parameter's admitted numeric domain.
        // Reify it only from the same declaration position's checked binding.
        if (typeof supplied === 'number' || supplied?.Kind !== 'literal') return argument;
        const value = supplied.Value;
        if (isTypedNumber(value)) {
          if (!parameters[i]?.IsValueParameter) return argument;
          const same = typeof value.value === 'bigint'
            ? Number.isInteger(number) && BigInt(number) === value.value : Object.is(number, value.value);
          return same ? supplied : argument;
        }
        // eslint-disable-next-line @engine262/mathematical-value -- compare the exact stored numeric argument, including negative zero
        return value instanceof NumberValue && Object.is(number, value.numberValue()) ? supplied : argument;
      });
      if (!SameArgumentList(arguments_, evidence.Arguments, [])) {
        alternatives.set(evidence, unresolved);
        return unresolved;
      }
      if (target.CapturedBindings?.length) {
        const captures = target.CapturedBindings.map((capture, i) => {
          const supplied = evidence.CapturedBindings?.[i];
          if (!supplied || capture.Declaration !== supplied.Declaration) return capture;
          const type = complete(capture.Type, supplied.Type, signature, true);
          // A captured value parameter has the same declared numeric domain
          // as a directly written class argument. Reify an exact Number only
          // from that declaration's independently checked captured input.
          if (capture.Declaration.IsValueParameter && type.Kind === 'literal'
            && type.Value instanceof NumberValue && !isTypedNumber(type.Value)
            && supplied.Type.Kind === 'literal' && isTypedNumber(supplied.Type.Value)) {
            // eslint-disable-next-line @engine262/mathematical-value -- compare the exact source Number
            const number = type.Value.numberValue();
            const value = supplied.Type.Value.value;
            const same = typeof value === 'bigint' ? Number.isInteger(number) && BigInt(number) === value : Object.is(number, value);
            if (same) return { ...capture, Type: supplied.Type };
          }
          return { ...capture, Type: type };
        });
        if (captures.length !== evidence.CapturedBindings?.length
          || captures.some((capture, i) => capture.Declaration !== evidence.CapturedBindings![i].Declaration
            || !SameArgumentList([capture.Type], [evidence.CapturedBindings![i].Type], []))) {
          alternatives.set(evidence, unresolved);
          return unresolved;
        }
        copy.CapturedBindings = captures;
      }
      copy.Arguments = arguments_;
      copy.Constructor = signature ? ClassFamilyOf(evidence.Constructor) : evidence.Constructor;
      copy.DeclarationIdentity = evidence.DeclarationIdentity;
      return copy;
    }
    // These are type-argument descriptions, not evidence about array contents
    // or arbitrary result values. Preserve the target's shape and require the
    // enclosing nominal's exact argument comparison after completing leaves.
    if (argument) {
      if (copy.Kind === 'nominal' && evidence?.Kind === 'nominal'
        && copy.Declaration === evidence.Declaration && copy.LibraryName === evidence.LibraryName
        && copy.DeclarationIdentity === evidence.DeclarationIdentity) {
        copy.Arguments = copy.Arguments.map((entry, i) => {
          const supplied = evidence.Arguments[i];
          return typeof entry === 'number' ? entry : complete(entry,
            typeof supplied === 'number' ? undefined : supplied, signature, true);
        });
        return copy;
      }
      if (copy.Kind === 'array' && evidence?.Kind === 'array') {
        copy.Element = complete(copy.Element, evidence.Element, signature, true);
        if (typeof copy.Extent === 'object') copy.Extent = complete(copy.Extent,
          typeof evidence.Extent === 'object' ? evidence.Extent : undefined, signature, true);
        return copy;
      }
      if (copy.Kind === 'tuple' && evidence?.Kind === 'tuple' && copy.Elements.length === evidence.Elements.length) {
        copy.Elements = copy.Elements.map((entry, i) => ({ ...entry,
          Type: complete(entry.Type, evidence.Elements[i].Type, signature, true) }));
        return copy;
      }
      if ((copy.Kind === 'union' || copy.Kind === 'intersection') && evidence?.Kind === copy.Kind) {
        copy.Members = copy.Members.map((member) => {
          // Set order is immaterial. Ambiguous matches cannot choose an
          // activation; the surrounding exact comparison will reject it.
          const matches = evidence.Members.map((supplied) => ({ supplied,
            completed: complete(member, supplied, signature, true) }))
            .filter(({ supplied, completed }) => SameArgumentList([completed], [supplied], []));
          return matches.length === 1 ? matches[0].completed : member;
        });
        return copy;
      }
      if ((copy.Kind === 'reference' || copy.Kind === 'shared') && evidence?.Kind === copy.Kind) {
        copy.Target = complete(copy.Target, evidence.Target, signature, true);
        return copy;
      }
      if (copy.Kind === 'parameterized' && evidence?.Kind === 'parameterized') {
        copy.Base = complete(copy.Base, evidence.Base, signature, true);
        return copy;
      }
    }
    if (target.Kind === 'function' && copy.Kind === 'function') {
      if (evidence?.Kind !== 'function') return target;
      // Match descriptions, never the candidate callable's observed value.
      // Inferred results participate even though they are not written returns.
      const contract = (entry: SignatureRecord): TypeRecord => ({ Kind: 'function',
        Signatures: [{ ...entry, Return: entry.Return ?? entry.InferredReturn ?? null }] });
      copy.Signatures = target.Signatures.map((to) => {
        const matches: SignatureRecord[] = [];
        for (const from of evidence.Signatures) {
          const parameters = to.TypeParameters ?? [], supplied = from.TypeParameters ?? [];
          if (parameters.length !== supplied.length
            || !!(to as SignatureRecord & { Untyped?: boolean }).Untyped !== !!(from as SignatureRecord & { Untyped?: boolean }).Untyped
            || parameters.some((parameter, i) => parameter.Declaration !== supplied[i].Declaration)) continue;
          const candidate: SignatureRecord = { ...to,
            Parameters: to.Parameters.map((parameter, i) => ({ ...parameter,
              Type: complete(parameter.Type, from.Parameters[i]?.Type, true, true) })),
            // A signature result is a type description, including protocol
            // arguments; it is not evidence about an arbitrary returned value.
            Return: to.Return ? complete(to.Return, from.Return ?? from.InferredReturn ?? undefined, true, true) : to.Return,
            InferredReturn: to.InferredReturn ? complete(to.InferredReturn, from.InferredReturn ?? from.Return ?? undefined, true, true) : to.InferredReturn,
            ...(to.ThisType ? { ThisType: complete(to.ThisType, from.ThisType ?? undefined, true, true) } : {}),
            ...(to.Narrows ? { Narrows: to.Narrows.map((narrow, i) => ({ ...narrow,
              Type: complete(narrow.Type, from.Narrows?.[i]?.Type, true, true) })) } : {}),
          };
          // Exact identity checks modes, defaults, receiver and narrowing
          // obligations as well as types. Own binders remain declarations.
          if (SameArgumentList([contract(candidate)], [contract(from)], [])) matches.push(candidate);
        }
        // Declaration order cannot select an activation. Multiple candidates
        // are usable only when they establish the same completed contract.
        return matches.length && matches.every((match) => SameArgumentList([contract(match)], [contract(matches[0])], []))
          ? matches[0] : to;
      });
      return copy;
    }
    if (target.Kind !== 'object' || copy.Kind !== 'object') {
      alternatives.set(evidence, target);
      return target;
    }
    const contributed = evidence?.Kind === 'object' ? evidence.Properties : [];
    const properties = new Map(contributed.map((property) => [property.key, property]));
    const keys = new Map(contributed.filter((property) => property.keyDependency)
      .map((property) => [property.keyDependency!, property]));
    copy.Properties = target.Properties.map((property) => {
      let key = property.key;
      let keyDependency = property.keyDependency;
      if (IsSymbolicPropertyKey(key)) {
        // A selected contribution supplies its activation before a lexical
        // fallback. Recursive calls must not use the caller's own fresh key.
        const supplied = keys.get(key)?.key;
        const actual = supplied instanceof SymbolValue && !IsSymbolicPropertyKey(supplied)
          ? supplied : InitializedSymbolKey(key);
        if (actual) {
          keyDependency = key;
          key = actual;
        }
      }
      const supplied = properties.get(key);
      return { ...property, key, keyDependency, type: complete(property.type, supplied?.type, signature, argument),
        ...(argument && property.writeType ? { writeType: complete(property.writeType, supplied?.writeType, signature, true) } : {}) };
    });
    if (argument && evidence?.Kind === 'object') {
      copy.IndexSignatures = copy.IndexSignatures.map((index) => {
        const matches = evidence.IndexSignatures.map((supplied) => ({ supplied,
          key: complete(index.Key, supplied.Key, signature, true) }))
          .filter(({ supplied, key }) => SameArgumentList([key], [supplied.Key], []));
        if (matches.length !== 1) return index;
        return { ...index, Key: matches[0].key, Value: complete(index.Value, matches[0].supplied.Value, signature, true) };
      });
    }
    return copy;
  };
  return complete(type, dependency);
}

/** Called after the ordinary boundary check, with that boundary's target. */
export function RetainCheckedResult(completion: object | undefined, type: TypeRecord): void {
  if (!completion) return;
  constructionSelections.delete(completion);
  if (type.Kind === 'object' || type.Kind === 'function' || (sourceNominal(type) && type.Constructor instanceof ObjectValue)) accepted.set(completion, type);
  else accepted.delete(completion);
}

/** Preserve an admitted contract when the interpreter wraps the same result. */
export function TransferResultDependency<T extends object>(from: object, to: T, construction = true): T {
  const selections = construction && constructionSelections.get(from);
  if (selections) constructionSelections.set(to, selections);
  else constructionSelections.delete(to);
  const type = accepted.get(from);
  if (type) accepted.set(to, type);
  else accepted.delete(to);
  return to;
}

/** A fresh data property's committed descriptor owns its initializer's evidence.
 * Replacing or deleting that descriptor cannot leave evidence on the new slot.
 * Call only after an ordinary literal/copy/iterator-result creation succeeds. */
export function RetainPropertyResult(object: ObjectValue, key: PropertyKeyValue, completion: object): void {
  const descriptor = object.properties.get(key);
  if (descriptor && IsDataDescriptor(descriptor)) {
    TransferResultDependency(completion, descriptor, false);
    const selections = constructionSelections.get(completion);
    const pending = aggregateSelections.get(object);
    if (selections?.length) pending?.set(propertyIdentity(key), { key, descriptor, value: descriptor.Value!, selections });
    else pending?.delete(propertyIdentity(key));
    const construction = constructions.get(object);
    const type = accepted.get(completion);
    const identity = propertyIdentity(key);
    const keyDependency = construction?.get(identity)?.keyDependency;
    if (type || keyDependency) construction?.set(identity, { type, keyDependency });
    else construction?.delete(identity);
  }
}

/** A later literal method/accessor replaces the earlier source contribution.
 * This does not apply to an arbitrary backing mutation by a decorator. */
export function ForgetObjectPropertyContribution(object: ObjectValue, key: PropertyKeyValue): void {
  constructions.get(object)?.delete(propertyIdentity(key));
}

/** Retain the already evaluated key's source identity, independently of data. */
export function RetainObjectPropertyKey(object: ObjectValue, key: PropertyKeyValue, keyDependency?: SymbolValue): void {
  const construction = constructions.get(object);
  const identity = propertyIdentity(key);
  const type = construction?.get(identity)?.type;
  if (key instanceof SymbolValue && keyDependency) construction?.set(identity, { type, keyDependency });
  else if (type) construction?.set(identity, { type });
  else construction?.delete(identity);
}

export function RetainCopiedPropertyKey(object: ObjectValue, key: PropertyKeyValue, source?: object): void {
  const type = source && accepted.get(source);
  const identity = propertyIdentity(key);
  const property = type?.Kind === 'object' ? type.Properties.find((entry) => entry.key === identity) : undefined;
  RetainObjectPropertyKey(object, key, property?.keyDependency);
}

export function BeginObjectResult(object: ObjectValue): void {
  constructions.set(object, new Map());
  BeginConstructionSelections(object);
}

export function EndObjectResult(object: ObjectValue): void {
  constructions.delete(object);
  EndConstructionSelections(object);
}

/** Finish a fresh object's contribution without reading any program value. */
export function CompleteObjectResult(object: ObjectValue, own?: ConstructionSelection): NormalCompletion<ObjectValue> {
  const result = NormalCompletion(object);
  const entries = constructions.get(object);
  if (entries?.size) accepted.set(result, {
    Kind: 'object', IndexSignatures: [],
    Properties: [...entries].map(([key, entry]): PropertyTypeRecord => {
      const property = { key, type: entry.type ?? anyType, keyDependency: entry.keyDependency, optional: false, readonly: false };
      if (!entry.type) keyOnly.add(property);
      return property;
    }),
  });
  return CompleteConstructionSelections(object, result, own);
}

function project(type: TypeRecord | undefined, key: PropertyKeyValue, result: object): void {
  if (type?.Kind !== 'object') return;
  const identity = propertyIdentity(key);
  const property = type.Properties.find((entry) => entry.key === identity);
  // A checked view is authoritative, including an erased member. A missing
  // named entry (for example a fresh accessor) supplies no replacement target.
  if (property && !keyOnly.has(property)) RetainCheckedResult(result, property.type);
}

/** Project the established source view, independently of replaceable backing. */
export function ProjectResultDependency(source: object | undefined, key: PropertyKeyValue, result: object): void {
  project(source && accepted.get(source), key, result);
}

/** Keep the base view until ordinary key conversion and reference checks finish. */
export function RetainPropertyReceiver(source: object, reference: ReferenceRecord): ReferenceRecord {
  const type = accepted.get(source);
  if (type?.Kind === 'object') receivers.set(reference, type);
  return reference;
}

export function ReadPropertyResult(reference: ReferenceRecord, key: PropertyKeyValue, result: object): void {
  project(receivers.get(reference), key, result);
}

/** A returned call contributes evidence, not an exemption from admission. */
export function ForwardResultDependency<T extends object>(from: object, to: T): T {
  const selections = constructionSelections.get(from);
  if (selections) constructionSelections.set(to, selections);
  else constructionSelections.delete(to);
  const type = accepted.get(from);
  if (type) forwarded.set(to, type);
  return to;
}

/** Read once and preserve only the contract of the value actually obtained. */
export function* GetResultValue(result: NormalCompletion<ReferenceRecord | Value>): ValueEvaluator {
  const read = EnsureCompletion(yield* GetValue(result.Value));
  if (read.Type !== 'normal') return read;
  // A binding read supplies its own evidence after TDZ/reference checks. Do not
  // transfer metadata from a reference evaluated before the value was read.
  if (result.Value instanceof ReferenceRecord) return read;
  return TransferResultDependency(result, read);
}

/** Value-preserving expression evaluation, including ordinary GetValue. */
export function* EvaluateResultValue(node: ParseNode.AssignmentExpressionOrHigher): ValueEvaluator {
  const result = EnsureCompletion(yield* Evaluate(node));
  if (result.Type !== 'normal') return result;
  return yield* GetResultValue(result);
}

/** Only a successfully initialized immutable ordinary binding retains evidence. */
export function RetainBindingResult(reference: ReferenceRecord, completion: object): void {
  if (!(reference.Base instanceof EnvironmentRecord) || !(reference.ReferencedName instanceof JSStringValue)) return;
  const binding = RefBindingHolder(reference.Base, reference.ReferencedName)?.bindings.get(reference.ReferencedName);
  if (!binding?.initialized || binding.mutable !== false || binding.indirect || binding.refLocation) return;
  TransferResultDependency(completion, binding, false);
}
