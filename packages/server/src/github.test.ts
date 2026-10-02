import { describe, expect, it } from "vitest";
import { GithubClient, type FetchLike, type GithubResponse } from "./github.js";

/**
 * What populace puts on somebody else's wire, and what it says about what came back.
 *
 * Both halves are load-bearing and the first one is the one that is easy to lose. A client that
 * forgets the API version header, or sends the token as `token` instead of `Bearer`, or posts an
 * issue with a label the repository does not have, fails in a way that looks from the outside like
 * GitHub being unhelpful — so every assertion below that can name the method, the path, the headers
 * and the body does. The `recorder()` harness in `live-secrets.test.ts` exists for exactly this
 * class of bug; here it is a fake `FetchLike` rather than a socket, which is what keeps these tests
 * offline with no token of any kind in the environment.
 */

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

interface Reply {
  status: number;
  body?: object | string;
  headers?: Record<string, string>;
}

/** The token these tests send. Deliberately shapeless: see the redaction test at the bottom. */
const TOKEN = "not-a-real-token-at-all";

/**
 * A fake GitHub, answering from a script and recording what it was asked. The script is a function
 * of the call rather than a queue so a test can answer differently per path — `getRepo` asks twice
 * — while a test that only cares about one call can ignore its argument.
 */
function fake(answer: (sent: Sent, calls: number) => Reply): { fetchImpl: FetchLike; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const call: Sent = { url, method: init.method, headers: init.headers, body: init.body };
    sent.push(call);
    const reply = answer(call, sent.length);
    return replyOf(reply);
  };
  return { fetchImpl, sent };
}

function replyOf(reply: Reply): GithubResponse {
  const text = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body ?? {});
  return {
    ok: reply.status >= 200 && reply.status < 300,
    status: reply.status,
    headers: new Headers(reply.headers ?? {}),
    text: () => Promise.resolve(text),
  };
}

const NOON = Date.UTC(2026, 8, 30, 12, 0, 0);

/**
 * A client whose waits are recorded instead of waited, so a backoff test costs no time.
 *
 * `clock` is a function rather than an instant because the pass budget is wall-clock: a test of it
 * has to be able to move time on between calls without waiting any of it.
 */
function clientWith(
  fetchImpl: FetchLike,
  options: { now?: number; clock?: () => number; budgetMs?: number | null } = {},
): { client: GithubClient; slept: number[] } {
  const slept: number[] = [];
  const client = new GithubClient({
    repo: "acme/tasklet",
    token: TOKEN,
    fetchImpl,
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
    now: options.clock ?? (() => options.now ?? NOON),
    ...(options.budgetMs === undefined ? {} : { budgetMs: options.budgetMs }),
  });
  return { client, slept };
}

const OPENED_AT = "2026-05-01T09:12:33Z";

const AN_ISSUE = { number: 41, html_url: "https://github.com/acme/tasklet/issues/41", state: "open", created_at: OPENED_AT };

/** What `AN_ISSUE` should come back as. */
const A_REF = { number: 41, url: "https://github.com/acme/tasklet/issues/41", state: "open", createdAt: "2026-05-01T09:12:33.000Z" };

