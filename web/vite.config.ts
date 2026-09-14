import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

/**
 * L'interface est construite depuis `web/` mais lit le `.env` de la racine
 * (une seule source de configuration en local). Seules les variables `VITE_*`
 * sont exposées au navigateur.
 *
 * `VITE_BASE_PATH` : un site GitHub Pages de projet est servi sous
 * `/<nom-du-depot>/` ; le workflow `pages.yml` le renseigne automatiquement.
 */
export default defineConfig(({ mode }) => {
  const root = fileURLToPath(new URL('.', import.meta.url));
  const envDir = fileURLToPath(new URL('..', import.meta.url));
  const env = loadEnv(mode, envDir, '');
  return {
    root,
    envDir,
    base: env.VITE_BASE_PATH || '/',
    build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
    server: { fs: { allow: [envDir] } },
  };
});
