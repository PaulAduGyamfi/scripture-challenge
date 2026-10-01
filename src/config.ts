import "dotenv/config";

// Reads a required setting from .env and stops with a clear message if it's missing
export function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in your .env file`);
  return value;
}

export function optionalEnv(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}