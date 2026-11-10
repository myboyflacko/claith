import { createDirectories } from "./infrastructure/directories.js";
import { appSettings, type AppSettings } from "./settings.js";

export async function bootstrap(
  settings: AppSettings = appSettings,
): Promise<void> {
  await createDirectories(settings.configDir);
}
