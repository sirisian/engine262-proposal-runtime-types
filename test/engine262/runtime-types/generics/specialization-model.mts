/**
 * A small model universe for exercising the specialization matcher and the
 * selection rules built on it directly (plan phases 3 and 4). Patterns come from
 * the real parser; subjects are plain records, and every relation the matcher
 * delegates is supplied here. The universe is deliberately not the engine's
 * Type Records: what the tests pin is the matcher's and selector's own logic.
 */
import {
  type SpecializationMatchHost, type NestedConstructor, type PatternSlotParameter, type CaptureBindingRecord,
} from '../../../../src/type-system/specialization-patterns.mts';
import { Agent, ManagedRealm, setSurroundingAgent, Parser } from '#self';
import type { ParseNode } from '#self';

export type M =
  | { readonly k: 'prim', readonly name: string, readonly meta?: Readonly<Record<string, M>> }
  | { readonly k: 'lit', readonly base: string, readonly value: string | number }
  | { readonly k: 'app', readonly ctor: string, readonly args: readonly M[] }
  | { readonly k: 'seq', readonly els: readonly M[] }
  | { readonly k: 'arr', readonly extent: M | 'dynamic', readonly el: M }
  | { readonly k: 'val', readonly v: number | string };

export const prim = (name: string, meta?: Record<string, M>): M => ({ k: 'prim', name, meta });
export const app = (ctor: string, ...args: M[]): M => ({ k: 'app', ctor, args });
export const seq = (...els: M[]): M => ({ k: 'seq', els });
export const arr = (extent: M | 'dynamic', el: M): M => ({ k: 'arr', extent, el });
export const val = (v: number | string): M => ({ k: 'val', v });
export const [uint8, uint16, uint32, uint64, str, type] = ['uint8', 'uint16', 'uint32', 'uint64', 'string', 'type'].map((n) => prim(n));

export function same(a: M, b: M): boolean {
  if (a.k !== b.k) return false;
  switch (a.k) {
    case 'prim': return a.name === (b as typeof a).name;
    case 'lit': return a.base === (b as typeof a).base && Object.is(a.value, (b as typeof a).value);
    case 'val': return Object.is(a.v, (b as typeof a).v);
    case 'app': return a.ctor === (b as typeof a).ctor && a.args.length === (b as typeof a).args.length && a.args.every((x, i) => same(x, (b as typeof a).args[i]));
    case 'seq': return a.els.length === (b as typeof a).els.length && a.els.every((x, i) => same(x, (b as typeof a).els[i]));
    case 'arr': {
      const o = b as typeof a;
      return (a.extent === 'dynamic' ? o.extent === 'dynamic' : o.extent !== 'dynamic' && same(a.extent, o.extent)) && same(a.el, o.el);
    }
    default: return false;
  }
}

export const show = (m: M): string => (m.k === 'prim' ? m.name : m.k === 'val' ? String(m.v) : m.k === 'seq' ? `[${m.els.map(show).join(', ')}]` : m.k === 'app' ? `${m.ctor}.<${m.args.map(show).join(', ')}>` : m.k);

export const param = (Name: string, extra: Partial<PatternSlotParameter<M>> = {}): PatternSlotParameter<M> => ({
  Name, Variadic: false, HasDefault: false, Domain: type, ...extra,
});

export function ctor(Name: string, Parameters: PatternSlotParameter<M>[], defaults: (M | undefined)[] = []): NestedConstructor<M> {
  return {
    Name,
    Parameters,
    argumentsOf: (s) => (s.k === 'app' && s.ctor === Name ? s.args : null),
    defaultOf: (q) => defaults[q],
  };
}

export const constructors: Record<string, NestedConstructor<M>> = {
  Map: ctor('Map', [param('K'), param('V')]),
  Pair: ctor('Pair', [param('A'), param('B')]),
  Box: ctor('Box', [param('T'), param('N', { Domain: uint32, HasDefault: true })], [undefined, val(16)]),
  Tuple: ctor('Tuple', [param('Ts', { Variadic: true })]),
  Tagged: ctor('Tagged', [param('D', { Metadata: true })]),
  Apply: ctor('Apply', [param('W', { Arity: 1 }), param('T')]),
};

export function resolve(node: ParseNode): M {
  const n = node as unknown as { type: string, [k: string]: unknown };
  switch (n.type) {
    case 'TypeReference': {
      const ref = node as ParseNode.TypeReference;
      const name = ref.TypeName.IdentifierReference.name;
      if (ref.TypeArguments) {
        return app(name, ...ref.TypeArguments.TypeArgumentList.map((a) => resolve(a as unknown as ParseNode)));
      }
      if (['uint8', 'uint16', 'uint32', 'uint64', 'string', 'type', 'float32'].includes(name)) return prim(name);
      throw new Error(`${name} is not defined`);
    }
    case 'LiteralType': {
      const lit = node as ParseNode.LiteralType;
      return val(lit.negated ? -(lit.value as number) : lit.value as number | string);
    }
    case 'NumericLiteral': {
      const v = n.value as number | { numberValue(): number };
      // The model universe holds plain numbers, not engine values.
      // eslint-disable-next-line @engine262/mathematical-value
      return val(typeof v === 'number' ? v : v.numberValue());
    }
    case 'TupleType':
      return seq(...(node as ParseNode.TupleType).TupleElementList.map((e) => resolve(e.Type)));
    default:
      throw new Error(`unsupported ${n.type}`);
  }
}

export const host: SpecializationMatchHost<M> = {
  resolveFixed: resolve,
  sameArgument: same,
  // A literal refines its base: the relation a type-subject leaf uses.
  structuralMatch: (s, f) => same(s, f) || (s.k === 'lit' && f.k === 'prim' && s.base === f.name),
  constructorOf: (name) => constructors[name.IdentifierReference.name] ?? null,
  arrayOf: (s) => (s.k === 'arr' ? { Extent: s.extent, Element: s.el } : null),
  sequenceOf: (s) => (s.k === 'seq' ? s.els : null),
  makeSequence: (els) => seq(...els),
  metadataOf: (s, meta) => (s.k === 'prim' ? s.meta?.[meta.sourceText] ?? null : null),
  // `Wrap(T)`: a builder, run forward over captures already bound.
  evaluate: (node, env) => {
    const call = node as ParseNode.ComputedType;
    const argument = call.Arguments[0] as unknown as ParseNode.IdentifierReference;
    return app('Wrapped', env.get(argument.name)!);
  },
  // `Small` admits uint8 and uint16.
  satisfiesBound: (v, bound) => bound.sourceText !== 'Small' || same(v, uint8) || same(v, uint16),
};

/** The TypeParameters of `class X<...> {}`, ignoring the early error that selection is not supported. */
export function list(entries: string): ParseNode.TypeParameters {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const pop = realm.pushTopContext();
  let script: ParseNode.Script;
  try {
    const parser = new Parser({ source: `class X<${entries}> {}` });
    script = (parser as unknown as { parseScript(): ParseNode.Script }).parseScript();
  } finally {
    pop?.();
  }
  const declaration = script.ScriptBody!.StatementList[0] as ParseNode.ClassDeclaration;
  return declaration.TypeParameters!;
}

export const bindings = (r: CaptureBindingRecord<M>[] | 'no-match'): string | Record<string, string> => (r === 'no-match'
  ? r
  : Object.fromEntries(r.map((b) => [b.Capture.Name, show(b.Value)])));

