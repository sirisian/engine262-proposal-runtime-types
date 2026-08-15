import { LanguageParser } from './LanguageParser.mts';
import type {
  ParseNode,
  ParseNodesByType,
} from './ParseNode.mts';
import { Scope } from './Scope.mts';
import { PrescanPreprocessorNames } from './PrescanDecoratorModes.mts';
import { surroundingAgent, type Feature } from '#self';

export interface ParserOptions {
  /** `{ bound name -> grammar }` for this module's preprocessor decorations. */
  decoratorGrammars?: ReadonlyMap<string, string>;
  readonly source: string;
  readonly decoratingSource?: string;
  readonly specifier?: string;
  readonly json?: boolean;
  readonly allowAllPrivateNames?: boolean;
}

export class Parser extends LanguageParser {
  protected readonly source: string;

  protected readonly specifier?: string;

  readonly state: {
    hasTopLevelAwait: boolean;
    strict: boolean;
    json: boolean;
    allowAllPrivateNames: boolean;
  };

  readonly scope = new Scope(this);

  protected readonly decoratingSource?: string;

  /**
   * proposal-runtime-types: the lexical MODE each replacement decorator's region
   * is scanned in, keyed by the decoration's name.
   *
   * Collected by a PRE-SCAN of the preprocessor imports rather than from the
   * parsed tree, because it has to be known before the region is scanned and
   * expansion runs on an already-parsed tree - so there is no later point at
   * which to learn it. An import declaration is at the top of a module and lexes
   * as ordinary ECMAScript, so the pre-scan is cheap and cannot itself need a
   * mode.
   */
  readonly decoratorModes: ReadonlyMap<string, string>;

  /**
   * The names this module's preprocessor imports BIND.
   *
   * A decoration spelled with one of these takes a REGION where a `{` follows
   * it, which is what used to require a `mode:` attribute. The attribute is
   * gone: being a preprocessor decoration is what makes the braces a region, and
   * `preprocessor: "true"` is as lexically visible as `mode:` was - so a tool
   * that does not resolve imports recognises a region exactly as before.
   */
  readonly preprocessorNames: ReadonlySet<string>;

  constructor({
    source, specifier, json = false, allowAllPrivateNames = false, decoratingSource,
    decoratorGrammars,
  }: ParserOptions) {
    super();
    this.source = source;
    this.specifier = specifier;
    this.decoratingSource = decoratingSource;
    this.preprocessorNames = surroundingAgent?.feature?.('runtime-types')
      ? PrescanPreprocessorNames(source)
      : new Set();
    // WHICH grammar a region is read in comes from the macro, which is resolved
    // before the parse and passed in. A preprocessor name whose macro declares
    // none takes an opaque region - captured by delimiter matching and handed to
    // the macro as tokens of the ordinary lexical grammar, which is what `linq`
    // wants and what a mode-less preprocessor gets.
    const grammars = new Map<string, string>();
    for (const name of this.preprocessorNames) {
      grammars.set(name, decoratorGrammars?.get(name) ?? 'opaque');
    }
    this.decoratorModes = grammars;
    this.state = {
      hasTopLevelAwait: false,
      strict: false,
      json,
      allowAllPrivateNames,
    };
  }

  isStrictMode() {
    return this.state.strict;
  }

  feature(name: Feature) {
    return surroundingAgent.feature(name);
  }

  startNode<T extends ParseNode>(inheritStart?: ParseNode.BaseParseNode): ParseNode.Unfinished<T>;

  startNode(inheritStart?: ParseNode.BaseParseNode): ParseNode.Unfinished {
    this.peek();
    const s = this.source;
    const node: ParseNode.BaseParseNode = {
      type: undefined!,
      parent: undefined,
      location: this.getLocation(inheritStart),
      strict: this.state.strict,
      get sourceText() {
        return s.slice(node.location.startIndex, node.location.endIndex);
      },
    };
    return node;
  }

  markNodeStart(node: ParseNode.Unfinished) {
    node.location.startIndex = this.peekToken.startIndex;
    node.location.start = {
      line: this.peekToken.line,
      column: this.peekToken.column,
    };
  }

  finishNode<T extends ParseNode.Unfinished, K extends T['type'] & ParseNode['type']>(node: T, type: K): ParseNodesByType[K];

  finishNode(node: ParseNode.Unfinished, type: ParseNode['type']) {
    node.type = type;
    this.markLocationEnd(node);
    return node;
  }
}
