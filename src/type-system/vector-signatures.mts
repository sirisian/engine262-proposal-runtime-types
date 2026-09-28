import type { ParseNode } from '../parser/ParseNode.mts';
import { isMaskLaneType } from './vector-ops.mts';
import { makePrimitive, parameter, parameterTypeRecord, type Known, type TypeParameterRecord, type TypeRecord } from './records.mts';

const signatures = new WeakMap<TypeRecord, Map<string, TypeRecord>>();

/** #sec-vector-masks: member reads describe callable methods, not their results. */
export function VectorMaskMethodSignature(receiver: Known, name: string): Known {
  if (receiver?.Kind !== 'primitive' || receiver.Name !== 'vector') return null;
  const [lane, count] = receiver.Arguments;
  if (!lane || typeof lane === 'number' || typeof count !== 'number' || !isMaskLaneType(lane)) return null;
  if (name !== 'any' && name !== 'all' && name !== 'select') return null;
  let methods = signatures.get(receiver);
  if (!methods) {
    methods = new Map();
    signatures.set(receiver, methods);
  }
  const cached = methods.get(name);
  if (cached) return cached;
  let result: TypeRecord;
  if (name !== 'select') {
    result = { Kind: 'function', Signatures: [{ Parameters: [], Return: makePrimitive('boolean') }] };
  } else {
    const element = parameterTypeRecord('U');
    const declaration = { type: 'TypeParameter', BindingIdentifier: { type: 'BindingIdentifier', name: 'U' } } as ParseNode.TypeParameter;
    const typeParameter: TypeParameterRecord = {
      Name: 'U', Kind: 'type', Variadic: false, Variance: 'invariant', Arity: 0,
      ConstraintNode: null, DefaultNode: null, Declaration: declaration, Parameter: element,
    };
    const vector: TypeRecord = { ...receiver, Arguments: [element, count] };
    result = { Kind: 'function', Signatures: [{
      Parameters: [parameter(vector, { Name: 'whenSet' }), parameter(vector, { Name: 'whenClear' })],
      Return: vector, TypeParameters: [typeParameter],
    }] };
  }
  methods.set(name, result);
  return result;
}
