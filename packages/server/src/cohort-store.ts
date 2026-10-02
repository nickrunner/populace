import {
  dealStudy,
  handleFor,
  instantiatePersona,
  laneSlugFor,
  nameFrom,
  personIdFor,
  type Cohort,
  type DealMember,
  type DealMix,
  type Person,
  type PersonProfile,
  type Simulation,
  type Store,
  type StoredPersona,
  type StoredPopulation,
} from "@populace/core";

/**
 * The people of a cohort (ADR-0031, ADR-0039, ADR-0041).
 *
 * A person is written ONCE per `(lane, ordinal)` and then frozen. That is what makes a name
 * stable across executions — the row is stored, not regenerated — and it is why nothing here ever
 * overwrites a row that exists. Tier 2 (a model writing names and details) replaces the content of
 * a row exactly once, on an explicit request; this is tier 1, the seeded bank, which is free,
 * offline and always available, so the test suite runs with no API key.
 *
 * A cohort has no size of its own, and neither has a population: the one headcount is the STUDY's
 * (`Simulation.size`), dealt across the population's cohorts by their weights and then across each
 * cohort's mix by its weights (`dealStudy`). The roster is therefore sized by the studies that send
 * the cohort — at the LARGEST count any of them gives each lane — so the same cohort at ten people
 * in one study and forty in another is one roster of forty, of which the first study meets the
 * first ten of each lane. Resolution reads that roster and never writes it; the writers are the
 * study, population and cohort routes, an execution start and an import (`materialise`).
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

/** One (cohort, persona) pair in a deal: who they are drawn from, their share of the cohort, and how many. */
export interface Lane {
  cohort: Cohort;
  persona: StoredPersona;
  laneSlug: string;
  weight: number;
  count: number;
}

/**
 * What a population sends at one size, in the order the deal is stated: members in the population's
 * order, lanes in each cohort's mix order. `sends` is the sum of the lanes, which falls short of
 * `size` only when a member's cohort is gone (it is skipped) or has no mix to deal into.
 */
export interface Deal {
  size: number;
  sends: number;
  cohorts: { cohort: Cohort; weight: number; count: number; lanes: Lane[] }[];
  /** Every lane of every cohort, flattened in deal order. */
  lanes: Lane[];
}

/**
 * The rows a deal is looked up against, read once per operation so that dealing a population —
 * or every study's population, in `laneSizes` — costs two list queries rather than one query per
 * persona. Screens are a bounded number of store calls whatever the headcount.
 */
interface DealContext {
  cohorts: Map<string, Cohort>;
  personas: Map<string, StoredPersona>;
}

async function dealContext(store: Store, projectId: string): Promise<DealContext> {
  const [cohorts, personas] = await Promise.all([store.listCohorts(projectId), store.listPersonas(projectId)]);
  return { cohorts: new Map(cohorts.map((cohort) => [cohort.id, cohort])), personas: new Map(personas.map((persona) => [persona.id, persona])) };
}

/** The deal against rows already read. A member whose cohort is gone is skipped, not dealt to. */
function dealWith(context: DealContext, population: StoredPopulation, size: number): Deal {
  const present = population.members.flatMap((member) => {
    const cohort = context.cohorts.get(member.cohortId);
    return cohort ? [{ member, cohort }] : [];
  });
  const members: DealMember[] = present.map(({ member }) => ({ cohortId: member.cohortId, weight: member.weight }));
  const mixes: DealMix[] = present.map(({ cohort }) => ({ cohortId: cohort.id, entries: cohort.mix }));
  const dealt = dealStudy(size, members, mixes);
  const cohorts: Deal["cohorts"] = [];
  const lanes: Lane[] = [];
  for (const [index, { member, cohort }] of present.entries()) {
    const share = dealt.cohorts[index];
    const laneCounts = new Map((share?.lanes ?? []).map((lane) => [lane.personaId, lane.count]));
    const own: Lane[] = [];
    for (const entry of cohort.mix) {
      const persona = context.personas.get(entry.personaId);
      if (!persona) throw new RosterIncomplete(cohort, entry.personaId);
      own.push({ cohort, persona, laneSlug: laneSlugFor(cohort.slug, persona.slug), weight: entry.weight, count: laneCounts.get(entry.personaId) ?? 0 });
    }
    cohorts.push({ cohort, weight: member.weight, count: share?.count ?? 0, lanes: own });
    lanes.push(...own);
  }
  return { size, sends: dealt.sends, cohorts, lanes };
}