describe("what populace sends github.com", () => {
  it("opens an issue with the title, the body and the labels, and reads back where it landed", async () => {
    const { fetchImpl, sent } = fake(() => ({ status: 201, body: AN_ISSUE }));
    const { client } = clientWith(fetchImpl);

    const filed = await client.createIssue({ title: "search_tasks misses a task by its capital letter", body: "## What happened\n…", labels: ["populace"] });

    expect(filed.ok).toBe(true);
    if (!filed.ok) return;
    expect(filed.issue).toEqual(A_REF);

    const call = sent[0]!;
    expect(call.method).toBe("POST");
    expect(call.url).toBe("https://api.github.com/repos/acme/tasklet/issues");
    expect(call.headers["Authorization"]).toBe(`Bearer ${TOKEN}`);
    expect(call.headers["Accept"]).toBe("application/vnd.github+json");
    expect(call.headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
    expect(call.headers["User-Agent"]).toContain("populace");
    expect(call.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(call.body ?? "")).toEqual({
      title: "search_tasks misses a task by its capital letter",
      body: "## What happened\n…",
      labels: ["populace"],
    });
  });

  it("comments on an issue it already opened", async () => {
    const { fetchImpl, sent } = fake(() => ({ status: 201, body: { id: 9001, html_url: "https://github.com/acme/tasklet/issues/41#issuecomment-9001" } }));
    const { client } = clientWith(fetchImpl);

    const commented = await client.addComment(41, "Reported again in execution 3.");

    expect(commented.ok).toBe(true);
    if (!commented.ok) return;
    expect(commented.id).toBe(9001);
    expect(sent[0]!.method).toBe("POST");
    expect(sent[0]!.url).toBe("https://api.github.com/repos/acme/tasklet/issues/41/comments");
    expect(JSON.parse(sent[0]!.body ?? "")).toEqual({ body: "Reported again in execution 3." });
  });

  it("reopens a closed issue by patching its state, and nothing else about it", async () => {
    const { fetchImpl, sent } = fake(() => ({ status: 200, body: { ...AN_ISSUE, state: "open" } }));
    const { client } = clientWith(fetchImpl);

    const reopened = await client.reopenIssue(41);

    expect(reopened.ok).toBe(true);
    expect(sent[0]!.method).toBe("PATCH");
    expect(sent[0]!.url).toBe("https://api.github.com/repos/acme/tasklet/issues/41");
    // Only the state. A reopen is not an edit of the title, the body or the labels somebody may
    // have changed by hand since it was filed.
    expect(JSON.parse(sent[0]!.body ?? "")).toEqual({ state: "open" });
  });

  it("reads back the issue's current state, which is how it learns somebody closed it", async () => {
    const { fetchImpl, sent } = fake(() => ({ status: 200, body: { ...AN_ISSUE, state: "closed" } }));
    const { client } = clientWith(fetchImpl);

    const found = await client.getIssue(41);

    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.issue.state).toBe("closed");
    expect(sent[0]!.method).toBe("GET");
  });

  it("creates a label it needs and treats one that is already there as success", async () => {
    const { fetchImpl, sent } = fake((call) =>
      JSON.parse(call.body ?? "{}").name === "populace"
        ? { status: 422, body: { message: "Validation Failed", errors: [{ code: "already_exists", field: "name" }] } }
        : { status: 201, body: { name: "needs-triage" } },
    );
    const { client } = clientWith(fetchImpl);

    const ensured = await client.ensureLabels(["populace", "needs-triage"]);

    expect(ensured.ok).toBe(true);
    if (!ensured.ok) return;
    expect(ensured.existing).toEqual(["populace"]);
    expect(ensured.created).toEqual(["needs-triage"]);
    expect(sent.map((c) => c.url)).toEqual(["https://api.github.com/repos/acme/tasklet/labels", "https://api.github.com/repos/acme/tasklet/labels"]);
    expect(JSON.parse(sent[0]!.body ?? "")).toMatchObject({ name: "populace" });
  });

  it("searches the repository for a marker, scoped to issues and to the body", async () => {
    const { fetchImpl, sent } = fake(() => ({ status: 200, body: { items: [AN_ISSUE] } }));
    const { client } = clientWith(fetchImpl);

    const found = await client.searchIssues("populace:bug:search_tasks:abc123");

    expect(found.outcome).toBe("found");
    if (found.outcome !== "found") return;
    expect(found.issues).toEqual([A_REF]);
    const query = decodeURIComponent(new URL(sent[0]!.url).searchParams.get("q") ?? "");
    expect(query).toBe('repo:acme/tasklet is:issue in:body "populace:bug:search_tasks:abc123"');
  });

  it("creates one issue at a time, because the secondary limit is provoked by doing otherwise", async () => {
    const order: string[] = [];
    let release = (): void => undefined;
    const held = new Promise<void>((done) => {
      release = done;
    });
    const fetchImpl: FetchLike = async (_url, init) => {
      const title = JSON.parse(init.body ?? "{}").title;
      order.push(`start ${title}`);
      if (title === "first") await held;
      order.push(`end ${title}`);
      return replyOf({ status: 201, body: AN_ISSUE });
    };
    const { client } = clientWith(fetchImpl);

    const both = Promise.all([
      client.createIssue({ title: "first", body: "b", labels: [] }),
      client.createIssue({ title: "second", body: "b", labels: [] }),
    ]);
    // The second create must not have gone out while the first was still in flight.
    await Promise.resolve();
    expect(order).toEqual(["start first"]);
    release();
    await both;

    expect(order).toEqual(["start first", "end first", "start second", "end second"]);
  });
});

/**
 * A filed issue is handed over to something watching the repository by a LABEL being added, so
 * populace has to be able to change the labels on an issue that already exists — and to hand the
 * same issue over a second time, when a problem comes back, it has to take the label off and put it
 * back, because the label is already there.
 *
 * The remove is the half with the trap in it. GitHub answers 404 both for a label that is not on the
 * issue and for an issue that is not there, and the first of those is the state the caller is asking
 * for: reading it as a failure aborts the remove-then-add half way, the label never goes back on,
 * and the issue is never handed over again — a silent nothing, where silence looks like success.
 */
