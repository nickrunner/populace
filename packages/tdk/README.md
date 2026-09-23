# Target Development Kit

`@populace/tdk` is the app-side half of populace. It mounts in your own server, and it exists so
that a population of AI agents can get accounts on your product without you building an
account-making API for them.

populace sends a population of strangers at your product through its MCP server. Every one of them
needs an account of their own — that is the premise: forty people who have never used your app,
each with their own data, their own history and their own way of getting lost in it. Arranging
that has, until now, meant one of three things, and all three push a whole mechanism onto you:

- **expose a sign-up tool over MCP**, which is often impossible — many servers authenticate at the
  transport, before dispatch, so there is nowhere to put an unauthenticated tool;
- **hand-make N accounts into a JSON pool file**, which has no renewal, so any token with an
  expiry (a Firebase ID token lasts an hour) is dead before the run finishes;
- **hand populace your vendor's admin credentials**, which is the one nobody should be
  comfortable with: a Firebase service account can mint a token for *any* uid, including your
  admins.

The irreducible work is tiny. populace cannot know how your app makes a user, so somebody has to
write that. **Everything else is generic** — the HTTP contract, the auth, the run tags, expiry and
renewal, teardown, listing by tag, the dev-only guard, the error shapes — and this package is all
of it.

## The whole thing

```ts
import { populaceProvisioning } from "@populace/tdk";

app.use("/populace", populaceProvisioning({
  secret: process.env.POPULACE_SECRET,
  async createPerson({ email, displayName, tag, attributes }) {
    const { uid } = await admin.auth().createUser({ email, displayName, password: … });
    await ensureAppUser(uid, email);          // the bit only you can write
    return { userId: uid, bearerToken: await idTokenFor(uid) };
  },
  async removePerson({ userId }) { await admin.auth().deleteUser(userId); },
}));
```

Point populace at `https://your-dev-app/populace` with that same secret and the population has
accounts.

## The ladder

Most people write less than that.

**Rung one — a preset, no functions at all.** A Firebase-backed product needs nothing but its
credentials. `firebase()` creates the user, tags it, exchanges the custom token for an ID token,
renews it, and deletes it again.

```ts
import { populaceProvisioning, firebase } from "@populace/tdk";

app.use("/populace", populaceProvisioning({
  secret: process.env.POPULACE_SECRET,
  backend: firebase({
    serviceAccount: process.env.GOOGLE_SERVICE_ACCOUNT_PATH,
    apiKey: process.env.FIREBASE_WEB_API_KEY,
  }),
}));
```

**Rung two — the preset plus one hook.** This is the common real case: a product whose API
resolves its callers against its own database, where a bare Firebase user is not yet a *user of
the product*. `afterCreate` writes that row, and it runs before populace is told the person
exists, so the account is usable the moment it is handed over. `beforeRemove` is the other half.

```ts
backend: firebase({
  serviceAccount, apiKey,
  async afterCreate({ userId, email, displayName, tag }) {
    await db.users.insert({ id: userId, email, name: displayName, source: tag });
  },
  async beforeRemove({ userId }) { await db.users.delete(userId); },
}),
```

**Rung three — your own functions.** Supabase, Clerk, a homegrown session, an internal service.
Implement `createPerson` and `removePerson` as in the snippet above, plus `refreshPerson` and
`listPeople` if you can. What you leave out is reported honestly at the handshake rather than
discovered as a 500 halfway through a sweep.

## Where it mounts

The core is a function from a request to a response and knows about no framework at all. What
`populaceProvisioning` returns is an Express middleware carrying the other shapes on it:

```ts
const kit = populaceProvisioning({ … });

app.use("/populace", kit);                       // Express, or a bare Node server
export const GET = kit.fetch;                    // Next route handler, Hono, Deno, Bun, Workers
export const POST = kit.fetch;
await kit.handle({ method, path, query, headers, body });   // in a test, with no port bound
```

