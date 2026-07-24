import type { ParseNode } from '../parser/ParseNode.mts';
import { EnsureCompletion, Q } from '../completion.mts';
import type { PlainEvaluator } from '../evaluator.mts';
import {
  anyType, builtinTypeRecord, makePrimitive, voidType, displayType, type TypeRecord,
} from './records.mts';
import { TypeNodeToTypeRecord } from './runtime.mts';
import { surroundingAgent, Value } from '#self';

/**
 * proposal-runtime-types: the static checker, Phase 1 of STATIC-CHECKER-PLAN.md.
 *
 * This is the pass, the environment, and the diagnostic channel, and nothing
 * more. It assigns a Static Type to the expression forms
 * `sec-static-type-of-an-expression` gives without reference to a later feature,
 * carries annotated bindings in a scope chain, and COLLECTS diagnostics rather
 * than throwing them, so one pass reports every error in a program instead of
 * the first.
 *
 * IT CHANGES NO PROGRAM'S BEHAVIOUR, deliberately. It is reached only through
 * the host-facing entry point below, so it can land, be exercised, and be judged
 * on whether it reads the language correctly before anything depends on its
 * answers. That ordering is the point of the phase: a checker that misunderstands
 * the program is worse than no checker, and the cheapest way to find out is to
 * run it over every program the suite already has and require silence.
 *
 * WHAT IT DOES NOT DO YET, each belonging to a later phase: assignability
 * diagnostics and the metadata subtype judgment (Phase 2), contextual types and
 * overload resolution at a call (Phase 3), narrowing and exhaustiveness
 * (Phase 4). Where a form's type depends on one of those, this pass answers
 * `any`, which is the correct conservative answer and not a placeholder: `any`
 * is exactly "the checker knows nothing here", and every judgment that consumes
 * a Static Type already treats it as admitting everything.
 */

export interface Diagnostic {
  readonly message: string;
  readonly line: number;
  readonly column: number;
}

/**
 * A scope chain of names to Type Records, parallel to the lexical environment
 * but carrying types rather than values. Separate from the runtime environment
 * on purpose: the checker runs before evaluation and must not depend on, or
 * disturb, anything the evaluator holds.
 */
export class TypeEnvironment {
  private readonly names = new Map<string, TypeRecord>();

  /**
   * Declared TYPES, in their own namespace. A type and a value may share a name,
   * `type Point = ...` beside `const Point = ...`, and a type annotation reads
   * the first while an expression reads the second, so one map cannot serve both.
   */
  private readonly typeNames = new Map<string, TypeRecord>();

  readonly parent: TypeEnvironment | undefined;

  constructor(parent?: TypeEnvironment) {
    this.parent = parent;
  }

  declare(name: string, type: TypeRecord): void {
    this.names.set(name, type);
  }

  /** The type bound to a name, or *undefined* where the checker knows of none. */
  lookup(name: string): TypeRecord | undefined {
    return this.names.get(name) ?? this.parent?.lookup(name);
  }

  declareType(name: string, type: TypeRecord): void {
    this.typeNames.set(name, type);
  }

  lookupType(name: string): TypeRecord | undefined {
    return this.typeNames.get(name) ?? this.parent?.lookupType(name);
  }
}

/** The collected result of a pass. */
export interface CheckResult {
  readonly diagnostics: readonly Diagnostic[];
  /** The Static Type the pass assigned to each expression it visited. */
  readonly types: ReadonlyMap<ParseNode, TypeRecord>;
}

function positionOf(node: ParseNode): { line: number, column: number } {
  const location = (node as { location?: { start?: { line: number, column: number } } }).location;
  return { line: location?.start?.line ?? 0, column: location?.start?.column ?? 0 };
}

class Checker {
  readonly diagnostics: Diagnostic[] = [];

  readonly types = new Map<ParseNode, TypeRecord>();

  report(node: ParseNode, message: string): void {
    const { line, column } = positionOf(node);
    this.diagnostics.push({ message, line, column });
  }

  /**
   * #sec-static-type-of-an-expression. Syntax-directed, and deliberately partial:
   * a form this phase does not understand is `any` rather than an error, since a
   * checker that reports what it has not implemented is a checker nobody can run.
   */
  * staticTypeOf(node: ParseNode | null | undefined, env: TypeEnvironment): PlainEvaluator<TypeRecord> {
    if (!node) {
      return anyType;
    }
    const type = Q(yield* this.computeStaticType(node, env));
    this.types.set(node, type);
    return type;
  }