describe("changing the labels on an issue that already exists", () => {
  it("adds labels with a POST to that issue's own labels endpoint", async () => {
    const { fetchImpl, sent } = fake(() => ({ status: 200, body: [{ name: "populace" }, { name: "needs-triage" }] }));
    const { client } = clientWith(fetchImpl);

    const added = await client.addLabels(41, ["populace", "needs-triage"]);

    expect(added.ok).toBe(true);
    if (!added.ok) return;
    // Every label now on the issue, which is what GitHub answers with rather than just the new ones.
    expect(added.labels).toEqual(["populace", "needs-triage"]);
    expect(sent[0]!.method).toBe("POST");
    expect(sent[0]!.url).toBe("https://api.github.com/repos/acme/tasklet/issues/41/labels");
    expect(JSON.parse(sent[0]!.body ?? "")).toEqual({ labels: ["populace", "needs-triage"] });
  });

  it("does not go out at all when there are no labels to add, because GitHub 422s an empty list", async () => {
    const { fetchImpl, sent } = fake(() => ({ status: 422, body: { message: "Invalid request" } }));
    const { client } = clientWith(fetchImpl);

    const added = await client.addLabels(41, []);

    // A connection with no labels configured is a setting nobody filled in, not a problem with the
    // issue, and a 422 here would read like the latter.
    expect(added.ok).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it("removes one label by DELETE, with the name encoded because a label may carry a space or a slash", async () => {
    const { fetchImpl, sent } = fake(() => ({ status: 200, body: [{ name: "populace" }] }));
    const { client } = clientWith(fetchImpl);

    const answer = await client.removeLabel(41, "hand over: fix/this");

    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.removed).toBe(true);
    expect(sent[0]!.method).toBe("DELETE");
    // The slash in the LABEL is encoded, where the slash in `owner/name` is not: one is part of a
    // name and the other is a separator.
    expect(sent[0]!.url).toBe("https://api.github.com/repos/acme/tasklet/issues/41/labels/hand%20over%3A%20fix%2Fthis");
  });

  it("reads a label that was not on the issue as success, because the caller wanted it gone and it is gone", async () => {
    const { fetchImpl } = fake(() => ({ status: 404, body: { message: "Label does not exist" } }));
    const { client } = clientWith(fetchImpl);

    const answer = await client.removeLabel(41, "populace");

    // The assertion that matters: a remove-then-add must survive this, or the hand-over never fires.
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    // Said plainly all the same, so a caller can tell "GitHub took it off" from "there was nothing
    // to take off" without having to read the second one as a failure.
    expect(answer.removed).toBe(false);
  });

  it("reads a 404 about the ISSUE as the failure it is, rather than as a label that was not there", async () => {
    const { fetchImpl } = fake(() => ({ status: 404, body: { message: "Not Found" } }));
    const { client } = clientWith(fetchImpl);

    const answer = await client.removeLabel(99, "populace");

    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.code).toBe("not-found");
    expect(answer.status).toBe(404);
    expect(answer.message).toContain("cannot see it");
  });

  it("reads a 404 it cannot read the words of as the failure too, because nothing was learned", async () => {
    // Something in front of GitHub answered. Whether the label is on the issue is unknown, and
    // unknown is not a licence to report it gone.
    const { fetchImpl } = fake(() => ({ status: 404, body: "<html><body>not found</body></html>" }));
    const { client } = clientWith(fetchImpl);

    const answer = await client.removeLabel(41, "populace");

    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.code).toBe("not-found");
  });

  it("waits the seconds GitHub asks for when a label write is throttled, and then goes again", async () => {
    const { fetchImpl, sent } = fake((_call, calls) =>
      calls === 1
        ? { status: 429, body: { message: "You have exceeded a secondary rate limit" }, headers: { "retry-after": "2" } }
        : { status: 200, body: [{ name: "populace" }] },
    );
    const { client, slept } = clientWith(fetchImpl);

    const added = await client.addLabels(41, ["populace"]);

    expect(added.ok).toBe(true);
    expect(sent).toHaveLength(2);
    expect(slept).toEqual([2000]);
  });

  it("keeps the token out of what either of them says, and out of a label name GitHub echoes back", async () => {
    const { fetchImpl } = fake(() => ({
      status: 403,
      body: { message: `The token ${TOKEN} may not label this. Sent as Authorization: Bearer ${TOKEN}.` },
    }));
    const { client } = clientWith(fetchImpl);

    const added = await client.addLabels(41, ["populace"]);
    const removed = await client.removeLabel(41, "populace");

    for (const answer of [added, removed]) {
      expect(answer.ok).toBe(false);
      if (answer.ok) continue;
      expect(answer.message).not.toContain(TOKEN);
      expect(answer.message).toContain("[redacted");
    }

    // An echoed label NAME is quoted back to the caller as well, so it goes through the same funnel.
    const { fetchImpl: echoes } = fake(() => ({ status: 200, body: [{ name: `populace ${TOKEN}` }] }));
    const { client: other } = clientWith(echoes);

    const echoed = await other.addLabels(41, ["populace"]);

    expect(echoed.ok).toBe(true);
    if (!echoed.ok) return;
    expect(echoed.labels[0]).not.toContain(TOKEN);
    expect(echoed.labels[0]).toContain("[redacted");
  });
});

