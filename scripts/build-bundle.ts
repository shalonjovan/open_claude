// scripts/build-bundle.ts
// Usage: bun scripts/build-bundle.ts [--watch] [--minify] [--no-sourcemap]
//
// Production build: bun scripts/build-bundle.ts --minify
// Dev build:        bun scripts/build-bundle.ts
// Watch mode:       bun scripts/build-bundle.ts --watch

import * as esbuild from 'esbuild'
import { resolve, dirname, isAbsolute } from 'path'
import { chmodSync, readFileSync, existsSync, statSync } from 'fs'
import { fileURLToPath } from 'url'

// Bun: import.meta.dir — Node 21+: import.meta.dirname — fallback
const __dir: string =
  (import.meta as any).dir ??
  (import.meta as any).dirname ??
  dirname(fileURLToPath(import.meta.url))

const ROOT = resolve(__dir, '..')
const watch = process.argv.includes('--watch')
const minify = process.argv.includes('--minify')
const noSourcemap = process.argv.includes('--no-sourcemap')

// Read version from package.json for MACRO injection
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'))
const version = pkg.version || '0.0.0-dev'

// ── Plugin: resolve bare 'src/' imports (tsconfig baseUrl: ".") ──
// The codebase uses `import ... from 'src/foo/bar.js'` which relies on
// TypeScript's baseUrl resolution. This plugin maps those to real TS files.
const srcResolverPlugin: esbuild.Plugin = {
  name: 'src-resolver',
  setup(build) {
    // Resolve 'src/' prefixed imports
    build.onResolve({ filter: /^src\// }, (args) => {
      const basePath = resolve(ROOT, args.path)
      if (existsSync(basePath) && statSync(basePath).isFile()) return { path: basePath }
      const withoutExt = basePath.replace(/\.(js|jsx)$/, '')
      for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
        const candidate = withoutExt + ext
        if (existsSync(candidate)) return { path: candidate }
      }
      const dirPath = basePath.replace(/\.(js|jsx)$/, '')
      for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
        const candidate = resolve(dirPath, 'index' + ext)
        if (existsSync(candidate)) return { path: candidate }
      }
      // Not found — mark as external (will fail at runtime if actually used)
      return { path: args.path, external: true }
    })

    // Resolve relative imports (.js/.ts files in the codebase)
    build.onResolve({ filter: /^\.\.?\// }, (args) => {
      const basePath = resolve(args.importer ? dirname(args.importer) : ROOT, args.path)
      // Check if it's a file import (has extension)
      if (existsSync(basePath) && statSync(basePath).isFile()) return { path: basePath }
      const withoutExt = basePath.replace(/\.(js|jsx)$/, '')
      for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
        const candidate = withoutExt + ext
        if (existsSync(candidate)) return { path: candidate }
      }
      // Try as directory
      for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
        const candidate = resolve(basePath, 'index' + ext)
        if (existsSync(candidate)) return { path: candidate }
      }
      // Try .txt files (skill content)
      if (basePath.endsWith('.txt') || basePath.endsWith('.md')) {
        if (existsSync(basePath)) return { path: basePath }
      }
      // Not found — mark as external
      return { path: args.path, external: true }
    })

    // Catch-all: mark unresolvable npm packages as external
    build.onResolve({ filter: /^[^.\/]/ }, (args) => {
      // Avoid resolving Node built-ins or packages explicitly marked as external
      if (args.path.startsWith('node:') || buildOptions.external?.includes(args.path)) {
        return { path: args.path, external: true }
      }

      // Known problematic packages — always external
      const knownProblematic = [
        '@anthropic-ai/sandbox-runtime',
        '@anthropic-ai/claude-agent-sdk',
        '@ant/',
        'fsevents',
        'sharp',
        'image-processor-napi',
        '@opentelemetry/',
        '@alcalzone/ansi-tokenize',
        'modifiers-napi',
        'audio-capture-napi',
      ]
      for (const ext of knownProblematic) {
        if (args.path === ext || args.path.startsWith(ext)) {
          return { path: args.path, external: true }
        }
      }
      // Check if this resolves to a real package
      try {
        const resolved = require.resolve(args.path, { paths: [ROOT] })
        if (!isAbsolute(resolved)) {
          return { path: args.path, external: true }
        }
        return { path: resolved }
      } catch {
        // Package can't be resolved — mark as external
        return { path: args.path, external: true }
      }
    })
  },
}

