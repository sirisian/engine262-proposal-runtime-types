// proposal-runtime-types: the lexical modes a module's preprocessor imports
// declare, read from SOURCE TEXT before the module is parsed.
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

/** Matches `import { a, b as c } from "..." with { ... }` and captures the pieces. */
const IMPORT_WITH_ATTRIBUTES = /\bimport\s*\{([^}]*)\}\s*from\s*(?:'[^']*'|"[^"]*")\s*with\s*\{([^}]*)\}/g;

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
export function PrescanDecoratorModes(source: string): ReadonlyMap<string, string> {
  const modes = new Map<string, string>();
  if (!source.includes('preprocessor')) {
    // The attribute name must appear literally for any of this to apply, so a
    // single substring test skips the scan for essentially all source.
    return modes;
  }
  IMPORT_WITH_ATTRIBUTES.lastIndex = 0;
  let match = IMPORT_WITH_ATTRIBUTES.exec(source);
  while (match !== null) {
    const [, namedImports, withClause] = match;
    let isPreprocessor = false;
    let mode: string | undefined;
    ATTRIBUTE.lastIndex = 0;
    let attribute = ATTRIBUTE.exec(withClause);
    while (attribute !== null) {
      const key = unquote(attribute[1]);
      const value = attribute[2] ?? attribute[3] ?? '';
      if (key === 'preprocessor' && value === 'true') {
        isPreprocessor = true;
      } else if (key === 'mode') {
        mode = value;
      }
      attribute = ATTRIBUTE.exec(withClause);
    }
    if (isPreprocessor && mode !== undefined) {
      for (const specifier of namedImports.split(',')) {
        // `a` binds `a`; `a as b` binds `b`, which is the name a decoration is
        // spelled with and therefore the name a mode is keyed by.
        const parts = specifier.trim().split(/\s+as\s+/);
        const bound = (parts[parts.length - 1] ?? '').trim();
        if (bound !== '') {
          modes.set(bound, mode);
        }
      }
    }
    match = IMPORT_WITH_ATTRIBUTES.exec(source);
  }
  return modes;
}
