export function needsKimiV1Hint(provider: string, baseUrl?: string): boolean {
  if (!baseUrl?.trim()) return false;
  try {
    const url = new URL(baseUrl);
    const kimi = /kimi|moonshot/i.test(provider) || /(^|\.)(kimi\.com|moonshot\.cn|moonshot\.ai)$/i.test(url.hostname);
    return kimi && !url.pathname.split("/").includes("v1");
  } catch {
    return false;
  }
}
