import type { ParseNode } from '../parser/ParseNode.mts';
import { StringValue } from './all.mts';

/**
 * proposal-runtime-types `sec-static-semantics-replacementdecoratornames`.
 *
 * The names a module's preprocessor imports introduce. A decoration names a
 * REPLACEMENT DECORATOR if and only if its identifier is one of these.
 *
 * **It is computed from the |ImportDeclaration|s alone**, which is the whole
 * point. Deciding by SCOPE would be circular: a replacement decorator may
 * introduce declarations, so the scope to resolve against is not final until
 * expansion has finished, which is the thing being decided. A syntactic scan
 * breaks the cycle, and the price is that a replacement decorator cannot be
 * aliased or locally rebound.
 *
 * It also decides whether to expand AT ALL. A module whose names are empty is
 * parsed unchanged, so a program that uses no replacement decorator observes no
 * phase - and a loader knows from the import clauses alone which modules it must
 * fetch first.
 */
export function ReplacementDecoratorNames(module: ParseNode.Module | ParseNode.ModuleBody | undefined): readonly string[] {
  const names: string[] = [];
  const body = (module as { ModuleBody?: ParseNode.ModuleBody } | undefined)?.ModuleBody ?? module;
  const items = (body as { ModuleItemList?: readonly ParseNode[] } | undefined)?.ModuleItemList ?? [];
  for (const item of items) {
    if (item.type !== 'ImportDeclaration') {
      continue;
    }
    if (!IsPreprocessorImport(item)) {
      continue;
    }
    // **Only NamedImports contribute.** A default import, a namespace import and
    // a bare ModuleSpecifier introduce no name a DECORATION can be spelled with
    // under the Strict Lexical Rule, so a preprocessor module imported any of
    // those ways provides no replacement decorators. Three forms that all parse
    // and none of which works is worth a test each.
    const clause = (item as { ImportClause?: { NamedImports?: { ImportsList?: readonly ParseNode[] } } }).ImportClause;
    for (const spec of clause?.NamedImports?.ImportsList ?? []) {
      const binding = (spec as { ImportedBinding?: ParseNode }).ImportedBinding;
      if (binding) {
        names.push(StringValue(binding as Parameters<typeof StringValue>[0]).stringValue());
      }
    }
  }
  return names;
}

/**
 * The value of an import attribute, or undefined where the declaration carries
 * no such key.
 */
export function ImportAttributeValue(node: ParseNode, wantedKey: string): string | undefined {
  const entries = (node as {
    WithClause?: { WithEntries?: readonly ParseNode[] };
  }).WithClause?.WithEntries ?? [];
  for (const entry of entries) {
    const e = entry as { AttributeKey?: ParseNode, AttributeValue?: { value?: unknown } };
    if (!e.AttributeKey) {
      continue;
    }
    const key = StringValue(e.AttributeKey as Parameters<typeof StringValue>[0]).stringValue();
    if (key === wantedKey) {
      return String(e.AttributeValue?.value);
    }
  }
  return undefined;
}

/**
 * proposal-runtime-types: the lexical MODE each replacement decorator's region
 * is scanned in, where its import declares one.
 *
 * A region a macro decorates is scanned as ECMAScript, which is why a DSL that
 * is not ECMAScript - JSX being the motivating one - cannot reach a macro at
 * all: `<` cannot begin an expression, so the parse fails before the macro is
 * ever consulted.
 *
 * The mode is declared on the IMPORT and keyed by the decoration's NAME, which
 * is what lets a highlighter recognise a region without resolving imports - a
 * TextMate grammar cannot follow one, and keying on the literal name is how
 * `lit-html` and `graphql-tag` are highlighted today.
 *
 * `mode` is one key of an OPEN set: a later key may carry a type contract for
 * completion inside the region, so an implementation must not treat the
 * attribute list as closed.
 */
/**
 * The lexical modes an implementation provides.
 *
 * A mode is host-provided rather than userland: a userland scanner would have to
 * run BEFORE parsing, and the compile-time evaluability gate cannot police it -
 * that gate analyses a function the engine has already parsed. Arbitrary code
 * running before the parse is the capability a CSP-conscious host refuses.
 */
const KNOWN_MODES = new Set(['jsx']);

/**
 * The first import declaring a mode this implementation does not provide, or
 * *undefined*.
 *
 * `sec-preprocessor-modules`: "It is a Syntax Error if the value does not name a
 * mode the implementation provides, reported at the import declaration." Falling
 * back to scanning as ECMAScript instead would fail later, at the `<` of a
 * region the author believed was moded, with a message about an unexpected token
 * rather than about the mode they misspelled.
 */
export function FirstUnknownMode(module: ParseNode): { mode: string, node: ParseNode } | undefined {
  // A |Module| holds its items under [[ModuleBody]]; a |ModuleBody| holds them
  // directly. Reading only the latter silently found NOTHING for a Module,
  // which is the shape ParseModule passes - so the rule below never fired.
  const body = (module as { ModuleBody?: ParseNode } | undefined)?.ModuleBody ?? module;
  const items = (body as { ModuleItemList?: readonly ParseNode[] } | undefined)?.ModuleItemList ?? [];
  for (const item of items) {
    if (!IsPreprocessorImport(item)) {
      continue;
    }
    const mode = ImportAttributeValue(item, 'mode');
    if (mode !== undefined && !KNOWN_MODES.has(mode)) {
      return { mode, node: item };
    }
  }
  return undefined;
}

export function ReplacementDecoratorModes(module: ParseNode): Map<string, string> {
  const modes = new Map<string, string>();
  // A |Module| holds its items under [[ModuleBody]]; a |ModuleBody| holds them
  // directly. Reading only the latter silently found NOTHING for a Module,
  // which is the shape ParseModule passes - so the rule below never fired.
  const body = (module as { ModuleBody?: ParseNode } | undefined)?.ModuleBody ?? module;
  const items = (body as { ModuleItemList?: readonly ParseNode[] } | undefined)?.ModuleItemList ?? [];
  for (const item of items) {
    if (!IsPreprocessorImport(item)) {
      continue;
    }
    const mode = ImportAttributeValue(item, 'mode');
    if (mode === undefined) {
      continue;
    }
    const clause = (item as { ImportClause?: { NamedImports?: { ImportsList?: readonly ParseNode[] } } }).ImportClause;
    for (const spec of clause?.NamedImports?.ImportsList ?? []) {
      const binding = (spec as { ImportedBinding?: ParseNode }).ImportedBinding;
      if (binding) {
        modes.set(StringValue(binding as Parameters<typeof StringValue>[0]).stringValue(), mode);
      }
    }
  }
  return modes;
}

/** Whether an |ImportDeclaration| carries `preprocessor` set to `"true"`. */
export function IsPreprocessorImport(node: ParseNode): boolean {
  const entries = (node as {
    WithClause?: { WithEntries?: readonly ParseNode[] };
  }).WithClause?.WithEntries ?? [];
  for (const entry of entries) {
    const e = entry as { AttributeKey?: ParseNode, AttributeValue?: { value?: unknown } };
    if (!e.AttributeKey) {
      continue;
    }
    const key = StringValue(e.AttributeKey as Parameters<typeof StringValue>[0]).stringValue();
    // The specification requires [[Value]] to be *"true"* - an import attribute's
    // value is a StringLiteral, so this is the string and not the boolean.
    if (key === 'preprocessor' && String(e.AttributeValue?.value) === 'true') {
      return true;
    }
  }
  return false;
}
