import { getSessionEntries, resolveSessionPath } from "./session-reader.js";
import { isFilePathReferencedByEntries, isValidSessionId } from "./session-file-references-core.js";

export async function isFilePathReferencedBySession(filePath: string, sessionId: string | null): Promise<boolean> {
  if (!isValidSessionId(sessionId)) return false;
  try {
    const sessionPath = await resolveSessionPath(sessionId);
    return !!sessionPath && isFilePathReferencedByEntries(filePath, getSessionEntries(sessionPath));
  } catch {
    return false;
  }
}
