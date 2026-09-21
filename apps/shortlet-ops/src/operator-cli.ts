import {
  createProvisionedOperator,
  type OperatorRecord,
  type OperatorRepository,
} from "../../../domains/shortlet/src/index.js";

export interface OperatorSummary {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OperatorCommandResult {
  readonly operator: OperatorRecord;
  readonly summary: OperatorSummary;
}

function requiredFlag(args: readonly string[], flag: string): string {
  const index = args.indexOf(flag);
  if (index < 0 || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`${flag} is required`);
  return args[index + 1];
}

function assertKnownFlags(args: readonly string[], allowed: readonly string[]): void {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--") || !allowed.includes(argument)) throw new Error(`Unsupported argument ${argument}`);
    index += 1;
  }
}

function summarize(operator: OperatorRecord): OperatorSummary {
  return {
    id: operator.id,
    tenantId: operator.tenantId,
    name: operator.name,
    status: operator.status,
    createdAt: operator.createdAt,
    updatedAt: operator.updatedAt,
  };
}

export function runOperatorCreateCommand(repository: OperatorRepository, args: readonly string[], now = new Date()): OperatorCommandResult {
  assertKnownFlags(args, ["--operator-id", "--tenant-id", "--name"]);
  const operator = repository.create(createProvisionedOperator({
    id: requiredFlag(args, "--operator-id"),
    tenantId: requiredFlag(args, "--tenant-id"),
    name: requiredFlag(args, "--name"),
    now,
  }));
  return { operator, summary: summarize(operator) };
}

export function runOperatorListCommand(repository: OperatorRepository): { readonly operators: readonly OperatorSummary[] } {
  return { operators: repository.findAll().map(summarize) };
}

export function runOperatorUpdateCommand(repository: OperatorRepository, args: readonly string[]): OperatorCommandResult {
  assertKnownFlags(args, ["--operator-id", "--name"]);
  const operator = repository.update(requiredFlag(args, "--operator-id"), { name: requiredFlag(args, "--name") });
  return { operator, summary: summarize(operator) };
}

export function formatOperatorSummary(summary: OperatorSummary): string {
  return [
    `Operator ID: ${summary.id}`,
    `Tenant ID: ${summary.tenantId}`,
    `Name: ${summary.name}`,
    `Status: ${summary.status}`,
    `Created: ${summary.createdAt}`,
    `Updated: ${summary.updatedAt}`,
  ].join("\n");
}

export function formatOperatorList(result: { readonly operators: readonly OperatorSummary[] }): string {
  if (result.operators.length === 0) return "No Operators found.";
  return result.operators.map((operator) => `${operator.id}\t${operator.tenantId}\t${operator.name}\t${operator.status}`).join("\n");
}
