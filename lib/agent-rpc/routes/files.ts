import { proxyAgentRequest, proxyJson, type AgentFetch } from "../proxy";
import { browserResponse } from "./agent";

const FILE_HEADERS = [
  "content-type", "content-length", "content-range", "accept-ranges", "content-disposition", "cache-control",
  "content-security-policy", "referrer-policy", "x-content-type-options", "x-accel-buffering", "x-request-id",
];

type FilesContext = { params: Promise<{ path: string[] }> };
const query = (request: Request) => new URL(request.url).search;

export function createRemoteFileRoutes(send: AgentFetch) {
  const plain = async (request: Request, path: string) => browserResponse(await proxyJson(request, `${path}${query(request)}`, send));
  return {
    BROWSE: (request: Request) => plain(request, "/internal/v1/api/cwd/browse"),
    VALIDATE: (request: Request) => plain(request, "/internal/v1/api/cwd/validate"),
    DEFAULT_CWD: (request: Request) => plain(request, "/internal/v1/api/default-cwd"),
    INDEX: (request: Request) => plain(request, "/internal/v1/api/file-index"),
    FILES: async (request: Request, context: FilesContext) => {
      const { path } = await context.params;
      if (!Array.isArray(path) || !path.length || path.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\") || segment.includes("\0"))) {
        return Response.json({ error: "Invalid file path", code: "invalid_request" }, { status: 400 });
      }
      const encoded = path.map(encodeURIComponent).join("/");
      return browserResponse(await proxyAgentRequest(request, `/internal/v1/api/files/${encoded}${query(request)}`, send, FILE_HEADERS));
    },
  };
}