/**
 * The marker search is the dedupe rule's second line of defence, and the bug it guards against is
 * not "a wasted request": a search that FAILED and a search that found NOTHING read identically
 * through an empty list, and a publisher that cannot tell them apart reads a 403 as "not filed
 * yet" and opens a duplicate. Since the marker search exists precisely for the case where the
 * local ledger is gone, that mistake re-files every issue populace has ever opened.
 *
 * So the three answers are asserted as three, including — and this is the assertion that would
 * have caught it — that there is no `issues` list on either of the two that found nothing.
 */
describe("a marker search that did not answer is not a marker search that found nothing", () => {
  it("says none when GitHub answered and the marker is in nothing", async () => {
    const { fetchImpl } = fake(() => ({ status: 200, body: { items: [] } }));
    const { client } = clientWith(fetchImpl);

    const found = await client.searchIssues("populace:bug:search_tasks:abc123");

    expect(found.outcome).toBe("none");
    // Nothing to reach for, so nothing to mistake an empty list for.
    expect("issues" in found).toBe(false);
  });

  it("says it could not answer when the search was rate limited, and names why", async () => {
    const reset = Math.floor(Date.UTC(2026, 8, 30, 13, 0, 0) / 1000);
    const { fetchImpl } = fake(() => ({
      status: 403,
      body: { message: "API rate limit exceeded for user" },
      headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) },
    }));
    const { client } = clientWith(fetchImpl);

    const found = await client.searchIssues("populace:bug:search_tasks:abc123");

    expect(found.outcome).toBe("could-not-answer");
    if (found.outcome !== "could-not-answer") return;
    expect(found.failure.code).toBe("rate-limited");
    expect(found.failure.message).toContain("rate limiting");
    expect("issues" in found).toBe(false);
  });

  it("says it could not answer when nothing reached github.com at all", async () => {
    const fetchImpl: FetchLike = () => Promise.reject(new Error("getaddrinfo ENOTFOUND api.github.com"));
    const { client } = clientWith(fetchImpl);

    const found = await client.searchIssues("populace:bug:search_tasks:abc123");

    expect(found.outcome).toBe("could-not-answer");
    if (found.outcome !== "could-not-answer") return;
    expect(found.failure.code).toBe("unreachable");
    expect(found.failure.status).toBeNull();
  });

  it("treats a body it cannot read as a failure to answer rather than as an absence", async () => {
    // Something in front of GitHub answered 200 with its own page. What is in the repository is
    // unknown, which is not the same as nothing being there.
    const { fetchImpl } = fake(() => ({ status: 200, body: "<html><body>proxy sign-in</body></html>" }));
    const { client } = clientWith(fetchImpl);

    const found = await client.searchIssues("populace:bug:search_tasks:abc123");

    expect(found.outcome).toBe("could-not-answer");
    if (found.outcome !== "could-not-answer") return;
    expect(found.failure.code).toBe("malformed");
  });
});

/**
 * A marker search finds an issue that may have been opened months ago. A ledger row that stamped
 * `filedAt` with the local clock would claim populace filed it just now — and since every tie-break
 * in the dedupe rule is "the oldest `filedAt` wins", a fabricated date can permanently redirect
 * future comments to the wrong issue. So the date comes from GitHub, or it is null.
 */
