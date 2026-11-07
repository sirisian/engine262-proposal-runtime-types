import type { ParseNode } from '../parser/ParseNode.mts';
import { ResolveBindingDeclaration, type BindingDeclaration } from './compile-time-evaluability.mts';

type Node = ParseNode & Record<string, unknown>;
interface Origin {
  source: ParseNode;
  arguments?: ParseNode.TypeArguments;
  deferredGlobal?: boolean;
  /** Kept across an operation only by its footprint: optional deeper analysis (#sec-class-value-origin-order), so it may remove an error but not establish one. */
  deeper?: boolean;
}
interface Binding {
  declaration: BindingDeclaration;
  name: string;
  owner: ParseNode;
  immutable: boolean;
  global: boolean;
}
interface State {
  values: Map<Binding, Origin>;
  live: boolean;
}
const ignored = new Set(['parent', 'location', 'sourceText', 'strict', 'TypeAnnotation', 'TypeParameters',
  'TypeArguments', 'ReturnType', 'ReturnTypeAnnotation', 'WhereClauses', 'ImplementsClause']);
const parameterKeys = ['FormalParameters', 'ArrowParameters', 'UniqueFormalParameters', 'PropertySetParameterList'];
const bodyKeys = ['FunctionBody', 'ConciseBody', 'AsyncConciseBody', 'GeneratorBody', 'AsyncBody', 'AsyncGeneratorBody'];
const isNode = (value: unknown): value is Node => !!value && typeof value === 'object'
  && typeof (value as { type?: unknown }).type === 'string';
const callable = (node: Node): boolean => parameterKeys.some((key) => key in node);
const unwrap = (value: unknown): Node | undefined => {
  let node = isNode(value) ? value : undefined;
  while (node?.type === 'ParenthesizedExpression') node = node.Expression as Node;
  return node;
};
const children = (node: Node): Node[] => Object.entries(node).flatMap(([key, value]) =>
  ignored.has(key) ? [] : (Array.isArray(value) ? value : [value]).filter(isNode));
const same = (a: Origin | undefined, b: Origin | undefined): boolean => a?.source === b?.source
  && a?.arguments === b?.arguments && a?.deferredGlobal === b?.deferredGlobal && a?.deeper === b?.deeper;
const copy = (state: State): State => ({ values: new Map(state.values), live: state.live });
/** Two origins that differ only in how they were kept merge to the weaker, footprint-kept one. */
const merged = (a: Origin | undefined, b: Origin | undefined): Origin | undefined => {
  if (same(a, b)) return a;
  if (a && b && same({ ...a, deeper: undefined }, { ...b, deeper: undefined })) return { ...a, deeper: true };
  return undefined;
};
const join = (into: State, a: State, b: State): void => {
  into.live = a.live || b.live;
  into.values = !a.live ? new Map(b.values) : !b.live ? new Map(a.values)
    : new Map([...a.values].flatMap(([key, value]) => {
      const kept = merged(value, b.values.get(key));
      return kept ? [[key, kept] as const] : [];
    }));
};

/**
  * Constructor VALUE evidence at evaluated expression positions. This does not
    * form a type, execute source, or license check elision. In particular a later
      * effect cannot rewrite a value already captured by a heritage or new operand.
        * Unsupported effects withdraw evidence; declaration contracts remain separate.
          */
