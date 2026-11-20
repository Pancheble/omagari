// Builds the `omagari` npm package into dist/omagari (ADR-0048): the CLI, the runner, the hooks and the contract, as JavaScript.
// Usage: node scripts/build-package.ts <version> <dist-tag>. Only publishing runs it. Development and tests run the .ts sources (ADR-0014).
// Node strips the types itself (the sources use only erasable syntax). The files keep their folder layout, so paths like
// `../../hooks/src/main` in install.ts still hold. Imports of `.ts` files and of the workspace packages become relative `.js` imports.
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join, relative } from "node:path";

const [version, tag] = process.argv.slice(2);
if (!version || !tag) throw new Error("Usage: node scripts/build-package.ts <version> <dist-tag>");

const root = dirname(import.meta.dirname);
const out = join(root, "dist", "omagari");
const PACKAGES = ["contract", "runner", "cli", "hooks"];
/** Where each workspace import points inside the built package. */
const WORKSPACE: Record<string, string> = {
  "@omagari/contract": "packages/contract/src/index.js",
  "@omagari/contract/version": "packages/contract/src/version.js",
  "@omagari/runner": "packages/runner/src/index.js",
};

await rm(out, { recursive: true, force: true });
const dependencies: Record<string, string> = {};
for (const name of PACKAGES) {
  const pkg = JSON.parse(await readFile(join(root, "packages", name, "package.json"), "utf8"));
  for (const [dep, range] of Object.entries<string>(pkg.dependencies ?? {}))
    if (!dep.startsWith("@omagari/")) dependencies[dep] = range;
  const src = join(root, "packages", name, "src");
  for (const file of await readdir(src)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    const target = join(out, "packages", name, "src", file.replace(/\.ts$/, ".js"));
    const code = stripTypeScriptTypes(await readFile(join(src, file), "utf8")).replace(
      /(from\s*|import\(\s*)(["'])([^"']+)\2/g,
      (whole, before: string, quote: string, spec: string) => {
        const rel = WORKSPACE[spec] && relative(dirname(target), join(out, WORKSPACE[spec]));
        const to = rel
          ? rel.startsWith(".")
            ? rel
            : `./${rel}`
          : spec.startsWith(".")
            ? spec.replace(/\.ts$/, ".js")
            : undefined;
        if (spec.startsWith("@omagari/") && !to) throw new Error(`${file}: unknown import ${spec}`);
        return to ? `${before}${quote}${to}${quote}` : whole;
      },
    );
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, code, { mode: code.startsWith("#!") ? 0o755 : 0o644 });
  }
}
await cp(join(root, "packages", "cli", "skills"), join(out, "packages", "cli", "skills"), {
  recursive: true,
});
for (const file of ["README.md", "LICENSE"]) await cp(join(root, file), join(out, file));

const rootPkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const pkg = {
  name: "omagari",
  version,
  description: "Lets your team's coding agents see what each other are working on",
  license: rootPkg.license,
  type: "module",
  repository: { type: "git", url: "git+https://github.com/omagari-dev/omagari.git" },
  homepage: "https://github.com/omagari-dev/omagari",
  engines: rootPkg.engines,
  bin: { omagari: "packages/cli/src/main.js", "omagari-hook": "packages/hooks/src/main.js" },
  dependencies,
  // npm publishes under this tag, and the installed package keeps it, so the runner knows which tag to update from (#355).
  publishConfig: { tag },
};
await writeFile(join(out, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`Built omagari ${version} (${tag}) in ${relative(process.cwd(), out)}`);
