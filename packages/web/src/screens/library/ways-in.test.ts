import { TargetInputSchema } from "@populace/contract";
import { describe, expect, it } from "vitest";
import { EMPTY_IDENTITY, identityDraftFromCheck, identityFrom, whatIdentityNeeds, whatIdentityWillNotDo, type IdentityDraft } from "./ways-in.js";

/**
 * How the PEOPLE get in, as the two screens that ask compute it.
 *
 * These are the functions behind a bug a reader met on the way to their first run: the connect
 * screen sent `{ strategy: "self-signup", signupTool: "" }` for every target, so connecting
 * anything whose accounts are not made through an MCP tool ended at
 * `Too small: expected string to have >=1 characters → at identity.signupTool` — a schema error
 * about a choice the reader had never been offered, on a screen with no field to fix it.
 *
 * So what is asserted here is mostly the refusals: that a draft nobody has answered produces no
 * config at all, and that every config it DOES produce is one the server will accept. The last
 * one is checked against the contract schema itself rather than by eye, because agreeing with the
 * server is the whole job and a hand-written expectation would only agree with me.
 */

/** The identity half of what the wire takes, which is what these functions have to satisfy. */
const accepts = (identity: ReturnType<typeof identityFrom>): boolean =>
  identity !== null &&
  TargetInputSchema.safeParse({ name: "a target", mcp: [{ name: "default", url: "https://example.test/mcp" }], identity }).success;

describe("what the tool list suggests", () => {
  it("fills in self-signup when there is a sign-up tool to name", () => {
    const draft = identityDraftFromCheck({
      signupTool: "sign_up",
      tokenPath: "token",
      userIdPath: "user.id",
      teardownTool: "delete_account",
      because: [],
    });
    expect(draft.strategy).toBe("self-signup");
    expect(draft.signupTool).toBe("sign_up");
    expect(whatIdentityNeeds(draft)).toBeNull();
    expect(accepts(identityFrom(draft))).toBe(true);
  });

  it("chooses nothing at all when the tool list holds no sign-up", () => {
    const draft = identityDraftFromCheck({ signupTool: null, tokenPath: null, userIdPath: null, teardownTool: null, because: [] });
    // Not self-signup with an empty tool name. The check has just said nobody can sign themselves
    // up here, and a form that then opened on that branch would be asking for a tool it was told
    // does not exist.
    expect(draft.strategy).toBe("undecided");
    expect(identityFrom(draft)).toBeNull();
    expect(whatIdentityNeeds(draft)).toBe("a way in");
  });
});

describe("what a draft still needs", () => {
  it("refuses a way in nobody has chosen, and says so before anything is sent", () => {
    expect(whatIdentityNeeds(EMPTY_IDENTITY)).toBe("a way in");
    expect(identityFrom(EMPTY_IDENTITY)).toBeNull();
  });

  it("refuses self-signup with no tool named, which is the shape that used to reach the server", () => {
    const draft: IdentityDraft = { ...EMPTY_IDENTITY, strategy: "self-signup" };
    expect(whatIdentityNeeds(draft)).toBe("the name of the tool that makes an account");
    // And it is the exact body the old connect screen sent, so this is the regression itself.
    expect(accepts(identityFrom(draft))).toBe(false);
  });

  it("refuses a pool with no file to read", () => {
    expect(whatIdentityNeeds({ ...EMPTY_IDENTITY, strategy: "static" })).toBe("a file of accounts to hand out");
  });

  it("takes admin-mint with nothing but the strategy, because Firebase needs nothing else to save", () => {
    const draft: IdentityDraft = { ...EMPTY_IDENTITY, strategy: "admin-mint" };
    expect(whatIdentityNeeds(draft)).toBeNull();
    expect(accepts(identityFrom(draft))).toBe(true);
    // It will still not be able to sign anybody in, and that is a warning rather than a blocker:
    // a custom token is not an ID token, and the mint refuses without something to exchange with.
    expect(whatIdentityWillNotDo(draft)).toContain("custom token is not an ID token");
  });

  it("stops warning once there is something to exchange with", () => {
    expect(whatIdentityWillNotDo({ ...EMPTY_IDENTITY, strategy: "admin-mint", apiKey: "AIza…" })).toBeNull();
    expect(whatIdentityWillNotDo({ ...EMPTY_IDENTITY, strategy: "admin-mint", apiKeySet: true })).toBeNull();
    expect(whatIdentityWillNotDo({ ...EMPTY_IDENTITY, strategy: "admin-mint", exchangeUrl: "https://example.test/exchange" })).toBeNull();
    // It is about admin-mint and nothing else.
    expect(whatIdentityWillNotDo({ ...EMPTY_IDENTITY, strategy: "self-signup", signupTool: "sign_up" })).toBeNull();
  });
});

describe("what gets sent", () => {
  it("sends the API key only when one was typed, so a blank leaves the stored one alone", () => {
    const stored = identityFrom({ ...EMPTY_IDENTITY, strategy: "admin-mint", apiKeySet: true });
    expect(stored).not.toBeNull();
    expect(stored && "apiKey" in stored).toBe(false);
    const typed = identityFrom({ ...EMPTY_IDENTITY, strategy: "admin-mint", apiKey: "AIza…" });
    expect(typed).toMatchObject({ apiKey: "AIza…" });
  });

  it("leaves out the optional paths rather than sending empty strings", () => {
    const identity = identityFrom({ ...EMPTY_IDENTITY, strategy: "self-signup", signupTool: "register" });
    expect(identity).toEqual({ strategy: "self-signup", signupTool: "register", tokenPath: "token", emailDomain: "populace.test" });
    expect(accepts(identity)).toBe(true);
  });

  it("keeps what was typed on a branch the reader switched away from and back", () => {
    const typed: IdentityDraft = { ...EMPTY_IDENTITY, strategy: "self-signup", signupTool: "sign_up" };
    const wandered: IdentityDraft = { ...typed, strategy: "admin-mint" };
    const returned: IdentityDraft = { ...wandered, strategy: "self-signup" };
    expect(returned.signupTool).toBe("sign_up");
  });
});
