import type { ParseNode } from '../parser/ParseNode.mts';
import { PropName } from './all.mts';

/** https://tc39.es/ecma262/#sec-static-semantics-constructormethod */
// ClassElementList :
//   ClassElement
//   ClassElementList ClassElement
export function ConstructorMethod(ClassElementList: ParseNode.ClassElementList): ParseNode.MethodDefinition | undefined {
  return ClassElementList.find((ClassElement) => ClassElement.static === false && PropName(ClassElement) === 'constructor') as ParseNode.MethodDefinition;
}

/**
 * Every constructor a class body declares, in source order.
 *
 * proposal-runtime-types: a class may declare more than one constructor where the
 * declarations are distinct signatures and at least one parameter across the set
 * carries an annotation. `ConstructorMethod` above answers the FIRST and is left
 * alone, because every base-language caller wants exactly that; this is for the
 * places that must see the whole set.
 *
 * Returns a single-element List for an ordinary class, so a caller can treat one
 * constructor as the degenerate overload set rather than branching.
 */
export function ConstructorMethods(ClassElementList: ParseNode.ClassElementList): ParseNode.MethodDefinition[] {
  return ClassElementList.filter(
    (ClassElement) => ClassElement.static === false && PropName(ClassElement) === 'constructor',
  ) as ParseNode.MethodDefinition[];
}
