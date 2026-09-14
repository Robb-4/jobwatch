import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Vrai si le module a été lancé directement (`tsx src/tasks/fetch.ts`), pas importé par un test. */
export function isMain(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(realpathSync(entry)).href === moduleUrl;
  } catch {
    return false;
  }
}