describe("when the issue was opened", () => {
  it("carries GitHub's own created_at off a create and off a search", async () => {
    const { fetchImpl } = fake((call) => (call.method === "POST" ? { status: 201, body: AN_ISSUE } : { status: 200, body: { items: [AN_ISSUE] } }));
    const { client } = clientWith(fetchImpl);

    const filed = await client.createIssue({ title: "t", body: "b", labels: [] });
    const found = await client.searchIssues("populace:bug:search_tasks:abc123");

    expect(filed.ok).toBe(true);
    if (!filed.ok) return;
    expect(filed.issue.createdAt).toBe("2026-05-01T09:12:33.000Z");
    expect(found.outcome).toBe("found");
    if (found.outcome !== "found") return;
    expect(found.issues[0].createdAt).toBe("2026-05-01T09:12:33.000Z");
  });

  it("is null when the payload did not say, rather than the clock's answer", async () => {
    const { fetchImpl } = fake(() => ({ status: 200, body: { number: 41, html_url: "https://github.com/acme/tasklet/issues/41", state: "closed" } }));
    const { client } = clientWith(fetchImpl);

    const found = await client.getIssue(41);

    expect(found.ok).toBe(true);
    if (!found.ok) return;
    // The issue number is still usable: a date this could not read must not cost the issue.
    expect(found.issue.number).toBe(41);
    expect(found.issue.createdAt).toBeNull();
  });

  it("is null rather than a guess when the date is not a date", async () => {
    const { fetchImpl } = fake(() => ({ status: 200, body: { ...AN_ISSUE, created_at: "whenever" } }));
    const { client } = clientWith(fetchImpl);

    const found = await client.getIssue(41);

    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.issue.createdAt).toBeNull();
  });
});

describe("what populace says about what github.com answered", () => {
  it("says the token was not accepted, in GitHub's own words, without retrying it", async () => {
    const { fetchImpl, sent } = fake(() => ({ status: 401, body: { message: "Bad credentials" } }));
    const { client, slept } = clientWith(fetchImpl);

    const filed = await client.createIssue({ title: "t", body: "b", labels: [] });

    expect(filed.ok).toBe(false);
    if (filed.ok) return;
    expect(filed.code).toBe("refused");
    expect(filed.status).toBe(401);
    expect(filed.message).toContain("Bad credentials");
    // Asking again with the same credential gets the same answer, and a person is waiting.
    expect(sent).toHaveLength(1);
    expect(slept).toEqual([]);
  });

  it("reports an expired token as expired rather than as refused", async () => {
    const { fetchImpl } = fake(() => ({
      status: 401,
      body: { message: "Your token has expired. Please re-authenticate." },
      headers: { "github-authentication-token-expiration": "2026-09-01 10:00:00 UTC" },
    }));
    const { client } = clientWith(fetchImpl);

    const filed = await client.createIssue({ title: "t", body: "b", labels: [] });

    expect(filed.ok).toBe(false);
    if (filed.ok) return;
    // Its own code, because "refused" would send a reader hunting for a scope they already granted.
    expect(filed.code).toBe("expired");
    expect(filed.message).toContain("expired");
  });

  it("names the scope when a fine-grained token may not write issues here", async () => {
    const { fetchImpl, sent } = fake(() => ({
      status: 403,
      body: { message: "Resource not accessible by personal access token" },
      headers: { "x-ratelimit-remaining": "4998" },
    }));
    const { client } = clientWith(fetchImpl);

    const filed = await client.createIssue({ title: "t", body: "b", labels: [] });

    expect(filed.ok).toBe(false);
    if (filed.ok) return;
    expect(filed.code).toBe("refused");
    expect(filed.message).toContain("issues");
    expect(filed.message).toContain("Resource not accessible");
    // A 403 with no limit signal is a decision, not a throttle: retrying it can never work.
    expect(sent).toHaveLength(1);
  });

  it("says GitHub has nothing at that address for this token, which is both readings of a 404", async () => {
    const { fetchImpl } = fake(() => ({ status: 404, body: { message: "Not Found" } }));
    const { client } = clientWith(fetchImpl);

    const found = await client.getIssue(41);

    expect(found.ok).toBe(false);
    if (found.ok) return;
    expect(found.code).toBe("not-found");
    expect(found.message).toContain("cannot see it");
  });

  it("says there is nowhere to file when the issue tracker is switched off", async () => {
    const { fetchImpl } = fake(() => ({ status: 410, body: { message: "Issues are disabled for this repo" } }));
    const { client } = clientWith(fetchImpl);

    const filed = await client.createIssue({ title: "t", body: "b", labels: [] });

    expect(filed.ok).toBe(false);
    if (filed.ok) return;
    expect(filed.code).toBe("no-issues");
    expect(filed.message).toContain("acme/tasklet");
  });

  it("waits the seconds GitHub asks for on a 429 and then goes again", async () => {
    const { fetchImpl, sent } = fake((_call, calls) =>
      calls === 1
        ? { status: 429, body: { message: "You have exceeded a secondary rate limit" }, headers: { "retry-after": "2" } }
        : { status: 201, body: AN_ISSUE },
    );
    const { client, slept } = clientWith(fetchImpl);

    const filed = await client.createIssue({ title: "t", body: "b", labels: [] });

    expect(filed.ok).toBe(true);
    expect(sent).toHaveLength(2);
    expect(slept).toEqual([2000]);
  });

  it("refuses to hold a job open for a limit that will not clear for an hour", async () => {
    const reset = Math.floor(Date.UTC(2026, 8, 30, 13, 0, 0) / 1000);
    const { fetchImpl, sent } = fake(() => ({
      status: 403,
      body: { message: "API rate limit exceeded" },
      headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) },
    }));
    const { client, slept } = clientWith(fetchImpl);

    const filed = await client.createIssue({ title: "t", body: "b", labels: [] });

    expect(filed.ok).toBe(false);
    if (filed.ok) return;
    expect(filed.code).toBe("rate-limited");
    expect(filed.message).toContain("60 minutes");
    // Nothing slept and nothing spun: the serial job queue has sweeps and target checks behind it.
    expect(slept).toEqual([]);
    expect(sent).toHaveLength(1);
  });

  it("tries a few times when github.com is overloaded, and then says so", async () => {
    const { fetchImpl, sent } = fake(() => ({ status: 529, body: { message: "Overloaded" } }));
    const { client, slept } = clientWith(fetchImpl);

    const filed = await client.createIssue({ title: "t", body: "b", labels: [] });

    expect(filed.ok).toBe(false);
    if (filed.ok) return;
    expect(filed.code).toBe("unreachable");
    expect(filed.status).toBe(529);
    expect(sent).toHaveLength(3);
    // Bounded, and small: this is a courtesy pause rather than a retry strategy.
    expect(slept).toEqual([1000, 2000]);
  });

  it("says github.com could not be reached when nothing answers at all", async () => {
    const fetchImpl: FetchLike = () => Promise.reject(new Error("The operation was aborted due to timeout"));
    const { client } = clientWith(fetchImpl);

    const filed = await client.createIssue({ title: "t", body: "b", labels: [] });

    expect(filed.ok).toBe(false);
    if (filed.ok) return;
    expect(filed.code).toBe("unreachable");
    expect(filed.status).toBeNull();
    expect(filed.message).toContain("could not be reached");
  });

  it("does not crash on something answering in front of GitHub", async () => {
    const { fetchImpl } = fake(() => ({ status: 200, body: "<html><body>proxy sign-in</body></html>" }));
    const { client } = clientWith(fetchImpl);

    const filed = await client.createIssue({ title: "t", body: "b", labels: [] });

    expect(filed.ok).toBe(false);
    if (filed.ok) return;
    expect(filed.code).toBe("malformed");
    expect(filed.message).toContain("in front of it");
  });
});

