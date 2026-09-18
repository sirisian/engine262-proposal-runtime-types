import type { TypeRecord } from './records.mts';
import { IsReferenceClass, LayoutOf } from './layout.mts';

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
      if (record.Kind === 'parameterized') {
        // A parameterization is stored as its base is, so it is the base that
        // decides whether this edge is inline and whether it continues a cycle.
        // Left unwrapped, `brand(SomeValueClass, 'X')` reached the LayoutOf
        // fallback as an opaque leaf: now that a parameterization HAS a layout,
        // that fallback would answer *true* and the walk would stop, so a cycle
        // running through a branded class field would go unreported.
        return fieldType(record.Base, key);
      }
      if (record.Kind === 'union') {
        // #sec-optional-values: a `T | null` over a value type class is now
        // INLINE, so the recursion descends into the payload instead of stopping
        // at it. Left as a leaf it read as laid out - the optional HAS a layout
        // now - and `class C { c: C | null; }` was accepted with no finite size.
        // Over a reference type it still stops, that being where the indirection
        // moved to.
        // Descend through `collect`, NOT through `LayoutOf(payload)`. A class
        // whose layout is still being computed answers *null* to LayoutOf, so
        // testing it here read a self-referential payload as a reference and
        // lost the very cycle this walk exists to find. `collect` answers from
        // the DECLARATION, which is available whether or not the layout is.
        const payload = record.Members.find((m) => m.Kind === 'nominal');
        if (payload !== undefined && !IsReferenceClass(payload)) {
          const target = collect(payload);
          if (target) {
            node.edges.push({ target, key });
            target.incoming.push(node);
            return true;
          }
        }
        // No collectable payload: a `dynamic` class, one with an untyped field,
        // or a reference type. The union is then whatever LayoutOf makes it,
        // which for these is a reference's width.
        return LayoutOf(record) !== null;
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
