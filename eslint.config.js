import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
export default [{
  files: ["frontend/*.js"],
  languageOptions: { globals: { ...globals.browser, WaveSurfer: "readonly" }, sourceType: "module", ecmaVersion: "latest" },
  rules: { "no-undef": "error" },
}, {
  files: ["frontend/**/*.{ts,tsx}"],
  languageOptions: { parser: tseslint.parser, globals: globals.browser, parserOptions: { ecmaFeatures: { jsx: true } } },
  plugins: { "react-hooks": reactHooks },
  rules: { "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "error" },
}];
