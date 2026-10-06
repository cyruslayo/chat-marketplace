import type {
  EnforcementAppealRecord,
  EnforcementNoticeRecord,
  FinalizedEnforcementRecord,
  IncidentRecordInput,
  ProtectiveActionRecord,
  TurnoverRestorationKind,
} from "./operator-enforcement.js";

export interface RestorationDisposition {
  readonly enforcementId: string;
  readonly operatorId: string;
  readonly unitId: string;
  readonly disposition: "restored";
  readonly kind: TurnoverRestorationKind;
  readonly recordedAtIso: string;
}

/** Keyed records in insertion order. Reads return copies, so a caller can never change stored state in place. */
export interface EnforcementRecordCollection<T> {
  get(key: string): T | undefined;
  has(key: string): boolean;
  set(key: string, value: T): void;
  delete(key: string): void;
  values(): T[];
}

/**
 * Everything `OperatorEnforcementManager` must not lose across a restart (ADR 0064, ADR 0004). Every collection and the
 * sequence share one transaction scope, so a multi-step decision commits whole or not at all.
 */
export interface OperatorEnforcementStateStore {
  readonly incidents: EnforcementRecordCollection<IncidentRecordInput>;
  readonly protectiveActions: EnforcementRecordCollection<ProtectiveActionRecord>;
  readonly finalizedEnforcements: EnforcementRecordCollection<FinalizedEnforcementRecord>;
  readonly notices: EnforcementRecordCollection<EnforcementNoticeRecord>;
  readonly appeals: EnforcementRecordCollection<EnforcementAppealRecord>;
  readonly restoredUnits: EnforcementRecordCollection<true>;
  readonly restorationDispositions: EnforcementRecordCollection<RestorationDisposition>;
  readonly initialDecisionMakers: EnforcementRecordCollection<string>;
  /** The next enforcement number (the N in enf_N); never reused, including after a restart. */
  nextSequence(): number;
  transaction<T>(fn: () => T): T;
}

class InMemoryCollection<T> implements EnforcementRecordCollection<T> {
  readonly #records = new Map<string, T>();
  get(key: string): T | undefined {
    const value = this.#records.get(key);
    return value === undefined ? undefined : structuredClone(value);
  }
  has(key: string): boolean {
    return this.#records.has(key);
  }
  set(key: string, value: T): void {
    this.#records.set(key, structuredClone(value));
  }
  delete(key: string): void {
    this.#records.delete(key);
  }
  values(): T[] {
    return [...this.#records.values()].map((value) => structuredClone(value));
  }
}

/** The default for unit tests and demos: same behaviour, nothing survives the instance. */
export class InMemoryOperatorEnforcementStateStore implements OperatorEnforcementStateStore {
  readonly incidents = new InMemoryCollection<IncidentRecordInput>();
  readonly protectiveActions = new InMemoryCollection<ProtectiveActionRecord>();
  readonly finalizedEnforcements = new InMemoryCollection<FinalizedEnforcementRecord>();
  readonly notices = new InMemoryCollection<EnforcementNoticeRecord>();
  readonly appeals = new InMemoryCollection<EnforcementAppealRecord>();
  readonly restoredUnits = new InMemoryCollection<true>();
  readonly restorationDispositions = new InMemoryCollection<RestorationDisposition>();
  readonly initialDecisionMakers = new InMemoryCollection<string>();
  #sequence = 0;
  nextSequence(): number {
    return ++this.#sequence;
  }
  transaction<T>(fn: () => T): T {
    return fn();
  }
}