Express strips its own mount path; a `fetch` handler never learns one, so pass `basePath` when you
mount it anywhere but the root:

```ts
// app/api/populace/[...tdk]/route.ts
const kit = populaceProvisioning({ …, basePath: "/api/populace" });
```

## The wire

Every request carries `Authorization: Bearer <secret>`, compared in constant time. All paths are
relative to the mount point; everything is JSON.

| Route | What |
| --- | --- |
| `GET /` | Handshake. `{ "tdk": 1, "environment": "development", "capabilities": { "refresh": true, "teardown": true, "listByTag": true } }` |
| `POST /people` | Provision one person. `{ tag, handle, email, displayName, password?, attributes }` → `201 { userId, bearerToken, expiresAt, refreshToken }` |
| `POST /people/refresh` | Renew an expiring bearer. `{ userId, refreshToken }` → `{ bearerToken, expiresAt, refreshToken }` |
| `POST /people/remove` | Teardown. `{ userId }` → `204`, whether or not it existed. |
| `GET /people?tag=…&cursor=…` | For a sweep whose local store is gone. → `{ people: [{ userId, email, displayName, tag }], nextCursor }` |

**`tdk` is the contract version**, an integer, starting at 1. It versions the kit rather than any
one of its jobs, so populace can say "your `@populace/tdk` is older than this populace expects"
instead of failing as a mystery. The signal goes both ways: populace sends
`X-Populace-Tdk-Expects: <integer>`, and a kit older than that answers "this populace speaks TDK
contract 2; this kit implements 1 — upgrade `@populace/tdk`" rather than a schema error about a
field it has never heard of. The header is optional — no header means the caller speaks this
contract — and the handshake answers regardless of it, because the handshake is how a version
disagreement gets diagnosed.

**`attributes` is what makes one person different from another.** Every other field on the way in
has the same shape for everybody — a handle, a name, an address, the run. The attributes are flat
key/values drawn from the persona populace invented this person from: a plan tier, a locale, a seat
count, whatever that persona was written with. It is what lets *half of these people are on the paid
plan* reach your database instead of staying a sentence in a prompt.

```ts
async createPerson({ email, displayName, attributes }) {
  const user = await db.users.create({
    email,
    name: displayName,
    plan: attributes.plan === "paid" ? "paid" : "free",   // one you recognise
  });
  return { userId: user.id, bearerToken: await sessionTokenFor(user.id) };
}
```

Three rules, and the third is the one that matters:

- **Read what you recognise, ignore the rest.** The bag is whatever a persona author typed. It is
  not namespaced and it is not a schema.
- **It defaults to `{}`**, so destructuring it is always safe, and a value the kit cannot use — a
  nested object, an array — is dropped from the bag rather than failing the person.
- **It is never an authorization input.** `attributes.admin` is a sentence somebody wrote about a
  fictional user, not a claim anyone checked. A product that reads one into a role has handed its
  test fixtures a privilege escalation.

**Removing a person takes the id in the body, not the path.** The id is your app's: a uuid, a
`user_2ab…`, and for plenty of products an email address or a URN. Those do not survive a path
reliably — percent-encoding round-trips differently through proxies, frameworks and routers, and
the failure is silent and looks like a person who was never there.

**The list is paged** with an opaque cursor, the same shape populace's own API uses for every list
it serves. Your `listPeople` returns everything for the tag and the kit pages it: what must not be
unbounded is the response crossing somebody else's network, and growing a cursor of your own to
satisfy that would put the kit's problem back in your hands.

**`password` is optional.** Passwordless vendors are ordinary now — Clerk's magic links,
Supabase's one-time codes — and a required field reads as one you have to honour. Use it if your
app has passwords; ignore it if it does not. (The Firebase preset generates one when populace
sends none, because a Firebase user without a password can only ever be signed in by an admin.)

