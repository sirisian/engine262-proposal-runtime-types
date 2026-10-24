import type { ParseNode } from '../parser/ParseNode.mts';
import { anyType, makePrimitive, parameter, type ParameterRecord, type TypeRecord } from './records.mts';
import { joinTypes } from './logical-types.mts';

/** Map a contextual input sequence onto the literal's own formal positions. */
export function contextualParameters(formals: readonly ParseNode[], parameters: readonly ParameterRecord[]): readonly ParameterRecord[] {
  const undefinedType = makePrimitive('undefined');
  const sequence = parameters.flatMap((p): ParameterRecord[] => p.Rest && p.Type.Kind === 'tuple'
    ? p.Type.Elements.map((element) => parameter(element.Type, { Rest: element.Rest, Ref: p.Ref,
      Optional: element.Initial !== 'none' || element.DeclaredDefault,
      DeclaredDefault: element.Initial !== 'none' || element.DeclaredDefault,
      ...(element.Initial !== 'none' ? { Initial: element.Initial } : {}) })) : [p]);
  let position = 0;
  return parameters.length === 0 ? [] : formals.map((formal, index): ParameterRecord => {
    const original = sequence[position];
    if (formal.type === 'BindingRestElement' && index === formals.length - 1) {
      const tail = sequence.slice(position);
      const collection: TypeRecord = tail.length === 1 && tail[0].Rest ? tail[0].Type
        : { Kind: 'tuple', Elements: tail.map((p) => ({ Type: p.Optional && p.Initial === undefined && !p.DeclaredDefault
          ? joinTypes(p.Type, undefinedType) : p.Type, Rest: p.Rest, Initial: p.Initial ?? 'none', DeclaredDefault: p.DeclaredDefault })) };
      return parameter(collection, { Rest: true, Ref: original?.Ref });
    }
    if (original?.Rest) {
      // A single trailing homogeneous run has a known element contract.
      // Distribution across multiple runs needs argument facts unavailable here.
      return sequence.length === position + 1 && original.Type.Kind === 'array'
        ? parameter(original.Type.Element, { Optional: true, Ref: original.Ref }) : parameter(anyType);
    }
    position += 1;
    return original ?? parameter(anyType);
  });
}
