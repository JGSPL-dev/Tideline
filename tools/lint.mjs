// Runs the code checker: copies the app's main script out of index.html (keeping line numbers) and checks it and the service.
// Usage: node tools/lint.mjs   (needs ESLint 9+: npx eslint, or a global install)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, "..");
const html = readFileSync(path.join(root, "index.html"), "utf8");
const open = html.indexOf("<script>", html.indexOf("<script>") + 1) + 8, close = html.lastIndexOf("</script>");
mkdirSync(path.join(here, "build"), {recursive: true});
writeFileSync(path.join(here, "build/app.js"), "\n".repeat(html.slice(0, open).split("\n").length - 1) + html.slice(open, close));
writeFileSync(path.join(here, "build/worker.js"), readFileSync(path.join(root, "service/worker.js"), "utf8"));
const eslint = process.env.ESLINT || "eslint";
try{
  execFileSync(eslint, ["-c", "eslint.config.mjs", "build/app.js", "build/worker.js"], {cwd: here, stdio: "inherit"});
  console.log("Code check passed (line numbers: build/app.js matches index.html, build/worker.js matches service/worker.js)");
}catch{ process.exit(1); }
