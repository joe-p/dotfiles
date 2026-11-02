import * as fs from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Loads the default extension factory declared by a Pi package's
 * `package.json` -> `pi.extensions` manifest.
 *
 * Usage from a shim in ~/.pi/agent/extensions:
 *
 *   import { loadPiPackageExtension } from "./lib/pi-package.ts";
 *   export default await loadPiPackageExtension("some-pi-package");
 *
 * The package is resolved through the current pnpm/node_modules layout, then
 * canonicalized so its own dependencies resolve from the real package root
 * instead of through a pnpm symlink.
 */

export type PiExtensionFactory = (pi: any) => unknown;

type PiPackageManifest = {
  name?: string;
  pi?: {
    extensions?: string[];
  };
};

type GlobSync = (
  pattern: string,
  options: { cwd: string },
) => string[];

const require = createRequire(import.meta.url);
const globSync = (fs as unknown as { globSync?: GlobSync }).globSync;
const GLOB_PATTERN = /[*?[\]{}]/;

function isExtensionFile(path: string): boolean {
  return path.endsWith(".ts") || path.endsWith(".js");
}

function readJson(path: string): PiPackageManifest {
  return JSON.parse(fs.readFileSync(path, "utf8")) as PiPackageManifest;
}

function findPackageRoot(packageName: string): string {
  // Works for packages without an "exports" restriction on package.json.
  try {
    return dirname(fs.realpathSync(require.resolve(`${packageName}/package.json`)));
  } catch {
    // Fall through to scanning module resolution paths.
  }

  for (const searchPath of require.resolve.paths(packageName) ?? []) {
    const candidate = join(searchPath, packageName, "package.json");
    if (fs.existsSync(candidate)) {
      return dirname(fs.realpathSync(candidate));
    }
  }

  throw new Error(`Cannot find Pi package "${packageName}" from ${import.meta.url}`);
}

function resolveEntryPath(path: string): string[] {
  let stats: fs.Stats;
  try {
    stats = fs.statSync(path);
  } catch {
    return [];
  }

  if (stats.isFile()) {
    return isExtensionFile(path) ? [fs.realpathSync(path)] : [];
  }

  if (!stats.isDirectory()) {
    return [];
  }

  for (const name of ["index.ts", "index.js"]) {
    const index = join(path, name);
    if (fs.existsSync(index)) {
      return [fs.realpathSync(index)];
    }
  }

  return [];
}

function expandPattern(packageRoot: string, pattern: string): string[] {
  if (!GLOB_PATTERN.test(pattern)) {
    return [resolve(packageRoot, pattern)];
  }

  if (!globSync) {
    throw new Error(
      `Glob pattern "${pattern}" in ${packageRoot}/package.json requires Node.js >= 22 (fs.globSync)`,
    );
  }

  return globSync(pattern, { cwd: packageRoot }).map((match) =>
    resolve(packageRoot, match),
  );
}

/**
 * Returns the canonical extension entry files declared by the package's
 * `pi.extensions` manifest, with glob and `!exclusion` patterns applied.
 */
export function resolvePiPackageExtensionEntries(
  packageName: string,
): string[] {
  const packageRoot = findPackageRoot(packageName);
  const manifest = readJson(join(packageRoot, "package.json"));
  const patterns = manifest.pi?.extensions;

  if (!Array.isArray(patterns) || patterns.length === 0) {
    throw new Error(
      `Pi package "${packageName}" has no "pi.extensions" entries in ${packageRoot}/package.json`,
    );
  }

  const entries = new Set<string>();

  for (const rawPattern of patterns) {
    if (typeof rawPattern !== "string" || rawPattern.length === 0) {
      continue;
    }

    const negated = rawPattern.startsWith("!") && !rawPattern.startsWith("!(");
    const pattern = negated ? rawPattern.slice(1) : rawPattern;

    for (const match of expandPattern(packageRoot, pattern)) {
      for (const entry of resolveEntryPath(match)) {
        if (negated) {
          entries.delete(entry);
        } else {
          entries.add(entry);
        }
      }
    }
  }

  if (entries.size === 0) {
    throw new Error(
      `Pi package "${packageName}" has "pi.extensions" entries, but none resolved to .ts/.js files`,
    );
  }

  return [...entries];
}

/**
 * Imports the extension factory (or factories) declared by a Pi package.
 * If the manifest declares several extension entries, they are composed into
 * one factory and invoked in manifest order.
 */
export async function loadPiPackageExtension(
  packageName: string,
): Promise<PiExtensionFactory> {
  const factories: PiExtensionFactory[] = [];

  for (const entry of resolvePiPackageExtensionEntries(packageName)) {
    const module = await import(pathToFileURL(entry).href);
    const factory = module.default;

    if (typeof factory !== "function") {
      throw new Error(
        `Extension "${entry}" from package "${packageName}" does not export a default factory function`,
      );
    }

    factories.push(factory);
  }

  if (factories.length === 1) {
    return factories[0]!;
  }

  return async (pi: any) => {
    for (const factory of factories) {
      await factory(pi);
    }
  };
}
