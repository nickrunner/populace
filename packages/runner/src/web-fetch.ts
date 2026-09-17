/** Same-origin page fetch for the agent, returned as plain text. */
export async function fetchPageText(baseUrl: string, path: string, maxChars: number): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  let url: URL;
  try {
    url = new URL(path, baseUrl);
  } catch {
    return { ok: false, error: `invalid path ${JSON.stringify(path)}` };
  }
  const base = new URL(baseUrl);
  if (url.origin !== base.origin) return { ok: false, error: `only pages under ${base.origin} can be fetched` };
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: "text/html, text/plain;q=0.9, */*;q=0.1" }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    return { ok: false, error: `fetch failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  const body = await response.text();
  const text = htmlToText(body);
  const clipped = text.length > maxChars ? `${text.slice(0, maxChars)}\n[truncated]` : text;
  return response.ok ? { ok: true, text: `HTTP ${response.status} ${url.pathname}\n\n${clipped}` } : { ok: false, error: `HTTP ${response.status} ${url.pathname}\n\n${clipped}` };
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, "\n")
    .replace(/<li>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
