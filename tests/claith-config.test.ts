import { expectTypeOf, it } from "vitest";
import type { ClaithConfig } from "../src/domain/claithConfig.js";
import type { RuntimeSettings } from "../src/domain/configuration.js";

it("describes the resolved config.toml without agent profiles or Pi settings", () => {
  expectTypeOf<ClaithConfig>().toEqualTypeOf<RuntimeSettings>();
});