describe("checking the repository", () => {
  it("reports a private repository as ready, with the token's expiry", async () => {
    const { fetchImpl, sent } = fake((call) =>
      call.url.endsWith("/issues?per_page=1")
        ? { status: 200, body: [], headers: { "github-authentication-token-expiration": "2027-01-31 23:59:59 UTC" } }
        : { status: 200, body: { full_name: "acme/tasklet", private: true, visibility: "private", has_issues: true } },
    );
    const { client } = clientWith(fetchImpl);

    const check = await client.getRepo();

    expect(check).toEqual({ outcome: "ready", detail: null, visibility: "private", expiresAt: "2027-01-31T23:59:59.000Z" });
    // It asks the endpoint it would file to, because that is the one that answers 410.
    expect(sent.map((c) => c.url)).toEqual(["https://api.github.com/repos/acme/tasklet", "https://api.github.com/repos/acme/tasklet/issues?per_page=1"]);
  });

  it("reports a public repository as public, which is what decides whether an address may be published", async () => {
    const { fetchImpl } = fake((call) =>
      call.url.endsWith("/issues?per_page=1")
        ? { status: 200, body: [] }
        : { status: 200, body: { full_name: "acme/tasklet", private: false, visibility: "public", has_issues: true } },
    );
    const { client } = clientWith(fetchImpl);

    const check = await client.getRepo();

    expect(check.outcome).toBe("ready");
    expect(check.visibility).toBe("public");
    expect(check.expiresAt).toBeNull();
  });

  it("says the issue tracker is off from the repository's own payload, without asking twice", async () => {
    const { fetchImpl, sent } = fake(() => ({ status: 200, body: { full_name: "acme/tasklet", private: true, has_issues: false } }));
    const { client } = clientWith(fetchImpl);

    const check = await client.getRepo();

    expect(check.outcome).toBe("no-issues");
    expect(check.visibility).toBe("private");
    expect(sent).toHaveLength(1);
  });

  it("says the issue tracker is off when the issues endpoint is the thing that refuses", async () => {
    const { fetchImpl } = fake((call) =>
      call.url.endsWith("/issues?per_page=1")
        ? { status: 410, body: { message: "Issues are disabled for this repo" } }
        : { status: 200, body: { full_name: "acme/tasklet", private: true, has_issues: true } },
    );
    const { client } = clientWith(fetchImpl);

    const check = await client.getRepo();

    expect(check.outcome).toBe("no-issues");
    expect(check.visibility).toBe("private");
  });

  it("reports a repository this token cannot see as refused, and claims to know nothing about it", async () => {
    const { fetchImpl } = fake(() => ({ status: 404, body: { message: "Not Found" } }));
    const { client } = clientWith(fetchImpl);

    const check = await client.getRepo();

    expect(check.outcome).toBe("refused");
    // Nothing was learned about the repository, and `unknown` is the honest word for that: a check
    // that guessed `private` here would make an unchecked connection look safe.
    expect(check.visibility).toBe("unknown");
  });

  it("reports a network failure as unreachable rather than as a permission problem", async () => {
    const fetchImpl: FetchLike = () => Promise.reject(new Error("getaddrinfo ENOTFOUND api.github.com"));
    const { client } = clientWith(fetchImpl);

    const check = await client.getRepo();

    expect(check.outcome).toBe("unreachable");
    expect(check.detail).toContain("ENOTFOUND");
  });
});

