import { claithConfigSchema } from "./schema.js";
import type { ClaithConfig } from "./schema.js";

export function validateClaithConfig(value: unknown): ClaithConfig {
  return claithConfigSchema.parse(value);
}
