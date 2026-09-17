import type { IdentityConfig, IdentityProvider } from "@populace/core";
import { FirebaseAdminProvider } from "./firebase-admin/index.js";
import { SelfSignupProvider } from "./self-signup/index.js";
import { StaticIdentityProvider } from "./static/index.js";

export { SelfSignupProvider } from "./self-signup/index.js";
export { StaticIdentityProvider } from "./static/index.js";
export { FirebaseAdminProvider, type FirebaseAuthLike } from "./firebase-admin/index.js";

export function identityProviderFor(config: IdentityConfig): IdentityProvider {
  switch (config.strategy) {
    case "self-signup":
      return new SelfSignupProvider(config);
    case "static":
      return new StaticIdentityProvider(config);
    case "admin-mint":
      return new FirebaseAdminProvider(config);
  }
}