describe("the token", () => {
  it("appears in nothing that comes back, however GitHub words its refusal", async () => {
    // Three ways a credential ends up in somebody else's error string: quoted verbatim, echoed as
    // the header it was sent in, and a recognisable token shape belonging to somebody else.
    const { fetchImpl } = fake(() => ({
      status: 403,
      body: {
        message: `The token ${TOKEN} may not do this. Sent as Authorization: Bearer ${TOKEN}. Try ghp_${"A".repeat(36)} instead.`,
      },
    }));
    const { client } = clientWith(fetchImpl);

    const filed = await client.createIssue({ title: "t", body: "b", labels: [] });
    const check = await client.getRepo();

    expect(filed.ok).toBe(false);
    if (filed.ok) return;
    expect(filed.message).not.toContain(TOKEN);
    expect(filed.message).toContain("[redacted");
    expect(check.detail).not.toBeNull();
    expect(check.detail ?? "").not.toContain(TOKEN);
    expect(check.detail ?? "").not.toContain(`ghp_${"A".repeat(36)}`);
  });

  it("is kept out of the NESTED errors as well, which is the other half of GitHub's error body", async () => {
    // A 422's `errors[]` is the half that says what to change, so it is quoted — which means it is
    // also a second way a credential gets out. It goes through the same funnel as the top-level
    // message, and the funnel is at the parse rather than at each use site so that the next thing
    // to quote an error cannot skip it.
    const { fetchImpl } = fake(() => ({
      status: 422,
      body: {
        message: "Validation Failed",
        errors: [
          { resource: "Issue", field: "body", code: "custom", message: `body is too long, and it quoted ${TOKEN} and ghp_${"B".repeat(36)}` },
          { resource: "Issue", field: "labels", code: "invalid" },
        ],
      },
    }));
    const { client } = clientWith(fetchImpl);

    const filed = await client.createIssue({ title: "t", body: "b", labels: ["nope"] });

    expect(filed.ok).toBe(false);
    if (filed.ok) return;
    // The useful half of a 422 is quoted...
    expect(filed.message).toContain("body: body is too long");
    expect(filed.message).toContain("labels: invalid");
    // ...and neither this token nor a recognisable one belonging to somebody else survives it.
    expect(filed.message).not.toContain(TOKEN);
    expect(filed.message).not.toContain(`ghp_${"B".repeat(36)}`);
    expect(filed.message).toContain("[redacted");
  });

  it("is kept out of a transport failure's words too, which is where the request itself gets quoted", async () => {
    const fetchImpl: FetchLike = () => Promise.reject(new Error(`request failed: POST /issues with Authorization: Bearer ${TOKEN}`));
    const { client } = clientWith(fetchImpl);

    const filed = await client.addComment(41, "hello");

    expect(filed.ok).toBe(false);
    if (filed.ok) return;
    expect(filed.message).not.toContain(TOKEN);
  });
});

