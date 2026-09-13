import type { TypeRecord } from './records.mts';
import { LayoutOf } from './layout.mts';

export interface InlineField {
  readonly key: string;
  readonly type: TypeRecord;
}

interface ClassNode {
  readonly type: TypeRecord;
  readonly edges: { target: ClassNode, key: string }[];
  readonly incoming: ClassNode[];
  blocked: boolean;
}

/**
 * #sec-layout-finiteness: find a cycle among classes whose fields otherwise
 * admit inline layout. Unknown, decorated and non-value layouts are deferred
 * by fieldsOf; LayoutOf classifies the remaining leaf and reference positions.
 */
export function FirstClassInlineCycle(
  roots: readonly TypeRecord[],
  fieldsOf: (type: TypeRecord) => readonly InlineField[] | null | undefined,
): { type: TypeRecord, field: string } | null {
  const nodes = new Map<object, ClassNode>();
  const collect = (type: TypeRecord): ClassNode | undefined => {
    if (type.Kind !== 'nominal' || !type.Declaration) return undefined;
    const known = nodes.get(type.Declaration);
    if (known) return known;
    const fields = fieldsOf(type);
    if (fields === undefined) return undefined;
    const node: ClassNode = { type, edges: [], incoming: [], blocked: fields === null };
    nodes.set(type.Declaration, node);
    const fieldType = (record: TypeRecord, key: string): boolean => {
      if (record.Kind === 'array') {
        return typeof record.Extent === 'number' && fieldType(record.Element, key);
      }
      if (record.Kind === 'nominal') {
        const target = collect(record);
        if (target) {
          node.edges.push({ target, key });
          target.incoming.push(node);
          return true;
        }
      }
      return LayoutOf(record) !== null;
    };
    for (const field of fields ?? []) {
      if (!fieldType(field.type, field.key)) node.blocked = true;
    }
    return node;
  };
  roots.forEach(collect);
  // A field of a reference class is itself a reference. Propagate that fact
  // before looking for cycles so declaration/field order cannot change it.
  const blocked = [...nodes.values()].filter((node) => node.blocked);
  for (let i = 0; i < blocked.length; i += 1) {
    for (const parent of blocked[i]!.incoming) {
      if (!parent.blocked) {
        parent.blocked = true;
        blocked.push(parent);
      }
    }
  }
  const visited = new Set<ClassNode>();
  const active = new Set<ClassNode>();
  const visit = (node: ClassNode): { type: TypeRecord, field: string } | null => {
    if (node.blocked || visited.has(node)) return null;
    active.add(node);
    for (const edge of node.edges) {
      if (edge.target.blocked) continue;
      if (active.has(edge.target)) return { type: node.type, field: edge.key };
      const found = visit(edge.target);
      if (found) return found;
    }
    active.delete(node);
    visited.add(node);
    return null;
  };
  for (const node of nodes.values()) {
    const found = visit(node);
    if (found) return found;
  }
  return null;
}
