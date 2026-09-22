import type { ReactNode } from "react";

import type { TargetCheck } from "../../api.js";
import type { IdentityConfigView, TargetInput } from "@populace/contract";
import {
  ConditionalFieldset,
  Field,
  FieldGrid,
  Input,
  SecretField,
  Stack,
  type ConditionalBranch,
} from "../../design/index.js";

/**
 * The ways in — how the PEOPLE a simulation sends get accounts of their own.
 *
 * Not to be confused with your own sign-in to the address (ADR-0036), which is how populace reads
 * a tool list and is one human's credential. This is the other half: forty strangers, forty
 * accounts, and the three mechanisms that can produce them.
 *
 * **It lives here because two screens need the same answer.** It was only ever on the saved-target
 * editor, and `ConnectTarget` — the screen that actually creates a target — sent a hardcoded
 * `{ strategy: "self-signup", signupTool: "" }` instead. That is not a valid config: `signupTool`
 * is `min(1)`, so connecting any target whose accounts are not made through an MCP tool ended at
 * `Too small: expected string to have >=1 characters at identity.signupTool`, with no field on the
 * screen to fix and no way to save. A target that cannot be saved cannot be edited either, because
 * the editor is only reachable for one that exists.
 */

/**
 * The identity half of a target, as a form holds it: flat, all strings, every branch's fields
 * present whichever branch is chosen. Switching between them and back does not lose what was
 * typed, which is the property a discriminated union in component state would not have.
 */
export interface IdentityDraft {
  /**
   * `undecided` is a real state and not a placeholder. A target whose tool list holds no sign-up
   * has no default way in that would be honest — the fieldset shows three unselected radios, and
   * `whatIdentityNeeds` refuses the save until one of them is answered. It matches no branch, so
   * `ConditionalFieldset` renders no fields for it, which is exactly the shape of "nothing picked".
   */
  strategy: "undecided" | "self-signup" | "static" | "admin-mint";
  signupTool: string;
  tokenPath: string;
  userIdPath: string;
  teardownTool: string;
  emailDomain: string;
  staticFile: string;
  /** admin-mint: the Firebase Web API key. Empty means "leave whatever is stored alone". */
  apiKey: string;
  apiKeySet: boolean;
  serviceAccountFile: string;
  firebaseProjectId: string;
  exchangeUrl: string;
}

export const EMPTY_IDENTITY: IdentityDraft = {
  strategy: "undecided",
  signupTool: "",
  tokenPath: "token",
  userIdPath: "",
  teardownTool: "",
  emailDomain: "populace.test",
  staticFile: "",
  apiKey: "",
  apiKeySet: false,
  serviceAccountFile: "",
  firebaseProjectId: "",
  exchangeUrl: "",
};

/** A stored target's identity, as a draft. The API key is never among it: it is not sent down. */
export function identityDraftFrom(identity: IdentityConfigView): IdentityDraft {
  return {
    ...EMPTY_IDENTITY,
    strategy: identity.strategy,
    signupTool: identity.strategy === "self-signup" ? identity.signupTool : "",
    tokenPath: identity.strategy === "self-signup" ? identity.tokenPath : "token",
    userIdPath: identity.strategy === "self-signup" ? (identity.userIdPath ?? "") : "",
    teardownTool: identity.strategy === "self-signup" ? (identity.teardownTool ?? "") : "",
    emailDomain: identity.strategy === "self-signup" ? identity.emailDomain : "populace.test",
    staticFile: identity.strategy === "static" ? identity.file : "",
    apiKeySet: identity.strategy === "admin-mint" ? identity.apiKeySet : false,
    serviceAccountFile: identity.strategy === "admin-mint" ? (identity.serviceAccountFile ?? "") : "",
    firebaseProjectId: identity.strategy === "admin-mint" ? (identity.projectId ?? "") : "",
    exchangeUrl: identity.strategy === "admin-mint" ? (identity.exchangeUrl ?? "") : "",
  };
}

/**
 * What the tool list suggests, as a starting draft.
 *
 * **A guess with no sign-up tool in it is not a self-signup target.** The check says so in as many
 * words — "nothing here looks like a sign-up" — and a form that then opened on the self-signup
 * branch would be asking for a tool the reader has just been told does not exist. The strategy is
 * left unchosen in that case, and the screen asks.
 */
export function identityDraftFromCheck(guess: TargetCheck["identity"]): IdentityDraft {
  if (guess.signupTool === null) return EMPTY_IDENTITY;
  return {
    ...EMPTY_IDENTITY,
    strategy: "self-signup",
    signupTool: guess.signupTool,
    tokenPath: guess.tokenPath ?? "token",
    userIdPath: guess.userIdPath ?? "",
    teardownTool: guess.teardownTool ?? "",
  };
}

