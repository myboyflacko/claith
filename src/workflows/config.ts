import { ApplicationFailure } from "@temporalio/workflow";
import type { ProjectConfig } from "./types.js";

export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  maxParallel: 3,
  maxWorktrees: 5,
  taskRetryPolicy: {
    maximumAttempts: 1,
    initialIntervalMs: 5000,
    backoffCoefficient: 2,
    maximumIntervalMs: 60000,
  },
  taskTimeout: 3600000,
  evidenceRetention: 1000,
  historyEventLimit: 10000,
};

export function createConfig(
  input: Partial<ProjectConfig> = {},
  previous?: ProjectConfig,
): ProjectConfig {
  const config = {
    ...DEFAULT_PROJECT_CONFIG,
    ...previous,
    ...input,
    maxWorktrees:
      input.maxWorktrees ??
      previous?.maxWorktrees ??
      (input.maxParallel ?? 3) + 2,
    taskRetryPolicy: {
      ...(previous?.taskRetryPolicy ?? DEFAULT_PROJECT_CONFIG.taskRetryPolicy),
      ...input.taskRetryPolicy,
    },
  };
  const positiveInteger = (value: number) =>
    Number.isSafeInteger(value) && value > 0;
  if (
    !positiveInteger(config.maxParallel) ||
    !positiveInteger(config.maxWorktrees) ||
    config.maxWorktrees < config.maxParallel ||
    !positiveInteger(config.taskTimeout) ||
    !positiveInteger(config.evidenceRetention) ||
    !positiveInteger(config.historyEventLimit) ||
    !positiveInteger(config.taskRetryPolicy.maximumAttempts) ||
    !positiveInteger(config.taskRetryPolicy.initialIntervalMs) ||
    !positiveInteger(config.taskRetryPolicy.maximumIntervalMs) ||
    config.taskRetryPolicy.maximumIntervalMs <
      config.taskRetryPolicy.initialIntervalMs ||
    !Number.isFinite(config.taskRetryPolicy.backoffCoefficient) ||
    config.taskRetryPolicy.backoffCoefficient < 1
  )
    throw ApplicationFailure.nonRetryable(
      "Invalid project configuration",
      "Validation",
    );
  return config;
}
