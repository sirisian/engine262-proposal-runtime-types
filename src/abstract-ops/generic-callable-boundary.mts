import { Value, ObjectValue } from '../value.mts';
import { Q, type ValueEvaluator } from '../completion.mts';
import type { TypeRecord } from '../type-system/records.mts';
import { InferSignatureInstantiation } from '../type-system/relations.mts';
import { RuntimeTypeOf, CompleteCallableConstraints, BindTypeArgumentRecordsInto, SubstituteTypeArguments } from '../type-system/runtime.mts';
import { SpecializeGenericFunction } from '../runtime-semantics/RuntimeTypesDeclarations.mts';
import { GenericMapTypeOf, SpecializeGenericMap } from './generic-map.mts';
import { InCallableDeclarationContext } from './callable-selection.mts';
import { AdoptedTypeParametersOf, classFrameOfMethod, functionTypeParameters } from './runtime-types.mts';

/** #sec-crossing-with-a-generic-function: admission must retain the inferred body. */
export function* MaterializeGenericCallable(value: Value, target: TypeRecord): ValueEvaluator {
  if (!(value instanceof ObjectValue)) return value;
  const seen = new Set<TypeRecord>();
  while (!seen.has(target)) {
    seen.add(target);
    if (target.Kind === 'shared') target = target.Target;
    else if (target.Kind === 'nominal' && target.Structure) {
      target = SubstituteTypeArguments(target.Structure, target.Declaration, target.Arguments);
    } else break;
  }
  if (target.Kind !== 'function'
      || target.Signatures.length !== 1 || target.Signatures[0]!.TypeParameters?.length) return value;
  const native = GenericMapTypeOf(value);
  const parameters = native ? undefined : functionTypeParameters(value as Parameters<typeof functionTypeParameters>[0]);
  if (!native && !parameters?.length) return value;
  const wanted = Q(yield* CompleteCallableConstraints(target));
  if (wanted.Kind !== 'function') return value;
  if (native?.Kind === 'function') {
    const bindings = InferSignatureInstantiation(native.Signatures[0]!, wanted.Signatures[0]!);
    return bindings ? SpecializeGenericMap(value, bindings.get('U')!) : value;
  }
  return yield* InCallableDeclarationContext(value, new Map(), classFrameOfMethod(value), function* materialize(): ValueEvaluator {
    const source = Q(yield* CompleteCallableConstraints(RuntimeTypeOf(value), true));
    if (source.Kind !== 'function' || source.Signatures.length !== 1) return value;
    let signature = source.Signatures[0]!;
    const wantedSignature = wanted.Signatures[0]!;
    // Match IsOfType's non-arrow receiver adoption without retaining this
    // receiving view on the shared specialization.
    if (!signature.ThisType && wantedSignature.ThisType
        && (value as { ThisMode?: string }).ThisMode !== 'lexical') {
      signature = { ...signature, ThisType: wantedSignature.ThisType };
    }
    const bindings = InferSignatureInstantiation(signature, wantedSignature);
    if (!bindings) return value;
    const frame = new Map<string, TypeRecord>();
    const records = parameters!.map((p) => bindings.get(p.BindingIdentifier.name)!);
    Q(yield* BindTypeArgumentRecordsInto(parameters!, records, records.map(() => undefined), frame, 'the function', undefined, AdoptedTypeParametersOf(value)));
    return yield* SpecializeGenericFunction(value, undefined, undefined, parameters!, frame);
  });
}