/**
 * A `switch`, not an if/else chain: the chain's final `else` silently produced an admin-mint
 * config for any strategy it did not know about, so a fourth way in would have compiled and
 * quietly sent the wrong one.
 */
export function identityFrom(draft: IdentityDraft): TargetInput["identity"] | null {
  switch (draft.strategy) {
    case "undecided":
      return null;
    case "self-signup":
      return {
        strategy: "self-signup",
        signupTool: draft.signupTool,
        tokenPath: draft.tokenPath || "token",
        ...(draft.userIdPath ? { userIdPath: draft.userIdPath } : {}),
        ...(draft.teardownTool ? { teardownTool: draft.teardownTool } : {}),
        emailDomain: draft.emailDomain || "populace.test",
      };
    case "static":
      return { strategy: "static", file: draft.staticFile };
    case "admin-mint":
      return {
        strategy: "admin-mint",
        provider: "firebase",
        emailDomain: draft.emailDomain || "populace.test",
        // Absent leaves the stored key alone; the form only sends one when it was typed.
        ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
        ...(draft.serviceAccountFile ? { serviceAccountFile: draft.serviceAccountFile } : {}),
        ...(draft.firebaseProjectId ? { projectId: draft.firebaseProjectId } : {}),
        ...(draft.exchangeUrl ? { exchangeUrl: draft.exchangeUrl } : {}),
      };
  }
}

/**
 * What this draft still needs before the server will take it, in the reader's words, or null when
 * it is ready.
 *
 * It answers the same question the schema does and answers it HERE, because the alternative is
 * what the connect screen was doing: sending something invalid and rendering
 * `Too small: expected string to have >=1 characters → at identity.signupTool` at somebody who
 * never chose self-signup in the first place.
 */
export function whatIdentityNeeds(draft: IdentityDraft): string | null {
  if (draft.strategy === "undecided") return "a way in";
  if (draft.strategy === "self-signup" && draft.signupTool.trim() === "") return "the name of the tool that makes an account";
  if (draft.strategy === "static" && draft.staticFile.trim() === "") return "a file of accounts to hand out";
  return null;
}

/**
 * What this draft will not be able to do, even though it will save. Firebase mints a CUSTOM token
 * and every backend verifies ID tokens, so a config with nothing to exchange with refuses at the
 * mint (ADR-0002) — which is a run that dies at its first visit rather than a form that said so.
 * A warning and not a blocker: the key may be arriving later, and the editor has always allowed it.
 */
export function whatIdentityWillNotDo(draft: IdentityDraft): string | null {
  if (draft.strategy !== "admin-mint") return null;
  if (draft.apiKey !== "" || draft.apiKeySet || draft.exchangeUrl !== "") return null;
  return "Without a Web API key or an exchange endpoint, nobody can be signed in: a Firebase custom token is not an ID token, and anything that verifies one will refuse it.";
}

/** The chooser and the fields of whichever way is chosen. */
export function WaysIn({ draft, onChange }: { draft: IdentityDraft; onChange: (patch: Partial<IdentityDraft>) => void }): ReactNode {
  return (
    <ConditionalFieldset<IdentityDraft["strategy"]>
      legend="Way in"
      name="identity-strategy"
      value={draft.strategy}
      onChange={(strategy) => {
        onChange({ strategy });
      }}
      branches={WAYS_IN.map((way) => ({ ...way, fields: identityFields(way.value, draft, onChange) }))}
    />
  );
}

/** The three ways a PERSON gets an account. `undecided` is not among them: it is the absence. */
type WayIn = Exclude<IdentityDraft["strategy"], "undecided">;

const WAYS_IN: readonly Omit<ConditionalBranch<WayIn>, "fields">[] = [
  {
    value: "self-signup",
    label: "They sign themselves up",
    hint: "Recommended: each person makes their own account through the target's own tool.",
  },
  {
    value: "static",
    label: "Accounts from a file I provide",
    hint: "Accounts you already hold, handed out one per person.",
  },
  {
    value: "admin-mint",
    label: "Minted by an admin SDK",
    hint: "Firebase makes each person, and a key turns what comes back into a session.",
    note: "The service account creates each person in Firebase; the Web API key turns what comes back into a session the product will accept. Both are needed — a Firebase custom token is not an ID token, and anything that verifies one will refuse it.",
  },
];

