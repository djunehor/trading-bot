// eslint.config.js — flat config (ESLint 10)
// Practical-maximum strictness: strictest TS + core + unicorn + sonarjs + import-x.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import unicorn from 'eslint-plugin-unicorn';
import sonarjs from 'eslint-plugin-sonarjs';
import importX from 'eslint-plugin-import-x';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'data/**',
      'public/**',
      'scripts/**',
    ],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },

  // ── Base + TypeScript (strictest type-checked presets) ─────────────
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // Type-checked rules can't run on plain .js files (no type info).
  // Scope the disable to JS files so the type rules don't crash on them.
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    ...tseslint.configs.disableTypeChecked,
  },

  // ── Third-party plugin presets ─────────────────────────────────────
  unicorn.configs['flat/recommended'],
  importX.configs['flat/recommended'],
  importX.configs['flat/typescript'],

  // sonarjs "recommended" is effectively its full catalog (217 rules incl.
  // AWS/React/DOM/security and contradictory `use-type-alias`) — hand-picked below.
  {
    plugins: { sonarjs },
    rules: {
      // False positives: standard ESM plugin default-export access (`tseslint.configs`).
      'import-x/no-named-as-default': 'off',
      'import-x/no-named-as-default-member': 'off',
    },
  },

  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // ── Type-safe strictness (opt-in, above the presets) ───────────
      '@typescript-eslint/strict-boolean-expressions': 'error',
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/typedef': [
        'error',
        {
          arrayDestructuring: true,
          arrowParameter: true,
          memberVariableDeclaration: true,
          objectDestructuring: true,
          parameter: true,
          propertyDeclaration: true,
        },
      ],
      '@typescript-eslint/no-magic-numbers': [
        'error',
        {
          ignore: [-1, 0, 1],
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
          ignoreClassFieldInitialValues: true,
          ignoreEnums: true,
          ignoreNumericLiteralTypes: true,
          ignoreReadonlyClassProperties: true,
        },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/no-use-before-define': 'error',
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/prefer-readonly-parameter-types': 'error',
      '@typescript-eslint/promise-function-async': 'error',
      '@typescript-eslint/no-unnecessary-qualifier': 'error',
      '@typescript-eslint/no-useless-empty-export': 'error',
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'default', format: ['camelCase'] },
        { selector: 'variable', format: ['camelCase', 'UPPER_CASE'] },
        { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
        { selector: 'property', format: ['camelCase', 'snake_case', 'UPPER_CASE'] },
        { selector: 'method', format: ['camelCase'] },
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'enumMember', format: ['UPPER_CASE'] },
      ],
      '@typescript-eslint/member-ordering': 'error',
      '@typescript-eslint/explicit-member-accessibility': 'error',
      '@typescript-eslint/class-methods-use-this': 'error',
      '@typescript-eslint/consistent-return': 'error',
      '@typescript-eslint/default-param-last': 'error',
      '@typescript-eslint/init-declarations': 'error',
      '@typescript-eslint/method-signature-style': 'error',
      '@typescript-eslint/parameter-properties': 'error',
      '@typescript-eslint/prefer-destructuring': 'error',
      '@typescript-eslint/prefer-enum-initializers': 'error',
      '@typescript-eslint/prefer-ts-expect-error': 'error',
      '@typescript-eslint/require-array-sort-compare': 'error',
      '@typescript-eslint/sort-type-constituents': 'error',
      '@typescript-eslint/strict-void-return': 'error',
      '@typescript-eslint/no-dupe-class-members': 'error',
      '@typescript-eslint/no-empty-interface': 'error',
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-invalid-this': 'error',
      '@typescript-eslint/no-loop-func': 'error',
      '@typescript-eslint/no-loss-of-precision': 'error',
      '@typescript-eslint/no-redeclare': 'error',
      '@typescript-eslint/no-shadow': 'error',
      '@typescript-eslint/no-unnecessary-parameter-property-assignment': 'error',
      '@typescript-eslint/no-unsafe-type-assertion': 'error',
      '@typescript-eslint/no-unused-private-class-members': 'error',
      '@typescript-eslint/no-var-requires': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],

      // ── Core JS strictness (above `recommended`) ───────────────────
      eqeqeq: ['error', 'always'],
      curly: ['error', 'all'],
      'no-duplicate-imports': 'error',
      'object-shorthand': ['error', 'always'],
      'prefer-template': 'error',
      'no-else-return': 'error',
      'no-useless-return': 'error',
      'no-unneeded-ternary': 'error',
      'default-case': 'error',
      'default-case-last': 'error',
      'no-undefined': 'error',
      'no-param-reassign': ['error', { props: true }],
      'no-bitwise': 'error',
      'no-mixed-operators': 'error',
      radix: ['error', 'always'],
      'no-await-in-loop': 'error',
      'id-length': ['error', { min: 2, exceptions: ['_', 'i', 'j', 'k', 'x', 'y', 'z'], properties: 'never' }],
      'no-warning-comments': 'error',
      'max-classes-per-file': ['error', 1],
      yoda: 'error',
      'no-implicit-coercion': 'error',
      'prefer-arrow-callback': 'error',
      'prefer-exponentiation-operator': 'error',
      'prefer-object-spread': 'error',
      'prefer-numeric-literals': 'error',
      'prefer-object-has-own': 'error',
      'prefer-regex-literals': 'error',
      'no-return-assign': ['error', 'always'],
      'no-sequences': 'error',
      'no-multi-assign': 'error',
      'no-self-compare': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-unreachable-loop': 'error',
      'no-useless-call': 'error',
      'no-useless-rename': 'error',
      'no-useless-computed-key': 'error',

      // ── Complexity / size limits (kill god functions) ──────────────
      complexity: ['error', 10],
      'max-depth': ['error', 4],
      'max-nested-callbacks': ['error', 3],
      '@typescript-eslint/max-params': ['error', { max: 4 }],
      'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }],
      'max-statements': ['error', 25],
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],

      // ── import-x strictness ────────────────────────────────────────
      'import-x/order': [
        'error',
        { 'newlines-between': 'always', alphabetize: { order: 'asc', caseInsensitive: true } },
      ],
      'import-x/no-cycle': 'error',

      // ── sonarjs (hand-picked, no contradictions) ───────────────────
      'sonarjs/cognitive-complexity': 'error',
      'sonarjs/no-identical-functions': 'error',
      'sonarjs/no-duplicate-string': 'error',
      'sonarjs/no-duplicated-branches': 'error',
      'sonarjs/no-all-duplicated-branches': 'error',
      'sonarjs/no-identical-expressions': 'error',
      'sonarjs/no-identical-conditions': 'error',
      'sonarjs/no-dead-store': 'error',
      'sonarjs/no-unused-collection': 'error',
      'sonarjs/no-empty-collection': 'error',
      'sonarjs/no-redundant-assignments': 'error',
      'sonarjs/no-gratuitous-expressions': 'error',
      'sonarjs/no-nested-template-literals': 'error',
      'sonarjs/no-inverted-boolean-check': 'error',
      'sonarjs/no-redundant-jump': 'error',
      'sonarjs/prefer-immediate-return': 'error',
      'sonarjs/no-useless-catch': 'error',
      'sonarjs/no-nested-conditional': 'error',
      'sonarjs/no-redundant-boolean': 'error',
      'sonarjs/prefer-single-boolean-return': 'error',
      'sonarjs/no-collapsible-if': 'error',
      'sonarjs/no-unthrown-error': 'error',
      'sonarjs/no-element-overwrite': 'error',
      'sonarjs/no-collection-size-mischeck': 'error',
      'sonarjs/array-callback-without-return': 'error',
      'sonarjs/no-invariant-returns': 'error',
      'sonarjs/no-same-line-conditional': 'error',

      // ── unicorn overrides (not right for this codebase) ────────────
      'unicorn/no-null': 'off', // SQL-backed app: `null` is the correct SQL NULL
      'unicorn/filename-case': 'off', // existing convention is camelCase filenames
      'unicorn/require-array-sort-compare': 'off', // use @typescript-eslint version instead
      'unicorn/name-replacements': 'off', // `db`/`stmt`/`qty`/`pl`/`sym` are domain-standard
      'unicorn/prefer-response-static-json': 'off', // browser rule; Node test mocks construct Response objects
    },
  },
);
