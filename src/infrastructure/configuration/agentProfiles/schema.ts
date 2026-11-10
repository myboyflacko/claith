import { z } from "zod";

export const agentRoles = ["implementer", "reviewer", "planner"] as const;
export type AgentRole = (typeof agentRoles)[number];

export const profileNameSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
    "Use letters, digits, underscores or hyphens for a profile name",
  )
  .refine((name) => name.toLowerCase() !== "skills", {
    message: "skills is reserved for shared skills",
  });

export const agentProfileConfigSchema = z
  .strictObject({
    role: z.enum(agentRoles),
    description: z.string().trim().min(1, "Describe the agent"),
    permissions: z.enum(["read-only", "read-write"]),
    skills: z
      .strictObject({
        additionalSkillsDirs: z.array(z.string().trim().min(1)).optional(),
      })
      .optional(),
    model: z.strictObject({
      provider: z.string().trim().min(1, "Select a provider"),
      name: z.string().trim().min(1, "Select a model"),
      reasoning: z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]),
    }),
  })
  .refine(
    (config) =>
      config.role === "implementer" || config.permissions === "read-only",
    {
      path: ["permissions"],
      message: "Reviewer and planner profiles must be read-only",
    },
  );

export const agentPromptSchema = z
  .string()
  .refine((prompt) => prompt.trim().length > 0, {
    message: "prompt.md must not be empty",
  });

export type AgentProfileConfig = z.infer<typeof agentProfileConfigSchema>;

export interface AgentProfile {
  name: string;
  config: AgentProfileConfig;
  prompt: string;
  skills: { shared: string; profile: string; additional: string[] };
}