/**
 * The fields that belong to one way in. A function rather than three inline trees: what the
 * `ConditionalFieldset` needs is one branch's fields, and building them beside the branch's own
 * words is what keeps the two from drifting apart.
 */
function identityFields(
  strategy: WayIn,
  draft: IdentityDraft,
  onChange: (patch: Partial<IdentityDraft>) => void,
): ReactNode {
  switch (strategy) {
    case "self-signup":
      return (
        <Stack gap={6}>
          <Field label="Sign-up tool" hint="The tool that creates an account.">
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                describedBy={describedBy}
                invalid={invalid}
                value={draft.signupTool}
                onChange={(v) => onChange({ signupTool: v })}
                placeholder="sign_up"
                mono
              />
            )}
          </Field>
          <FieldGrid cols={2}>
            <Field label="Where the token comes back" hint="Dotted path into the result.">
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  describedBy={describedBy}
                  invalid={invalid}
                  value={draft.tokenPath}
                  onChange={(v) => onChange({ tokenPath: v })}
                  placeholder="token"
                  mono
                />
              )}
            </Field>
            <Field label="Where the account id comes back" optional>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  describedBy={describedBy}
                  invalid={invalid}
                  value={draft.userIdPath}
                  onChange={(v) => onChange({ userIdPath: v })}
                  placeholder="user.id"
                  mono
                />
              )}
            </Field>
          </FieldGrid>
          <FieldGrid cols={2}>
            <Field
              label="Tool that deletes an account"
              hint="Used to clean up afterwards. Without it, accounts have to be removed by hand."
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  describedBy={describedBy}
                  invalid={invalid}
                  value={draft.teardownTool}
                  onChange={(v) => onChange({ teardownTool: v })}
                  placeholder="delete_account"
                  mono
                />
              )}
            </Field>
            <Field
              label="Email domain"
              hint="Every address carries the execution's tag, so a sweep can find them again."
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  describedBy={describedBy}
                  invalid={invalid}
                  value={draft.emailDomain}
                  onChange={(v) => onChange({ emailDomain: v })}
                  mono
                />
              )}
            </Field>
          </FieldGrid>
        </Stack>
      );
    case "static":
      return (
        <Field
          label="Accounts file"
          hint={'JSON keyed by cohort — { "byCohort": { "<cohort slug>": [ { "bearerToken": "..." } ] } } — with one entry per person. These accounts are yours: a clean-up leaves them alone.'}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              describedBy={describedBy}
              invalid={invalid}
              value={draft.staticFile}
              onChange={(v) => onChange({ staticFile: v })}
              placeholder="accounts.json"
              mono
            />
          )}
        </Field>
      );
    case "admin-mint":
      return (
        <Stack gap={6}>
          <SecretField
            label="Web API key"
            stored={draft.apiKeySet}
            value={draft.apiKey}
            onChange={(v) => onChange({ apiKey: v })}
            hint="Firebase console → Project settings → General → Web API Key. Used to exchange the custom token and to renew it every hour."
          />
          <FieldGrid cols={2}>
            <Field
              label="Service account file"
              hint="Path to the JSON key. Leave empty to use GOOGLE_APPLICATION_CREDENTIALS."
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  describedBy={describedBy}
                  invalid={invalid}
                  value={draft.serviceAccountFile}
                  onChange={(v) => onChange({ serviceAccountFile: v })}
                  placeholder="./service-account.json"
                  mono
                />
              )}
            </Field>
            <Field label="Firebase project" optional hint="Only needed when the credentials do not name one.">
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  describedBy={describedBy}
                  invalid={invalid}
                  value={draft.firebaseProjectId}
                  onChange={(v) => onChange({ firebaseProjectId: v })}
                  placeholder="my-app-staging"
                  mono
                />
              )}
            </Field>
          </FieldGrid>
          <FieldGrid cols={2}>
            <Field
              label="Email domain"
              hint="Every address carries the execution's tag, so a sweep can find them again."
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  describedBy={describedBy}
                  invalid={invalid}
                  value={draft.emailDomain}
                  onChange={(v) => onChange({ emailDomain: v })}
                  mono
                />
              )}
            </Field>
            <Field
              label="Exchange endpoint"
              optional
              hint="An endpoint of your own that turns a custom token into the bearer your product accepts. Set one and it replaces Google's exchange entirely — sessions are renewed through it too, never through Google."
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  describedBy={describedBy}
                  invalid={invalid}
                  value={draft.exchangeUrl}
                  onChange={(v) => onChange({ exchangeUrl: v })}
                  placeholder="https://…"
                  mono
                />
              )}
            </Field>
          </FieldGrid>
        </Stack>
      );
  }
}
