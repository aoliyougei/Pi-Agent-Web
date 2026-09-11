import { REQUIRED_CAPABILITIES, parseAgentVersion } from "@aoliyougei/pi-agent-contract";

export function checkAgentCompatibility(value: unknown) {
  try {
    const version = parseAgentVersion(value);
    if (version.piVersion !== "0.84.4" || !REQUIRED_CAPABILITIES.every((capability) => version.capabilities.includes(capability))) {
      throw new Error();
    }
    return version;
  } catch {
    throw new Error("Incompatible agent service");
  }
}
