import { z } from "zod";

export const roles = ["orchestrator", "implementer", "reviewer"] as const;
export type Role = (typeof roles)[number];
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
});
export type RuntimeSettings = z.infer<typeof runtimeSchema>;
export type AgentProfile = z.infer<typeof profileSchema>;
export interface ExecutionConfiguration {
  runtime: RuntimeSettings;
  agents: Record<Role, AgentProfile>;
}
export const executionConfigurationSchema = z.strictObject({
  runtime: runtimeSchema,
  agents: z.strictObject({
    orchestrator: profileSchema,
    implementer: profileSchema,
    reviewer: profileSchema,
  }),
});