/**
 * Three bounded retries per request is not a bound on a bulk publish: forty issues, each pausing
 * politely twice, is forty times the pause — and a publish sits in the serial job queue with
 * sweeps and target checks behind it. So the client carries one wall clock for its whole life, and
 * a caller with a list to get through can stop cleanly with what it filed.
 */
describe("the pass's wall clock", () => {
  it("stops going out once the budget is spent, and answers rate-limited rather than grinding", async () => {
    let clock = NOON;
    const { fetchImpl, sent } = fake(() => ({ status: 201, body: AN_ISSUE }));
    const { client, slept } = clientWith(fetchImpl, { clock: () => clock, budgetMs: 5_000 });

    const first = await client.createIssue({ title: "first", body: "b", labels: [] });
    expect(first.ok).toBe(true);
    expect(client.outOfTime()).toBeNull();

    // Time passes the way it passes in a throttled pass: one polite pause at a time.
    clock += 6_000;

    const stop = client.outOfTime();
    expect(stop).not.toBeNull();
    expect(stop?.code).toBe("rate-limited");
    expect(stop?.message).toContain("Whatever was filed before that is filed");

    const second = await client.createIssue({ title: "second", body: "b", labels: [] });

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe("rate-limited");
    expect(second.status).toBeNull();
    // The second create never went out: a spent pass stops dialling instead of retrying its way
    // through the rest of the list.
    expect(sent).toHaveLength(1);
    expect(slept).toEqual([]);
  });

  it("will not start a wait that outlasts the pass, and reports GitHub's own words when it does not", async () => {
    const { fetchImpl, sent } = fake(() => ({
      status: 429,
      body: { message: "You have exceeded a secondary rate limit" },
      headers: { "retry-after": "30" },
    }));
    const { client, slept } = clientWith(fetchImpl, { budgetMs: 5_000 });

    const filed = await client.createIssue({ title: "t", body: "b", labels: [] });

    expect(filed.ok).toBe(false);
    if (filed.ok) return;
    // GitHub's answer, not the budget's: it names the limit and the wait, which the budget cannot.
    expect(filed.code).toBe("rate-limited");
    expect(filed.message).toContain("30 seconds");
    expect(slept).toEqual([]);
    expect(sent).toHaveLength(1);
  });

  it("is unbounded only when a caller asks for that", async () => {
    const { fetchImpl } = fake(() => ({ status: 201, body: AN_ISSUE }));
    const { client } = clientWith(fetchImpl, { budgetMs: null });

    expect(client.timeLeftMs()).toBe(Number.POSITIVE_INFINITY);
    expect(client.outOfTime()).toBeNull();
    expect((await client.createIssue({ title: "t", body: "b", labels: [] })).ok).toBe(true);
    expect(client.outOfTime()).toBeNull();
  });

  it("starts the budget at the first call, not at construction", async () => {
    let clock = NOON;
    const { fetchImpl, sent } = fake(() => ({ status: 201, body: AN_ISSUE }));
    const { client } = clientWith(fetchImpl, { clock: () => clock, budgetMs: 5_000 });

    // A publish builds its client, then reads a connection and a whole study context before it
    // files anything. A budget that had been running through that would be a different budget
    // every time, depending on how slow the read model was.
    clock += 60_000;

    const filed = await client.createIssue({ title: "t", body: "b", labels: [] });

    expect(filed.ok).toBe(true);
    expect(sent).toHaveLength(1);
  });
});

/**
 * The most public copy populace produces goes out through this file, so the words ADR-0032 and
 * ADR-0042 keep off the wire are checked here as well as on the routes: a label description and a
 * failure sentence are both read by somebody who is not a populace user.
 */
describe("the words", () => {
  it("never writes agent, wake, simulation or lane in anything it sends or says", async () => {
    const { fetchImpl, sent } = fake((_call, calls) => (calls === 1 ? { status: 201, body: { name: "populace" } } : { status: 410, body: { message: "Issues are disabled for this repo" } }));
    const { client } = clientWith(fetchImpl);

    await client.ensureLabels(["populace"]);
    const filed = await client.createIssue({ title: "t", body: "b", labels: ["populace"] });
    const said = filed.ok ? "" : filed.message;

    const everything = [...sent.map((c) => `${c.url} ${c.body ?? ""}`), said].join("\n").toLowerCase();
    for (const word of ["agent", "wake", "simulation", "lane"]) expect(everything).not.toContain(word);
  });
});
