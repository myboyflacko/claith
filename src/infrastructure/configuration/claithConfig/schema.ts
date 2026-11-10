import { z } from "zod";

const seconds = z.number().int().positive();

export const temporalConfigSchema = z
  .strictObject({
    address: z.string().min(1),
    namespace: z.string().min(1),
    taskQueue: z.string().min(1),
    heartbeatIntervalSeconds: seconds,
    heartbeatTimeoutSeconds: seconds,
  })
  .refine(
    (config) =>
      config.heartbeatIntervalSeconds < config.heartbeatTimeoutSeconds,
    {
      path: ["heartbeatIntervalSeconds"],
      message:
        "heartbeatIntervalSeconds must be less than heartbeatTimeoutSeconds",
    },
  );

export const executionConfigSchema = z.strictObject({
  maxRepairs: z.number().int().min(0).max(20),
  agentTimeoutSeconds: seconds,
  checkTimeoutSeconds: seconds,
  reminderSeconds: seconds,
});

export const claithConfigSchema = z.strictObject({
  temporal: temporalConfigSchema,
  execution: executionConfigSchema,
});

export type TemporalConfig = z.infer<typeof temporalConfigSchema>;
export type ExecutionConfig = z.infer<typeof executionConfigSchema>;
export type ClaithConfig = z.infer<typeof claithConfigSchema>;

/** Used only when creating config.toml; loading requires every field. */
export const initialClaithConfig = {
  temporal: {
    address: "127.0.0.1:7233",
    namespace: "default",
    taskQueue: "claith",
    heartbeatIntervalSeconds: 10,
    heartbeatTimeoutSeconds: 30,
  },
  execution: {
    maxRepairs: 2,
    agentTimeoutSeconds: 1800,
    checkTimeoutSeconds: 600,
    reminderSeconds: 3600,
  },
} satisfies ClaithConfig;
