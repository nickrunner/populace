import { z } from "zod";

/**
 * The provisioning wire, as schemas.
 *
 * Both directions are parsed, not just the inbound one. What populace sends is somebody else's
 * JSON and is checked for the obvious reason; what an app's own hook hands back is checked for a
 * better one — a `createPerson` that returns `{ uid }` where the kit wanted `userId` would
 * otherwise put `"userId": undefined` on the wire and the run would fail later, on the target,
 * as an auth error with no connection to the mistake that caused it (ADR-0002).
 */

/**
 * An instant, however the app happens to spell it. A `Date` is accepted because the vendor SDKs
 * hand one back and making every implementor write `.toISOString()` is a papercut that would be
 * paid in every kit; `null` means "this bearer does not expire as far as I know", which populace
 * reads as "never renew".
 */
const ExpiresAtSchema = z
  .union([z.date(), z.iso.datetime()])
  .nullish()
  .transform((value) => (value === null || value === undefined ? null : value instanceof Date ? value.toISOString() : value));

const OptionalTokenSchema = z
  .string()
  .min(1)
  .nullish()
  .transform((value) => value ?? null);

/**
 * What populace asks for when it needs one person.
 *
 * `tag` identifies the run and MUST come back out again — a sweep whose local store is gone finds
 * this run's accounts by it and nothing else. Store it wherever the app can: a custom claim, a
 * column, the local part of the email (populace puts it there too, so an app with nowhere else to
 * put it still has it).
 *
 * `handle` is the person's stable name within the run (`marta-2`), which is what makes the email
 * unique; `displayName` is the person's actual name and is what a screenshot of your product will
 * show. Unknown fields are ignored rather than refused, so a later populace that sends more does
 * not break a kit that shipped before it.
 *
 * `password` is OPTIONAL, and that is not an oversight. Passwordless vendors are ordinary now —
 * Clerk's magic links, Supabase's one-time codes — and a required field reads as one the
 * implementor has to honour. Use it if your app has passwords; ignore it if it does not.
 */
export const PersonRequestSchema = z.object({
  tag: z.string().min(1),
  handle: z.string().min(1),
  email: z.email(),
  displayName: z.string().min(1),
  password: z.string().min(1).optional(),
});
export type PersonRequest = z.infer<typeof PersonRequestSchema>;

/** What an app's `createPerson` hands back. */
export const CreatedPersonSchema = z.object({
  /** The app's own id for this person, and the handle every later call uses. */
  userId: z.string().min(1),
  /** What populace puts in `Authorization: Bearer …` on the target. */
  bearerToken: z.string().min(1),
  expiresAt: ExpiresAtSchema,
  refreshToken: OptionalTokenSchema,
});
export type CreatedPerson = z.input<typeof CreatedPersonSchema>;

export const ProvisionedPersonSchema = z.object({
  userId: z.string().min(1),
  bearerToken: z.string().min(1),
  expiresAt: z.string().nullable(),
  refreshToken: z.string().nullable(),
});

/**
 * What populace sends to renew a bearer.
 *
 * Both fields go every time on purpose. Some vendors re-mint from the user id alone — Firebase
 * does, `createCustomToken` needs nothing from the old session — and others can only exchange a
 * refresh token. Sending both means the implementor uses whichever they have instead of the kit
 * guessing which kind of vendor they are.
 */
export const RefreshRequestSchema = z.object({
  userId: z.string().min(1),
  refreshToken: OptionalTokenSchema,
});
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

export const RefreshedPersonSchema = z.object({
  bearerToken: z.string().min(1),
  expiresAt: ExpiresAtSchema,
  refreshToken: OptionalTokenSchema,
});
export type RefreshedPerson = z.input<typeof RefreshedPersonSchema>;

export const RefreshResponseSchema = z.object({
  bearerToken: z.string().min(1),
  expiresAt: z.string().nullable(),
  refreshToken: z.string().nullable(),
});

/** Which person to remove. In the body and not the path: see the note on the route. */
export const RemoveRequestSchema = z.object({ userId: z.string().min(1) });
export type RemoveRequest = z.infer<typeof RemoveRequestSchema>;

/**
 * One account the app knows about, as a sweep sees it.
 *
 * `email` and `displayName` are nullable because a vendor listing does not always have them — a
 * Firebase user created by some other path may carry neither — and a sweep that shows an empty
 * string where it means "not recorded" is telling the reader something untrue about their own
 * product. `tag` is filled in from the query when the app does not echo it, because the app was
 * asked by tag and answering with a different one would be a bug, not a feature.
 */
export const ListedPersonSchema = z.object({
  userId: z.string().min(1),
  email: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  displayName: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  tag: z.string().min(1).optional(),
});
export type ListedPerson = z.input<typeof ListedPersonSchema>;

export const PeopleListSchema = z.object({
  people: z.array(
    z.object({
      userId: z.string().min(1),
      email: z.string().nullable(),
      displayName: z.string().nullable(),
      tag: z.string().min(1),
    }),
  ),
  /** Opaque. Pass it back as `cursor` for the next page; `null` means that was the last one. */
  nextCursor: z.string().nullable(),
});

export const ListQuerySchema = z.object({ tag: z.string().min(1), cursor: z.string().min(1).optional() });

export type MaybePromise<T> = T | Promise<T>;

/**
 * The work only the app can do.
 *
 * `createPerson` is the one function that has to exist: populace cannot know how your product
 * makes a user, and everything else in this package — the HTTP contract, the auth, the tags, the
 * expiry, the teardown, the listing, the dev-only guard, the error shapes — is generic and is
 * why the kit exists. The other three are optional, and their absence is reported honestly at the
 * handshake instead of being discovered as a 500 in the middle of a sweep.
 */
export interface ProvisioningBackend {
  createPerson(person: PersonRequest): MaybePromise<CreatedPerson>;
  /**
   * Remove the account. Must be idempotent: populace sweeps more than once and does not care.
   *
   * An account that was already gone is a success, not a failure — and a hook that throws
   * `TdkError("gone", …)` for one is read as exactly that, so an app whose vendor throws on a
   * missing user does not have to swallow it itself.
   */
  removePerson?(person: RemoveRequest): MaybePromise<void>;
  /** Renew an expiring bearer. Absent means every person's session has to outlive the run. */
  refreshPerson?(request: RefreshRequest): MaybePromise<RefreshedPerson>;
  /**
   * Every account carrying this run's tag — the only way home for a sweep whose local store is gone.
   *
   * Return all of them: the kit pages what comes back, so an app never implements paging to answer
   * a paged route. A run is tens to hundreds of people, and the unbounded thing the cursor exists
   * to prevent is the RESPONSE, which is what crosses somebody else's network.
   *
   * Nothing checks that the tag you were handed at `createPerson` is the tag you answer to here.
   * It cannot: the kit never sees your storage. A sweep that finds nothing is how a tag that was
   * dropped on the way in gets discovered, which is the argument for the conformance check this
   * kit will grow — not a hole in the wire contract.
   */
  listPeople?(query: { tag: string }): MaybePromise<readonly ListedPerson[]>;
}

/** What the handshake reports, and what a route checks before it refuses with `unsupported`. */
export interface ProvisioningCapabilities {
  refresh: boolean;
  teardown: boolean;
  listByTag: boolean;
}
