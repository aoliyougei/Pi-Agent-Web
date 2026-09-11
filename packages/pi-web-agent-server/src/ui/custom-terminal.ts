export const MAX_CUSTOM_FRAME_BYTES = 256 * 1024;
export const MAX_CUSTOM_FRAME_LINES = 1000;
export const MAX_CUSTOM_INPUT_BYTES = 64 * 1024;

export function validCustomFrame(lines: unknown): lines is string[] {
  return Array.isArray(lines) && lines.length <= MAX_CUSTOM_FRAME_LINES
    && lines.every((line) => typeof line === "string")
    && Buffer.byteLength(JSON.stringify(lines), "utf8") <= MAX_CUSTOM_FRAME_BYTES;
}

export function validCustomInput(value: unknown, revision: number): value is { data: string; revision?: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return typeof input.data === "string" && Buffer.byteLength(input.data, "utf8") <= MAX_CUSTOM_INPUT_BYTES
    && (input.revision === undefined || (Number.isSafeInteger(input.revision)
      && Number(input.revision) >= 0 && Number(input.revision) <= revision));
}

export const DEFAULT_CUSTOM_UI_COLUMNS = 92;
export const DEFAULT_CUSTOM_UI_ROWS = 40;

export interface HeadlessCustomUiTerminal {
  readonly columns: number;
  readonly rows: number;
  readonly kittyProtocolActive: false;
}

export interface HeadlessCustomUiTui {
  readonly terminal: HeadlessCustomUiTerminal;
  requestRender(force?: boolean): void;
}

export function createHeadlessCustomUiTui(
  requestRender: (force?: boolean) => void,
  columns = DEFAULT_CUSTOM_UI_COLUMNS,
  rows = DEFAULT_CUSTOM_UI_ROWS,
): HeadlessCustomUiTui {
  const terminal = Object.freeze({
    columns,
    rows,
    kittyProtocolActive: false as const,
  });

  return Object.freeze({ terminal, requestRender });
}
