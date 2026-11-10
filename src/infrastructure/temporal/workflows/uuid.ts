import { uuid4 } from "@temporalio/workflow";

/** Workflow-only: Temporal's seeded UUID generator is stable during history replay. */
export const uuidv4 = uuid4;