  private* computeStaticType(node: ParseNode, env: TypeEnvironment): PlainEvaluator<TypeRecord> {
    switch (node.type) {
      // A literal has the literal type of its value, whose base is the primitive
      // the literal denotes. The literal RULE, that a literal takes the type its
      // position requires, is a matter of contextual typing and belongs to
      // Phase 3; what this reports is the type a literal has on its own.
      case 'NumericLiteral':
        return makePrimitive('number');
      case 'StringLiteral':
        return makePrimitive('string');
      case 'BooleanLiteral':
        return makePrimitive('boolean');
      case 'NullLiteral':
        return makePrimitive('object');
      case 'BigIntLiteral' as ParseNode['type']:
        return makePrimitive('bigint');
      case 'IdentifierReference': {
        const name = (node as ParseNode.IdentifierReference).name;
        return env.lookup(name) ?? anyType;
      }
      case 'ParenthesizedExpression':
        return Q(yield* this.staticTypeOf((node as { Expression?: ParseNode }).Expression, env));
      case 'CommaOperator': {
        // The type of a comma expression is the type of its last operand.
        const list = (node as { ExpressionList?: readonly ParseNode[] }).ExpressionList ?? [];
        let last: TypeRecord = anyType;
        for (const e of list) {
          last = Q(yield* this.staticTypeOf(e, env));
        }
        return last;
      }
      default:
        return anyType;
    }
  }

  /**
   * Walk a statement, declaring what it binds and typing what it evaluates. The
   * traversal is structural over the node's own children, so a form this phase
   * has no case for is still descended into and its expressions still typed.
   */
  private readonly visited = new WeakSet<object>();

  * statement(node: ParseNode | null | undefined, env: TypeEnvironment): PlainEvaluator {
    if (!node || typeof node !== 'object' || this.visited.has(node)) {
      return;
    }
    this.visited.add(node);
    // An annotated lexical binding is what puts a type into the environment, and
    // is the reason the environment exists at all before Phase 2.
    if (node.type === 'LexicalDeclaration' || node.type === 'VariableStatement') {
      for (const decl of childNodes(node)) {
        Q(yield* this.bindDeclaration(decl, env));
      }
    }
    for (const child of childNodes(node)) {
      if (isExpressionish(child)) {
        Q(yield* this.staticTypeOf(child, env));
      }
      Q(yield* this.statement(child, env));
    }
  }

  /**
   * Collect every type a program declares before typing anything in it.
   *
   * This is what lets the checker resolve a type NAME at all. The runtime's
   * `TypeNodeToTypeRecord` resolves one through `ResolveBinding`, against the
   * runtime lexical environment, which does not exist yet when the checker runs;
   * reaching for it asserts rather than failing catchably. So the checker keeps
   * its own type namespace and fills it here.
   *
   * The pre-pass is separate from the walk, and must be, because a type may be
   * used before it is declared: `let a: Later = ...; type Later = ...` is legal,
   * and a single-pass walk would resolve the annotation against an empty
   * namespace. Collecting first is the whole reason this is two passes.
   */
  collectTypes(node: ParseNode | null | undefined, env: TypeEnvironment): void {
    if (!node || typeof node !== 'object') {
      return;
    }
    const binding = (node as { BindingIdentifier?: { name?: string } }).BindingIdentifier;
    if (binding?.name) {
      if (node.type === 'TypeAliasDeclaration') {
        const aliased = (node as { Type?: ParseNode }).Type;
        env.declareType(binding.name, aliased ? this.resolveTypeNode(aliased, env) : anyType);
      } else if (node.type === 'InterfaceDeclaration' || node.type === 'EnumDeclaration') {
        // Both are nominal: the declaration IS the identity, so the record can be
        // built without resolving the members, which is what lets a self-referring
        // interface be collected without recursing forever.
        env.declareType(binding.name, { Kind: 'nominal', Declaration: node, Arguments: [] } as TypeRecord);
      }
    }
    for (const child of childNodes(node)) {
      this.collectTypes(child, env);
    }
  }

