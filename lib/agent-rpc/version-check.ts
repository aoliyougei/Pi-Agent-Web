import { REQUIRED_CAPABILITIES, parseAgentVersion } from "@aoliyougei/pi-agent-contract";

export function checkAgentCompatibility(value: unknown) {
  try {
    const version = parseAgentVersion(value);
    if (!["0.84.4", "1.2.0"].includes(version.piVersion) || !REQUIRED_CAPABILITIES.every((capability) => version.capabilities.includes(capability))) {
      throw new Error();
    }
    return version;
  } catch {
    throw new Error("Incompatible agent service");
  }
}
