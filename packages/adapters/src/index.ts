import type { IdentityConfig, IdentityProvider } from "@populace/core";
import { FirebaseAdminProvider } from "./firebase-admin/index.js";
import { NoAccountsProvider } from "./no-accounts/index.js";
import { SelfSignupProvider } from "./self-signup/index.js";
import { ProvisionUrlProvider } from "./provision-url/index.js";
import { StaticIdentityProvider } from "./static/index.js";

export { SelfSignupProvider } from "./self-signup/index.js";
export { StaticIdentityProvider } from "./static/index.js";
export { FirebaseAdminProvider, type FetchLike, type FirebaseAuthLike } from "./firebase-admin/index.js";
export { ProvisionUrlProvider, TdkRefusal, type TdkHandshake } from "./provision-url/index.js";
export { NoAccountsProvider } from "./no-accounts/index.js";

export function identityProviderFor(config: IdentityConfig): IdentityProvider {
  switch (config.strategy) {
    case "self-signup":
      return new SelfSignupProvider(config);
    case "static":
      return new StaticIdentityProvider(config);
    case "admin-mint":
      return new FirebaseAdminProvider(config);
    case "provision-url":
      return new ProvisionUrlProvider(config);
    case "none":
      return new NoAccountsProvider();
    case "undecided":
      // Not a way in, and there is no provider that could stand in for one (ADR-0040). A target
      // is left `undecided` by a check that saved the address before anybody said how people get
      // accounts, so the sentence names the unfinished half rather than the missing class: the
      // reader has a connected target and one question left to answer, and every caller of this
      // function surfaces what it throws.
      throw new Error("this target is not finished — nobody has said how people get accounts on it, so no account can be made; open the target and answer that before sending anybody here");
  }
}
