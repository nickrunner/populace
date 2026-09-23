import type { ReactNode } from "react";

import type { TargetCheck } from "../../api.js";
import type { IdentityConfigView, TargetInput } from "@populace/contract";
import { TdkSetup } from "./tdk-setup.js";
import {
  ConditionalFieldset,
  Field,
  FieldGrid,
  Input,
  SecretField,
  Stack,
  ToolName,
  type ConditionalBranch,
} from "../../design/index.js";

/**
 * The ways in — how the PEOPLE a simulation sends get accounts of their own.
 *
 * Not to be confused with your own sign-in to the address (ADR-0036), which is how populace reads
 * a tool list and is one human's credential. This is the other half: forty strangers, forty
 * accounts, and the ways there are of producing them.
 *
 * **It lives here because two screens need the same answer.** It was only ever on the saved-target
 * editor, and `ConnectTarget` — the screen that actually creates a target — sent a hardcoded
 * `{ strategy: "self-signup", signupTool: "" }` instead. That is not a valid config: `signupTool`
 * is `min(1)`, so connecting any target whose accounts are not made through an MCP tool ended at
 * `Too small: expected string to have >=1 characters at identity.signupTool`, with no field on the
 * screen to fix and no way to save. A target that cannot be saved cannot be edited either, because
 * the editor is only reachable for one that exists.
 *
 * **The question is about the product, not about mechanisms** (ADR-0038). It used to be legended
 * "Way in" over four radios named after providers, and a reader who does not already know which
 * mechanism their product uses cannot answer a question phrased that way — the user who prompted
 * the rework asked all four of the obvious questions and the screen answered none of them. It
 * asks *how do people get accounts on your app*, and the options are answers to that.
 *
 * **They are not four peers, and the shape says so.** Three are answers about what a product is
 * like; two are escape hatches for somebody who cannot deploy code into the app at all, and those
 * live behind a disclosure with their costs named. `admin-mint` is not removed — an evaluator
 * pointed at a build they do not own is a real reader — but a service account that can mint a
 * token for any uid including an admin's is not a peer of a revocable dev-scoped secret, and
 * offering the two side by side with equal weight is offering a choice between two doors, one of
 * which has a hole in the floor.
 */

/**
 * The identity half of a target, as a form holds it: flat, all strings, every branch's fields
 * present whichever branch is chosen. Switching between them and back does not lose what was
 * typed, which is the property a discriminated union in component state would not have.
 */
export interface IdentityDraft {
  /**
   * `undecided` is a real state and not a placeholder. A target whose tool list holds no sign-up
   * has no default way in that would be honest — the fieldset shows unselected radios, and
   * `whatIdentityNeeds` refuses the save until one of them is answered. It matches no branch, so
   * `ConditionalFieldset` renders no fields for it, which is exactly the shape of "nothing picked".
   *
   * `none` is the opposite and is an ANSWER: there are no accounts here and nobody will be signed
   * up (ADR-0038). It is not a default either, because "this server has no users" is a fact about
   * somebody's product that nothing on the wire can tell populace.
   */
  strategy: "undecided" | "none" | "self-signup" | "static" | "admin-mint" | "provision-url";
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
  /** provision-url: where `@populace/tdk` is mounted in the target, and the secret it expects. */
  provisionUrl: string;
  /** Empty means "leave whatever is stored alone", exactly as the Firebase key does. */
  provisionSecret: string;
  provisionSecretSet: boolean;
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
  provisionUrl: "",
  provisionSecret: "",
  provisionSecretSet: false,
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
    provisionUrl: identity.strategy === "provision-url" ? identity.url : "",
    provisionSecretSet: identity.strategy === "provision-url" ? identity.secretSet : false,
  };
}

/**
 * What the tool list suggests, as a starting draft.
 *
 * **A guess with no sign-up tool in it is not a self-signup target.** The check says so in as many
 * words — "nothing here looks like a sign-up" — and a form that then opened on the self-signup
 * branch would be asking for a tool the reader has just been told does not exist.
 *
 * It is not `none` either, and that is the harder restraint. A tool list of nothing but reads can
 * be a product with accounts whose sign-up is simply not on the MCP surface — which is the common
 * case and the reason `provision-url` exists — so "this server has no users" is a fact about
 * somebody's product that the tool list cannot establish. The strategy is left unchosen, and the
 * screen asks (ADR-0035: refuse to guess, and name the choices).
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
 * config for any strategy it did not know about, so a new way in would have compiled and quietly
 * sent the wrong one.
 */
