import {
  CreateDataPropertyOrThrow, OrdinaryObjectCreate, SetIntegrityLevel,
} from './abstract-ops/all.mts';
import { Value, type ObjectValue } from './value.mts';
import { X } from './completion.mts';
import { StampReflectionContext } from './type-system/reflection-contexts.mts';
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
 * A captured region reports `'Block'`: it IS a block, and the engine not
 * parsing its text is a fact about the decorator rather than a second position.
 *
 * EVERY VALUE HERE IS A NAME `decorators.md` DEFINES. An earlier draft carried
 * `'TryBlock'`, `'SwitchBlock'` and `'MatchBlock'`, which it does not - its block
 * family is `Block` and eleven others, and try and switch are not among them.
 * A position with no documented context yields no context rather than an
 * invented one, and `syntax-context.test.mts` fails if that stops being true.
 */
const KIND_BY_PARSE_NODE: Readonly<Record<string, string>> = {
  // `PLAN-region-context-removal` Q2/Q3: a region reports `Block`, the context it
  // IS. `Region` was a position of its own only because the context type carried
  // the capture decision; capture follows from being a replacement decorator now
  // (`#sec-preprocessor-modules`), so a region is a block whose text the engine
  // does not parse, and `Reflect.Block` is what a macro annotates.
  ModedRegion: 'Block',
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
export function SyntaxContextFor(realm: Realm, kind: string, label?: string): ObjectValue {
  const context = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
  // Stamped with the reflection context its `kind` names, so `RuntimeTypeOf`
  // answers `Reflect.Region` (or `Reflect.Class`, and the rest) rather than the
  // bare `object` an unstamped literal gives.
  //
  // Without it a macro's context argument had no nominal type, and OVERLOAD
  // RESOLUTION - which selects on argument types - could not match a parameter
  // annotated `Reflect.Region`. A direct call accepted the same value, because
  // parameter enforcement judges it differently; that asymmetry is what made
  // one name carrying both a replacement and an ordinary decorator impossible.
  // `FINDING-overload-resolution-host-nominals.md`.
  StampReflectionContext(context, kind);
  X(CreateDataPropertyOrThrow(context, Value('kind'), Value(kind)));
  // `label` is the ONE syntactic fact the tokens cannot carry, and that is why
  // it is here when nothing else is. A label PRECEDES the decoration -
  // `lbl:` then `@m` then `{ ... }` - so a span reaching back to include it
  // would contain the decoration being expanded. `decorators.md` already
  // declares `label?: string` on every block reflection, so carrying it makes
  // this context match the document rather than diverge from it.
  if (label !== undefined) {
    X(CreateDataPropertyOrThrow(context, Value('label'), Value(label)));
  }
  X(SetIntegrityLevel(context, 'frozen'));
  return context;
}

/** The label a decorated statement carries, where the parser recorded one. */
export function LabelOfDecoratedNode(node: ParseNode): string | undefined {
  return (node as { BlockLabel?: string }).BlockLabel;
}
