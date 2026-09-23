import { mount, type Mounted } from "../mount.js";
import { createProvisioningHandler, type ProvisioningOptions } from "./handler.js";

/**
 * Mount the provisioning routes.
 *
 * ```ts
 * app.use("/populace", populaceProvisioning({
 *   secret: process.env.POPULACE_SECRET,
 *   async createPerson({ email, displayName, tag }) { … },
 *   async removePerson({ userId }) { … },
 * }));
 * ```
 *
 * The one function an app has to write is `createPerson`, because populace cannot know how your
 * product makes a user. Everything else — the HTTP contract, the auth, the run tags, the expiry
 * and renewal, the teardown, the listing, the dev-only guard, the error shapes — is generic, and
 * every app re-implementing it is the friction this kit deletes.
 */
export function populaceProvisioning(options: ProvisioningOptions): Mounted {
  return mount(createProvisioningHandler(options), { basePath: options.basePath, knownSegments: ["people"] });
}

export { createProvisioningHandler, type ProvisioningOptions, type ProvisioningServerOptions } from "./handler.js";
export { firebase, type FetchLike, type FirebaseAuthLike, type FirebaseOptions, type FirebasePerson } from "./firebase.js";
export {
  AttributeValueSchema,
  CreatedPersonSchema,
  ListedPersonSchema,
  ListQuerySchema,
  PeopleListSchema,
  PersonRequestSchema,
  ProvisionedPersonSchema,
  RefreshedPersonSchema,
  RefreshRequestSchema,
  RefreshResponseSchema,
  RemoveRequestSchema,
  type CreatedPerson,
  type ListedPerson,
  type MaybePromise,
  type PersonRequest,
  type ProvisioningBackend,
  type ProvisioningCapabilities,
  type RefreshedPerson,
  type RefreshRequest,
  type RemoveRequest,
} from "./contract.js";
