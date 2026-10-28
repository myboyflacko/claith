export const roles = ["orchestrator", "implementer", "reviewer"] as const;
export type Role = (typeof roles)[number];
export const permissions = ["read-only", "read-write"] as const;
export type Permission = (typeof permissions)[number];

export const rolePolicy: Record<
  Role,
  { permissions: Permission; completion: string }
> = {
  orchestrator: { permissions: "read-only", completion: "submit_proposal" },
  implementer: {
    permissions: "read-write",
    completion: "submit_implementation",
  },
  reviewer: { permissions: "read-only", completion: "submit_review" },
};

export interface ToolRegistration {
  name: string;
  permissions: Permission;
  roles: readonly Role[];
  source: "pi" | "custom";
}

/** Pure metadata: safe to use both in Temporal workflows and on the worker. */
export class ToolRegistry {
  private readonly entries: ReadonlyMap<string, ToolRegistration>;

  constructor(registrations: readonly ToolRegistration[]) {
    const entries = new Map<string, ToolRegistration>();
    for (const registration of registrations) {
      if (entries.has(registration.name))
        throw new Error(`Duplicate tool registration: ${registration.name}`);
      entries.set(registration.name, {
        ...registration,
        roles: [...registration.roles],
      });
    }
    this.entries = entries;
  }

  get(name: string): ToolRegistration | undefined {
    const entry = this.entries.get(name);
    return entry ? { ...entry, roles: [...entry.roles] } : undefined;
  }

  assertPermissions(role: Role, permission: Permission): void {
    if (
      rolePolicy[role].permissions === "read-only" &&
      permission === "read-write"
    )
      throw new Error(`${role} permissions must be read-only`);
  }

  private allowed(role: Role, permission: Permission): string[] {
    this.assertPermissions(role, permission);
    return [...this.entries.values()]
      .filter(
        (tool) =>
          tool.roles.includes(role) &&
          (permission === "read-write" || tool.permissions === "read-only"),
      )
      .map((tool) => tool.name);
  }

  resolve(role: Role, permission: Permission): string[] {
    const tools = this.allowed(role, permission);
    this.validate(role, permission, tools);
    return tools;
  }

  /** Validate a saved selection without expanding it to newly registered tools. */
  validate(role: Role, permission: Permission, tools: readonly string[]): void {
    const allowed = new Set(this.allowed(role, permission));
    if (new Set(tools).size !== tools.length)
      throw new Error(`Duplicate tools in ${role} execution profile`);
    for (const name of tools) {
      if (!allowed.has(name))
        throw new Error(
          `Tool ${name} is not allowed for ${role} (${permission}); allowed: ${[...allowed].join(", ")}`,
        );
    }
    if (!tools.includes(rolePolicy[role].completion))
      throw new Error(`${role} requires ${rolePolicy[role].completion}`);
  }
}

export const toolRegistry = new ToolRegistry([
  ...["read", "grep", "find", "ls"].map((name): ToolRegistration => ({
    name,
    permissions: "read-only",
    roles,
    source: "pi",
  })),
  ...["edit", "write"].map((name): ToolRegistration => ({
    name,
    permissions: "read-write",
    roles: ["implementer"],
    source: "pi",
  })),
  // Claith supplies its own logged/cancellable bash implementation.
  {
    name: "bash",
    permissions: "read-write",
    roles: ["implementer"],
    source: "custom",
  },
  {
    name: "read_diff",
    permissions: "read-only",
    roles: ["reviewer"],
    source: "custom",
  },
  ...roles.map((role): ToolRegistration => ({
    name: rolePolicy[role].completion,
    permissions: "read-only",
    roles: [role],
    source: "custom",
  })),
]);
