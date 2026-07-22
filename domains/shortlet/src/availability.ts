function dateOverlaps(startA: any, endA: any, startB: any, endB: any): boolean {
  return startA < endB && startB < endA;
}

export class AvailabilityCalendar {
  #repository: any;
  #audit: any;
  #operatorBlocks = new Map<string, any[]>();
  #holds = new Map<string, any>();

  constructor({ repository = null, audit = null }: { repository?: any; audit?: any } = {}) {
    this.#repository = repository;
    this.#audit = audit;
  }

  #getUnitBlocks(unitId: string): any[] {
    if (!this.#operatorBlocks.has(unitId)) {
      this.#operatorBlocks.set(unitId, []);
    }
    return this.#operatorBlocks.get(unitId)!;
  }

  #getActiveHolds(unitId: string, clock: () => Date): any[] {
    const now = clock();
    const active: any[] = [];
    for (const hold of this.#holds.values()) {
      if (hold.unitId === unitId && new Date(hold.expiresAt) > now) {
        active.push(hold);
      }
    }
    return active;
  }

  addOperatorBlock({ unitId, operatorId, start, end, reason = "", clock = () => new Date() }: { unitId: string; operatorId: string; start: any; end: any; reason?: string; clock?: () => Date }) {
    const activeHolds = this.#getActiveHolds(unitId, clock);
    for (const hold of activeHolds) {
      if (dateOverlaps(start, end, hold.start, hold.end)) {
        throw new Error("Availability conflict: dates overlap an active hold");
      }
    }

    const blockId = `blk-${crypto.randomUUID()}`;
    const block = {
      blockId,
      unitId,
      operatorId,
      start,
      end,
      reason,
      createdAt: clock().toISOString()
    };

    const blocks = this.#getUnitBlocks(unitId);
    blocks.push(block);

    if (this.#audit) {
      this.#audit.record({
        type: "availability.operator_block",
        unitId,
        operatorId,
        start,
        end,
        reason
      });
    }

    if (this.#repository) {
      const unit = this.#repository.findById ? this.#repository.findById(unitId) : this.#repository.findAll().find((u: any) => u.id === unitId);
      if (unit) {
        unit.blockedDates = unit.blockedDates || [];
        unit.blockedDates.push({ start, end });
        this.#repository.save(unit);
      }
    }

    return { ...block };
  }

  createHold({ unitId, holderId, start, end, clock = () => new Date() }: { unitId: string; holderId: string; start: any; end: any; clock?: () => Date }) {
    const now = clock();
    const activeHolds = this.#getActiveHolds(unitId, clock);
    for (const hold of activeHolds) {
      if (dateOverlaps(start, end, hold.start, hold.end)) {
        throw new Error("Availability conflict: dates overlap an active hold");
      }
    }

    const blocks = this.#getUnitBlocks(unitId);
    for (const block of blocks) {
      if (dateOverlaps(start, end, block.start, block.end)) {
        throw new Error("Availability conflict: dates overlap an operator block");
      }
    }

    if (this.#repository) {
      const unit = this.#repository.findById ? this.#repository.findById(unitId) : this.#repository.findAll().find((u: any) => u.id === unitId);
      if (unit && unit.blockedDates) {
        for (const blocked of unit.blockedDates) {
          if (dateOverlaps(start, end, blocked.start, blocked.end)) {
            throw new Error("Availability conflict: dates overlap blocked dates");
          }
        }
      }
    }

    const holdId = `hld-${crypto.randomUUID()}`;
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + 45 * 60 * 1000).toISOString();

    const hold = {
      holdId,
      unitId,
      holderId,
      start,
      end,
      createdAt,
      expiresAt,
      extensionCount: 0
    };

    this.#holds.set(holdId, hold);
    return { ...hold };
  }

  extendHold(holdId: string, { clock = () => new Date() }: { clock?: () => Date } = {}) {
    const hold = this.#holds.get(holdId);
    if (!hold) throw new Error(`Hold not found: ${holdId}`);

    const now = clock();
    if (now >= new Date(hold.expiresAt)) {
      throw new Error("Hold expired automatically");
    }

    if (hold.extensionCount >= 1) {
      throw new Error("Maximum extension limit reached: at most 1 extension permitted");
    }

    const currentExpiryMs = new Date(hold.expiresAt).getTime();
    const maxExpiryMs = new Date(hold.createdAt).getTime() + 60 * 60 * 1000;
    const newExpiresMs = Math.min(currentExpiryMs + 15 * 60 * 1000, maxExpiryMs);

    hold.expiresAt = new Date(newExpiresMs).toISOString();
    hold.extensionCount += 1;

    return { ...hold };
  }

  getAuthoritativeAvailability({ unitId, checkIn, checkOut, clock = () => new Date() }: { unitId: string; checkIn: any; checkOut: any; clock?: () => Date }) {
    const blocks = this.#getUnitBlocks(unitId);
    for (const block of blocks) {
      if (dateOverlaps(checkIn, checkOut, block.start, block.end)) {
        return {
          isAvailable: false,
          conflictReason: "Overlaps with Operator Block",
          unitId,
          checkIn,
          checkOut
        };
      }
    }

    if (this.#repository) {
      const unit = this.#repository.findById ? this.#repository.findById(unitId) : this.#repository.findAll().find((u: any) => u.id === unitId);
      if (unit && unit.blockedDates) {
        for (const blocked of unit.blockedDates) {
          if (dateOverlaps(checkIn, checkOut, blocked.start, blocked.end)) {
            return {
              isAvailable: false,
              conflictReason: "Overlaps with Operator Block",
              unitId,
              checkIn,
              checkOut
            };
          }
        }
      }
    }

    const activeHolds = this.#getActiveHolds(unitId, clock);
    for (const hold of activeHolds) {
      if (dateOverlaps(checkIn, checkOut, hold.start, hold.end)) {
        return {
          isAvailable: false,
          conflictReason: "Overlaps with active Hold",
          unitId,
          checkIn,
          checkOut
        };
      }
    }

    return {
      isAvailable: true,
      unitId,
      checkIn,
      checkOut
    };
  }
}
