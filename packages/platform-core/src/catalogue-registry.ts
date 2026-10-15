/**
 * The platform catalogue registry (ADR 0073, ADR 0099 rule 4). A domain pack registers the
 * A2UI catalogue ids it owns; the platform reads them and fails closed on anything no pack
 * registered.
 */
export class CatalogueRegistry {
  readonly #owners = new Map<string, string>();

  register(owner: string, catalogueIds: readonly string[]): void {
    if (!owner) throw new Error("Catalogue registration requires an owner");
    for (const catalogueId of catalogueIds) {
      if (!catalogueId) throw new Error("Catalogue registration requires a catalogue id");
      this.#owners.set(catalogueId, owner);
    }
  }

  has(catalogueId: string): boolean {
    return this.#owners.has(catalogueId);
  }

  ownerOf(catalogueId: string): string | undefined {
    return this.#owners.get(catalogueId);
  }

  ids(): readonly string[] {
    return [...this.#owners.keys()];
  }
}
