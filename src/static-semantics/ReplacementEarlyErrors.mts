import type { ParseNode } from '../parser/ParseNode.mts';
import { ReplacementDecoratorNames } from './ReplacementDecoratorNames.mts';

/**
 * proposal-runtime-types `sec-replacement-decorators`, Static Semantics: Early
 * Errors over `Module : ModuleBody?`.
 *
 * Both are computed from the module's own text and depend on nothing expansion
 * produces, so they are raised before anything runs - which is the property the
 * Strict Lexical Rule exists to give.
 */

export interface ReplacementEarlyError {
  readonly kind: 'shadowed' | 'misplaced';
  readonly name: string;
  readonly node: ParseNode;
}

/** The identifier a decoration spells, where it spells a bare one. */
function decorationName(decorator: ParseNode): string | undefined {
  const m = (decorator as { MemberExpression?: { type?: string, name?: string } }).MemberExpression;
  return m?.type === 'IdentifierReference' ? m.name : undefined;
}

/**
 * The first early error a module commits, or *undefined*.
 *
 * **SHADOWING.** It is a Syntax Error for a declaration to bind a name a
 * preprocessor import introduced. A TOP-LEVEL redeclaration is already a
 * duplicate binding in ordinary JavaScript, so this rule is load-bearing only
 * for INNER scopes - `{ const m = 1; }` and a shadow inside a function both
 * parse today and both leave the name in the set. **Worth knowing before
 * writing a rule that half restates one the language already has.**
 *
 * **PLACEMENT.** It is a Syntax Error for a decoration naming a replacement
 * decorator to appear closer to the decorated declaration than one that does
 * not. Replacement decorators run first, so writing them outermost makes source
 * order agree with execution order - and it gives them the capability the
 * arrangement exists for, since a replacement then ENCLOSES the runtime
 * decorations and may rewrite or remove them with what it replaces.
 */
export function FirstReplacementEarlyError(module: ParseNode): ReplacementEarlyError | undefined {
  const names = ReplacementDecoratorNames(module as ParseNode.Module);
  if (names.length === 0) {
    return undefined;
  }
  const wanted = new Set(names);
  let found: ReplacementEarlyError | undefined;
  const seen = new Set<object>();

  const visit = (node: unknown, insideImport: boolean): void => {
    if (found || node === null || typeof node !== 'object' || seen.has(node as object)) {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((n) => visit(n, insideImport));
      return;
    }
    seen.add(node as object);
    const n = node as ParseNode & {
      type?: string,
      name?: string,
      Decorators?: readonly ParseNode[] | null,
    };
    // A binding of a reserved name, anywhere but the import clause that
    // introduced it.
    if (!insideImport && n.type === 'BindingIdentifier' && typeof n.name === 'string' && wanted.has(n.name)) {
      found = { kind: 'shadowed', name: n.name, node: n };
      return;
    }
    // Within one stack, source order is outermost-first, so a replacement that
    // appears AFTER a non-replacement is closer to the declaration than it.
    if (Array.isArray(n.Decorators)) {
      let sawOrdinary = false;
      for (const d of n.Decorators) {
        const name = decorationName(d);
        const isReplacement = name !== undefined && wanted.has(name);
        if (isReplacement && sawOrdinary) {
          found = { kind: 'misplaced', name: name!, node: d };
          return;
        }
        if (!isReplacement) {
          sawOrdinary = true;
        }
      }
    }
    for (const key of Object.keys(n)) {
      if (key === 'location' || key === 'sourceText' || key === 'strict' || key === 'parent') {
        continue;
      }
      visit(
        (n as unknown as Record<string, unknown>)[key],
        insideImport || n.type === 'ImportDeclaration',
      );
    }
  };
  visit(module, false);
  return found;
}
