/** Resolved config.toml settings; agent profiles and Pi settings are separate. */
export interface ClaithConfig {
  address: string;
  namespace: string;
  taskQueue: string;
  maxRepairs: number;
  agentTimeoutSeconds: number;
  checkTimeoutSeconds: number;
  heartbeatIntervalSeconds: number;
  heartbeatTimeoutSeconds: number;
  reminderSeconds: number;
}
