import { Value, ObjectValue, type Arguments, type FunctionCallContext } from '../value.mts';
import { Q, type ValueEvaluator } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { anyType, parameter, type TypeRecord } from '../type-system/records.mts';
import { GetTypeObject } from '../type-system/intern.mts';
import { indexTypeRecord } from '../type-system/index-type.mts';
import { iteratorHelperType, iteratorMethodSignature } from '../type-system/std-signatures.mts';
import { BindTypeArgumentsInto, RegisterSpecializedFunctionType, pushTypeParameterFrame, popTypeParameterFrame } from '../type-system/runtime.mts';
import { CaseGroupMembers, SelectExplicitCase, WithSelectedInvocation } from './callable-selection.mts';
import { classFrameOfObject, RequireType } from './runtime-types.mts';
import { DecayReferenceValue } from './reference-operations.mts';
import { Call, CreateBuiltinFunction, Throw, type Realm } from '#self';

type MapSteps = (args: Arguments, context: FunctionCallContext, output?: TypeRecord) => ValueEvaluator;
type MapDeclaration = { realm: Realm, steps: MapSteps, type: TypeRecord, specializations: WeakMap<object, ObjectValue> };
const declarations = new WeakMap<Value, MapDeclaration>();
const parameters = [{ type: 'TypeParameter', BindingIdentifier: { name: 'U' } }] as ParseNode.TypeParameter[];

/** Capability and signature belong to the original function object. */
export function RegisterGenericMap(fn: ObjectValue, realm: Realm, steps: MapSteps): void {
  declarations.set(fn, { realm, steps, type: iteratorMethodSignature('map', anyType)!, specializations: new WeakMap() });
}

export function GenericMapTypeOf(fn: Value): TypeRecord | undefined {
  return declarations.get(fn)?.type;
}

/** Same intrinsic and SameType output yield one receiver-independent callable. */
export function SpecializeGenericMap(fn: Value, output: TypeRecord): ObjectValue {
  const declaration = declarations.get(fn)!;
  const key = GetTypeObject(output, declaration.realm);
  const previous = declaration.specializations.get(key);
  if (previous) return previous;
  const specialized = CreateBuiltinFunction(function* mapped(args, context): ValueEvaluator {
    // Completed signatures make this a forwarding implementation wrapper.
    // Perform the native value boundary before entering the original steps.
    const values: Value[] = [];
    for (const value of args) {
      const admitted = Q(yield* DecayReferenceValue(value ?? Value.undefined));
      values.push(admitted);
    }
    return yield* declaration.steps(values, context, output);
  }, 1, Value('map'), [], declaration.realm);
  const callback: TypeRecord = { Kind: 'function', Signatures: [{
    Parameters: [parameter(anyType, { Name: 'value' }), parameter(indexTypeRecord(), { Name: 'index' })], Return: output,
  }] };
  RegisterSpecializedFunctionType(specialized, { Kind: 'function', Signatures: [{
    Parameters: [parameter(callback, { Name: 'callback' })], Return: iteratorHelperType(output),
  }] });
  declaration.specializations.set(key, specialized);
  return specialized;
}

export function* ApplyGenericMap(fn: Value, nodes: readonly ParseNode.Type[]): ValueEvaluator<ObjectValue> {
  const [output] = Q(yield* BindTypeArgumentsInto(parameters, nodes, new Map(), 'map'));
  return SpecializeGenericMap(fn, output!);
}

/** Range.map<U> delegates an explicit application to the normally selected map. */
export function* CallGenericMapDelegate(fn: Value, receiver: Value, args: Arguments, output: TypeRecord): ValueEvaluator {
  let result: Value;
  if (declarations.has(fn)) {
    result = Q(yield* Call(SpecializeGenericMap(fn, output), receiver, args));
  } else {
    const declaration = (fn as { ECMAScriptCode?: { parent?: ParseNode } }).ECMAScriptCode?.parent;
    const members = CaseGroupMembers(fn) ?? (declaration ? [{ fn, declaration }] : []);
    if (!members.length) return Throw.TypeError('type arguments require a generic function');
    const selected = Q(yield* SelectExplicitCase(members as never, [], 'map', function* arguments_() {
      return args.map((value) => ({ value }));
    }, classFrameOfObject(receiver), [output]));
    pushTypeParameterFrame(selected.frame ?? new Map());
    try {
      result = Q(yield* WithSelectedInvocation(selected.fn, function* invoke() {
        return yield* Call(selected.fn, receiver, (selected.arguments ?? args) as Arguments);
      }));
    } finally {
      popTypeParameterFrame();
    }
  }
  return yield* RequireType(result, iteratorHelperType(output));
}
