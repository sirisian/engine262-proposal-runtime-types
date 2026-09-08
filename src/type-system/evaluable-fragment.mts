import type { ParseNode } from '../parser/ParseNode.mts';

/**
 * proposal-runtime-types #annex-evaluable-fragment: "The fragment is the
 * ECMAScript grammar less the following", which makes the membership test a walk
 * with a rejection list rather than an evaluator. The annex says as much about a
 * standalone implementation of the fragment: "a small tree-walking interpreter,
 * not an embedded engine".
 *
 * The list, and what each rejects:
 *
 *   - |AwaitExpression| and |YieldExpression|, "and every async and generator
 *     form of function, method, and arrow". The suspension forms: evaluation
 *     here runs to completion or is a type error, and a form that can suspend
 *     has no completion to give a type.
 *   - |ClassDeclaration| and |ClassExpression|, because "a builder transforms
 *     and constructs types but does not mint a nominal one".
 *   - A direct or indirect `eval`, the Function constructor, the construction of
 *     a Proxy, and a dynamic `import()`. Each would let evaluation reach code
 *     the fragment does not cover.
 *   - The `debugger` statement.
 *
 * The library rule of the annex - that a built-in is in the fragment when its
 * result is determined by its arguments, it mutates nothing outside values the
 * call created, and it depends on no host or ambient state - is a judgment about
 * BUILT-INS rather than about syntax, and is not decided here. What this decides
 * is the syntactic half, which is what the two initializer positions need.
 */

/** Node types the fragment excludes outright, mapped to what to call them. */
const EXCLUDED_TYPES: ReadonlyMap<string, string> = new Map([
  ['AwaitExpression', 'an await expression'],
  ['YieldExpression', 'a yield expression'],
  ['ClassDeclaration', 'a class declaration'],
  ['ClassExpression', 'a class expression'],
  ['ImportCall', 'a dynamic import()'],
  ['DebuggerStatement', 'a debugger statement'],
  ['AsyncArrowFunction', 'an async arrow function'],
  ['AsyncFunctionDeclaration', 'an async function declaration'],
  ['AsyncFunctionExpression', 'an async function expression'],
  ['AsyncMethod', 'an async method'],
  ['AsyncGeneratorDeclaration', 'an async generator declaration'],
  ['AsyncGeneratorExpression', 'an async generator expression'],
  ['AsyncGeneratorMethod', 'an async generator method'],
  ['GeneratorDeclaration', 'a generator declaration'],
  ['GeneratorExpression', 'a generator expression'],
  ['GeneratorMethod', 'a generator method'],
]);

/**
 * Names whose USE the fragment excludes. `eval` is named directly because the
 * annex excludes the indirect form too, so it is the NAME that is out rather
 * than the call form: `const e = eval;` reaches the same evaluator.
 */
const EXCLUDED_NAMES: ReadonlyMap<string, string> = new Map([
  ['eval', 'a use of eval'],
  ['Function', 'a use of the Function constructor'],
  ['Proxy', 'a use of Proxy'],
]);

function referencedName(node: { type?: string, name?: string }): string | undefined {
  return node.type === 'IdentifierReference' ? node.name : undefined;
}

/**
 * The first form of `node` that the fragment excludes, described for a
 * diagnostic, or *undefined* where the whole subtree is within it.
 *
 * The walk is over own enumerable properties, skipping `parent` - a
 * BaseParseNode carries a back-pointer, so following it would not terminate -
 * and `location`, which holds no nodes.
 */
export function FirstNonEvaluableForm(node: ParseNode | undefined | null): string | undefined {
  const seen = new Set<object>();
  const visit = (value: unknown): string | undefined => {
    if (value === null || typeof value !== 'object') {
      return undefined;
    }
    if (seen.has(value as object)) {
      return undefined;
    }
    seen.add(value as object);
    if (Array.isArray(value)) {
      for (const element of value) {
        const found = visit(element);
        if (found !== undefined) {
          return found;
        }
      }
      return undefined;
    }
    const record = value as { type?: string, name?: string };
    if (typeof record.type === 'string') {
      const excluded = EXCLUDED_TYPES.get(record.type);
      if (excluded !== undefined) {
        return excluded;
      }
      const name = referencedName(record);
      if (name !== undefined) {
        const byName = EXCLUDED_NAMES.get(name);
        if (byName !== undefined) {
          return byName;
        }
      }
    }
    for (const [key, child] of Object.entries(record)) {
      if (key === 'parent' || key === 'location') {
        continue;
      }
      const found = visit(child);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  };
  return visit(node);
}
