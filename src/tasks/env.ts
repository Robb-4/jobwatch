import 'dotenv/config';

/** Variable d'environnement obligatoire : erreur lisible si absente. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
  return value;
}

export function optionalEnv(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export function optionalIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) throw new Error(`Variable d'environnement invalide : ${name}=${raw}`);
  return value;
}
