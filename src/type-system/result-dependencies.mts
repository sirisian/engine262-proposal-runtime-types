import { anyType, makePrimitive, mentionsTypeParameter, type TypeRecord, type PropertyTypeRecord } from './records.mts';
import { SameArgumentList } from './relations.mts';
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

function propertyIdentity(key: PropertyKeyValue): string | SymbolValue {
  return key instanceof JSStringValue ? key.stringValue() : key;
}

function sourceNominal(type: TypeRecord | undefined): type is Extract<TypeRecord, { Kind: 'nominal' }> {
  return type?.Kind === 'nominal' && type.Declaration.type === 'ClassDeclaration';
}

/** Complete matching nominal and Symbol-key dependencies in a private view. */
export function InstantiateReturnDependency(type: TypeRecord, completion?: object): TypeRecord {
  const dependency = completion && forwarded.get(completion);
  const seen = new Map<TypeRecord, Map<TypeRecord | undefined, TypeRecord>>();
  const signatureSeen = new Map<TypeRecord, Map<TypeRecord | undefined, TypeRecord>>();
  const argumentSeen = new Map<TypeRecord, Map<TypeRecord | undefined, TypeRecord>>();
  const argumentSignatureSeen = new Map<TypeRecord, Map<TypeRecord | undefined, TypeRecord>>();
  const complete = (target: TypeRecord, evidence: TypeRecord | undefined, signature = false, argument = false): TypeRecord => {
    if (!argument && target.Kind !== 'object' && target.Kind !== 'function' && !sourceNominal(target)) return target;
    const memo = argument ? (signature ? argumentSignatureSeen : argumentSeen) : (signature ? signatureSeen : seen);
    let alternatives = memo.get(target);
    if (!alternatives) memo.set(target, alternatives = new Map());
    const prior = alternatives.get(evidence);
    if (prior) return prior;
    const copy = { ...target };
    alternatives.set(evidence, copy);
    if (sourceNominal(target) && sourceNominal(copy)) {
      const parameters = (target.Declaration as ParseNode.ClassDeclaration).TypeParameters?.TypeParameterList ?? [];
      if (!signature) {
        // A compact number in a TYPE parameter position already means the
        // literal Number type. Its domain cannot come from a replacement.
        copy.Arguments = target.Arguments.map((argument, i) => typeof argument === 'number' && parameters[i] && !parameters[i].IsValueParameter
          ? { Kind: 'literal', Value: MakeValue(argument), Base: makePrimitive('number') } : argument);
      }
      const unresolved = copy.Arguments.some((argument, i) => argument !== target.Arguments[i]) ? copy : target;
      if (target.Constructor || !sourceNominal(evidence)
        || evidence.Declaration !== target.Declaration || !(evidence.Constructor instanceof ObjectValue)
        || (target.DeclarationIdentity && target.DeclarationIdentity !== evidence.DeclarationIdentity)
        || (!signature && target.Arguments.some((argument) => typeof argument !== 'number' && mentionsTypeParameter(argument)))) {
        alternatives.set(evidence, unresolved);
        return unresolved;
      }
      // Complete nested declaration dependencies before comparing arguments.
      // Equal source syntax alone never replaces an already completed argument.
      const arguments_ = copy.Arguments.map((argument, i) => {
        const supplied = evidence.Arguments[i];
        if (typeof argument !== 'number') return complete(argument, typeof supplied === 'number' ? undefined : supplied, signature, true);
        // A compact checking-time number denotes this exact argument, not an
        // untyped substitute for a value parameter's admitted numeric domain.
        // Reify it only from the same declaration position's checked binding.
        if (typeof supplied === 'number' || supplied?.Kind !== 'literal') return argument;
        const value = supplied.Value;
        if (isTypedNumber(value)) {
          if (!parameters[i]?.IsValueParameter) return argument;
          const same = typeof value.value === 'bigint'
            ? Number.isInteger(argument) && BigInt(argument) === value.value : Object.is(argument, value.value);
          return same ? supplied : argument;
        }
        // eslint-disable-next-line @engine262/mathematical-value -- compare the exact stored numeric argument, including negative zero
        return value instanceof NumberValue && Object.is(argument, value.numberValue()) ? supplied : argument;
      });
      if (!SameArgumentList(arguments_, evidence.Arguments, [])) {
        alternatives.set(evidence, unresolved);
        return unresolved;
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
      // A single retained callable contract has one corresponding result
      // position. Its own generic binders remain declarations, not arguments
      // of the enclosing invocation. Overload correspondence is separate.
      if (target.Signatures.length !== 1 || evidence?.Kind !== 'function' || evidence.Signatures.length !== 1) return target;
      const to = target.Signatures[0], from = evidence.Signatures[0];
      const parameters = to.TypeParameters ?? [], supplied = from.TypeParameters ?? [];
      const completedParameters = argument ? to.Parameters.map((parameter, i) => ({ ...parameter,
        Type: complete(parameter.Type, from.Parameters[i]?.Type, signature, true) })) : to.Parameters;
      if (parameters.length !== supplied.length || parameters.some((parameter, i) => parameter.Declaration !== supplied[i].Declaration)
        || to.Parameters.some((parameter, i) => parameter.Optional !== from.Parameters[i]?.Optional || parameter.Rest !== from.Parameters[i]?.Rest || parameter.Ref !== from.Parameters[i]?.Ref)
        || !SameArgumentList(completedParameters.map((parameter) => parameter.Type), from.Parameters.map((parameter) => parameter.Type), [])) return target;
      copy.Signatures = [{ ...to, Parameters: completedParameters,
        Return: to.Return ? complete(to.Return, from.Return ?? undefined, true, argument) : to.Return,
        InferredReturn: to.InferredReturn ? complete(to.InferredReturn, from.InferredReturn ?? undefined, true, argument) : to.InferredReturn,
        ...(argument && to.ThisType ? { ThisType: complete(to.ThisType, from.ThisType ?? undefined, signature, true) } : {}),
        ...(argument && to.Narrows ? { Narrows: to.Narrows.map((narrow, i) => ({ ...narrow,
          Type: complete(narrow.Type, from.Narrows?.[i]?.Type, signature, true) })) } : {}),
      }];
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
  if (type.Kind === 'object' || type.Kind === 'function' || (sourceNominal(type) && type.Constructor instanceof ObjectValue)) accepted.set(completion, type);
  else accepted.delete(completion);
}

/** Preserve an admitted contract when the interpreter wraps the same result. */
export function TransferResultDependency<T extends object>(from: object, to: T): T {
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
    TransferResultDependency(completion, descriptor);
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
}

export function EndObjectResult(object: ObjectValue): void {
  constructions.delete(object);
}

/** Finish a fresh object's contribution without reading any program value. */
export function CompleteObjectResult(object: ObjectValue): NormalCompletion<ObjectValue> {
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
  return result;
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
  TransferResultDependency(completion, binding);
}
