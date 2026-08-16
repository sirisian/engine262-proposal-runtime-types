import {
  CreateDataPropertyOrThrow, OrdinaryObjectCreate, SetIntegrityLevel,
} from './abstract-ops/all.mts';
import { Value, type ObjectValue } from './value.mts';
import { X } from './completion.mts';
import type { ParseNode } from './parser/ParseNode.mts';
import type { Realm } from '#self';

/**
 * The `kind` a decorated position reports.
 *
 * `decorators.md`: "Every reflection below carries a `kind`, a string naming the
 * context it came from - `'ClassField'`, `'FunctionParameter'`, and so on." So
 * these are the reflection names, and a replacement decorator's context uses the
 * same vocabulary a runtime decorator's does rather than a second one.
 *
 * `'Region'` is the one value that is new, a captured region not being a
 * position `decorators.md` had.
 *
 * EVERY VALUE HERE IS A NAME `decorators.md` DEFINES. An earlier draft carried
 * `'TryBlock'`, `'SwitchBlock'` and `'MatchBlock'`, which it does not - its block
 * family is `Block` and eleven others, and try and switch are not among them.
 * A position with no documented context yields no context rather than an
 * invented one, and `syntax-context.test.mts` fails if that stops being true.
 */
const KIND_BY_PARSE_NODE: Readonly<Record<string, string>> = {
  ModedRegion: 'Region',
  ClassDeclaration: 'Class',
  ClassExpression: 'Class',
  FunctionDeclaration: 'Function',
  FunctionExpression: 'Function',
  AsyncFunctionDeclaration: 'Function',
  GeneratorDeclaration: 'Function',
  AsyncGeneratorDeclaration: 'Function',
  MethodDefinition: 'ClassMethod',
  FieldDefinition: 'ClassField',
  Block: 'Block',
  IfStatement: 'IfBlock',
  ForStatement: 'ForBlock',
  ForInStatement: 'ForInBlock',
  ForOfStatement: 'ForOfBlock',
  WhileStatement: 'WhileBlock',
  DoWhileStatement: 'DoWhileBlock',
  DoExpression: 'DoBlock',
};
/** Every `kind` this implementation can produce, for the vocabulary test. */
export const KIND_NAMES: readonly string[] = [...new Set(Object.values(KIND_BY_PARSE_NODE))];

/** The `kind` for a decorated ParseNode, or *undefined* where it has none. */
export function KindOfDecoratedNode(node: ParseNode): string | undefined {
  const type = (node as { type?: string }).type;
  if (type === undefined) {
    return undefined;
  }
  // A region is a ModedRegion whether it was captured or parsed - the
  // distinction is the decorator's own `capture`, not a second position.
  return KIND_BY_PARSE_NODE[type];
}

/**
 * The context a replacement decorator receives.
 *
 * `{ kind }` and nothing else, and the reason is the one `decoratorreplacement.md`
 * 3.1 gives for having no `source` field beside the tokens: a field beside a
 * token stream is two ways to say one thing. A replacement decorator receives the
 * tokens OF WHAT IT DECORATES, so `name`, `static`, `private`, a `for`'s binding
 * and a match arm's pattern are all in those tokens already. A runtime decorator
 * needs them in its context because it gets no tokens; this one does not.
 *
 * Frozen, because a context is a report and not a channel.
 */
export function SyntaxContextFor(realm: Realm, kind: string): ObjectValue {
  const context = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
  X(CreateDataPropertyOrThrow(context, Value('kind'), Value(kind)));
  X(SetIntegrityLevel(context, 'frozen'));
  return context;
}
