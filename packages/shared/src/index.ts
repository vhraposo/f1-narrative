export const appName = "F1 Narrative Universe";

export function createApp(version: string): string {
  return `${appName} v${version}`;
}

export const greeting = {
  name: "0.1.0",
} as const;