/**
 * Who a population sends at `size` people: the two-level deal (ADR-0041) with the rows attached.
 * Member order, then mix order. Throws `RosterIncomplete` when a persona in a mix is gone — a deal
 * that names nobody for a lane is not a deal — and skips a member whose cohort is gone, because
 * the population row is composition and a dangling reference is a display problem, not a reason
 * to send nobody at all.
 */
export async function dealFor(store: Store, population: StoredPopulation, size: number): Promise<Deal> {
  return dealWith(await dealContext(store, population.projectId), population, size);
}

/**
 * Which studies size a roster: every one that is not archived, plus an archived one whose
 * execution is still running or paused — its participants are those rows, and putting them aside
 * under a live run would make "execution 3" mean two different casts.
 */
async function sizingStudies(store: Store, projectId: string): Promise<Simulation[]> {
  const [studies, running, paused] = await Promise.all([
    store.listSimulations({ projectId, includeArchived: true }),
    store.listRuns({ projectId, status: "running" }),
    store.listRuns({ projectId, status: "paused" }),
  ]);
  const live = new Set([...running, ...paused].map((run) => run.simulationId));
  return studies.filter((study) => !study.archived || live.has(study.id));
}

/**
 * How many people each lane of the cohort has to hold: the LARGEST count any sizing study deals
 * it, lane by lane in mix order. Every lane in the mix is present, at nought when no study sends
 * it, so that `ensureRoster` archives what nobody sends any more.
 */
export async function laneSizes(store: Store, cohort: Cohort): Promise<Map<string, number>> {
  const context = await dealContext(store, cohort.projectId);
  const [studies, populations] = await Promise.all([sizingStudies(store, cohort.projectId), store.listPopulations(cohort.projectId)]);
  const populationById = new Map(populations.map((population) => [population.id, population]));
  const sizes = new Map<string, number>();
  for (const entry of cohort.mix) {
    const persona = context.personas.get(entry.personaId);
    if (!persona) throw new RosterIncomplete(cohort, entry.personaId);
    sizes.set(laneSlugFor(cohort.slug, persona.slug), 0);
  }
  for (const study of studies) {
    const population = populationById.get(study.populationId);
    if (!population || !population.members.some((member) => member.cohortId === cohort.id)) continue;
    const deal = dealWith(context, population, study.size);
    for (const lane of deal.lanes) {
      if (lane.cohort.id !== cohort.id) continue;
      sizes.set(lane.laneSlug, Math.max(sizes.get(lane.laneSlug) ?? 0, lane.count));
    }
  }
  return sizes;
}

/** The cohort's lanes in mix order, each at the count `sizes` gives it. */
function lanesAt(context: DealContext, cohort: Cohort, sizes: ReadonlyMap<string, number>): Lane[] {
  return cohort.mix.map((entry) => {
    const persona = context.personas.get(entry.personaId);
    if (!persona) throw new RosterIncomplete(cohort, entry.personaId);
    const laneSlug = laneSlugFor(cohort.slug, persona.slug);
    return { cohort, persona, laneSlug, weight: entry.weight, count: sizes.get(laneSlug) ?? 0 };
  });
}

/**
 * Fills every empty `(lane, ordinal)` slot the studies call for and returns the cohort's cast,
 * lane by lane in mix order.
 *
 * Three rules, and all three are load-bearing:
 *
 * - **It never overwrites.** Growing a lane from 25 to 30 writes ordinals 25–29 and touches
 *   nobody else; changing the cohort's seed renames nobody, it only decides who the NEXT ordinal is.
 * - **Shrinking archives rather than deletes.** A person past their lane's count — because every
 *   study sending them was made smaller or archived, or the weights moved, or their persona left
 *   the mix — is marked inactive, so growing back restores the same individuals rather than a
 *   fresh cast wearing their ids.
 * - **Names are unique within the cohort**, across every lane. The draw rejects a name the cohort
 *   already holds, so a roster of 25 never contains two of anybody.
 *
 * This is a WRITE, and it is called only by the writers (ADR-0041, D3): the study, population and
 * cohort routes, an execution start, people generation and an import. A GET never reaches it.
 */