**`capabilities` are honest.** A capability is reported `true` only when there is a function behind
it. An app that soft-deletes sets `capabilities: { teardown: false }`, and populace then reports
that the accounts it created must be removed by hand — which is exactly what it already does for a
self-signup target with no teardown tool. Asking for something reported `false` is answered
`unsupported`, not a crash. A declaration can only subtract: claiming a capability with no hook
behind it is a promise the kit cannot keep, so it is ignored.

**The tag identifies the run and must be round-trippable.** A sweep finds this run's accounts by it
and by nothing else. Store it wherever your app can — a Firebase custom claim, a column, the local
part of the email (populace puts it there too, so an app with nowhere else to put it still has it).

**Both fields go to `/people/refresh` every time.** Some vendors re-mint from the user id alone —
Firebase does — and others can only exchange a refresh token. Use whichever you have.

Every failure is `{ "error": { "code": …, "message": … } }` with the matching status:

| Code | Status | Means |
| --- | --- | --- |
| `unauthorized` | 401 | The secret was missing or wrong. |
| `bad_request` | 400 | The request was not one this kit serves, or not in a shape it understands. |
| `refused` | 403 | The app could have, and said no — the production guard, an email it will not accept. Change something and ask again. |
| `gone` | 404 | That **person** is not there any more. Provision a new one; do not keep renewing somebody who no longer exists. |
| `unsupported` | 501 | A capability the handshake already reported `false`. Asking again will never work. |
| `internal` | 500 | Something broke. |

The message is shown to a human verbatim in populace's UI, so write it in plain words that say
what to do. Throw `TdkError` from your own hooks to choose the code:

```ts
import { TdkError } from "@populace/tdk";
throw new TdkError("refused", "This target only makes accounts for @example.com addresses.");
```

`gone` thrown from `removePerson` is read as the outcome teardown wanted, so a vendor that refuses
to delete what is not there stays idempotent without you writing the catch.

## Three things this contract knowingly does not do

Recorded so the next reader does not re-litigate them.

**`expiresAt: null` means both "never expires" and "I do not know."** They are different, and
populace can only treat them the same. Splitting them here alone would put this contract out of
step with populace's own `Credential`, which carries exactly the same conflation — it is a change
to both halves or to neither.

**Nothing checks that the tag you were given is the tag you answer to.** The kit never sees your
storage, so it cannot: a tag dropped on the way in is discovered by a sweep that finds nothing.
That is an argument for the conformance check this kit will grow — an app running the contract
against itself, before a population is pointed at it — and not a hole in the wire.

**A capability is all-or-nothing.** An app that can delete its vendor's user but not its own row
has no way to say so halfway. The honest answer is `capabilities: { teardown: false }` and a note
in your own docs saying what is left behind.

## Security

This is the point of the package.

**populace holds a dev-scoped, revocable, single-purpose secret — never your vendor's admin
credentials.** The alternative it replaces is a Firebase service account, which can mint a token
for any uid on your project, including your own. What this secret can do is exactly what you wrote
into `createPerson` and `removePerson`, on the deployment you mounted it in, and nothing else.
Rotate it by changing one environment variable.

**It is dev-only by default.** When the environment is production — `NODE_ENV`, or whatever you
pass as `environment` — the kit refuses every request, including the handshake, and says so at
mount time. A test-user factory reachable in production is the failure mode this package must not
have. `allowProduction: true` overrides it, and announces itself just as loudly.

**It will not start without a secret.** `secret: process.env.POPULACE_SECRET` with the variable
unset would otherwise mount an account factory that anyone can call, so an empty secret throws at
mount rather than serving.

**Nothing it says can carry a credential.** Error messages are scrubbed of the secret and of
anything shaped like a bearer token on the way out — a vendor SDK that helpfully quotes the request
it just made is the usual way one would otherwise end up in a screenshot — and they are one line,
never a stack trace.

**Give it its own deployment if you can.** A dev or staging environment with its own database is
where a population belongs; the accounts it makes are real accounts, and the mess they make is
real mess. That is the product working.
