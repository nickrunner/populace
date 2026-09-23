import {
  apportion,
  handleFor,
  instantiatePersona,
  laneSlugFor,
  nameFrom,
  personIdFor,
  type Cohort,
  type Person,
  type PersonProfile,
  type Store,
  type StoredPersona,
  type StoredPopulation,
} from "@populace/core";

/**
 * The people of a cohort (ADR-0031, ADR-0039).
 *
 * A person is written ONCE per `(lane, ordinal)` and then frozen. That is what makes a name
 * stable across executions — the row is stored, not regenerated — and it is why nothing here ever
 * overwrites a row that exists. Tier 2 (a model writing names and details) replaces the content of
 * a row exactly once, on an explicit request; this is tier 1, the seeded bank, which is free,
 * offline and always available, so the test suite runs with no API key.
 *
 * A cohort has no size of its own. It is sized by the populations that send it — at the LARGEST
 * size any of them gives it, so the same cohort at ten people in one population and forty in
 * another is one roster of forty, of which the first population meets the first ten of each lane.
 */

/** Thrown when a cohort's mix names a persona that is not in the project any more. */
export class RosterIncomplete extends Error {
  constructor(
    readonly cohort: Cohort,
    readonly personaId: string,
  ) {
    super(`the ${cohort.name} cohort draws on a persona that no longer exists (${personaId})`);
    this.name = "RosterIncomplete";
  }
}

/** One (cohort, persona) pair at a given size: who they are drawn from, and how many. */
export interface Lane {
  persona: StoredPersona;
  laneSlug: string;
  weight: number;
  count: number;
}

/** How many people a population sends from this cohort; nought when it does not hold it. */
export function sizeIn(population: StoredPopulation, cohortId: string): number {
  return population.members.find((member) => member.cohortId === cohortId)?.size ?? 0;
}

/** The sum of a population's member sizes: the only headcount there is. */
export function headcountOf(population: StoredPopulation): number {
  return population.members.reduce((sum, member) => sum + member.size, 0);
}

/** The largest size any population gives this cohort — the roster it has to hold. */
export async function sizeOfCohort(store: Store, cohort: Cohort): Promise<number> {
  const populations = await store.listPopulations(cohort.projectId);
  return populations.reduce((largest, population) => Math.max(largest, sizeIn(population, cohort.id)), 0);
}

/** The cohort's lanes at `size` people, in mix order, apportioned by weight. */
export async function lanesOf(store: Store, cohort: Cohort, size: number): Promise<Lane[]> {
  const counts = apportion(size, cohort.mix.map((entry) => entry.weight));
  const lanes: Lane[] = [];
  for (const [index, entry] of cohort.mix.entries()) {
    const persona = await store.getPersona(entry.personaId);
    if (!persona) throw new RosterIncomplete(cohort, entry.personaId);
    lanes.push({ persona, laneSlug: laneSlugFor(cohort.slug, persona.slug), weight: entry.weight, count: counts[index] ?? 0 });
  }
  return lanes;
}

/**
 * Fills every empty `(lane, ordinal)` slot the cohort's size calls for and returns the cohort's
 * cast, lane by lane in mix order.
 *
 * Three rules, and all three are load-bearing:
 *
 * - **It never overwrites.** Growing a lane from 25 to 30 writes ordinals 25–29 and touches
 *   nobody else; changing the cohort's seed renames nobody, it only decides who the NEXT ordinal is.
 * - **Shrinking archives rather than deletes.** A person past their lane's count — because the
 *   cohort was sent at fewer people, or its weights moved, or their persona left the mix — is
 *   marked inactive, so growing back restores the same individuals rather than a fresh cast
 *   wearing their ids.
 * - **Names are unique within the cohort**, across every lane. The draw rejects a name the cohort
 *   already holds, so a roster of 25 never contains two of anybody.
 */
export async function ensureRoster(store: Store, cohortId: string, now: Date = new Date()): Promise<Person[]> {
  const cohort = await store.getCohort(cohortId);
  if (!cohort) throw new Error(`no cohort ${cohortId}`);
  const lanes = await lanesOf(store, cohort, await sizeOfCohort(store, cohort));

  // Archived rows are read too: they are the people a shrink put aside, and growing back must find
  // them rather than draw somebody new into their slot.
  const stored = await store.listPeople({ cohortId, includeArchived: true });
  const used = new Set(stored.map((person) => person.name));
  const at = now.toISOString();
  const live = new Set<string>();

  const roster: Person[] = [];
  for (const lane of lanes) {
    const byOrdinal = new Map(stored.filter((person) => person.laneSlug === lane.laneSlug).map((person) => [person.ordinal, person]));
    for (let ordinal = 0; ordinal < lane.count; ordinal++) {
      const existing = byOrdinal.get(ordinal);
      if (existing) {
        live.add(existing.id);
        if (existing.archivedAt === null) {
          roster.push(existing);
          continue;
        }
        const restored: Person = { ...existing, archivedAt: null, updatedAt: at };
        await store.savePerson(restored);
        roster.push(restored);
        continue;
      }
      const person = await writePerson(store, cohort, lane, ordinal, used, at);
      live.add(person.id);
      roster.push(person);
    }
  }

  for (const person of stored) {
    if (live.has(person.id) || person.archivedAt !== null) continue;
    await store.savePerson({ ...person, archivedAt: at, updatedAt: at });
  }
  return roster;
}

async function writePerson(store: Store, cohort: Cohort, lane: Lane, ordinal: number, used: Set<string>, at: string): Promise<Person> {
  // The person's seed, which both the name bank and `instantiatePersona` draw from. Expansion
  // samples from the same string, so the traits an agent runs with are the ones this row recorded
  // — before the cohort's overlay and the person's own overrides go on top.
  const seed = `${cohort.seed}:${lane.laneSlug}:${ordinal}`;
  const name = nameFrom(seed, used);
  used.add(name);
  const person: Person = {
    id: personIdFor(lane.laneSlug, ordinal),
    projectId: cohort.projectId,
    cohortId: cohort.id,
    cohortSlug: cohort.slug,
    personaId: lane.persona.id,
    personaSlug: lane.persona.slug,
    laneSlug: lane.laneSlug,
    ordinal,
    name,
    details: "",
    handle: handleFor(name, lane.laneSlug, ordinal),
    // Inlined with the persona's immutable slug as its id, exactly as resolution inlines it: a
    // continuation matches on that id and it must never follow a display-name rename.
    persona: instantiatePersona({ ...lane.persona.spec, id: lane.persona.slug }, seed),
    overrides: { traits: {} },
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
 * to render the cast, to sign an account up, and to honour what was set on them by hand — and
 * nothing that a run would be wrong to freeze.
 */
export function rosterProfiles(people: readonly Person[]): PersonProfile[] {
  return people.map((person) => ({ ordinal: person.ordinal, id: person.id, name: person.name, details: person.details, handle: person.handle, overrides: person.overrides }));
}