const buildOptions: esbuild.BuildOptions = {
  entryPoints: [resolve(ROOT, 'src/entrypoints/cli.tsx')],
  bundle: true,
  platform: 'node',
  loader: {
    '.md': 'text',
    '.txt': 'text',
  },
  target: ['node20', 'es2022'],
  format: 'esm',
  outdir: resolve(ROOT, 'dist'),
  outExtension: { '.js': '.mjs' },

  // Single-file output — no code splitting for CLI tools
  splitting: false,

  plugins: [srcResolverPlugin],

  // Use tsconfig for baseUrl / paths resolution (complements plugin above)
  tsconfig: resolve(ROOT, 'tsconfig.json'),

  // Alias bun:bundle to our runtime shim
  alias: {
    'bun:bundle': resolve(ROOT, 'src/shims/bun-bundle.ts'),
  },

  // Don't bundle node built-ins or problematic native packages
  external: [
    // Node built-ins (with and without node: prefix)
    'fs', 'path', 'os', 'crypto', 'child_process', 'http', 'https',
    'net', 'tls', 'url', 'util', 'stream', 'events', 'buffer',
    'querystring', 'readline', 'zlib', 'assert', 'tty', 'worker_threads',
    'perf_hooks', 'async_hooks', 'dns', 'dgram', 'cluster',
    'string_decoder', 'module', 'vm', 'constants', 'domain',
    'console', 'process', 'v8', 'inspector',
    'node:*',
    // Native addons that can't be bundled
    'fsevents',
    'sharp',
    'image-processor-napi',
    // Anthropic-internal packages (not published externally)
    '@anthropic-ai/sandbox-runtime',
    '@anthropic-ai/claude-agent-sdk',
    // Anthropic-internal (@ant/) packages — gated behind USER_TYPE === 'ant'
    '@ant/*',
  ],

  jsx: 'automatic',

  // Source maps for production debugging (external .map files)
  sourcemap: noSourcemap ? false : 'external',

  // Minification for production
  minify,

  // Tree shaking (on by default, explicit for clarity)
  treeShaking: true,

  // Define replacements — inline constants at build time
  // MACRO.* — originally inlined by Bun's bundler at compile time
  // process.env.USER_TYPE — eliminates 'ant' (Anthropic-internal) code branches
  define: {
    'MACRO.VERSION': JSON.stringify(version),
    'MACRO.PACKAGE_URL': JSON.stringify('@anthropic-ai/claude-code'),
    'MACRO.ISSUES_EXPLAINER': JSON.stringify(
      'report issues at https://github.com/anthropics/claude-code/issues'
    ),
    'process.env.USER_TYPE': '"external"',
    'process.env.NODE_ENV': minify ? '"production"' : '"development"',
  },

  // Banner: shebang for direct CLI execution
  banner: {
    js: '#!/usr/bin/env node\n',
  },

  // Handle the .js → .ts resolution that the codebase uses
  resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.json'],

  logLevel: 'info',

  // Metafile for bundle analysis
  metafile: true,
}

async function main() {
  if (watch) {
    const ctx = await esbuild.context(buildOptions)
    await ctx.watch()
    console.log('Watching for changes...')
  } else {
    const startTime = Date.now()
    const result = await esbuild.build(buildOptions)

    if (result.errors.length > 0) {
      console.error('Build failed')
      process.exit(1)
    }

    // Make the output executable
    const outPath = resolve(ROOT, 'dist/cli.mjs')
    try {
      chmodSync(outPath, 0o755)
    } catch {
      // chmod may fail on some platforms, non-fatal
    }

    const elapsed = Date.now() - startTime

    // Print bundle size info
    if (result.metafile) {
      const text = await esbuild.analyzeMetafile(result.metafile, { verbose: false })
      const outFiles = Object.entries(result.metafile.outputs)
      for (const [file, info] of outFiles) {
        if (file.endsWith('.mjs')) {
          const sizeMB = ((info as { bytes: number }).bytes / 1024 / 1024).toFixed(2)
          console.log(`\n  ${file}: ${sizeMB} MB`)
        }
      }
      console.log(`\nBuild complete in ${elapsed}ms → dist/`)

      // Write metafile for further analysis
      const { writeFileSync } = await import('fs')
      writeFileSync(
        resolve(ROOT, 'dist/meta.json'),
        JSON.stringify(result.metafile),
      )
      console.log('  Metafile written to dist/meta.json')
    }
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
