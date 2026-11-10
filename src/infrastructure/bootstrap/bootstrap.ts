import { createDefaultAgentProfiles } from "../configuration/agentProfiles/create.js";
import { createClaithConfig } from "../configuration/claithConfig/create.js";
import { createDirectories } from "../configuration/directories/create.js";
import { appSettings, type AppSettings } from "../settings.js";

/** Create missing initialization files without loading user configuration. */
export async function bootstrap(
  settings: AppSettings = appSettings,
): Promise<void> {
  await createDirectories(settings);
  await Promise.all([
    createClaithConfig(settings),
    createDefaultAgentProfiles(settings),
  ]);
}
