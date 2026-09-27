import { CanonicalizeType } from './intern.mts';
import { mentionsTypeParameter, type Known, type TypeRecord } from './records.mts';

/** #sec-array-and-tuple-types: a closed rest operand denotes an array or tuple. */
export function invalidTupleRest(type: Known, seen = new Set<TypeRecord>()): TypeRecord | null {
  if (!type || seen.has(type)) return null;
  seen.add(type);
  const children: TypeRecord[] = [];
  if (type.Kind === 'tuple') {
    for (const element of type.Elements) {
      if (element.Rest && !mentionsTypeParameter(element.Type)) {
        const operand = CanonicalizeType(element.Type);
        if (operand.Kind !== 'array' && operand.Kind !== 'tuple') return operand;
      }
      children.push(element.Type);
    }
  } else if (type.Kind === 'object') {
    for (const property of type.Properties) {
      children.push(property.type);
      if (property.writeType) children.push(property.writeType);
    }
    for (const index of type.IndexSignatures) children.push(index.Key, index.Value);
  } else if (type.Kind === 'function') {
    for (const signature of type.Signatures) {
      children.push(...signature.Parameters.map((parameter) => parameter.Type));
      if (signature.Return) children.push(signature.Return);
      if (signature.ThisType) children.push(signature.ThisType);
    }
  } else if (type.Kind === 'array') children.push(type.Element);
  else if (type.Kind === 'reference' || type.Kind === 'shared') children.push(type.Target);
  else if (type.Kind === 'union' || type.Kind === 'intersection') children.push(...type.Members);
  else if (type.Kind === 'parameterized') children.push(type.Base);
  else if (type.Kind === 'nominal') {
    if (type.Structure) children.push(type.Structure);
    if (type.Base) children.push(type.Base);
  }
  if ('Arguments' in type) {
    for (const argument of type.Arguments ?? []) {
      if (typeof argument !== 'number') children.push(argument);
    }
  }
  for (const child of children) {
    const invalid = invalidTupleRest(child, seen);
    if (invalid) return invalid;
  }
  return null;
}
