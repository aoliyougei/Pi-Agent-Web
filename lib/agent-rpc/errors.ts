export function proxyError(status: number, error: string, code: string): Response {
  return Response.json({ error, code }, { status });
}
