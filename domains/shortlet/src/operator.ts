import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Unit } from "./browse.js";

export interface OperatorRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly legalForm?: string | null;
  readonly cacVerified?: boolean;
  readonly responsiblePersonsVerified?: boolean;
  readonly responsiblePersons?: readonly unknown[];
  readonly beneficialOwnersVerified?: boolean;
  readonly paymentProviderApproved?: boolean;
  readonly settlementAccountVerified?: boolean;
  readonly settlementIdentity?: unknown;
  readonly approvedAt?: string;
  readonly approvalExpiresAt?: string;
}

export interface OperatorRepository {
  create(operator: OperatorRecord): OperatorRecord;
  findById(id: string): OperatorRecord | null;
  findAll(): readonly OperatorRecord[];
  update(id: string, metadata: { readonly name?: string }): OperatorRecord;
}

export class OperatorConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperatorConflictError";
  }
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} is required`);
  return value.trim();
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function readRecords(filePath: string): OperatorRecord[] {
  const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("Operator registry must contain a JSON array");
  return parsed.map((record) => validateRecord(record));
}

function validateRecord(value: unknown): OperatorRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Operator record must be an object");
  const record = value as Record<string, unknown>;
  const id = requiredText(record.id, "Operator ID");
  const tenantId = requiredText(record.tenantId, "Operator tenant ID");
  const name = requiredText(record.name, "Operator name");
  const status = requiredText(record.status, "Operator status");
  const createdAt = requiredText(record.createdAt, "Operator created timestamp");
  const updatedAt = requiredText(record.updatedAt, "Operator updated timestamp");
  if (!Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(updatedAt))) throw new Error("Operator timestamps must be valid dates");
  return clone({
    id,
    tenantId,
    name,
    status,
    createdAt,
    updatedAt,
    ...(typeof record.legalForm === "string" || record.legalForm === null ? { legalForm: record.legalForm } : {}),
    ...(typeof record.cacVerified === "boolean" ? { cacVerified: record.cacVerified } : {}),
    ...(typeof record.responsiblePersonsVerified === "boolean" ? { responsiblePersonsVerified: record.responsiblePersonsVerified } : {}),
    ...(Array.isArray(record.responsiblePersons) ? { responsiblePersons: record.responsiblePersons } : {}),
    ...(typeof record.beneficialOwnersVerified === "boolean" ? { beneficialOwnersVerified: record.beneficialOwnersVerified } : {}),
    ...(typeof record.paymentProviderApproved === "boolean" ? { paymentProviderApproved: record.paymentProviderApproved } : {}),
    ...(typeof record.settlementAccountVerified === "boolean" ? { settlementAccountVerified: record.settlementAccountVerified } : {}),
    ...(record.settlementIdentity !== undefined ? { settlementIdentity: record.settlementIdentity } : {}),
    ...(typeof record.approvedAt === "string" ? { approvedAt: record.approvedAt } : {}),
    ...(typeof record.approvalExpiresAt === "string" ? { approvalExpiresAt: record.approvalExpiresAt } : {}),
  });
}

export function createProvisionedOperator(input: { readonly id: string; readonly tenantId: string; readonly name: string; readonly now?: Date }): OperatorRecord {
  const now = input.now ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("Operator provisioning clock is invalid");
  const timestamp = now.toISOString();
  return validateRecord({
    id: input.id,
    tenantId: input.tenantId,
    name: input.name,
    // ADR-0010/0065: provisioning records identity only; verification and settlement claims remain absent.
    status: "unverified",
    createdAt: timestamp,
    updatedAt: timestamp,
    legalForm: null,
    cacVerified: false,
    responsiblePersonsVerified: false,
    responsiblePersons: [],
    beneficialOwnersVerified: false,
    paymentProviderApproved: false,
    settlementAccountVerified: false,
    settlementIdentity: null,
  });
}

export class JsonOperatorRepository implements OperatorRepository {
  readonly filePath: string;
  readonly #clock: () => Date;

  constructor(filePath: string, options: { readonly clock?: () => Date } = {}) {
    this.filePath = filePath;
    this.#clock = options.clock ?? (() => new Date());
    mkdirSync(dirname(filePath), { recursive: true });
    try {
      readFileSync(filePath, "utf8");
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      writeFileSync(filePath, "[]", "utf8");
    }
  }

  create(operator: OperatorRecord): OperatorRecord {
    const candidate = validateRecord(operator);
    const records = readRecords(this.filePath);
    if (records.some((record) => record.id === candidate.id)) throw new OperatorConflictError(`Operator ${candidate.id} already exists`);
    writeFileSync(this.filePath, JSON.stringify([...records, candidate], null, 2), "utf8");
    return clone(candidate);
  }

  findById(id: string): OperatorRecord | null {
    const record = readRecords(this.filePath).find((candidate) => candidate.id === id);
    return record ? clone(record) : null;
  }

  findAll(): readonly OperatorRecord[] {
    return readRecords(this.filePath).map((record) => clone(record));
  }

  update(id: string, metadata: { readonly name?: string }): OperatorRecord {
    const records = readRecords(this.filePath);
    const index = records.findIndex((record) => record.id === id);
    if (index < 0) throw new Error(`Operator ${id} was not found`);
    const now = this.#clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("Operator update clock is invalid");
    const name = metadata.name === undefined ? records[index].name : requiredText(metadata.name, "Operator name");
    const updated = validateRecord({ ...records[index], name, updatedAt: now.toISOString() });
    records[index] = updated;
    writeFileSync(this.filePath, JSON.stringify(records, null, 2), "utf8");
    return clone(updated);
  }
}

function isMissingFile(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function compatibleOperatorRecord(value: unknown, tenantId: string, now: Date): OperatorRecord | null {
  const operator = asRecord(value);
  if (!operator || typeof operator.id !== "string" || typeof operator.name !== "string") return null;
  const timestamp = now.toISOString();
  return validateRecord({
    ...operator,
    tenantId: typeof operator.tenantId === "string" ? operator.tenantId : tenantId,
    createdAt: typeof operator.createdAt === "string" ? operator.createdAt : timestamp,
    updatedAt: typeof operator.updatedAt === "string" ? operator.updatedAt : timestamp,
    status: typeof operator.status === "string" ? operator.status : "unverified",
  });
}

export function bootstrapOperatorsFromUnitRepository(input: {
  readonly units: { findAll(): Unit[] };
  readonly operators: OperatorRepository;
  readonly tenantId: string;
  readonly now?: Date;
}): readonly OperatorRecord[] {
  const tenantId = requiredText(input.tenantId, "Migration tenant ID");
  const now = input.now ?? new Date();
  const migrated: OperatorRecord[] = [];
  for (const unit of input.units.findAll()) {
    const candidate = compatibleOperatorRecord(unit.operator, tenantId, now);
    if (!candidate) continue;
    if (candidate.tenantId !== tenantId) throw new Error(`Operator ${candidate.id} belongs to a different tenant`);
    const existing = input.operators.findById(candidate.id);
    if (existing) {
      if (existing.tenantId !== candidate.tenantId) throw new Error(`Operator ${candidate.id} has conflicting tenant ownership`);
      continue;
    }
    migrated.push(input.operators.create(candidate));
  }
  return migrated;
}
