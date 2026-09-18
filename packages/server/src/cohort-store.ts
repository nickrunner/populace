import {
  handleFor,
  instantiatePersona,
  nameFrom,
  personIdFor,
  type Cohort,
  type Person,
  type PersonProfile,
  type Store,
  type StoredPersona,
} from "@populace/core";

/**
 * The people of a cohort (SPEC §5).
 *
 * A person is written ONCE per `(cohort, ordinal)` and then frozen. That is what makes a name
 * stable across executions — the row is stored, not regenerated — and it is why nothing here ever
 * overwrites a row that exists. Tier 2 (a model writing names and details, stage 6) replaces the
 * content of a row exactly once, on an explicit request; this is tier 1, the seeded bank, which is
 * free, offline and always available, so the test suite runs with no API key.
 */

/** Thrown when a cohort names a persona that is not in the project any more. */
export class RosterIncomplete extends Error {
  constructor(readonly cohort: Cohort) {
    super(`the ${cohort.name} cohort points at a persona that no longer exists (${cohort.personaId})`);
    this.name = "RosterIncomplete";
  }
}

/**
 * Fills every empty `(cohort, ordinal)` slot below `cohort.size` and returns the cohort's cast in
 * ordinal order.
 *
 * Three rules, and all three are load-bearing:
 *
 * - **It never overwrites.** Growing a cohort from 25 to 30 writes ordinals 25–29 and touches
 *   nobody else; changing the cohort's seed renames nobody, it only decides who the NEXT ordinal is.
 * - **Shrinking archives rather than deletes.** An ordinal at or past `size` is marked inactive, so
 *   growing back restores the same individuals rather than a fresh cast wearing their ids.
 * - **Names are unique within the cohort.** The draw rejects a name the cohort already holds, so a
 *   roster of 25 never contains two of anybody.
 */
export async function ensureRoster(store: Store, cohortId: string, now: Date = new Date()): Promise<Person[]> {
  const cohort = await store.getCohort(cohortId);
  if (!cohort) throw new Error(`no cohort ${cohortId}`);
  const persona = await store.getPersona(cohort.personaId);
  if (!persona) throw new RosterIncomplete(cohort);

  // Archived rows are read too: they are the people a shrink put aside, and growing back must find
  // them rather than draw somebody new into their slot.
  const stored = await store.listPeople({ cohortId, includeArchived: true });
  const byOrdinal = new Map(stored.map((person) => [person.ordinal, person]));
  const used = new Set(stored.map((person) => person.name));
  const at = now.toISOString();

  const roster: Person[] = [];
  for (let ordinal = 0; ordinal < cohort.size; ordinal++) {
    const existing = byOrdinal.get(ordinal);
    if (existing) {
      if (existing.archivedAt === null) {
        roster.push(existing);
        continue;
      }
      const restored: Person = { ...existing, archivedAt: null, updatedAt: at };
      await store.savePerson(restored);
      roster.push(restored);
      continue;
    }
    roster.push(await writePerson(store, cohort, persona, ordinal, used, at));
  }

  for (const person of stored) {
    if (person.ordinal < cohort.size || person.archivedAt !== null) continue;
    await store.savePerson({ ...person, archivedAt: at, updatedAt: at });
  }
  return roster;
}

async function writePerson(store: Store, cohort: Cohort, persona: StoredPersona, ordinal: number, used: Set<string>, at: string): Promise<Person> {
  // The person's seed, which both the name bank and `instantiatePersona` draw from. Expansion
  // rebuilds the persona from the same string, so the traits an agent runs with are the ones this
  // row recorded.
  const seed = `${cohort.seed}:${cohort.slug}:${ordinal}`;
  const name = nameFrom(seed, used);
  used.add(name);
  const person: Person = {
    id: personIdFor(cohort.slug, ordinal),
    projectId: cohort.projectId,
    cohortId: cohort.id,
    cohortSlug: cohort.slug,
    personaId: persona.id,
    personaSlug: persona.slug,
    ordinal,
    name,
    details: "",
    handle: handleFor(name, cohort.slug, ordinal),
    // Inlined with the persona's immutable slug as its id, exactly as resolution inlines it: a
    // continuation matches on that id and it must never follow a display-name rename.
    persona: instantiatePersona({ ...persona.spec, id: persona.slug }, seed),
    generatedBy: "seeded",
    generatedByModel: "",
    seed,
    archivedAt: null,
    createdAt: at,
    updatedAt: at,
  };
  await store.savePerson(person);
  return person;
}

/**
 * The slice of a person that rides in the resolved config, and therefore in the snapshot: enough
 * to render the cast and to sign an account up, and nothing that a run would be wrong to freeze.
 */
export function rosterProfiles(people: readonly Person[]): PersonProfile[] {
  return people.map((person) => ({ ordinal: person.ordinal, id: person.id, name: person.name, details: person.details, handle: person.handle }));
}
