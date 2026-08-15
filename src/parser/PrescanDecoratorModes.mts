// proposal-runtime-types: the names a module's preprocessor imports BIND, read
// from SOURCE TEXT before the module is parsed.
//
// It used to read a `mode:` attribute and answer a name-to-mode map. The mode is
// gone: a preprocessor decoration followed by `{` takes a region because it is a
// preprocessor decoration, and WHICH grammar the region is read in comes from the
// macro, which is resolved before the parse. So the scan needs only the names.
//
// Why a pre-scan rather than a walk of the parsed tree, which is how
// `ReplacementDecoratorModes` reads the same information: expansion runs on an
// already-parsed tree and splices a source range, so the first parse must
// already succeed over a moded region - and to scan a region in its mode the
// parser has to know the mode before it gets there. There is no later point.
//
// The scan is deliberately small. An |ImportDeclaration| sits at the top of a
// module and lexes as ordinary ECMAScript, so this cannot itself need a mode,
// and it stops at the first item that is not an import - the modes it is looking
// for cannot appear after one.

/**
 * Matches `import { a, b as c } from "..." with { ... }` and captures the pieces.
 *
 * The specifier is CAPTURED. It was not, because nothing needed it: the mode came
 * from an attribute and the macro from a host hook, so the module was never
 * loaded. Loading it - which is what the specification says happens - needs to
 * know where from.
 */
const IMPORT_WITH_ATTRIBUTES = /\bimport\s*\{([^}]*)\}\s*from\s*('[^']*'|"[^"]*")\s*with\s*\{([^}]*)\}/g;

/** Matches `key: "value"` or `key: 'value'` inside a with-clause. */
const ATTRIBUTE = /([A-Za-z_$][\w$]*|'[^']*'|"[^"]*")\s*:\s*(?:'([^']*)'|"([^"]*)")/g;

function unquote(text: string): string {
  const trimmed = text.trim();
  return /^['"]/.test(trimmed) ? trimmed.slice(1, -1) : trimmed;
}

/**
 * The `{ decoration name -> mode }` a source text's preprocessor imports
 * declare.
 *
 * Answers an empty map for source with no such import, which is every ordinary
 * program - so the cost where nothing uses a mode is one failed regular
 * expression match.
 */
export interface PreprocessorImport {
  /** The module specifier the import names. */
  readonly Specifier: string;
  /** The name the module EXPORTS, which is not the bound one under `as`. */
  readonly ExportName: string;
}

/**
 * The `{ bound name -> import }` a source text's preprocessor imports declare.
 *
 * Keyed by the BOUND name, because that is what a decoration is spelled with -
 * `import { jsx as h }` declares `@h` - and carrying the EXPORT name beside it,
 * because that is what the loaded module must be asked for.
 */
export function PrescanPreprocessorNames(source: string): ReadonlyMap<string, PreprocessorImport> {
  const found = new Map<string, PreprocessorImport>();
  if (!source.includes('preprocessor')) {
    // The attribute name must appear literally for any of this to apply, so a
    // single substring test skips the scan for essentially all source.
    return found;
  }
  IMPORT_WITH_ATTRIBUTES.lastIndex = 0;
  let match = IMPORT_WITH_ATTRIBUTES.exec(source);
  while (match !== null) {
    const [, namedImports, specifier, withClause] = match;
    let isPreprocessor = false;
    ATTRIBUTE.lastIndex = 0;
    let attribute = ATTRIBUTE.exec(withClause);
    while (attribute !== null) {
      if (unquote(attribute[1]) === 'preprocessor' && (attribute[2] ?? attribute[3] ?? '') === 'true') {
        isPreprocessor = true;
      }
      attribute = ATTRIBUTE.exec(withClause);
    }
    if (isPreprocessor) {
      for (const clause of namedImports.split(',')) {
        const text = clause.trim();
        if (text === '') {
          continue;
        }
        // `a` binds `a` and exports `a`; `a as b` binds `b` and exports `a`.
        const as = /\bas\b/.exec(text);
        const exported = (as ? text.slice(0, as.index) : text).trim();
        const bound = (as ? text.slice(as.index + 2) : text).trim();
        if (/^[A-Za-z_$][\w$]*$/.test(bound) && /^[A-Za-z_$][\w$]*$/.test(exported)) {
          found.set(bound, { Specifier: unquote(specifier), ExportName: exported });
        }
      }
    }
    match = IMPORT_WITH_ATTRIBUTES.exec(source);
  }
  return found;
}