  /**
   * The checker's own Type node to Type Record, consulting the type namespace
   * rather than the runtime environment. Deliberately partial in the same way
   * `staticTypeOf` is: a form it does not handle is `any`, which admits
   * everything and so cannot make the checker wrong, only imprecise.
   */
  resolveTypeNode(node: ParseNode | null | undefined, env: TypeEnvironment): TypeRecord {
    if (!node) {
      return anyType;
    }
    switch (node.type) {
      case 'TypeReference': {
        const typeName = (node as ParseNode.TypeReference).TypeName as {
          IdentifierReference?: { name?: string }, MemberNames?: readonly unknown[],
        };
        if (typeName?.MemberNames?.length) {
          return anyType;
        }
        const name = typeName?.IdentifierReference?.name;
        if (!name) {
          return anyType;
        }
        // A declared type first, then the builtin table. That order matters: a
        // program may shadow a builtin name, and the declaration wins.
        return env.lookupType(name) ?? builtinTypeRecord(name) ?? anyType;
      }
      case 'LiteralType': {
        const literal = node as ParseNode.LiteralType;
        if (literal.kind === 'imaginary') {
          // The runtime refuses this form; the checker declines to invent one.
          return anyType;
        }
        const raw = literal.negated && typeof literal.value === 'number' ? -literal.value : literal.value;
        return { Kind: 'literal', Value: Value(raw as never), Base: literalBaseOf(literal.kind) } as TypeRecord;
      }
      case 'PatternType': {
        const pattern = node as ParseNode.PatternType;
        return { Kind: 'pattern', Source: pattern.Source, Flags: pattern.Flags } as TypeRecord;
      }
      case 'ObjectType': {
        const Properties: { key: string, type: TypeRecord, optional: boolean, readonly: boolean }[] = [];
        const members = (node as { TypeMemberList?: readonly ParseNode[] }).TypeMemberList ?? [];
        for (const member of members) {
          if (member.type === 'IndexSignature') {
            // An index signature does not name a property, and the checker's
            // consumers read Properties; carrying it needs the same shape the
            // runtime builds and is left with the rest of the structural work.
            continue;
          }
          const m = member as unknown as {
            TypeMemberName?: { name?: string, value?: unknown },
            TypeAnnotation?: { Type?: ParseNode } | null,
            Optional?: boolean, Readonly?: boolean,
          };
          const rawKey = m.TypeMemberName?.name ?? m.TypeMemberName?.value;
          const key = typeof rawKey === 'number' || typeof rawKey === 'bigint' ? String(rawKey) : rawKey;
          if (typeof key !== 'string') {
            continue;
          }
          Properties.push({
            key,
            type: m.TypeAnnotation?.Type ? this.resolveTypeNode(m.TypeAnnotation.Type, env) : anyType,
            optional: !!m.Optional,
            readonly: !!m.Readonly,
          });
        }
        return { Kind: 'object', Properties, IndexSignatures: [] } as TypeRecord;
      }
      case 'ArrayType': {
        const args = (node as { TypeArguments?: { TypeArgumentList?: readonly ParseNode[] } | null }).TypeArguments;
        const first = args?.TypeArgumentList?.[0];
        const Element = first ? this.resolveTypeNode(first, env) : anyType;
        const extentNode = (node as { ArrayExtent?: ParseNode | null }).ArrayExtent;
        // A literal extent is read directly. A computed one evaluates, which the
        // checker will not do here: `dynamic` is the conservative answer and the
        // evaluation budget question belongs with the plan's open items.
        const Extent = extentNode && extentNode.type === 'NumericLiteral'
          ? (extentNode as unknown as { value: number }).value
          : 'dynamic';
        return { Kind: 'array', Element, Extent } as TypeRecord;
      }
      case 'TupleType': {
        const elements = (node as { TypeList?: readonly ParseNode[], Elements?: readonly ParseNode[] });
        const list = elements.TypeList ?? elements.Elements ?? [];
        return {
          Kind: 'tuple',
          Elements: list.map((e) => ({ Type: this.resolveTypeNode(e, env), Rest: false, Initial: 'none' })),
        } as TypeRecord;
      }
      case 'UnionType':
      case 'IntersectionType': {
        const members = childNodes(node)
          .filter((c) => c.type.endsWith('Type') || c.type === 'TypeReference')
          .map((c) => this.resolveTypeNode(c, env));
        return members.length
          ? ({ Kind: node.type === 'UnionType' ? 'union' : 'intersection', Members: members } as TypeRecord)
          : anyType;
      }
      default:
        return anyType;
    }
  }

