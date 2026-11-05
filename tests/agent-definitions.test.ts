import { expectTypeOf, it } from "vitest";
import type {
  AgentDefinition,
  Implementer,
  Planner,
  Reviewer,
} from "../src/domain/agents/index.js";

it("gives all agent roles the shared definition fields", () => {
  expectTypeOf<Implementer>().toExtend<AgentDefinition>();
  expectTypeOf<Reviewer>().toExtend<AgentDefinition>();
  expectTypeOf<Planner>().toExtend<AgentDefinition>();
  expectTypeOf<AgentDefinition["tools"]>().toEqualTypeOf<readonly string[]>();
  expectTypeOf<
    AgentDefinition["developerInstructions"]
  >().toEqualTypeOf<string>();
  expectTypeOf<AgentDefinition["model"]>().toEqualTypeOf<{
    readonly provider: string;
    readonly name: string;
  }>();
});

it("distinguishes roles and keeps reviewers and planners read-only", () => {
  expectTypeOf<Implementer["role"]>().toEqualTypeOf<"implementer">();
  expectTypeOf<Reviewer["role"]>().toEqualTypeOf<"reviewer">();
  expectTypeOf<Planner["role"]>().toEqualTypeOf<"planner">();
  expectTypeOf<Implementer["permissions"]>().toEqualTypeOf<
    "read-only" | "read-write"
  >();
  expectTypeOf<Reviewer["permissions"]>().toEqualTypeOf<"read-only">();
  expectTypeOf<Planner["permissions"]>().toEqualTypeOf<"read-only">();
});
