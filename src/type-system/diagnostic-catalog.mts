// Generated from proposal-runtime-types/diagnostics.json.
// Catalog SHA-256: a2b76a50fe073a2b3723720ca2d04fd3d4ded65257ca585f6f9dfd27266f6da8
export const TypeDiagnosticCatalog = [
  {
    "code": "RT_DEFAULT_EVALUATION",
    "rule": "rt-default-evaluation",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-default-values"
    ],
    "explanation": "A required default cannot be evaluated. Supply an evaluable default or an explicit initializer.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_DEFAULT_CONVERSION",
    "rule": "rt-default-conversion",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-default-values"
    ],
    "explanation": "The default cannot undergo the declared conversion.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_WHERE_UNSATISFIED",
    "rule": "rt-where-unsatisfied",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-generic-where"
    ],
    "explanation": "The application fails a declared constraint.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_UNCLAIMED_METADATA",
    "rule": "rt-unclaimed-metadata",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-primitive-metadata"
    ],
    "explanation": "A metadata key has no governing meta declaration.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_ENUM_INITIALIZER",
    "rule": "rt-enum-initializer",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-enums"
    ],
    "explanation": "An enum initializer violates its binding, evaluability, or value contract.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_SPECIALIZATION",
    "rule": "rt-specialization",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-generic-specialization"
    ],
    "explanation": "The call cannot be specialized under the declared constraints.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_TYPE_EVALUATION",
    "rule": "rt-type-evaluation",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-compile-time-evaluability",
      "sec-module-type-checking-order"
    ],
    "explanation": "A closed type expression does not evaluate to a Type Object.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_IMPOSSIBLE_TEST",
    "rule": "rt-impossible-test",
    "status": "provisional",
    "applicability": "checked",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-narrowfrom"
    ],
    "explanation": "The deciding test necessarily succeeds or necessarily fails under the specified stable facts.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_EMPTY_INTERSECTION",
    "rule": "rt-empty-intersection",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-intersection-type-early-errors"
    ],
    "explanation": "The declared intersection has no inhabitant under the specified stable judgment.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_ASSIGNABILITY",
    "rule": "rt-assignability",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-isassignable"
    ],
    "explanation": "The established source cannot satisfy the declared destination contract.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_UNINHABITED_DECLARATION",
    "rule": "rt-uninhabited-declaration",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-never-type"
    ],
    "explanation": "The declared type cannot have an initialized value.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_MISSING_DEFAULT",
    "rule": "rt-missing-default",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-default-values"
    ],
    "explanation": "The declaration needs an initializer because its type has no default.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_INHERITED_CONTRACT",
    "rule": "rt-inherited-contract",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-typed-classes"
    ],
    "explanation": "An implementation or override fails the inherited callable or member contract.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_GENERIC_BINDING_ORDER",
    "rule": "rt-generic-binding-order",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-type-parameters"
    ],
    "explanation": "A parameter constraint or default reads a binding before it is available.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_VARIADIC_CONTRACT",
    "rule": "rt-variadic-contract",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-variadic-parameters"
    ],
    "explanation": "The variadic declaration or rest boundary does not meet its required type or separation rule.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_GENERIC_CONSTRAINT",
    "rule": "rt-generic-constraint",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-type-parameters"
    ],
    "explanation": "The argument does not satisfy the type parameter constraint.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_RETURN_CONTRACT",
    "rule": "rt-return-contract",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-typed-arrow-functions"
    ],
    "explanation": "An established return value cannot satisfy the function return contract.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_VOID_USE",
    "rule": "rt-void-use",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-void-type"
    ],
    "explanation": "A void result is used where a value is required.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_AMBIGUOUS_CONVERSION",
    "rule": "rt-ambiguous-conversion",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-conversions"
    ],
    "explanation": "More than one applicable conversion is maximal; provide a uniquely applicable conversion.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_UNDECLARED_MEMBER",
    "rule": "rt-undeclared-member",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-typed-storage"
    ],
    "explanation": "The required member is not declared for the established receiver alternatives.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_IMMUTABLE_PATTERN_BINDING",
    "rule": "rt-immutable-pattern-binding",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-pattern-static-semantics"
    ],
    "explanation": "The pattern binding is immutable.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_READONLY_STORE",
    "rule": "rt-readonly-store",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-typed-storage"
    ],
    "explanation": "The operation writes a declared readonly member.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_READONLY_LAYOUT",
    "rule": "rt-readonly-layout",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-layout-properties"
    ],
    "explanation": "The operation writes an immutable type-layout property.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_MISSING_SETTER",
    "rule": "rt-missing-setter",
    "status": "provisional",
    "applicability": "checked",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-type-errors"
    ],
    "explanation": "The established existing built-in accessor has no setter for the reached store.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_INDEX_STORE",
    "rule": "rt-index-store",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-user-defined-operators"
    ],
    "explanation": "The index operation supplies neither a setter nor a reference location.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_STRING_STORE",
    "rule": "rt-string-store",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-typed-string-properties"
    ],
    "explanation": "The operation writes a fixed string position.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_VECTOR_LANE_STORE",
    "rule": "rt-vector-lane-store",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-vector-component-accessors"
    ],
    "explanation": "A vector store names a component more than once.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_DUPLICATE_MEMBER",
    "rule": "rt-duplicate-member",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-typed-classes"
    ],
    "explanation": "A repeated member conflicts with the declared storage contract.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_INDEX_SIGNATURE",
    "rule": "rt-index-signature",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-type-errors"
    ],
    "explanation": "An index signature, indexed type, or index operand does not meet its declared key contract.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_PARTIAL_CLASS",
    "rule": "rt-partial-class",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-partial-classes"
    ],
    "explanation": "The partial class contribution violates its target or contribution restrictions.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_META_DECLARATION",
    "rule": "rt-meta-declaration",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-meta-declarations"
    ],
    "explanation": "The meta declaration duplicates an owner or omits a required hook.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_COMPUTED_MEMBER_NAME",
    "rule": "rt-computed-member-name",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-type-errors"
    ],
    "explanation": "The computed name is not an admitted constant member key.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_NARROWING_DECLARATION",
    "rule": "rt-narrowing-declaration",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-declared-narrowing"
    ],
    "explanation": "The declared narrowing target does not name a parameter of this callable.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_LAYOUT",
    "rule": "rt-layout",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-memory-layout",
      "sec-recursive-declaration-validation"
    ],
    "explanation": "The declared storage cannot have the required finite layout.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_OVERLOAD_DECLARATION",
    "rule": "rt-overload-declaration",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-callable-overload-contracts"
    ],
    "explanation": "The declared overloads overlap in a prohibited or ambiguous way.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_IMPLEMENTS_CONTRACT",
    "rule": "rt-implements-contract",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-typed-classes"
    ],
    "explanation": "The implements target or implementing callable shape is invalid.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_GENERIC_ARGUMENT",
    "rule": "rt-generic-argument",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-type-parameters"
    ],
    "explanation": "The application does not supply the required kind, count, or inferable generic arguments.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_PROTECTED_MEMBER",
    "rule": "rt-protected-member",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-typed-classes"
    ],
    "explanation": "The member is protected at this access.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_PROMISE_PROTOCOL",
    "rule": "rt-promise-protocol",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-type-errors"
    ],
    "explanation": "The established then contract cannot accept the assimilation callbacks.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_ITERABLE_REQUIRED",
    "rule": "rt-iterable-required",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-static-iteration-contribution"
    ],
    "explanation": "The required iterable operation is impossible for the established source.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_COMPILE_TIME_EVALUABILITY",
    "rule": "rt-compile-time-evaluability",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-compile-time-evaluability"
    ],
    "explanation": "The required type computation is outside the compile-time-evaluable fragment.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_PARAMETER_ORDER",
    "rule": "rt-parameter-order",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-type-errors"
    ],
    "explanation": "The required positional parameter cannot follow this default without an unambiguous binding.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_MEMBER_DEFAULT",
    "rule": "rt-member-default",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-default-values"
    ],
    "explanation": "A member with a default must be optional.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_TYPE_REQUIRED",
    "rule": "rt-type-required",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-types-and-type-objects"
    ],
    "explanation": "The type position or annotation does not denote the required type category.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_INTEGER_WIDTH",
    "rule": "rt-integer-width",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-numeric-types-of-this-proposal"
    ],
    "explanation": "The integer width is outside the specified integer-width domain.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_ARRAY_EXTENT",
    "rule": "rt-array-extent",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-array-and-tuple-types"
    ],
    "explanation": "The array extent or type argument list is invalid.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_COMPOSITE_TYPE",
    "rule": "rt-composite-type",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-composite-typeobject-call"
    ],
    "explanation": "The requested composite has an inadmissible component type or key.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_WEAK_TARGET",
    "rule": "rt-weak-target",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-weak-references-and-typed-objects"
    ],
    "explanation": "The declared weak collection cannot hold this value category.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_EXPLICIT_CONVERSION",
    "rule": "rt-explicit-conversion",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-conversions"
    ],
    "explanation": "The explicit conversion is not defined for these types.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_CONSTRUCTOR_REQUIRED",
    "rule": "rt-constructor-required",
    "status": "provisional",
    "applicability": "checked",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-type-errors"
    ],
    "explanation": "The established target cannot be constructed.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_RANGE_VALUE",
    "rule": "rt-range-value",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-ranges"
    ],
    "explanation": "The range has an inadmissible endpoint or produces a value outside its declared domain.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_NUMERIC_RANGE",
    "rule": "rt-numeric-range",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-numericconvert"
    ],
    "explanation": "The established value is outside the required numeric or literal domain.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_NUMERIC_OPERATOR",
    "rule": "rt-numeric-operator",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-operators"
    ],
    "explanation": "The numeric categories do not admit this operator together.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_DISJOINT_COMPARISON",
    "rule": "rt-disjoint-comparison",
    "status": "provisional",
    "applicability": "checked",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-narrowfrom"
    ],
    "explanation": "The established operands share no value for this comparison.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_ZERO_DIVISOR",
    "rule": "rt-zero-divisor",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-operators"
    ],
    "explanation": "The literal divisor is zero where the typed operation forbids it.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_SHIFT_DISTANCE",
    "rule": "rt-shift-distance",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-operators"
    ],
    "explanation": "The typed shift distance is negative or removes every bit.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_REQUIRED_MEMBER",
    "rule": "rt-required-member",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-typed-storage"
    ],
    "explanation": "The value omits a required declared member.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_CONSTANT_CONDITION",
    "rule": "rt-constant-condition",
    "status": "provisional",
    "applicability": "checked",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-falsy-and-truthy-parts"
    ],
    "explanation": "The deciding value has only truthy or only falsy alternatives.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_IMPOSSIBLE_ASSERTION",
    "rule": "rt-impossible-assertion",
    "status": "provisional",
    "applicability": "checked",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-declared-narrowing"
    ],
    "explanation": "The asserted stable domain cannot admit the established value.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_UNREACHABLE_OPERAND",
    "rule": "rt-unreachable-operand",
    "status": "provisional",
    "applicability": "checked",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-narrowing-flow"
    ],
    "explanation": "The deciding left operand necessarily skips the right operand.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_PATTERN_DOMAIN",
    "rule": "rt-pattern-domain",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-pattern-static-semantics"
    ],
    "explanation": "The pattern cannot match or unambiguously describe the required position.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_MATCHER_CONTRACT",
    "rule": "rt-matcher-contract",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-pattern-static-semantics"
    ],
    "explanation": "The custom matcher is absent or has an incompatible callable/result contract.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_UNREACHABLE_PATTERN",
    "rule": "rt-unreachable-pattern",
    "status": "provisional",
    "applicability": "checked",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-pattern-static-semantics"
    ],
    "explanation": "No remaining value can reach this pattern clause.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_NONEXHAUSTIVE_MATCH",
    "rule": "rt-nonexhaustive-match",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-pattern-static-semantics"
    ],
    "explanation": "The match omits a required case or catch-all.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_UNREACHABLE_DEFAULT",
    "rule": "rt-unreachable-default",
    "status": "provisional",
    "applicability": "checked",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-narrowing-flow"
    ],
    "explanation": "Earlier cases cover every admitted value, so the default cannot be selected.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_PATTERN_SCOPE",
    "rule": "rt-pattern-scope",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-pattern-static-semantics"
    ],
    "explanation": "The binding-carrying pattern is outside its governing position or scope.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_RETURN_INFERENCE",
    "rule": "rt-return-inference",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-type-errors"
    ],
    "explanation": "Return inference grows without a finite result; write an explicit return type.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_UNPRODUCTIVE_TYPE",
    "rule": "rt-unproductive-type",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-type-alias-declarations",
      "sec-recursive-declaration-validation"
    ],
    "explanation": "The alias only defines itself and produces no type.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_REFERENCE_LOCATION",
    "rule": "rt-reference-location",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-reference-values"
    ],
    "explanation": "The operation requires a referenceable location, not merely a value.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_FIXED_EXTENT_STORE",
    "rule": "rt-fixed-extent-store",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-typed-storage"
    ],
    "explanation": "The operation changes a fixed sequence extent.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_PROPERTY_RECEIVER",
    "rule": "rt-property-receiver",
    "status": "provisional",
    "applicability": "checked",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-type-errors"
    ],
    "explanation": "The established receiver cannot support the required property operation.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_CONVERSION_PROTOCOL",
    "rule": "rt-conversion-protocol",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-type-errors"
    ],
    "explanation": "The selected typed conversion protocol cannot satisfy the reached operation.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_ITERATOR_CLOSE",
    "rule": "rt-iterator-close",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-type-errors"
    ],
    "explanation": "The reached iterator close cannot satisfy its declared protocol contract.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_NAMED_ARGUMENT",
    "rule": "rt-named-argument",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-type-errors"
    ],
    "explanation": "Named and positional arguments cannot bind the signature as written.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_BUILTIN_ARGUMENT",
    "rule": "rt-builtin-argument",
    "status": "provisional",
    "applicability": "checked",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-type-errors"
    ],
    "explanation": "The established arguments cannot satisfy the added contract of the existing built-in operation.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_ATOMIC_ARGUMENT",
    "rule": "rt-atomic-argument",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-atomics-typed-operations"
    ],
    "explanation": "The typed atomic operation requires a supported location and operand category.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_TYPED_ARRAY_STORE",
    "rule": "rt-typed-array-store",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-array-defaults-and-stores"
    ],
    "explanation": "The established intrinsic array store cannot convert to the declared element type.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_CALL_ARGUMENT",
    "rule": "rt-call-argument",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-type-errors"
    ],
    "explanation": "No argument binding can satisfy the required callable contract.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_AMBIGUOUS_CALL",
    "rule": "rt-ambiguous-call",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-overload-resolution"
    ],
    "explanation": "Multiple declared signatures remain applicable without a unique selection.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_NOT_CALLABLE",
    "rule": "rt-not-callable",
    "status": "provisional",
    "applicability": "checked",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-type-errors"
    ],
    "explanation": "The established callee is not callable.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_DECORATOR_ARGUMENT",
    "rule": "rt-decorator-argument",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-type-errors"
    ],
    "explanation": "The decorator cannot accept its written arguments and object context.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_REFERENCE_ARGUMENT",
    "rule": "rt-reference-argument",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-reference-parameters-and-arguments"
    ],
    "explanation": "The argument does not supply the required reference or reference type.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_PROXY_STORAGE",
    "rule": "rt-proxy-storage",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-typed-storage"
    ],
    "explanation": "A Proxy cannot wrap the specified protected typed storage.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_COLLECTION_SEED",
    "rule": "rt-collection-seed",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-collection-iteration"
    ],
    "explanation": "A surviving seed entry cannot satisfy its declared collection element contract.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_THIS_REQUIRED",
    "rule": "rt-this-required",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-type-errors"
    ],
    "explanation": "The call lacks the receiver required by the declared method contract.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_DUPLICATE_OPERATOR",
    "rule": "rt-duplicate-operator",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-primitive-operator-blocks"
    ],
    "explanation": "The operator overlaps an already declared primitive operation.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_EMPTY_ITERATION",
    "rule": "rt-empty-iteration",
    "status": "provisional",
    "applicability": "checked",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-narrowing-flow"
    ],
    "explanation": "The established source has no element, so the loop body cannot execute.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_REFERENCE_ITERATION",
    "rule": "rt-reference-iteration",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-reference-iteration"
    ],
    "explanation": "The iteration cannot supply references to its elements.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_DISPOSAL_CONTRACT",
    "rule": "rt-disposal-contract",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-typed-resource-management"
    ],
    "explanation": "The selected disposal hook cannot satisfy the required call contract.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_INSTANCEOF_PROTOCOL",
    "rule": "rt-instanceof-protocol",
    "status": "provisional",
    "applicability": "checked",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-operator-results",
      "sec-type-rule-applicability"
    ],
    "explanation": "An added instanceof protocol requirement cannot be satisfied in checked code.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_INSTANCEOF_PROTOCOL",
    "rule": "rt-instanceof-declared-call",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-operator-results",
      "sec-type-rule-applicability"
    ],
    "explanation": "Every selected callable instanceof hook violates its declared receiver or parameter contract.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_OBJECT_OPERAND",
    "rule": "rt-object-operand",
    "status": "provisional",
    "applicability": "checked",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-type-errors"
    ],
    "explanation": "The operator requires an Object right operand.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_CATCH_ORDER",
    "rule": "rt-catch-order",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-typed-catch"
    ],
    "explanation": "An untyped catch must be the final handler.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_UNREACHABLE_CATCH",
    "rule": "rt-unreachable-catch",
    "status": "provisional",
    "applicability": "checked",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-typed-catch"
    ],
    "explanation": "Previous catch filters admit every value this handler could accept.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_ENUM_CASE",
    "rule": "rt-enum-case",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-enums"
    ],
    "explanation": "The enum switch names an invalid case or omits a required case.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_UNREACHABLE_RANGE_CASE",
    "rule": "rt-unreachable-range-case",
    "status": "provisional",
    "applicability": "checked",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-narrowing-flow"
    ],
    "explanation": "Earlier range labels cover every value this label could select.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_DECLARATION_INFERENCE",
    "rule": "rt-declaration-inference",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-typed-bindings"
    ],
    "explanation": "The declaration requires a static type that its initializer does not establish.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_REFERENCE_REBINDING",
    "rule": "rt-reference-rebinding",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-reference-bindings"
    ],
    "explanation": "The destination is not a rebindable reference binding.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_TYPED_DELETE",
    "rule": "rt-typed-delete",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-typed-storage"
    ],
    "explanation": "The operation deletes protected typed storage.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_ABSTRACT_CONSTRUCTION",
    "rule": "rt-abstract-construction",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-typed-classes"
    ],
    "explanation": "An abstract class cannot be constructed.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_DECLARED_ZERO",
    "rule": "rt-declared-zero",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-declared-zero"
    ],
    "explanation": "The declared zero does not satisfy the type.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_SUPERCLASS_CONTRACT",
    "rule": "rt-superclass-contract",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-typed-classes"
    ],
    "explanation": "The typed superclass does not satisfy the constructor/prototype contract.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_AMBIGUOUS_RESULT",
    "rule": "rt-ambiguous-result",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-overloading-on-return-type"
    ],
    "explanation": "Several comparison result forms remain possible; supply a result context.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_OPERATOR_ARGUMENT",
    "rule": "rt-operator-argument",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-overload-resolution"
    ],
    "explanation": "No declared operator signature accepts these operands.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_AMBIGUOUS_OPERATOR",
    "rule": "rt-ambiguous-operator",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-overload-resolution"
    ],
    "explanation": "More than one declared operator signature remains applicable.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_PARAMETER_KIND",
    "rule": "rt-parameter-kind",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-parameter-kinds"
    ],
    "explanation": "The written parameter domain does not determine an admitted parameter kind.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_SPECIALIZATION_CONTRACT",
    "rule": "rt-specialization-contract",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-callable-overload-contracts"
    ],
    "explanation": "The specialized declaration does not preserve its owner contract or has invalid selection patterns.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_TYPE_DEFAULT_IDENTITY",
    "rule": "rt-type-default-identity",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-default-values"
    ],
    "explanation": "A shared type default must have value semantics.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_REFERENCE_PERMISSION",
    "rule": "rt-reference-permission",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-reference-alias-write-permission"
    ],
    "explanation": "The reference operation violates its access or lifetime permission.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_VECTOR_ARGUMENT",
    "rule": "rt-vector-argument",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-vector-types"
    ],
    "explanation": "The vector application does not meet its element, extent, or lane contract.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_TYPE_EVALUATION_LIMIT",
    "rule": "rt-type-evaluation-limit",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-evaluation-budget",
      "sec-type-evaluation-accounting"
    ],
    "explanation": "The specified semantic work limit is exhausted; the computation supplies no fallback type.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_CONSTRUCTOR_REQUIRED",
    "rule": "rt-proposal-construction",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-type-errors"
    ],
    "explanation": "The established target cannot be constructed.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  },
  {
    "code": "RT_NOT_CALLABLE",
    "rule": "rt-declared-call",
    "status": "provisional",
    "applicability": "always",
    "phases": [
      "static",
      "pre-evaluation"
    ],
    "errorClass": "StaticTypeError",
    "specification": [
      "sec-type-errors"
    ],
    "explanation": "The established callee is not callable.",
    "arguments": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "relatedLocations": [
      "declaration",
      "origin"
    ]
  }
] as const;
export type TypeDiagnosticCode = typeof TypeDiagnosticCatalog[number]['code'];
export type TypeDiagnosticRule = typeof TypeDiagnosticCatalog[number]['rule'];
export const TypeDiagnosticCatalogHash = 'a2b76a50fe073a2b3723720ca2d04fd3d4ded65257ca585f6f9dfd27266f6da8';