export function identityFrom(draft: IdentityDraft): TargetInput["identity"] | null {
  switch (draft.strategy) {
    case "undecided":
      return null;
    case "none":
      // No fields, and none invented. Where the ADDRESS is gated the token goes on the endpoint,
      // because it is the address that is closed and not the product.
      return { strategy: "none" };
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
    case "provision-url":
      return {
        strategy: "provision-url",
        url: draft.provisionUrl,
        emailDomain: draft.emailDomain || "populace.test",
        // Absent leaves the stored secret alone; the form only sends one when it was typed.
        ...(draft.provisionSecret ? { secret: draft.provisionSecret } : {}),
      };
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
  if (draft.strategy === "undecided") return "an answer to how people get accounts";
  if (draft.strategy === "self-signup" && draft.signupTool.trim() === "") return "the name of the tool that makes an account";
  if (draft.strategy === "static" && draft.staticFile.trim() === "") return "a file of accounts to hand out";
  if (draft.strategy === "provision-url") {
    if (draft.provisionUrl.trim() === "") return "the address your app answers provisioning on";
    if (draft.provisionSecret.trim() === "" && !draft.provisionSecretSet) return "the secret your app expects";
  }
  return null;
}

/**
 * What this draft will not be able to do, even though it will save. A warning and not a blocker:
 * the distinction is the schema boundary — what the SERVER will refuse blocks, what the RUN will
 * refuse warns.
 *
 * Two of them.
 *
 * Firebase mints a CUSTOM token and every backend verifies ID tokens, so a config with nothing to
 * exchange with refuses at the mint (ADR-0002) — a run that dies at its first visit rather than a
 * form that said so. The key may be arriving later, and the editor has always allowed it.
 *
 * A static pool cannot be renewed. `StaticIdentityProvider` implements no `refresh` and there is
 * nothing for it to redeem, so a pool of anything with an expiry — a Firebase ID token lasts an
 * hour — is dead before a run of any length finishes, and until now nothing anywhere said so. The
 * run itself refuses when the expiry is already known and already near (`checkPopulation`); this
 * is the half of it that has to be said at the moment somebody chooses the option, because an
 * expiry a day out is perfectly valid today and will not be on Thursday.
 */
export function whatIdentityWillNotDo(draft: IdentityDraft): string | null {
  if (draft.strategy === "static") {
    return "populace cannot renew any of these logins: nothing in a pool file says how to get a fresh one. A token with an expiry on it will be refused part-way through, and the people holding it stop there.";
  }
  if (draft.strategy !== "admin-mint") return null;
  if (draft.apiKey !== "" || draft.apiKeySet || draft.exchangeUrl !== "") return null;
  return "Without a Web API key or an exchange endpoint, nobody can be signed in: a Firebase custom token is not an ID token, and anything that verifies one will refuse it.";
}

/** Everything that is not an answer to the question. `undecided` is the absence of one. */
type WayIn = Exclude<IdentityDraft["strategy"], "undecided">;

export interface WaysInProps {
  draft: IdentityDraft;
  onChange: (patch: Partial<IdentityDraft>) => void;
  /**
   * What the check learned about this address, when anybody has run one.
   *
   * It decides two things and never chooses for the reader: the order the answers are offered in,
   * and whether self-signup is offered at all. Both call sites already hold it — the connect
   * screen has just run one and the editor keeps the last.
   */
  check?: TargetCheck | null;
  /** A saved target, so the TDK check can use a secret the form has never been shown. */
  targetId?: string | null;
}

/**
 * The question, the answers, and the fields of whichever answer was chosen.
 *
 * **The order is what the check learned, and nothing else.** The recommended way in is always
 * first, because what decides it is not convenience but what populace ends up holding — a
 * revocable, dev-scoped secret against a vendor service account, N real logins, or an account
 * factory on a public machine surface. After it: when the tool list holds a sign-up, that is the
 * cheapest correct answer in the product and it comes second; when it does not, self-signup is
 * last and it is inert with the reason attached, because a radio the reader was just told is
 * impossible should not be pressable.
 */
export function WaysIn({ draft, onChange, check = null, targetId = null }: WaysInProps): ReactNode {
  const signupTool = check?.identity.signupTool ?? null;
  // Only ever said on the strength of a check that got through. A check that failed learned
  // nothing about the tool list, and "nobody can sign up here" is not a thing to say about a
  // server that did not answer.
  const looked = check !== null && check.ok;
  const answers: readonly Omit<ConditionalBranch<WayIn>, "fields">[] = [
    {
      value: "provision-url",
      label: "My app makes them",
      hint: "Recommended. Your app answers on an address populace calls, and keeps everything else.",
      note: "Mount @populace/tdk in your app, write the one function that makes a user, and point this at it. It is about fifteen lines. It is the only way in that works when your accounts are not made through an MCP tool, and the only one where populace holds no credential of your vendor's — just a secret you can rotate in one environment variable.",
    },
    ...(looked && signupTool !== null ? [selfSignup(signupTool, null)] : []),
    {
      value: "none",
      label: "They don't need one",
      hint: "This server has no users. Everyone who visits it sees the same thing.",
      note: "Nobody will be signed up, and there is nothing to clean up afterwards. If the address itself needs a token, it goes on the endpoint and every person uses it.",
    },
    ...(looked && signupTool === null
      ? [
          selfSignup(
            null,
            // Not when it is the answer already saved: a radio that is both chosen and refused is
            // a contradiction, and a reader editing such a target still needs its fields.
            draft.strategy === "self-signup" ? null : { reason: "Nothing on this server looks like a sign-up, so nobody could." },
          ),
        ]
      : []),
    ...(looked ? [] : [selfSignup(null, null)]),
  ];

  return (
    <ConditionalFieldset<IdentityDraft["strategy"]>
      legend="How do people get accounts on your app?"
      name="identity-strategy"
      value={draft.strategy}
      onChange={(strategy) => {
        onChange({ strategy });
      }}
      branches={answers.map((way) => ({ ...way, fields: identityFields(way.value, draft, onChange, targetId) }))}
      folded={{
        label: "Other ways",
        branches: ESCAPE_HATCHES.map((way) => ({ ...way, fields: identityFields(way.value, draft, onChange, targetId) })),
      }}
    />
  );
}

/**
 * They sign themselves up — worded from what the check found, because the two cases are different
 * sentences and one of them is "this cannot work here".
 *
 * It keeps its place in the product: it is the one way in where populace holds no credential at
 * all, which is a real advantage and should not be argued away. What it is no longer is the
 * recommended one — an account-making tool on a machine-facing surface bypasses whatever
 * anti-abuse the human sign-up accumulated, because nothing there can do a captcha.
 */
function selfSignup(tool: string | null, disabled: { reason: string } | null): Omit<ConditionalBranch<WayIn>, "fields"> {
  return {
    value: "self-signup",
    label: "They sign themselves up",
    hint: tool === null ? "Each person makes their own account through a tool on this server." : <>Each person makes their own account through <ToolName name={tool} />.</>,
    note: "populace holds no credential at all this way, which is its one real advantage. It also puts account creation on a machine-facing surface, where your sign-up form's defences are not.",
    ...(disabled === null ? {} : { disabled }),
  };
}

/**
 * The two that are not answers to "what is your product like" but to "what can I reach today".
 *
 * Both are kept, and both say what they cost. A staging database seeded with users months ago is
 * real, and so is an evaluator pointed at a build they cannot deploy into. Neither is a peer of
 * the three above, and a disclosure is how a screen says that without taking the option away.
 */
const ESCAPE_HATCHES: readonly Omit<ConditionalBranch<WayIn>, "fields">[] = [
  {
    value: "static",
    label: "Accounts I already have",
    hint: "A file of logins, one per person. Nothing is created, and nothing is removed afterwards.",
    note: "One entry per person, keyed by cohort — twelve people need twelve logins. populace cannot renew any of them, so a token with an hour on it will be refused part-way through and those people stop.",
  },
  {
    value: "admin-mint",
    label: "Minted with a Firebase service account",
    hint: "populace holds a key that can sign in as anybody on your Firebase project.",
    note: "For a product you cannot deploy code into. The service account it needs can mint a token for any uid, including an admin's, and it is kept on this machine. If you can add a dependency to your app, @populace/tdk's firebase() preset does the same job and that credential stays yours.",
  },
];

/**
 * The fields that belong to one way in. A function rather than inline trees: what the
 * `ConditionalFieldset` needs is one branch's fields, and building them beside the branch's own
 * words is what keeps the two from drifting apart.
 */
function identityFields(
  strategy: WayIn,
  draft: IdentityDraft,
  onChange: (patch: Partial<IdentityDraft>) => void,
  targetId: string | null,
): ReactNode {
  switch (strategy) {
    case "none":
      // Deliberately nothing. There is no field a reader could fill in about accounts that do not
      // exist, and the branch's note is the whole of what there is to say.
      return null;
    case "provision-url":
      return (
        <Stack gap={6}>
          <Field
            label="Provisioning address"
            hint="Where @populace/tdk is mounted in your app — the base, not a route."
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                describedBy={describedBy}
                invalid={invalid}
                value={draft.provisionUrl}
                onChange={(v) => onChange({ provisionUrl: v })}
                placeholder="https://dev.example.com/populace"
                mono
              />
            )}
          </Field>
          <SecretField
            label="Shared secret"
            stored={draft.provisionSecretSet}
            value={draft.provisionSecret}
            onChange={(v) => onChange({ provisionSecret: v })}
            hint="The same value your app reads as POPULACE_SECRET. It is the whole authority populace has over that endpoint, and it is yours to rotate."
          />
          <TdkSetup
            url={draft.provisionUrl}
            secret={draft.provisionSecret}
            secretSet={draft.provisionSecretSet}
            onSecret={(secret) => onChange({ provisionSecret: secret })}
            targetId={targetId}
          />
          <Field
            label="Email domain"
            // The execution's ID and not its tag: a tag carries a colon, which is not legal in an
            // email local part, and the kit refuses the address outright (ADR-0037).
            hint="Every address carries the execution's id, so a sweep can find them again. The tag itself is sent alongside it."
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
        </Stack>
      );
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
