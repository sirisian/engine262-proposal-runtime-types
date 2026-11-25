import type { ParseNode } from '../parser/ParseNode.mts';

/**
 * #sec-function-types: whether a signature is TYPED, so that the function or
 * class member it belongs to takes part in the typed-source judgments: a
 * return annotation, type parameters, or a parameter with an annotation or
 * declared `ref`, at any depth of its binding pattern.
 */
export function TypedInvocationSignature(node: ParseNode): boolean {
  const signature = node as unknown as {
    TypeAnnotation?: unknown, TypeParameters?: unknown,
    FormalParameters?: readonly ParseNode[], UniqueFormalParameters?: readonly ParseNode[], ArrowParameters?: readonly ParseNode[],
  };
  const annotatedParameter = (parameter: ParseNode): boolean => {
    if ((parameter as { TypeAnnotation?: unknown, Ref?: boolean }).TypeAnnotation
      || (parameter as { Ref?: boolean }).Ref) return true;
    return Object.entries(parameter).some(([key, value]) => {
      if (['parent', 'location', 'sourceText', 'Initializer'].includes(key)) return false;
      return (Array.isArray(value) ? value : [value]).some((child) => child && typeof child === 'object'
        && 'type' in child && annotatedParameter(child as ParseNode));
    });
  };
  return !!signature.TypeAnnotation || !!signature.TypeParameters
    || (signature.FormalParameters ?? signature.UniqueFormalParameters ?? signature.ArrowParameters ?? []).some(annotatedParameter);
}

/**
 * #sec-function-types: whether the class _node_ declares itself a participant
 * in the typed-source judgments, through "its typed members, declared
 * operators, type parameters, class modifiers, or implemented interfaces". It
 * reads the declaration alone; what a class inherits is its base's to say.
 *
 * Question BV, BV2: such a class is called as a type is, so a call on it with
 * one argument is the explicit conversion of that argument to it
 * (#sec-explicit-conversion). No class written in JavaScript has any of these,
 * so no call of one that ran changes meaning.
 */
export function ClassParticipatesInTypes(node: ParseNode.ClassDeclaration | ParseNode.ClassExpression): boolean {
  const declaration = node as unknown as {
    TypeParameters?: unknown, ClassModifiers?: readonly string[] | null,
    ClassTail: { ImplementsClause?: readonly unknown[] | null, ClassBody?: readonly ParseNode[] | null },
  };
  return !!declaration.TypeParameters || !!declaration.ClassModifiers?.length || !!declaration.ClassTail.ImplementsClause?.length
    || (declaration.ClassTail.ClassBody ?? []).some((member) => member.type === 'OperatorDefinition' || TypedInvocationSignature(member));
}
