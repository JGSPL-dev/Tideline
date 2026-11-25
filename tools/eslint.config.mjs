// Code checker for the app's main script (tools/lint.mjs extracts it from index.html) and the service.
// Core correctness rules only: undefined names, unreachable code, duplicate keys, unused variables and the like.
const browser = Object.fromEntries(("window document navigator localStorage sessionStorage fetch console setTimeout clearTimeout setInterval clearInterval " +
  "URL URLSearchParams AbortController DOMParser Blob File FileReader Image Audio IntersectionObserver ResizeObserver MutationObserver " +
  "requestAnimationFrame cancelAnimationFrame getComputedStyle location history screen indexedDB crypto TextEncoder TextDecoder performance " +
  "matchMedia addEventListener removeEventListener scrollY scrollTo scrollBy innerWidth innerHeight CSS Event CustomEvent HTMLElement Node " +
  "NodeFilter XMLSerializer btoa atob queueMicrotask structuredClone alert confirm Notification caches MediaMetadata Intl visualViewport " +
  "devicePixelRatio open self globalThis Response Request Headers FormData DOMException createImageBitmap Element").split(/\s+/).map(k => [k, "readonly"]));
const worker = Object.fromEntries("fetch console Response Request Headers URL URLSearchParams crypto TextEncoder TextDecoder caches AbortController setTimeout clearTimeout btoa atob structuredClone DOMParser".split(" ").map(k => [k, "readonly"]));
const rules = {
  "no-undef": "error", "no-dupe-keys": "error", "no-unreachable": "error", "no-redeclare": "error", "no-self-assign": "error",
  "no-const-assign": "error", "no-dupe-else-if": "error", "no-duplicate-case": "error", "no-cond-assign": ["error", "except-parens"],
  "no-func-assign": "error", "no-unsafe-finally": "error", "no-dupe-args": "error", "use-isnan": "error", "valid-typeof": "error",
  "no-sparse-arrays": "error", "no-unused-expressions": ["error", {allowShortCircuit: true, allowTernary: true}],
  "no-unused-vars": ["error", {args: "none", caughtErrors: "none", ignoreRestSiblings: true}],
  "no-empty": ["error", {allowEmptyCatch: true}],
};
export default [
  {files: ["build/app.js"], languageOptions: {ecmaVersion: "latest", sourceType: "script", globals: browser}, rules},
  {files: ["build/worker.js"], languageOptions: {ecmaVersion: "latest", sourceType: "module", globals: worker}, rules},
];
