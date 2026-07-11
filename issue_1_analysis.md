# Build Analysis: Esbuild Plugin Built-In Resolution Failure (Issue #1)

This document provides a detailed breakdown of the critical build issue preventing compilation of the production bundle in the OpenClaude repository, followed by details of the implemented fix.

## Severity
**Critical** (Prevents the production build pipeline from succeeding).

## Category
**Build / Tooling**

## File Reference
* Target File: [scripts/build-bundle.ts](file:///c:/Users/srika/OneDrive - SSN-Institute/Coding Projects/Open_Claude/open_claude/scripts/build-bundle.ts)
* Location of Issue: `onResolve` handlers and `buildOptions` configuration

---

## The Error

When attempting to build the project using:
```bash
bun scripts/build-bundle.ts --minify
```
The build process failed immediately and outputted errors similar to the following:

```text
X [ERROR] Plugin "src-resolver" returned a non-absolute path: node:fs (set a namespace if this is not a file path)

    node_modules/@anthropic-ai/sdk/_shims/bun-runtime.js:5:26:
      5 │ const node_fs_1 = require("node:fs");
        ╵                           ~~~~~~~~~

X [ERROR] Plugin "src-resolver" returned a non-absolute path: node:process (set a namespace if this is not a file path)

    node_modules/@modelcontextprotocol/sdk/dist/cjs/client/stdio.js:9:47:
      9 │ const node_process_1 = require("node:process");
        ╵                                ~~~~~~~~~~~~~~
```

---

## Why It Happened

### 1. The Resolver's Filter
The plugin defined a catch-all resolver for package imports that do not start with a dot or slash:
```typescript
build.onResolve({ filter: /^[^.\/]/ }, (args) => { ... })
```
This regex matched bare package identifiers like `lodash-es`, but also caught Node.js built-in modules such as `fs`, `path`, `node:fs`, `node:process`, and `node:stream`.

### 2. Resolution Logic
Within this handler, the code resolved the package path dynamically:
```typescript
try {
  const resolved = require.resolve(args.path, { paths: [ROOT] })
  return { path: resolved }
} catch {
  return { path: args.path, external: true }
}
```

### 3. The Root Cause
For a built-in module import like `node:fs` or `fs`, Node.js's `require.resolve()` returned the module name verbatim (e.g. `"node:fs"` or `"fs"`). Because the resolution succeeded, the `try` block returned `{ path: "node:fs" }`.

However, `node:fs` is a **non-absolute path**. Under esbuild rules, a resolver plugin is not allowed to return a non-absolute path unless it also specifies a custom `namespace`. When a plugin returned a plain non-absolute path, esbuild flagged it as a builder configuration error and crashed.

---

## What Was Fixed

1. **Bypassed Built-in Resolution:** Modified the Bare Package resolver in `scripts/build-bundle.ts` to immediately return `{ path: args.path, external: true }` if the import starts with `node:` or is specified in the `buildOptions.external` array.
2. **Absolute Path Verification:** Added a fallback check using `isAbsolute(resolved)` for resolved paths. Packages like `ws` (which resolved to `"ws"` under Bun instead of an absolute file path) are now caught and marked as external.
3. **Directory vs. File Resolution Safeguard:** Added `statSync(basePath).isFile()` checks inside relative import and `src/` prefix resolvers to prevent resolving import names to directory folders with the same name (such as AJV's `validation` directory).
4. **Configured Text Loaders:** Configured `.md` and `.txt` loaders to `'text'` in the esbuild options so that Markdown skills and templates can compile.

---

## Files Changed

### [MODIFY] [scripts/build-bundle.ts](file:///c:/Users/srika/OneDrive - SSN-Institute/Coding Projects/Open_Claude/open_claude/scripts/build-bundle.ts)

Detailed Git diff of the changes:

```diff
diff --git a/scripts/build-bundle.ts b/scripts/build-bundle.ts
index e20739c..ff060bd 100644
--- a/scripts/build-bundle.ts
+++ b/scripts/build-bundle.ts
@@ -6,8 +6,8 @@
 // Watch mode:       bun scripts/build-bundle.ts --watch
 
 import * as esbuild from 'esbuild'
-import { resolve, dirname } from 'path'
-import { chmodSync, readFileSync, existsSync } from 'fs'
+import { resolve, dirname, isAbsolute } from 'path'
+import { chmodSync, readFileSync, existsSync, statSync } from 'fs'
 import { fileURLToPath } from 'url'
 
 // Bun: import.meta.dir — Node 21+: import.meta.dirname — fallback
@@ -34,7 +34,7 @@
     // Resolve 'src/' prefixed imports
     build.onResolve({ filter: /^src\// }, (args) => {
       const basePath = resolve(ROOT, args.path)
-      if (existsSync(basePath)) return { path: basePath }
+      if (existsSync(basePath) && statSync(basePath).isFile()) return { path: basePath }
       const withoutExt = basePath.replace(/\.(js|jsx)$/, '')
       for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
         const candidate = withoutExt + ext
@@ -52,7 +52,7 @@
     build.onResolve({ filter: /^\.\.?\// }, (args) => {
       const basePath = resolve(args.importer ? dirname(args.importer) : ROOT, args.path)
       // Check if it's a file import (has extension)
-      if (existsSync(basePath)) return { path: basePath }
+      if (existsSync(basePath) && statSync(basePath).isFile()) return { path: basePath }
       const withoutExt = basePath.replace(/\.(js|jsx)$/, '')
       for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
         const candidate = withoutExt + ext
@@ -74,6 +74,11 @@
 
     // Catch-all: mark unresolvable npm packages as external
     build.onResolve({ filter: /^[^.\/]/ }, (args) => {
+      // Avoid resolving Node built-ins or packages explicitly marked as external
+      if (args.path.startsWith('node:') || buildOptions.external?.includes(args.path)) {
+        return { path: args.path, external: true }
+      }
+
       // Known problematic packages — always external
       const knownProblematic = [
         '@anthropic-ai/sandbox-runtime',
@@ -98,6 +103,9 @@
       // Check if this resolves to a real package
       try {
         const resolved = require.resolve(args.path, { paths: [ROOT] })
+        if (!isAbsolute(resolved)) {
+          return { path: args.path, external: true }
+        }
         return { path: resolved }
       } catch {
         // Package can't be resolved — mark as external
@@ -110,6 +118,10 @@
   entryPoints: [resolve(ROOT, 'src/entrypoints/cli.tsx')],
   bundle: true,
   platform: 'node',
+  loader: {
+    '.md': 'text',
+    '.txt': 'text',
+  },
   target: ['node20', 'es2022'],
   format: 'esm',
   outdir: resolve(ROOT, 'dist'),
```
