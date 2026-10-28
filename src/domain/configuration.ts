import { z } from "zod";
import { permissions, toolRegistry } from "./tools.js";
import type { Role } from "./tools.js";

export { roles } from "./tools.js";
export type { Role } from "./tools.js";
const seconds = z.number().int().positive();
export const runtimeSchema = z
  .strictObject({
    address: z.string().min(1).default("127.0.0.1:7233"),
    namespace: z.string().min(1).default("default"),
    taskQueue: z.string().min(1).default("claith"),
    maxRepairs: z.number().int().min(0).max(20).default(2),
    agentTimeoutSeconds: seconds.default(1800),
    checkTimeoutSeconds: seconds.default(600),
    heartbeatIntervalSeconds: seconds.default(10),
    heartbeatTimeoutSeconds: seconds.default(30),
    reminderSeconds: seconds.default(3600),
  })
  .refine((s) => s.heartbeatIntervalSeconds < s.heartbeatTimeoutSeconds, {
    message:
      "heartbeatIntervalSeconds must be less than heartbeatTimeoutSeconds",
  });
export const profileSchema = z.strictObject({
  provider: z.string().trim().min(1, "Select a Pi provider"),
  model: z.string().trim().min(1, "Select an available Pi model"),
  reasoning: z
    .enum(["off", "minimal", "low", "medium", "high", "xhigh"])
    .default("medium"),
  instructions: z.string().trim().min(1),
  permissions: z.enum(permissions),
});
export type RuntimeSettings = z.infer<typeof runtimeSchema>;
export type AgentProfile = z.infer<typeof profileSchema>;
export function executionProfileSchema(role: Role) {
  return profileSchema
    .extend({ tools: z.array(z.string().min(1)) })
    .superRefine((profile, ctx) => {
      try {
        toolRegistry.validate(role, profile.permissions, profile.tools);
      } catch (error) {
        ctx.addIssue({ code: "custom", message: (error as Error).message });
      }
    });
}
export type ExecutionAgentProfile = z.infer<
  ReturnType<typeof executionProfileSchema>
>;

export function resolveProfile(
  role: Role,
  value: unknown,
): ExecutionAgentProfile {
  const profile = profileSchema.parse(value);
  return executionProfileSchema(role).parse({
    ...profile,
    tools: toolRegistry.resolve(role, profile.permissions),
  });
}

export interface ExecutionConfiguration {
  runtime: RuntimeSettings;
  agents: Record<Role, ExecutionAgentProfile>;
}
export const executionConfigurationSchema = z.strictObject({
  runtime: runtimeSchema,
  agents: z.strictObject({
    orchestrator: executionProfileSchema("orchestrator"),
    implementer: executionProfileSchema("implementer"),
    reviewer: executionProfileSchema("reviewer"),
  }),
});
