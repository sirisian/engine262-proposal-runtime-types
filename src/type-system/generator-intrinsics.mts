import type { ParseNode } from '../parser/ParseNode.mts';
import type { Realm } from '../execution-context/Realm.mts';
import { ObjectValue, Value, wellKnownSymbols } from '../value.mts';
import { intrinsicData, intrinsicSourceIsStable } from './intrinsic-origin.mts';

const originals = new WeakMap<Realm, { prototype: ObjectValue, iterator: ObjectValue, method: Value | undefined }>();

/** Capture the protocol before user code can replace its data properties. */
export function RememberGeneratorIntrinsics(realm: Realm, prototype: ObjectValue): void {
  const iterator = realm.Intrinsics['%Iterator.prototype%'];
  originals.set(realm, { prototype, iterator, method: intrinsicData(iterator, wellKnownSymbols.iterator) });
}

/**
 * #sec-generator-resume-forwarding: prove a current-source second resume of
 * fresh local generators. An uncalled body cannot promise future intrinsic
 * identity. This deliberately excludes aliases, escapes and unknown effects.
 */
export function ProvenResumedDelegations(root: ParseNode, statements: readonly ParseNode[], realm: Realm): ReadonlySet<ParseNode.YieldExpression> {
  const result = new Set<ParseNode.YieldExpression>();
  const original = originals.get(realm);
  if (!original || !original.method
      || original.prototype !== realm.Intrinsics['%GeneratorPrototype%']
      || (original.prototype as ObjectValue & { Prototype: Value }).Prototype !== original.iterator
      || original.prototype.properties.has(wellKnownSymbols.iterator)
      || intrinsicData(original.prototype, Value('next')) !== realm.Intrinsics['%GeneratorFunction.prototype.prototype.next%']
      || intrinsicData(original.iterator, wellKnownSymbols.iterator) !== original.method) return result;
  const unwrap = (node: ParseNode): ParseNode => {
    while (node.type === 'ParenthesizedExpression') node = node.Expression;
    return node;
  };
  const generators = new Map<string, ParseNode.GeneratorDeclaration>();
  for (const statement of statements) {
    const decorated = statement as ParseNode & { TypeParameters?: unknown, Decorators?: readonly unknown[] };
    if (statement.type === 'GeneratorDeclaration' && statement.BindingIdentifier
        && !decorated.TypeParameters && statement.FormalParameters.length === 0 && !decorated.Decorators?.length) {
      generators.set(statement.BindingIdentifier.name, statement);
    }
  }
  const firstYield = (generator: ParseNode.GeneratorDeclaration): ParseNode.YieldExpression | null => {
    const first = generator.GeneratorBody.FunctionStatementList.find((statement) => statement.type !== 'EmptyStatement');
    const expression = first?.type === 'ExpressionStatement' ? unwrap(first.Expression) : null;
    return expression?.type === 'YieldExpression' ? expression : null;
  };
  const delegateOf = (generator: ParseNode.GeneratorDeclaration): ParseNode.YieldExpression | null => {
    const yielded = firstYield(generator);
    const call = yielded?.hasStar && yielded.AssignmentExpression ? unwrap(yielded.AssignmentExpression) : null;
    if (call?.type !== 'CallExpression' || call.Arguments.length !== 0) return null;
    const callee = unwrap(call.CallExpression);
    const inner = callee.type === 'IdentifierReference' ? generators.get(callee.name) : null;
    const first = inner && firstYield(inner);
    // A literal first yield neither completes the delegate nor invokes code
    // that could change the selected protocol before suspension.
    return first && !first.hasStar && first.AssignmentExpression
      && ['NumericLiteral', 'StringLiteral', 'BooleanLiteral', 'NullLiteral'].includes(first.AssignmentExpression.type) ? yielded : null;
  };
  const fresh = new Map<string, { yielded: ParseNode.YieldExpression, resumes: number }>();
  const safeNodes = new Set<ParseNode>();
  for (const statement of statements) {
    if (statement.type === 'LexicalDeclaration' && statement.LetOrConst === 'const') {
      for (const binding of statement.BindingList) {
        if (!binding.BindingIdentifier || !binding.Initializer || binding.TypeAnnotation) continue;
        const call = unwrap(binding.Initializer);
        if (call.type !== 'CallExpression' || call.Arguments.length !== 0) continue;
        const callee = unwrap(call.CallExpression);
        const generator = callee.type === 'IdentifierReference' ? generators.get(callee.name) : null;
        const yielded = generator && delegateOf(generator);
        if (yielded) fresh.set(binding.BindingIdentifier.name, { yielded, resumes: 0 });
      }
    }
    const call = statement.type === 'ExpressionStatement' ? unwrap(statement.Expression) : null;
    if (call?.type !== 'CallExpression') continue;
    const member = unwrap(call.CallExpression);
    if (member.type !== 'MemberExpression' || member.IdentifierName?.name !== 'next') continue;
    const receiver = unwrap(member.MemberExpression);
    const origin = receiver.type === 'IdentifierReference' ? fresh.get(receiver.name) : null;
    if (!origin) continue;
    safeNodes.add(call);
    safeNodes.add(member);
    origin.resumes += 1;
    if (origin.resumes === 2) result.add(origin.yielded);
  }
  if (!intrinsicSourceIsStable(root, realm, (node) => safeNodes.has(node) || node.type === 'YieldExpression')) result.clear();
  return result;
}
