import { homedir } from "node:os";
import { join } from "node:path";

export interface AppSettings {
  readonly configDir: string;
}

export const appSettings: AppSettings = {
  configDir: join(homedir(), ".claith"),
};
