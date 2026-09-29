import { expect, test } from 'vitest';
import { observeProtocol } from '../observe-protocol.mts';

test.each([
  {
    "name": "invalid Unicode cooked part unused",
    "source": "function tag(s:[].<string>):void{}function f(){tag`\\unicode`;}",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "invalid Unicode cooked part executed",
    "source": "function tag(s:[].<string>):void{}tag`\\unicode`;",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "invalid hex cooked part unused",
    "source": "function tag(s:[].<string>):void{}function f(){tag`\\xG1`;}",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "invalid tail cooked part unused",
    "source": "function tag(s:[].<string>,n:uint8):void{}function f(){tag`ok${1}\\unicode`;}",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "valid cooked newline tuple wrongly rejected",
    "source": "function tag(s:[\"\\n\"]):void{}function f(){tag`\\n`;}",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "valid cooked hex tuple wrongly rejected",
    "source": "function tag(s:[\"a\"]):void{}function f(){tag`\\x61`;}",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "valid undefined tuple wrongly rejected",
    "source": "function tag(s:[undefined]):void{}function f(){tag`\\unicode`;}",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "raw text mistaken for cooked literal",
    "source": "function tag(s:[\"\\\\n\"]):void{}function f(){tag`\\n`;}",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "raw mistaken literal executed",
    "source": "function tag(s:[\"\\\\n\"]):void{}tag`\\n`;",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "string or undefined accepts malformed escape",
    "source": "function tag(s:[].<string|undefined>):void{}tag`\\unicode`;",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "untyped tag sees cooked and raw",
    "source": "function tag(s){globalThis.settled=String(s[0]===undefined)+\":\"+String(s.raw[0]===\"\\\\unicode\");}tag`\\unicode`;",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "true:true",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "ordinary typed string tag valid",
    "source": "function tag(s:[].<string>):void{}tag`plain`;",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "substitution still checks",
    "source": "function tag(s:any,n:uint8):void{}function f(){tag`x${\"bad\"}`;}",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "invalid escape remains untagged syntax error",
    "source": "function f(){return `\\unicode`;}",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "SyntaxError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "any tag remains unknown",
    "source": "function f(tag:any){tag`\\unicode`;}f(s=>{globalThis.settled=String(s[0]===undefined);});",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "true",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "undefined tuple executes successfully after cooking fix",
    "source": "function tag(s:[undefined]):void{globalThis.settled=String(s[0]===undefined);}tag`\\unicode`;",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "true",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "null escape keeps prefix suffix",
    "source": "function tag(s:[\"a\\0b\"]):void{}tag`a\\0b`;",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "identity escape",
    "source": "function tag(s:[\"aqb\"]):void{}tag`a\\qb`;",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "line continuation",
    "source": "function tag(s:[\"ab\"]):void{}tag`a\\\nb`;",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "CRLF continuation",
    "source": "function tag(s:[\"ab\"]):void{}tag`a\\\r\nb`;",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "literal CRLF normalization",
    "source": "function tag(s:[\"a\\nb\"]):void{}tag`a\r\nb`;",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "empty Unicode malformed",
    "source": "function tag(s:[undefined]):void{}tag`\\u{}`;",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "decimal escape malformed",
    "source": "function tag(s:[undefined]):void{}tag`\\1`;",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "cooked undefined ignores lexical shadow",
    "source": "function tag(s:[].<string>):void{}function f(undefined:any){tag`\\unicode`;}",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "cooked literal participates in overload",
    "source": "function tag(s:[\"a\"]):string{return \"a\";}function tag(s:[\"b\"]):string{return \"b\";}globalThis.settled=tag`\\x61`;",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "a",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "raw and frozen identity unchanged",
    "source": "let last;function tag(s){if(!Object.isFrozen(s)||!Object.isFrozen(s.raw))throw 0;if(last&&s!==last)throw 0;last=s;return s[0]+\"/\"+s.raw[0];}function f(){return tag`\\x61`;}f();globalThis.settled=f();",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "a/\\x61",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "ordinary string array overloaded with catchall",
    "source": "function tag(s:[].<string>):string{return \"typed\";}function tag(s:any):string{return \"any\";}globalThis.settled=tag`plain`;",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "typed",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "malformed selects admitted overload",
    "source": "function tag(s:[\"a\"]):string{return \"a\";}function tag(s:[undefined]):string{return \"absent\";}globalThis.settled=tag`\\unicode`;",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "absent",
      "hookRan": "false",
      "imports": []
    }
  }
])('$name', ({ source, expected }) => {
  expect(observeProtocol(source)).toMatchObject(expected);
});
