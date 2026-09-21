import type { ParseNode } from './ParseNode.mts';

export type StrictRange = readonly [start: number, end: number];

const bodyKeys = ['FunctionBody', 'GeneratorBody', 'AsyncBody', 'AsyncGeneratorBody', 'ConciseBody', 'AsyncConciseBody'];
const functions = new Set([
  'FunctionDeclaration', 'FunctionExpression', 'GeneratorDeclaration', 'GeneratorExpression',
  'AsyncFunctionDeclaration', 'AsyncFunctionExpression', 'AsyncGeneratorDeclaration', 'AsyncGeneratorExpression',
  'ArrowFunction', 'AsyncArrowFunction', 'MethodDefinition', 'GeneratorMethod', 'AsyncMethod', 'AsyncGeneratorMethod',
  'OperatorDeclaration',
]);

/** Classify syntax only. Nested function signatures belong to the nested unit. */
export function TypedStrictRanges(root: unknown): readonly StrictRange[] {
  const ranges: StrictRange[] = [];
  const seen = new WeakSet<object>();
  const visit = (value: unknown, owner?: ParseNode): boolean => {
    if (!value || typeof value !== 'object' || seen.has(value)) return false;
    seen.add(value);
    if (Array.isArray(value)) {
      let annotated = false;
      for (const item of value) annotated = visit(item, owner) || annotated;
      return annotated;
    }
    const node = value as ParseNode;
    const fields = value as Record<string, unknown>;
    const unit = node.type === 'Script' || functions.has(node.type)
      || (!owner && ['FunctionBody', 'GeneratorBody', 'AsyncBody', 'AsyncGeneratorBody'].includes(node.type));
    const classBoundary = node.type === 'ClassDeclaration' || node.type === 'ClassExpression';
    const scope = unit ? node : classBoundary ? undefined : owner;
    let annotated = node.type === 'TypeAnnotation';
    let outerAnnotated = false;
    for (const key of Object.keys(fields)) {
      if (['parent', 'location', 'sourceText', 'tokenLog'].includes(key)) continue;
      if (unit && (key === 'ClassElementName' || key === 'Decorators')) {
        outerAnnotated = visit(fields[key], owner) || outerAnnotated;
      } else {
        annotated = visit(fields[key], scope) || annotated;
      }
    }
    if (unit && annotated && !node.strict) {
      let start = node.location.startIndex;
      // A method's computed name is evaluated in the enclosing scope. Only
      // its parameters, return annotation, and body acquire its own strictness.
      if (node.type.endsWith('Method') || node.type === 'MethodDefinition') {
        const entries = [fields.UniqueFormalParameters, fields.PropertySetParameterList,
          fields.TypeAnnotation, ...bodyKeys.map((key) => fields[key])].flat();
        start = Math.min(...entries.filter((entry): entry is ParseNode => !!entry && typeof entry === 'object'
          && 'location' in entry).map((entry) => entry.location.startIndex));
      }
      ranges.push([start, node.location.endIndex]);
    }
    return unit ? outerAnnotated : classBoundary ? false : annotated;
  };
  visit(root);
  // An annotated outer unit covers all nested units. Merge so membership is a
  // binary search rather than a scan per token, including for generated source.
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of ranges) {
    const previous = merged.at(-1);
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  return merged;
}
