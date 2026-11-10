/** Each key is a directory; an empty object describes a leaf directory. */
export interface DirectoryStructure {
  readonly [name: string]: DirectoryStructure;
}

export const directoryStructure = {
  agents: {},
  skills: {},
  sessions: {},
  worktrees: {},
  log: {},
} satisfies DirectoryStructure;
