import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const catalogText = await readFile(new URL('src/type-system/diagnostic-catalog.mts', root), 'utf8');
const catalog = JSON.parse(catalogText.slice(catalogText.indexOf(' = [') + 3, catalogText.indexOf(' as const;')));
const hash = catalogText.match(/Catalog SHA-256: (\w+)/)[1];
const payload = JSON.stringify({ schemaVersion: 1, edition: 'ECMA-262 2025', diagnostics: catalog }, null, 2) + '\n';
if (createHash('sha256').update(payload).digest('hex') !== hash) {
  throw new Error('The pinned diagnostic catalog was changed without regeneration');
}
const rules = new Map(catalog.map((entry) => [entry.rule, entry]));
if (rules.size !== catalog.length) {
  throw new Error('Duplicate diagnostic rule');
}
const problems = [];
const sites = [];
const emitters = new Set(['reportType', 'CreateTypeDiagnostic', 'ReportTypeDiagnostic']);
function alternatives(node) {
  if (node && ts.isStringLiteral(node)) {
    return [node.text];
  }
  if (node && ts.isConditionalExpression(node)) {
    const yes = alternatives(node.whenTrue);
    const no = alternatives(node.whenFalse);
    return yes && no ? [...yes, ...no] : undefined;
  }
  return undefined;
}
function wrapper(node) {
  for (let scope = node.parent; scope; scope = scope.parent) {
    if (ts.isFunctionDeclaration(scope)) {
      return scope.name?.text;
    }
    if (ts.isArrowFunction(scope) && ts.isVariableDeclaration(scope.parent)) {
      return scope.parent.name.getText();
    }
  }
  return undefined;
}
const files = (await readdir(new URL('src/', root), { recursive: true })).filter((file) => file.endsWith('.mts')).sort();
for (const file of files) {
  const source = await readFile(new URL(`src/${file}`, root), 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(tree);
      const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
      const at = `src/${file}:${line}`;
      if (name.includes('Throw.StaticTypeError') && file !== 'type-system/diagnostics.mts') {
        problems.push(`${at}: use a registered diagnostic`);
      }
      if (emitters.has(name)) {
        const selected = alternatives(node.arguments[name === 'ReportTypeDiagnostic' ? 1 : 0]);
        if (selected) {
          for (const rule of selected) {
            if (!rules.has(rule) || rules.get(rule).status === 'retired') {
              problems.push(`${at}: unknown or retired rule ${rule}`);
            }
          }
          const sourceArgument = node.arguments[name === 'ReportTypeDiagnostic' ? 2 : 1];
          if (!sourceArgument || sourceArgument.kind === ts.SyntaxKind.NullKeyword
              || sourceArgument.getText(tree) === 'undefined') {
            problems.push(`${at}: missing obligation source`);
          }
          const messageIndex = name === 'reportType' ? 2 : name === 'CreateTypeDiagnostic' ? 3 : 4;
          const message = node.arguments[messageIndex];
          if (message && ts.isStringLiteralLike(message)) {
            const used = [...message.text.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
            if (Math.max(0, ...used) > node.arguments.length - messageIndex - 1
                && !node.arguments.some(ts.isSpreadElement)) {
              problems.push(`${at}: missing formatted argument`);
            }
          }
          sites.push({ file: `src/${file}`, line, rules: selected, source: sourceArgument?.getText(tree) });
        } else if (!(file === 'type-system/check.mts' && wrapper(node) === 'reportType')
            && !(file === 'type-system/diagnostics.mts' && wrapper(node) === 'ReportTypeDiagnostic')) {
          problems.push(`${at}: diagnostic rule must be explicit`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
}
if (problems.length) {
  throw new Error(problems.join('\n'));
}
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ catalogHash: hash, sites }, null, 2));
} else {
  console.log(`Validated ${sites.length} registered emission sites and ${rules.size} rules. Source-tree locations are available with --json.`);
}
