import { defineQuery, defineUpdate } from "@temporalio/workflow";
import type { Resume, RunRecord } from "../domain/contracts.js";
export const statusQuery = defineQuery<RunRecord>("status");
export const resumeUpdate = defineUpdate<string, [Resume]>("resume");
export const cancelUpdate = defineUpdate<string, [string]>("cancel");
