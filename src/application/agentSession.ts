/** A prepared agent session; independent of the underlying agent SDK. */
export interface AgentSession {
  readonly id: string;
  readonly transcriptPath: string | undefined;
  /** Wait for the agent turn to finish; structured results are handled by supplied tools. */
  sendPrompt(prompt: string): Promise<void>;
  abort(): Promise<void>;
  /** Abort active work and release the session. Safe to call more than once. */
  dispose(): Promise<void>;
}
