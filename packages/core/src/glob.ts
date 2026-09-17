/** Minimal glob matching for tool names: `*` matches any run of characters, `?` one character. */
export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

export function matchesAny(name: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => globToRegExp(p).test(name));
}

/**
 * Applies allow/deny lists. An empty allowlist means everything is allowed;
 * the denylist always wins.
 */
export function isToolAllowed(name: string, allow: readonly string[], deny: readonly string[]): boolean {
  if (matchesAny(name, deny)) return false;
  if (allow.length === 0) return true;
  return matchesAny(name, allow);
}
