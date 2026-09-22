/**
 * The Target Development Kit: the app-side half of populace.
 *
 * populace sends a population of AI agents at a product's MCP server, and every one of them is a
 * stranger who needs an account of their own. Provisioning those accounts is the kit's first job
 * and — today — its only one; the handshake versions the KIT rather than that job, so a later
 * capability can arrive behind the same mount and the same question.
 */
export { populaceProvisioning } from "./provisioning/index.js";
export {
  createProvisioningHandler,
  firebase,
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
  type FetchLike,
  type FirebaseAuthLike,
  type FirebaseOptions,
  type FirebasePerson,
  type ListedPerson,
  type MaybePromise,
  type PersonRequest,
  type ProvisioningBackend,
  type ProvisioningCapabilities,
  type ProvisioningOptions,
  type ProvisioningServerOptions,
  type RefreshedPerson,
  type RefreshRequest,
  type RemoveRequest,
} from "./provisioning/index.js";

export { TDK_CONTRACT_VERSION, HandshakeSchema, handshake, type Handshake } from "./handshake.js";
export { TdkError, TdkErrorCodeSchema, ErrorBodySchema, statusFor, type ErrorBody, type TdkErrorCode } from "./errors.js";
export { locate, mount, relativize, type ExpressMiddleware, type ExpressRequestLike, type ExpressResponseLike, type MountOptions, type Mounted } from "./mount.js";
export { bearerOf, failure, json, noContent, normalizePath, page, secretMatches, type TdkHandler, type TdkRequest, type TdkResponse } from "./http.js";
export { JsonValueSchema, type JsonObject, type JsonValue } from "./json.js";
