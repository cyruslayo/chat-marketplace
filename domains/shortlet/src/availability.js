function dateOverlaps(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

export class AvailabilityCalendar {
  #repository;
  #audit;
  #operatorBlocks = new Map(); // unitId -> list of blocks
  #holds = new Map(); // holdId -> hold

  constructor({ repository, audit } = {}) {
    this.#repository = repository;
    this.#audit = audit;
  }

  #getUnitBlocks(unitId) {
    if (!this.#operatorBlocks.has(unitId)) {
      this.#operatorBlocks.set(unitId, []);
    }
    return this.#operatorBlocks.get(unitId);
  }

  #getActiveHolds(unitId, clock) {
    const now = clock();
    const active = [];
    for (const hold of this.#holds.values()) {
      if (hold.unitId === unitId && new Date(hold.expiresAt) > now) {
        active.push(hold);
      }
    }
    return active;
  }

  addOperatorBlock({ unitId, operatorId, start, end, reason = "", clock = () => new Date() }) {
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

    // Also update unit in repository if repository exists
    if (this.#repository) {
      const unit = this.#repository.findById ? this.#repository.findById(unitId) : this.#repository.findAll().find((u) => u.id === unitId);
      if (unit) {
        unit.blockedDates = unit.blockedDates || [];
        unit.blockedDates.push({ start, end });
        this.#repository.save(unit);
      }
    }

    return { ...block };
  }

  createHold({ unitId, holderId, start, end, clock = () => new Date() }) {
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
      const unit = this.#repository.findById ? this.#repository.findById(unitId) : this.#repository.findAll().find((u) => u.id === unitId);
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
    const expiresAt = new Date(now.getTime() + 45 * 60 * 1000).toISOString(); // 45 mins

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

  extendHold(holdId, { clock = () => new Date() }) {
    const hold = this.#holds.get(holdId);
    if (!hold) throw new Error(`Hold not found: ${holdId}`);

    const now = clock();
    if (now >= new Date(hold.expiresAt)) {
      throw new Error("Hold expired automatically");
    }

    if (hold.extensionCount >= 1) {
      throw new Error("Maximum extension limit reached: at most 1 extension permitted");
    }

    // US-70: 15-minute extension capped at 60 minutes total from creation
    const currentExpiryMs = new Date(hold.expiresAt).getTime();
    const maxExpiryMs = new Date(hold.createdAt).getTime() + 60 * 60 * 1000;
    const newExpiresMs = Math.min(currentExpiryMs + 15 * 60 * 1000, maxExpiryMs);

    hold.expiresAt = new Date(newExpiresMs).toISOString();
    hold.extensionCount += 1;

    return { ...hold };
  }

  getAuthoritativeAvailability({ unitId, checkIn, checkOut, clock = () => new Date() }) {
    const now = clock();
    
    // Check Operator Blocks
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

    // Check Repository Blocked Dates
    if (this.#repository) {
      const unit = this.#repository.findById ? this.#repository.findById(unitId) : this.#repository.findAll().find((u) => u.id === unitId);
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


    // Check Active Holds
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
