/**
 * `${VAR}` substitution for config text.
 *
 * A config file names its secrets rather than carrying them (ADR-0018), and the same rule holds
 * whether the text was read from disk by the CLI or pasted into the dashboard's import box. One
 * implementation means one set of rules for what a placeholder looks like and what an unset one
 * does, which is what keeps a file that works on the CLI working in the browser.
 *
 * The environment is a parameter rather than a default so this stays browser-safe.
 */
export function substituteEnv(text: string, env: Record<string, string | undefined>): { text: string; missing: string[] } {
  const missing: string[] = [];
  const out = text.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, name: string) => {
    const value = env[name];
    if (value === undefined) missing.push(name);
    return value ?? "";
  });
  return { text: out, missing: [...new Set(missing)] };
}

/** The environment variable an exported config points at for a named secret. */
export function envPlaceholder(...parts: string[]): string {
  return `\${${parts.join("_").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")}}`;
}
