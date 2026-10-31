import type { ParseNode } from '../parser/ParseNode.mts';

export function IsConstantDeclaration(node: ParseNode | ParseNode.LetOrConst) {
  // proposal-runtime-types (explicit resource management): a `using` binding is
  // immutable like a `const` one, since the resource it names is disposed when the
  // block is left and rebinding it would lose the thing to dispose.
  const isConst = (v: unknown) => v === 'const' || v === 'using';
  // Round 5 follow-up, Q20 (A+): a type alias binding is immutable, so its value
  // can never disagree with what its name means as a type (type positions are
  // bound to the declaration; a reassigned binding left `T === uint8` true while
  // `let t: T = "x"` still meant string).
  if (typeof node === 'object' && node !== null && (node as { type?: string }).type === 'TypeAliasDeclaration') return true;
  return isConst(node) || (typeof node === 'object' && 'LetOrConst' in node && isConst(node.LetOrConst));
}