  private* bindDeclaration(node: ParseNode, env: TypeEnvironment): PlainEvaluator {
    const annotation = (node as { TypeAnnotation?: { Type?: ParseNode } | null }).TypeAnnotation;
    const binding = (node as { BindingIdentifier?: { name?: string } }).BindingIdentifier;
    if (!binding?.name || !annotation?.Type) {
      return undefined;
    }
    // This is the line the whole generator conversion exists for.
    // TypeNodeToTypeRecord is an evaluator, because a type expression may run a
    // builder, so resolving an annotation makes the pass effectful.
    //
    // A malformed annotation is COLLECTED rather than propagated. Letting the
    // completion escape would stop the pass at the first bad annotation, and a
    // pass that stops cannot make the claim Phase 1 rests on, that it walks a
    // whole program and reports what it finds.
    //
    // Resolved against the CHECKER's type namespace, filled by collectTypes.
    // The runtime's TypeNodeToTypeRecord is not usable here: it resolves a type
    // name through ResolveBinding against the runtime lexical environment, which
    // does not exist when the checker runs, and it asserts rather than failing
    // catchably. Where a running environment does happen to exist, it is still
    // preferred, because it handles every form this one does not.
    if (hasUsableEnvironment()) {
      const attempt = EnsureCompletion(yield* TypeNodeToTypeRecord(annotation.Type as never));
      if (attempt.Type !== 'throw') {
        env.declare(binding.name, attempt.Value as TypeRecord);
        return undefined;
      }
      this.report(node, `the annotation on ${binding.name} could not be resolved`);
    }
    env.declare(binding.name, this.resolveTypeNode(annotation.Type as ParseNode, env));
    return undefined;
  }
}

/**
 * Nodes reachable as own properties, in source order where an array.
 *
 * `parent` is skipped, and skipping it is not an optimization: a ParseNode
 * carries a back-reference, so a structural walk that followed every object
 * property would climb out of the subtree and back down forever. A visited set
 * guards the rest, since a tree is not guaranteed to be one.
 */
const BACK_REFERENCES = new Set(['parent', 'scriptOrModule', 'strict', 'sourceText', 'location']);

function childNodes(node: ParseNode): ParseNode[] {
  const out: ParseNode[] = [];
  for (const [key, value] of Object.entries(node as unknown as Record<string, unknown>)) {
    if (BACK_REFERENCES.has(key)) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const v of value) {
        if (isNode(v)) {
          out.push(v);
        }
      }
    } else if (isNode(value)) {
      out.push(value as ParseNode);
    }
  }
  return out;
}

/**
 * Whether a running execution context with a real lexical environment exists.
 * See the limitation noted in `bindDeclaration`: without one, resolving a type
 * name asserts inside ResolveBinding rather than failing catchably, so the pass
 * declines to try rather than taking the host down.
 */
function hasUsableEnvironment(): boolean {
  const context = (surroundingAgent as unknown as {
    runningExecutionContext?: { LexicalEnvironment?: unknown },
  }).runningExecutionContext;
  const env = context?.LexicalEnvironment;
  return !!env && typeof env === 'object' && 'HasBinding' in (env as object);
}

/** The base of a literal type, mirroring the runtime's own mapping. */
function literalBaseOf(kind: string): TypeRecord {
  switch (kind) {
    case 'number': return makePrimitive('number');
    case 'string': return makePrimitive('string');
    case 'boolean': return makePrimitive('boolean');
    case 'bigint': return makePrimitive('bigint');
    default: return anyType;
  }
}

function isNode(v: unknown): v is ParseNode {
  return !!v && typeof v === 'object' && typeof (v as { type?: unknown }).type === 'string'
    && 'location' in (v as object);
}

function isExpressionish(node: ParseNode): boolean {
  return node.type.endsWith('Literal') || node.type === 'IdentifierReference'
    || node.type === 'ParenthesizedExpression' || node.type === 'CommaOperator';
}

/**
 * Run the pass over a parsed program.
 *
 * Host-facing, like the provenance channel: an embedder or a tool calls it, and
 * no program can. That is what makes it inert. When a later phase makes its
 * diagnostics load-bearing, the decision of what a diagnostic DOES, an Early
 * Error or a warning a host may ignore, is the one the plan leaves open, and
 * this signature does not prejudge it.
 */
export function* CheckProgram(program: ParseNode): PlainEvaluator<CheckResult> {
  const checker = new Checker();
  const env = new TypeEnvironment();
  // Two passes: collect every declared type, then walk. A type may be used
  // before it is declared, so one pass would resolve against an empty namespace.
  checker.collectTypes(program, env);
  Q(yield* checker.statement(program, env));
  return { diagnostics: checker.diagnostics, types: checker.types };
}

/** The Static Type of one expression in a fresh environment, for a tool or a test. */
export function* StaticTypeOfExpression(node: ParseNode, env = new TypeEnvironment()): PlainEvaluator<TypeRecord> {
  return Q(yield* new Checker().staticTypeOf(node, env));
}

export { displayType, voidType };