export function ClassValueOrigins(root: ParseNode,
  globalBindingIsStable: (read: ParseNode.IdentifierReference) => boolean,
  transparentlyConstructed: (node: ParseNode.ClassDeclaration) => boolean): WeakMap<ParseNode, Origin | undefined> {
  const observations = new WeakMap<ParseNode, Origin | undefined>();
  const bindings = new Map<ParseNode, Map<string, Binding>>();
  const written = new Set<Binding>();
  const captured = new Set<Binding>();
  const directEvals: Node[] = [];
  const deferred: { node: Node, state: State }[] = [];
  const ownerOf = (node: ParseNode): ParseNode => {
    for (let at = node.parent; at; at = at.parent) {
      if (callable(at as Node) || at.type === 'FieldDefinition' && !at.static) return at;
    }
    return root;
  };
  const globalBinding = (declaration: BindingDeclaration): boolean => {
    if (root.type !== 'Script' || ownerOf(declaration.node) !== root) return false;
    if (declaration.kind === 'var' || declaration.kind === 'function') return true;
    if (declaration.node.type === 'ClassExpression') return false;
    for (let at = declaration.node.parent; at && at !== root; at = at.parent) {
      if (['Block', 'CaseBlock', 'Catch', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'ForAwaitStatement', 'ClassStaticBlock'].includes(at.type)) return false;
    }
    return true;
  };
  const bindingAt = (node: ParseNode, name: string): Binding | undefined => {
    const declaration = ResolveBindingDeclaration(node, name);
    if (!declaration) return undefined;
    let names = bindings.get(declaration.node);
    if (!names) {
      names = new Map(); bindings.set(declaration.node, names);
    }
    let binding = names.get(name);
    if (!binding) {
      const owner = ownerOf(declaration.node);
      binding = { declaration, name, owner, immutable: declaration.kind === 'const',
        global: globalBinding(declaration) };
      names.set(name, binding);
    }
    return binding;
  };
  const targets = (value: unknown, visit: (node: Node, name: string) => void): void => {
    if (Array.isArray(value)) {
      value.forEach((child) => targets(child, visit)); return;
    }
    if (!isNode(value)) return;
    if (value.type === 'IdentifierReference' || value.type === 'BindingIdentifier') {
      visit(value, value.name as string); return;
    }
    const keys: Record<string, string[]> = {
      ParenthesizedExpression: ['Expression'], AssignmentExpression: ['LeftHandSideExpression'],
      ArrayLiteral: ['ElementList'], ObjectLiteral: ['PropertyDefinitionList'],
      PropertyDefinition: ['AssignmentExpression'], CoverInitializedName: ['IdentifierReference'],
      SpreadElement: ['AssignmentExpression'], AssignmentRestElement: ['AssignmentExpression'],
      ObjectBindingPattern: ['BindingPropertyList', 'BindingRestProperty'], ArrayBindingPattern: ['BindingElementList', 'BindingRestElement'],
      BindingProperty: ['BindingElement'], BindingElement: ['BindingIdentifier', 'BindingPattern'],
      SingleNameBinding: ['BindingIdentifier'], BindingRestElement: ['BindingIdentifier', 'BindingPattern'],
      BindingRestProperty: ['BindingIdentifier'],
      ForBinding: ['BindingIdentifier', 'BindingPattern'], ForDeclaration: ['ForBinding'],
    };
    for (const key of keys[value.type] ?? []) targets(value[key], visit);
  };
  const directEval = (node: Node): boolean => {
    const callee = unwrap(node.CallExpression);
    return node.type === 'CallExpression' && callee?.type === 'IdentifierReference'
      && callee.name === 'eval';
  };
  const collect = (node: Node): void => {
    if (node.type === 'IdentifierReference' || node.type === 'BindingIdentifier') bindingAt(node, node.name as string);
    const target = node.type === 'AssignmentExpression' ? node.LeftHandSideExpression
      : node.type === 'UpdateExpression' ? node.LeftHandSideExpression ?? node.UnaryExpression
        : ['ForInStatement', 'ForOfStatement', 'ForAwaitStatement'].includes(node.type) ? node.LeftHandSideExpression : undefined;
    targets(target, (place, name) => {
      const binding = bindingAt(place, name);
      if (binding) {
        written.add(binding);
        if (ownerOf(place) !== binding.owner) captured.add(binding);
        for (let at = place.parent; at && at !== binding.owner; at = at.parent) {
          if ((at.type === 'ClassDeclaration' || at.type === 'ClassExpression') && at.TypeParameters?.TypeParameterList.length) captured.add(binding);
        }
      }
    });
    if (directEval(node)) directEvals.push(node);
    // A reference or dynamically selected location can expose a local cell to
    // code whose writes are not represented by an identifier assignment.
    if (node.type === 'RefExpression' || node.type === 'RefRebindingStatement' || node.Ref) {
      for (const child of children(node)) targets(child, (place, name) => {
        const binding = bindingAt(place, name);
        if (binding) {
          written.add(binding); captured.add(binding);
        }
      });
    }
    children(node).forEach(collect);
  };
  collect(root as Node);
  for (const names of bindings.values()) for (const binding of names.values()) {
    for (const evalNode of directEvals) {
      if (bindingAt(evalNode, binding.name) === binding) {
        written.add(binding);
        if (ownerOf(evalNode) !== binding.owner) captured.add(binding);
      }
    }
  }
  const observe = (node: Node, value: Origin | undefined): Origin | undefined => {
    if (observations.has(node) && !same(observations.get(node), value)) observations.set(node, merged(observations.get(node), value));
    else if (!observations.has(node)) observations.set(node, value);
    return value;
  };
  // #sec-class-value-origin-order: a potential call withdraws only the mutable
  // evidence it may affect, judged by its footprint as sec-elision-stability's
  // global mutation footprints are. A call of a function declaration the
  // source never reassigns may write what its body, transitively, writes.
  // Every other operation may reach every global, except the construction of
  // a transparently constructed class, which #sec-elision-stability says has
  // no effect of its own (see `effect`).
  const literalOnly = (value: unknown): boolean => {
    const node = unwrap(value);
    if (!node) return false;
    if (['NumericLiteral', 'StringLiteral', 'BooleanLiteral', 'NullLiteral'].includes(node.type)) return true;
    return node.type === 'UnaryExpression' && node.operator === '-' && unwrap(node.UnaryExpression)?.type === 'NumericLiteral';
  };
  const declarationOf = (callee: unknown, kind: string, type: string): { node: Node, binding: Binding } | undefined => {
    const reference = unwrap(callee);
    if (reference?.type !== 'IdentifierReference') return undefined;
    const binding = bindingAt(reference, reference.name as string);
    const node = binding?.declaration.node as Node | undefined;
    if (!binding || binding.declaration.kind !== kind || node?.type !== type || written.has(binding)) return undefined;
    return { node: node!, binding };
  };
  const transparentClass = (callee: unknown): boolean => {
    const found = declarationOf(callee, 'class', 'ClassDeclaration');
    return !!found && transparentlyConstructed(found.node as unknown as ParseNode.ClassDeclaration);
  };
  // A class declaration whose identity is established at _at_: a binding
  // that is not a Script global, or a Script's own straight-line code
  // (#sec-class-value-origin-order 962).
  const establishedClass = (reference: unknown, at: Node): Node | undefined => {
    const found = declarationOf(reference, 'class', 'ClassDeclaration');
    return found && (!found.binding.global || ownerOf(at) === root) ? found.node : undefined;
  };
  // A binding's own annotation: a plain parameter's, found in its function's
  // parameter list (the declaration names the function), or a `let`, `const`
  // or `var` declarator's. A reference or optional parameter has none here.
  const bindingAnnotation = (declaration: BindingDeclaration, name: string): ParseNode.Type | undefined => {
    const node = declaration.node as Node;
    if (declaration.kind === 'parameter') {
      for (const key of ['FormalParameters', 'UniqueFormalParameters', 'ArrowParameters', 'PropertySetParameterList']) {
        const list = node[key];
        for (const element of (Array.isArray(list) ? list : list ? [list] : []) as Node[]) {
          if (element?.type === 'SingleNameBinding' && (element.BindingIdentifier as { name?: string } | undefined)?.name === name) {
            return element.Ref || element.Optional ? undefined : (element.TypeAnnotation as ParseNode.TypeAnnotation | undefined)?.Type;
          }
        }
      }
      return undefined;
    }
    if (!['let', 'const', 'var'].includes(declaration.kind) || node.Ref
      || (node.BindingIdentifier as { name?: string } | undefined)?.name !== name) return undefined;
    return (node.TypeAnnotation as ParseNode.TypeAnnotation | null | undefined)?.Type;
  };
  // The class whose instance a receiver binding holds: a `const` initialized
  // by `new C()`, or a binding annotated with the class itself, whose every
  // value is admitted as an instance of it and so is no Proxy.
  const receiverClass = (receiver: unknown, at: Node): Node | undefined => {
    const reference = unwrap(receiver);
    if (reference?.type !== 'IdentifierReference') return undefined;
    const declaration = bindingAt(reference, reference.name as string)?.declaration;
    if (!declaration) return undefined;
    if (declaration.kind === 'const' && unwrap(declaration.initializer)?.type === 'NewExpression') {
      const construction = unwrap(declaration.initializer)!;
      return construction.Arguments !== undefined ? establishedClass(construction.MemberExpression, construction) : undefined;
    }
    const annotation = bindingAnnotation(declaration, reference.name as string);
    if (annotation?.type !== 'TypeReference' || annotation.TypeArguments || annotation.TypeName.MemberNames.length) return undefined;
    return establishedClass(annotation.TypeName.IdentifierReference, at);
  };
  const admitsNull = (type: ParseNode.Type): boolean => (type.type === 'PredefinedType' && type.keyword === 'null')
    || (type.type === 'UnionType' && type.Types.some(admitsNull));
  // A value admitted to a field's annotation without conversion: `null` where
  // the annotation admits null, or a construction of a class it names.
  const admittedWithoutConversion = (value: unknown, type: ParseNode.Type, at: Node): boolean => {
    const node = unwrap(value);
    if (node?.type === 'NullLiteral') return admitsNull(type);
    if (node?.type !== 'NewExpression') return false;
    const constructed = establishedClass(node.MemberExpression, at);
    const names = (t: ParseNode.Type): boolean => t.type === 'UnionType' ? t.Types.some(names)
      : t.type === 'TypeReference' && !t.TypeArguments && !t.TypeName.MemberNames.length
        && establishedClass(t.TypeName.IdentifierReference, at) === constructed;
    return !!constructed && names(type);
  };
  // A subject whose every value is a class's instance, and so no Proxy: a
  // `const` initialized by `new C()`, or a binding annotated with a class.
  const subjectIsInstance = (subject: unknown): boolean => {
    const reference = unwrap(subject);
    if (reference?.type !== 'IdentifierReference') return false;
    const declaration = bindingAt(reference, reference.name as string)?.declaration;
    if (!declaration) return false;
    if (declaration.kind === 'const' && unwrap(declaration.initializer)?.type === 'NewExpression') {
      return !!declarationOf(unwrap(declaration.initializer)!.MemberExpression, 'class', 'ClassDeclaration');
    }
    const annotation = bindingAnnotation(declaration, reference.name as string);
    return annotation?.type === 'TypeReference' && !annotation.TypeArguments && !annotation.TypeName.MemberNames.length
      && !!declarationOf(annotation.TypeName.IdentifierReference, 'class', 'ClassDeclaration');
  };
  // #sec-instanceof-operator: an `instanceof` whose subject is a class's
  // instance and whose right operand is an established class, none of whose
  // chain declares a decorator or a static member a computed key could make a
  // hook, calls no hook and meets no proxy. Only code that received the class
  // could have installed a hook, and reaching that code was an effect that
  // already withdrew every Script global; so the test withdraws only bindings
  // some code writes.
  const settledInstanceTest = (node: Node, state: State): boolean => {
    if (node.operator !== 'instanceof' || !subjectIsInstance(node.RelationalExpression)) return false;
    const target = unwrap(node.ShiftExpression);
    if (target?.type !== 'IdentifierReference') return false;
    const origin = read(target, state);
    if (!origin || origin.deeper || origin.arguments || (origin.source as Node).type !== 'ClassDeclaration') return false;
    const seen = new Set<Node>();
    for (let cls: Node | undefined = origin.source as Node; cls; seen.add(cls)) {
      if (seen.has(cls) || (cls.Decorators as unknown[] | null | undefined)?.length) return false;
      for (const element of ((cls.ClassTail as Node).ClassBody as Node[] | null | undefined) ?? []) {
        if ((element.Decorators as unknown[] | null | undefined)?.length) return false;
        const name = element.ClassElementName as Node | undefined;
        if (element.static && (name?.type === 'PropertyName' || name?.ComputedPropertyName)) return false;
      }
      const heritage: unknown = (cls.ClassTail as Node).ClassHeritage;
      if (!heritage) return true;
      cls = declarationOf(heritage, 'class', 'ClassDeclaration')?.node;
      if (!cls) return false;
    }
    return false;
  };
  const withdrawWritten = (state: State): void => {
    for (const binding of state.values.keys()) {
      if (!binding.immutable && (written.has(binding) || captured.has(binding))) state.values.delete(binding);
    }
  };
  // #sec-instanceof-operator: a read, or a `=` write, of a typed field that the
  // receiver's class or an ancestor declares without a decorator or `accessor`
  // reaches typed storage, which can be neither deleted nor redefined, so no
  // accessor runs; a write must also convert nothing. Such an access has no
  // effect, so it withdraws no evidence.
  const inertFieldAccess = (member: Node): boolean => {
    if (member.Expression) return false;
    const parent = member.parent as Node | undefined;
    const write = parent?.type === 'AssignmentExpression' && parent.LeftHandSideExpression === member;
    if (write && parent.AssignmentOperator !== '=' || parent?.type === 'UpdateExpression') return false;
    const name = (member.IdentifierName as { name?: string } | undefined)?.name;
    const privateName = (member.PrivateIdentifier as { name?: string } | undefined)?.name;
    if (name === undefined && privateName === undefined) return false;
    const seen = new Set<Node>();
    for (let cls = receiverClass(member.MemberExpression, member); cls && !seen.has(cls);) {
      seen.add(cls);
      const field = ((cls.ClassTail as Node).ClassBody as Node[] | null | undefined ?? []).find((element) => element.type === 'FieldDefinition'
        && !element.static && (privateName !== undefined
          ? (element.ClassElementName as Node).type === 'PrivateIdentifier' && (element.ClassElementName as { name: string }).name === privateName
          : (element.ClassElementName as Node).type === 'IdentifierName' && (element.ClassElementName as { name: string }).name === name));
      if (field) {
        const annotation = (field.TypeAnnotation as ParseNode.TypeAnnotation | null | undefined)?.Type;
        if ((field.Decorators as unknown[] | null | undefined)?.length || field.accessor || !annotation) return false;
        return !write || admittedWithoutConversion(parent!.AssignmentExpression, annotation, member);
      }
      const heritage = (cls.ClassTail as Node).ClassHeritage;
      cls = heritage ? establishedClass(heritage, member) : undefined;
    }
    return false;
  };
  const footprints = new Map<Node, Set<string> | null>();
  const footprintOf = (fn: Node): Set<string> | null => {
    if (footprints.has(fn)) return footprints.get(fn)!;
    const writes = new Set<string>();
    footprints.set(fn, writes);
    const numericLocals = new Set<string>();
    let unknown = false;
    const operand = (value: unknown): boolean => {
      const node = unwrap(value);
      return literalOnly(node) || (node?.type === 'IdentifierReference' && numericLocals.has(node.name as string));
    };
    const scan = (value: unknown): void => {
      if (unknown || !value || typeof value !== 'object') return;
      if (Array.isArray(value)) { value.forEach(scan); return; }
      const node = value as Node;
      if (typeof node.type !== 'string') return;
      if (node !== fn && callable(node)) return;
      switch (node.type) {
        case 'WithStatement': case 'YieldExpression': case 'AwaitExpression': case 'MemberExpression': case 'OptionalExpression':
        case 'TaggedTemplateExpression': case 'SuperCall': case 'ImportCall': case 'SpreadElement':
          unknown = true; return;
        case 'LexicalBinding': case 'VariableDeclaration':
          if (node.BindingIdentifier && literalOnly(node.Initializer) && unwrap(node.Initializer)?.type === 'NumericLiteral') numericLocals.add((node.BindingIdentifier as Node).name as string);
          break;
        case 'AssignmentExpression': case 'UpdateExpression': {
          const target = unwrap(node.type === 'AssignmentExpression' ? node.LeftHandSideExpression : node.LeftHandSideExpression ?? node.UnaryExpression);
          if (target?.type !== 'IdentifierReference') { unknown = true; return; }
          const binding = bindingAt(target, target.name as string);
          if (!binding || binding.global) writes.add(target.name as string);
          if (node.type === 'AssignmentExpression' && !(node.AssignmentOperator === '=' ? true : literalOnly(node.AssignmentExpression))) numericLocals.delete(target.name as string);
          break;
        }
        case 'CallExpression': {
          if (directEval(node)) { unknown = true; return; }
          const found = declarationOf(node.CallExpression, 'function', 'FunctionDeclaration');
          const inner = found && footprintOf(found.node);
          if (!inner) { unknown = true; return; }
          inner.forEach((name) => writes.add(name));
          scan(node.Arguments);
          return;
        }
        case 'NewExpression':
          if (!transparentClass(node.MemberExpression)) { unknown = true; return; }
          scan(node.Arguments);
          return;
        case 'AdditiveExpression': case 'MultiplicativeExpression': case 'RelationalExpression': case 'EqualityExpression':
        case 'ShiftExpression': case 'ExponentiationExpression': case 'BitwiseANDExpression': case 'BitwiseORExpression': case 'BitwiseXORExpression': {
          const operands = Object.keys(node).filter((key) => !ignored.has(key) && key !== 'operator' && isNode(node[key])).map((key) => node[key]);
          if ((node.operator === 'instanceof' || node.operator === 'in') || !operands.every(operand)) { unknown = true; return; }
          break;
        }
        default:
          break;
      }
      for (const key of Object.keys(node)) if (!ignored.has(key)) scan(node[key]);
    };
    for (const key of bodyKeys) if (key in fn) scan(fn[key]);
    const result = unknown ? null : writes;
    footprints.set(fn, result);
    return result;
  };
  const operationFootprint = (at: Node): Set<string> | null => {
    if (at.type === 'CallExpression' && !directEval(at)) {
      const found = declarationOf(at.CallExpression, 'function', 'FunctionDeclaration');
      return found ? footprintOf(found.node) : null;
    }
    if (at.type === 'NewExpression') return transparentClass(at.MemberExpression) ? new Set() : null;
    return null;
  };
  // Constructing a transparently constructed class has no effect of its own
  // (#sec-elision-stability), a required judgment, so it withdraws nothing and
  // marks nothing optional. That holds where the class's identity is
  // established: a binding that is not a Script global, or a Script's own
  // straight-line code. A deferred body can see a Script-global class that a
  // later Script installed (#sec-class-value-origin-order 962), so there the
  // footprint below keeps evidence as optional deeper analysis.
  const transparentConstruction = (at: Node): boolean => {
    if (at.type !== 'NewExpression') return false;
    const found = declarationOf(at.MemberExpression, 'class', 'ClassDeclaration');
    return !!found && transparentlyConstructed(found.node as unknown as ParseNode.ClassDeclaration)
      && (!found.binding.global || ownerOf(at) === root);
  };
  const effect = (state: State, at: Node, dynamic = false, all = false): void => {
    if (!dynamic && !all && transparentConstruction(at)) return;
    const footprint = dynamic || all ? null : operationFootprint(at);
    for (const binding of state.values.keys()) {
      const shadowable = dynamic && !at.strict && binding.owner !== ownerOf(at);
      if (!shadowable && footprint && binding.global && !captured.has(binding) && !footprint.has(binding.name)) {
        const kept = state.values.get(binding)!;
        if (!kept.deeper) state.values.set(binding, { ...kept, deeper: true });
        continue;
      }
      if (shadowable || !binding.immutable && (all || dynamic || binding.global || captured.has(binding))) state.values.delete(binding);
    }
  };
  const read = (node: Node, state: State): Origin | undefined => {
    const name = node.name as string;
    // A class body's self binding is immutable and separate from its outer
    // declaration. Heritage runs before that inner binding is initialized.
    for (let child: ParseNode = node, at = node.parent; at; child = at, at = at.parent) {
      if ((at.type === 'ClassDeclaration' || at.type === 'ClassExpression') && at.BindingIdentifier?.name === name) {
        if (child === at.ClassTail && at.ClassTail.ClassHeritage) {
          let inHeritage = false;
          for (let part: ParseNode | undefined = node; part && part !== at; part = part.parent) {
            if (part === at.ClassTail.ClassHeritage) inHeritage = true;
          }
          if (inHeritage) return undefined;
        }
        const selected = bindingAt(node, name);
        if (selected?.declaration.kind === 'class' && selected.declaration.node === at) return { source: at };
      }
    }
    const binding = bindingAt(node, name);
    if (binding?.declaration.kind === 'import') return { source: node };
    // A deferred read can follow later source initialization or another
    // activation. Keeping its declaration-entry candidate is conditional on
    // the shared global-effect proof at this actual read, not a snapshot of
    // the global cell when the function was declared.
    const value = binding && state.values.get(binding);
    // A class declaration that is not a Script global, and that nothing in
    // the source writes, holds its class at every read that succeeds; a read
    // before initialization throws. So a deferred body sees that class
    // whatever its entry state (#sec-class-value-origin-order: facts that
    // remain valid at entry). A Script global can be replaced by a later
    // Script, so its deferred reads keep the rule below.
    if (!value && binding?.declaration.kind === 'class' && !binding.global && !written.has(binding)) {
      return { source: binding.declaration.node };
    }
    if (!value?.deferredGlobal) return value;
    if (!globalBindingIsStable(node as ParseNode.IdentifierReference)) return undefined;
    // This expression has now captured the value. A later alias is not a
    // promise to reread the original global cell.
    return { source: value.source, arguments: value.arguments, ...(value.deeper ? { deeper: true } : {}) };
  };
  const store = (target: unknown, value: Origin | undefined, state: State): void => {
    targets(target, (node, name) => {
      const binding = bindingAt(node, name);
      if (!binding) return;
      const declaration = binding.declaration.node as Node;
      if (value && binding.declaration.kind !== 'parameter' && !declaration.TypeAnnotation && !declaration.Ref) state.values.set(binding, value);
      else state.values.delete(binding);
    });
  };
  const literalTruth = (value: unknown): boolean | undefined => {
    const node = unwrap(value);
    if (node?.type === 'BooleanLiteral') return node.value as boolean;
    if (node?.type === 'NullLiteral') return false;
    if (node?.type === 'StringLiteral') return !!node.value;
    return undefined;
  };
  const queue = (node: Node, state: State): void => {
    const entry = copy(state);
    entry.live = true;
    for (const binding of entry.values.keys()) {
      if (!binding.immutable && written.has(binding)) entry.values.delete(binding);
      else if (!binding.immutable && binding.global) {
        entry.values.set(binding, { ...entry.values.get(binding)!, deferredGlobal: true });
      }
    }
    deferred.push({ node, state: entry });
  };
  const keyEffects = (node: Node, state: State): void => {
    const key = node.ClassElementName ?? node.PropertyName;
    if (isNode(key) && key.type === 'PropertyName') {
      visit(key.ComputedPropertyName, state);
      if (!['StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'NullLiteral'].includes(unwrap(key.ComputedPropertyName)?.type ?? '')) effect(state, key);
    }
  };
  const typeEffects = (value: unknown, state: State): void => {
    if (Array.isArray(value)) {
      value.forEach((child) => typeEffects(child, state)); return;
    }
    if (!isNode(value)) return;
    if (value.type === 'TypeArguments' || value.type === 'TypeArgumentsExpression' || value.type === 'CallExpression') {
      effect(state, value);
      return;
    }
    // An application can initialize a specialization. Type formation is not
    // an ordinary initializer, but its permitted effects still precede later
    // ordinary value reads.
    for (const [key, child] of Object.entries(value)) {
      if (!['parent', 'location', 'sourceText', 'strict'].includes(key)) typeEffects(child, state);
    }
  };
  const widen = (value: unknown, state: State): void => {
    if (Array.isArray(value)) {
      value.forEach((child) => widen(child, state)); return;
    }
    if (!isNode(value)) return;
    const node = value;
    if (callable(node)) {
      for (const key of ['ClassElementName', 'PropertyName', 'Decorators']) widen(node[key], state);
      return;
    }
    if (node.type === 'FieldDefinition' && !node.static) {
      widen(node.ClassElementName, state);
      widen(node.Decorators, state);
      return;
    }
    const target = node.type === 'AssignmentExpression' ? node.LeftHandSideExpression
      : node.type === 'UpdateExpression' ? node.LeftHandSideExpression ?? node.UnaryExpression
        : ['ForInStatement', 'ForOfStatement', 'ForAwaitStatement'].includes(node.type) ? node.LeftHandSideExpression ?? node.ForBinding
          : node.type === 'VariableDeclaration' && node.Initializer ? node.BindingIdentifier : undefined;
    store(target, undefined, state);
    if (node.type === 'WithStatement' || node.type === 'RefExpression' || node.type === 'RefRebindingStatement') effect(state, node, true, true);
    else if (['CallExpression', 'NewExpression', 'MemberExpression', 'AwaitExpression', 'YieldExpression', 'SpreadElement', 'Decorator',
      'UnaryExpression', 'UpdateExpression', 'AdditiveExpression', 'MultiplicativeExpression', 'RelationalExpression',
      'EqualityExpression', 'ShiftExpression', 'ExponentiationExpression', 'BitwiseANDExpression', 'BitwiseORExpression', 'BitwiseXORExpression',
      'ForInStatement', 'ForOfStatement', 'ForAwaitStatement'].includes(node.type)) effect(state, node, directEval(node));
    typeEffects(node.TypeAnnotation ?? node.TypeArguments, state);
    children(node).forEach((child) => widen(child, state));
  };
  const visitPattern = (pattern: Node, state: State): void => {
    if (pattern.type === 'MatchExtractorPattern' || pattern.type === 'MatchJuxtapositionPattern') {
      visit(pattern.Head, state);
      effect(state, pattern);
      for (const part of [pattern.Elements, pattern.Shape]) {
        for (const child of Array.isArray(part) ? part : [part]) if (isNode(child)) visitPattern(child, state);
      }
      return;
    }
    for (const child of children(pattern)) {
      if (child.type.startsWith('Match')) visitPattern(child, state);
      else visit(child, state);
    }
    effect(state, pattern);
  };
  const visit = (value: unknown, state: State): Origin | undefined => {
    if (Array.isArray(value)) {
      let result: Origin | undefined;
      for (const item of value) result = visit(item, state);
      return result;
    }
    if (!isNode(value)) return undefined;
    const node = value;
    if (callable(node)) {
      keyEffects(node, state);
      if (node.Decorators) {
        visit(node.Decorators, state); effect(state, node);
      }
      queue(node, state);
      return undefined;
    }
    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      visit(node.ClassTail.ClassHeritage, state);
      // Compute all names before static initialization. Neither method bodies
      // nor instance initializers run while a class is being defined.
      for (const member of node.ClassTail.ClassBody ?? []) keyEffects(member as Node, state);
      for (const member of node.ClassTail.ClassBody ?? []) {
        if (callable(member as Node) || member.type === 'FieldDefinition' && !member.static) queue(member as Node, state);
        if (member.type === 'FieldDefinition' && member.static) visit(member.Initializer, state);
        if (member.type === 'ClassStaticBlock') visit(member.ClassStaticBlockBody, state);
        if ((member as Node).Decorators) {
          visit((member as Node).Decorators, state); effect(state, member as Node);
        }
      }
      if (node.Decorators) {
        visit(node.Decorators, state); effect(state, node);
      }
      const origin = { source: node };
      // A specialization contributes a case to the existing family binding.
      // It does not replace that binding with its nongeneric case declaration.
      if (node.type === 'ClassDeclaration' && !node.ClassModifiers?.includes('partial')
        && (!node.TypeParameters || node.TypeParameters.ListKind === 'parameters')) store(node.BindingIdentifier, origin, state);
      return observe(node, origin);
    }
    switch (node.type) {
      case 'IdentifierReference': return observe(node, read(node, state));
      case 'ParenthesizedExpression': return observe(node, visit(node.Expression, state));
      case 'TypeArgumentsExpression': {
        const base = visit(node.Expression, state);
        effect(state, node);
        return observe(node, base && { ...base, arguments: node.TypeArguments });
      }
      case 'CommaOperator': return observe(node, visit(node.ExpressionList, state));
      case 'LexicalBinding': case 'VariableDeclaration': {
        typeEffects(node.TypeAnnotation, state);
        const initial = visit(node.Initializer, state);
        if (node.BindingPattern) {
          effect(state, node);
          store(node.BindingPattern, undefined, state);
        } else store(node.BindingIdentifier, initial, state);
        return undefined;
      }
      case 'AssignmentExpression': {
        const target = unwrap(node.LeftHandSideExpression);
        if (target?.type !== 'IdentifierReference') visit(node.LeftHandSideExpression, state);
        const initial = visit(node.AssignmentExpression, state);
        if (target?.type !== 'IdentifierReference' && !(target?.type === 'MemberExpression' && inertFieldAccess(target))) effect(state, node);
        store(target, node.AssignmentOperator === '=' && target?.type === 'IdentifierReference' ? initial : undefined, state);
        return observe(node, node.AssignmentOperator === '=' ? initial : undefined);
      }
      case 'UpdateExpression':
        visit(node.LeftHandSideExpression ?? node.UnaryExpression, state);
        effect(state, node);
        store(node.LeftHandSideExpression ?? node.UnaryExpression, undefined, state);
        return undefined;
      case 'UnaryExpression':
        visit(node.UnaryExpression, state);
        if (!['void', 'typeof'].includes(node.operator)) effect(state, node);
        return undefined;
      case 'AdditiveExpression': case 'MultiplicativeExpression': case 'ShiftExpression': case 'RelationalExpression':
      case 'EqualityExpression': case 'ExponentiationExpression': case 'BitwiseANDExpression': case 'BitwiseORExpression': case 'BitwiseXORExpression': {
        const operands: Record<string, string[]> = {
          AdditiveExpression: ['AdditiveExpression', 'MultiplicativeExpression'], MultiplicativeExpression: ['MultiplicativeExpression', 'ExponentiationExpression'],
          ShiftExpression: ['ShiftExpression', 'AdditiveExpression'], RelationalExpression: ['RelationalExpression', 'ShiftExpression'],
          EqualityExpression: ['EqualityExpression', 'RelationalExpression'], ExponentiationExpression: ['UpdateExpression', 'ExponentiationExpression'],
          BitwiseANDExpression: ['A', 'B'], BitwiseORExpression: ['A', 'B'], BitwiseXORExpression: ['A', 'B'],
        };
        for (const key of operands[node.type]) visit(node[key], state);
        if (node.type === 'RelationalExpression' && settledInstanceTest(node, state)) withdrawWritten(state);
        else effect(state, node);
        return undefined;
      }
      case 'CallExpression': case 'NewExpression': {
        visit(node.type === 'CallExpression' ? node.CallExpression : node.MemberExpression, state);
        visit(node.PlacementArguments, state);
        visit(node.Arguments, state);
        effect(state, node, directEval(node));
        return observe(node, undefined);
      }
      case 'MemberExpression':
        visit(node.MemberExpression, state);
        visit(node.Expression, state);
        if (!inertFieldAccess(node)) effect(state, node);
        // Module namespace origin is separately proved by the linked checker.
        return observe(node, { source: node });
      case 'IfStatement': case 'ConditionalExpression': {
        const condition = node.type === 'IfStatement' ? node.Expression : node.ShortCircuitExpression;
        visit(condition, state);
        const a = copy(state), b = copy(state);
        const av = visit(node.type === 'IfStatement' ? node.Statement_a : node.AssignmentExpression_a, a);
        const bv = visit(node.type === 'IfStatement' ? node.Statement_b : node.AssignmentExpression_b, b);
        const selected = literalTruth(condition);
        if (selected !== undefined) {
          const chosen = selected ? a : b;
          state.values = chosen.values; state.live = chosen.live;
        } else join(state, a, b);
        return observe(node, selected === true ? av : selected === false ? bv : same(av, bv) ? av : undefined);
      }
      case 'LogicalANDExpression': case 'LogicalORExpression': case 'CoalesceExpression': {
        const left = node.type === 'LogicalANDExpression' ? node.LogicalANDExpression
          : node.type === 'LogicalORExpression' ? node.LogicalORExpression : node.CoalesceExpressionHead;
        const right = node.type === 'LogicalORExpression' ? node.LogicalANDExpression : node.BitwiseORExpression;
        const av = visit(left, state), before = copy(state), after = copy(state);
        const bv = visit(right, after), truth = literalTruth(left);
        const knownConstructor = av?.source.type === 'ClassDeclaration' || av?.source.type === 'ClassExpression';
        const takeRight = node.type === 'CoalesceExpression' ? unwrap(left)?.type === 'NullLiteral' ? true : knownConstructor ? false : undefined
          : truth === undefined ? knownConstructor ? node.type === 'LogicalANDExpression' : undefined : node.type === 'LogicalANDExpression' ? truth : !truth;
        if (takeRight === true) {
          state.values = after.values; state.live = after.live;
        } else if (takeRight === undefined) join(state, before, after);
        return observe(node, takeRight === true ? bv : takeRight === false ? av : same(av, bv) ? av : undefined);
      }
      case 'ForStatement': case 'ForInStatement': case 'ForOfStatement': case 'ForAwaitStatement':
      case 'WhileStatement': case 'DoWhileStatement': {
        visit(node.LexicalDeclaration ?? node.VariableDeclarationList ?? node.Expression_a, state);
        // Repeated evaluation can observe a previous iteration's writes. A
        // single conservative entry state prevents textual order from proving
        // a first-iteration fact for every iteration.
        widen(node, state);
        const entry = copy(state), body = copy(state);
        store(node.LeftHandSideExpression, undefined, body);
        visit(node.Expression ?? node.Expression_b, body);
        visit(node.Statement, body);
        visit(node.Expression_c, body);
        body.live = true;
        join(state, entry, body);
        return undefined;
      }
      case 'TryStatement': {
        const entry = copy(state), normal = copy(state);
        visit(node.Block, normal);
        widen(node.Block, entry);
        const handlers = node.CatchClauses ?? (node.Catch ? [node.Catch] : []);
        const failure = copy(entry);
        failure.live = false;
        for (const handler of handlers as Node[]) {
          const handled = copy(entry);
          visit(handler.Block, handled);
          join(failure, copy(failure), handled);
        }
        join(state, normal, failure);
        const wasLive = state.live;
        state.live = true;
        visit(node.Finally, state);
        state.live &&= wasLive;
        return undefined;
      }
      case 'ReturnStatement': case 'ThrowStatement':
        visit(node.Expression, state);
        state.live = false;
        return undefined;
      case 'BreakStatement': case 'ContinueStatement': state.live = false; return undefined;
      case 'AwaitExpression': case 'YieldExpression':
        children(node).forEach((child) => visit(child, state));
        effect(state, node);
        return undefined;
      case 'WithStatement':
        visit(node.Expression, state);
        effect(state, node, true, true);
        // Dynamic binding resolution cannot supply a lexical origin proof.
        suppress(node.Statement);
        return undefined;
      case 'ObjectLiteral':
        for (const property of node.PropertyDefinitionList ?? []) {
          if (callable(property as Node)) {
            visit(property, state); continue;
          }
          keyEffects(property as Node, state);
          visit(property.type === 'IdentifierReference' ? property : (property as Node).AssignmentExpression ?? (property as Node).IdentifierReference, state);
          if (property.type === 'PropertyDefinition' && !property.PropertyName) effect(state, property as Node);
        }
        return undefined;
      case 'ArrayLiteral': visit(node.ElementList, state); return undefined;
      case 'SpreadElement': visit(node.AssignmentExpression, state); effect(state, node); return undefined;
      case 'TypeAliasDeclaration': case 'InterfaceDeclaration': case 'TypeAnnotation': case 'TypeOperatorExpression':
        typeEffects(node, state);
        return undefined;
      case 'ExportDeclaration':
        visit(node.VariableStatement ?? node.Declaration ?? node.HoistableDeclaration ?? node.ClassDeclaration ?? node.AssignmentExpression, state);
        if (node.Decorators) {
          visit(node.Decorators, state); effect(state, node);
        }
        return undefined;
      // #sec-class-value-origin-order: a pattern's head is read at its own
      // evaluation position; its matcher call, its property reads and its
      // iteration are potential calls, which withdraw only what they may affect.
      case 'IsExpression':
        visit(node.Expression, state);
        if (isNode(node.Pattern)) visitPattern(node.Pattern, state);
        return undefined;
      case 'MatchExpression':
        visit(node.Expression, state);
        for (const clause of (node.Clauses as Node[] | undefined) ?? []) {
          if (isNode(clause.Pattern)) visitPattern(clause.Pattern, state);
          visit(clause.Guard, state);
          visit(clause.Body, state);
        }
        return undefined;
      default: {
        if (node.type.endsWith('Literal') || ['BindingIdentifier', 'IdentifierName', 'EmptyStatement', 'ThisExpression', 'ImportDeclaration'].includes(node.type)) return undefined;
        const transparent = ['Script', 'Module', 'ScriptBody', 'ModuleBody', 'Block', 'FunctionBody', 'AsyncBody',
          'GeneratorBody', 'AsyncGeneratorBody', 'ClassStaticBlockBody', 'ExpressionStatement', 'LexicalDeclaration',
          'VariableStatement', 'Finally', 'ExpressionBody', 'ConciseBody', 'AsyncConciseBody', 'NamedArgument',
          'FormalParameter', 'SingleNameBinding', 'BindingElement', 'FormalParameters', 'UniqueFormalParameters'].includes(node.type);
        if (!transparent) {
          effect(state, node, true, true);
          suppress(node);
          return undefined;
        }
        children(node).forEach((child) => visit(child, state));
        return undefined;
      }
    }
  };
  // Unsupported dynamic regions are unknown, including nested references that
  // must not fall back to a whole-source syntactic class guess.
  const suppress = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(suppress); return;
    }
    if (!isNode(value)) return;
    if (value.type === 'IdentifierReference') observations.set(value, undefined);
    children(value).forEach(suppress);
  };
  visit(root, { values: new Map(), live: true });
  for (const { node, state } of deferred) {
    if (node.type === 'FieldDefinition') visit(node.Initializer, state);
    else {
      // Parameter defaults precede the function body; a body var is not in
      // their environment. Unknown parameter defaults may or may not run.
      for (const key of parameterKeys) {
        const before = copy(state), after = copy(state);
        visit(node[key], after);
        join(state, before, after);
      }
      for (const key of bodyKeys) visit(node[key], state);
    }
  }
  return observations;
}