export async function ensureRoster(store: Store, cohortId: string, now: Date = new Date()): Promise<Person[]> {
  const cohort = await store.getCohort(cohortId);
  if (!cohort) throw new Error(`no cohort ${cohortId}`);
  const lanes = lanesAt(await dealContext(store, cohort.projectId), cohort, await laneSizes(store, cohort));

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
      const person = draftPerson(lane, ordinal, used, at);
      await store.savePerson(person);
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

/**
 * `ensureRoster` for every cohort the population holds — what a writer that changed how many go
 * (a study's size, a population's weights) calls afterwards. A member whose cohort is gone has no
 * roster to size.
 */
export async function ensureRosterFor(store: Store, populationId: string, now: Date = new Date()): Promise<void> {
  const population = await store.getPopulation(populationId);
  if (!population) return;
  const cohorts = new Set((await store.listCohorts(population.projectId)).map((cohort) => cohort.id));
  for (const member of population.members) {
    if (cohorts.has(member.cohortId)) await ensureRoster(store, member.cohortId, now);
  }
}

/**
 * The row the seeded bank writes for one slot, built without writing it. `ensureRoster` saves
 * what this returns; resolution calls it for a slot no writer has reached yet and keeps the result
 * in memory, so the person a snapshot freezes for that ordinal is the person the next write puts
 * in the row — same id, same name, same handle, same draw.
 *
 * `used` is the cohort's taken names and is ADDED TO here, because the caller is walking slots in
 * order and the next draw must not repeat this one.
 */
export function draftPerson(lane: Lane, ordinal: number, used: Set<string>, at: string): Person {
  const { cohort } = lane;
  // The person's seed, which both the name bank and `instantiatePersona` draw from. Expansion
  // samples from the same string, so the traits an agent runs with are the ones this row recorded
  // — before the cohort's overlay and the person's own overrides go on top.
  const seed = `${cohort.seed}:${lane.laneSlug}:${ordinal}`;
  const name = nameFrom(seed, used);
  used.add(name);
  return {
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
}

/**
 * The slice of a person that rides in the resolved config, and therefore in the snapshot: enough
 * to render the cast, to sign an account up, and to honour what was set on them by hand — and
 * nothing that a run would be wrong to freeze.
 */
export function rosterProfiles(people: readonly Person[]): PersonProfile[] {
  return people.map((person) => ({ ordinal: person.ordinal, id: person.id, name: person.name, details: person.details, handle: person.handle, overrides: person.overrides }));
}

/**
 * The people one study sends, in deal order — member order, mix order, ordinal — and how many of
 * its slots have no row yet. READ-ONLY: a lane whose rows were never written contributes nothing
 * and is counted in `missing`, which is the study people page's cue that a writer has not run.
 * An archived row within the deal is still that person and is returned as they are; the view
 * says they are archived. A study whose population is gone sends nobody.
 *
 * Bounded: one `listPeople` for the project, filtered in memory, however many people there are.
 */
export async function peopleSentBy(store: Store, simulation: Simulation): Promise<{ deal: Deal; people: Person[]; missing: number }> {
  const population = await store.getPopulation(simulation.populationId);
  if (!population) return { deal: { size: simulation.size, sends: 0, cohorts: [], lanes: [] }, people: [], missing: 0 };
  const deal = await dealFor(store, population, simulation.size);
  const byId = new Map((await store.listPeople({ projectId: simulation.projectId, includeArchived: true })).map((person) => [person.id, person]));
  const people: Person[] = [];
  let missing = 0;
  for (const lane of deal.lanes) {
    for (let ordinal = 0; ordinal < lane.count; ordinal++) {
      const person = byId.get(personIdFor(lane.laneSlug, ordinal));
      if (person) people.push(person);
      else missing++;
    }
  }
  return { deal, people, missing };
}
