import { SourceTextModuleRecord } from '../modules.mts';
import { isModuleNamespaceObject } from '../abstract-ops/module-namespace-exotic-objects.mts';
import { JSStringValue, Value } from '../value.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { surroundingAgent } from '#self';
import {
  CompileTimeEvaluabilityChecker, ModuleBindingDeclaration, ResolveBindingDeclaration, type BindingDeclaration,
} from './compile-time-evaluability.mts';

function sourceRoot(node: ParseNode): ParseNode {
  while (node.parent) node = node.parent;
  return node;
}

/** Check the original lexical declarations; neither reading values nor running bodies is needed. */
export function BuilderEvaluabilityViolation(call: ParseNode.ComputedType, callee: Value): string | undefined {
  return TypeExpressionEvaluabilityViolation(call, callee);
}

export function TypeExpressionEvaluabilityViolation(expression: ParseNode, callee: Value = Value.undefined): string | undefined {
  const fn = callee as { ECMAScriptCode?: { parent?: ParseNode }, ScriptOrModule?: unknown };
  const modules = new Map<ParseNode, SourceTextModuleRecord>();
  for (const module of [surroundingAgent.runningExecutionContext.ScriptOrModule, fn.ScriptOrModule]) {
    if (module instanceof SourceTextModuleRecord) modules.set(module.ECMAScriptCode, module);
  }
  const resolve = (reference: ParseNode, name: string): BindingDeclaration | undefined => {
    let declaration = ResolveBindingDeclaration(reference, name);
    const seen = new Set<unknown>();
    while (declaration?.kind === 'import') {
      const module = modules.get(sourceRoot(declaration.node));
      const binding = module?.Environment?.bindings.get(Value(name));
      if (!binding || seen.has(binding)) return declaration;
      seen.add(binding);
      let target;
      let targetName;
      if (binding.indirect) {
        [target, targetName] = binding.target;
      } else {
        // Namespace member lookup uses export resolution, never a property
        // getter or a dependency-body evaluation.
        if (!binding.initialized || !binding.value || !isModuleNamespaceObject(binding.value)) return declaration;
        const parent = reference.parent;
        const member = parent?.type === 'TypeName' ? parent.MemberNames[0]?.name
          : parent?.type === 'MemberExpression' && parent.MemberExpression === reference
            ? parent.IdentifierName?.name ?? (parent.Expression?.type === 'StringLiteral' ? parent.Expression.value : undefined)
            : undefined;
        if (member === undefined) return declaration;
        const exported = binding.value.Module.ResolveExport(Value(member));
        if (!exported || exported === 'ambiguous' || !(exported.BindingName instanceof JSStringValue)) return declaration;
        target = exported.Module;
        targetName = exported.BindingName;
      }
      if (!(target instanceof SourceTextModuleRecord)) return declaration;
      modules.set(target.ECMAScriptCode, target);
      name = targetName.stringValue();
      declaration = ModuleBindingDeclaration(target.ECMAScriptCode, name);
    }
    return declaration;
  };
  const mutations = new Map<ParseNode, { declarations: Set<ParseNode>, eval: boolean }>();
  const assigned = (name: string, reference: ParseNode): boolean => {
    const declaration = resolve(reference, name);
    if (!declaration) return false;
    const root = sourceRoot(declaration.node);
    let facts = mutations.get(root);
    if (!facts) {
      facts = { declarations: new Set(), eval: false };
      mutations.set(root, facts);
      const target = (value: unknown): void => {
        if (Array.isArray(value)) { value.forEach(target); return; }
        if (!value || typeof value !== 'object') return;
        const node = value as ParseNode & Record<string, unknown>;
        if (node.type === 'IdentifierReference' || node.type === 'BindingIdentifier') {
          const binding = ResolveBindingDeclaration(node, node.name);
          if (binding) facts!.declarations.add(binding.node);
          return;
        }
        const keys: Record<string, string[]> = {
          ParenthesizedExpression: ['Expression'], AssignmentExpression: ['LeftHandSideExpression'],
          ArrayLiteral: ['ElementList'], ObjectLiteral: ['PropertyDefinitionList'],
          PropertyDefinition: ['AssignmentExpression'], SpreadElement: ['AssignmentExpression'],
          AssignmentRestElement: ['AssignmentExpression'],
        };
        for (const key of keys[node.type] ?? []) target(node[key]);
      };
      const walk = (value: unknown): void => {
        if (Array.isArray(value)) { value.forEach(walk); return; }
        if (!value || typeof value !== 'object') return;
        const node = value as ParseNode & Record<string, unknown>;
        if (typeof node.type !== 'string') return;
        if (node.type === 'AssignmentExpression') target(node.LeftHandSideExpression);
        else if (node.type === 'UpdateExpression') target(node.LeftHandSideExpression ?? node.UnaryExpression);
        else if (['ForInStatement', 'ForOfStatement', 'ForAwaitStatement'].includes(node.type)) target(node.LeftHandSideExpression);
        else if (node.type === 'VariableDeclaration' && node.Initializer) target(node.BindingIdentifier);
        else if (node.type === 'CallExpression' && node.CallExpression?.type === 'IdentifierReference'
            && node.CallExpression.name === 'eval') facts!.eval = true;
        for (const [key, child] of Object.entries(node)) {
          if (!['parent', 'location', 'sourceText', 'strict'].includes(key)) walk(child);
        }
      };
      walk(root);
    }
    return facts.eval || facts.declarations.has(declaration.node);
  };
  const violation = CompileTimeEvaluabilityChecker({ resolve, assigned });
  return violation(expression) ?? (fn.ECMAScriptCode?.parent ? violation(fn.ECMAScriptCode.parent) : undefined);
}
