# Setting up a target

This is for somebody pointing populace at their own product for the first time.

populace sends a population of AI people at your app through its MCP server. They behave like
prospective users: they discover the product through its tools, try to get their own errands done,
come back on a schedule, and file what went wrong. For that to be a simulation of anything, they
have to be **strangers with accounts of their own** — forty people, forty accounts, forty separate
piles of data.

So there are two credentials in this setup, they are different things, and mixing them up is the
single most common confusion here:

| | Whose | What it is for |
| --- | --- | --- |
| **Connecting** | Yours | populace reads your tool list as you, once, to see what is there. One human, one sign-in. |
| **Getting accounts** | Theirs | Each of the people a simulation sends gets their own account on your product. |

Connecting is settled and mostly automatic: if your MCP server refuses anonymous callers and
publishes OAuth metadata, press **Sign in** on the Connect screen and populace does the rest. If it
is gated by a static token instead, there is a field for it beside the address.

**This page is about the other one.**

---

## Which of the three are you?

### 1. Your MCP server has no user accounts

A documentation server, a search index, an internal read-only tool — anything whose MCP surface is
a library rather than an account. Everyone who visits sees the same thing.

Choose **They don't need one**. There is nothing else to configure. Nobody is signed up, nothing is
created on your product, and there is nothing to clean up afterwards.

If the *address* needs a token — a QA gateway, an internal proxy — put it in **A token this
address needs** beside the MCP address. Every person will use it. That is a property of the door,
not of the people.

This is also the right answer for a first look. If you want to see what populace does before
asking anybody to merge code into your product, point it at a read-only surface and send a
population in. They will find discoverability and usability problems without ever needing an
account.

### 2. Your MCP server has a sign-up tool

If your tool list has something like `sign_up` or `register` that anyone can call, choose **They
sign themselves up** and name it. populace fills in the rest from the tool list — where the token
comes back, where the account id comes back, which tool deletes an account — and the Connect screen
shows you its guesses so you can correct them.

This is the only way in where populace holds no credential of yours at all: it gets in the way any
stranger could. That is a real advantage.

It has one real cost, and it is on your side of the wire: an account-making tool on a machine-facing
surface bypasses whatever anti-abuse your human sign-up form accumulated, because nothing there can
do a captcha. Many servers also authenticate at the transport, before dispatch — the server
instance is built *from* the resolved caller — and there is nowhere to put an anonymous tool
without inverting how the server is built.

### 3. Your product makes users some other way — this is most products

Your accounts are made by a sign-up form, an invite flow, a vendor SDK, an admin API. None of that
is on your MCP surface and none of it should be.

Choose **My app makes them**. This is the recommended way in, and the rest of this page is it.

---

## The recommended way: mount `@populace/tdk`

You mount one route in your own app. populace calls it with one shared secret and holds nothing
else — no vendor admin credentials, no service account, no list of real logins.

```
npm i @populace/tdk
```

### The fifteen lines

```ts
import { populaceProvisioning } from "@populace/tdk";

app.use("/populace", populaceProvisioning({
  secret: process.env.POPULACE_SECRET,
  async createPerson({ email, displayName, password }) {
    // Create the user in your system here, however you already do it,
    // then return their id and a token they can call your MCP server with.
    return { userId, bearerToken };
  },
  async refreshPerson({ userId }) {
    // Mint a fresh token for a user you already made.
    return { bearerToken };
  },
  async removePerson({ userId }) {
    // Delete the user. A sweep may call this twice, so make it safe to repeat.
  },
}));
```

The three comments are the whole of your work: making a user, giving them a session, and taking
them away again, however your product already does those. Everything else is the package: the HTTP contract, the constant-time
secret check, the run tags, expiry and renewal, idempotent teardown, listing by tag, the dev-only
guard, the error shapes.

Only `createPerson` is required. `refreshPerson` and `removePerson` are optional, and the handshake
reports honestly which of them you wrote — see below for what each one being absent costs.

### Where those arguments come from

Nothing in `createPerson`'s argument comes from your app. **populace invented the person** — before
any of this, it wrote a roster of people with names and handles, and every field below is that
person or the run they belong to.

| field | what it is | example |
| --- | --- | --- |
| `handle` | the person's stable name for the whole run, minted once when their row was written and frozen | `marta-2` |
| `displayName` | the person's actual name. This is what a screenshot of your product will show | `Marta Bergström` |
| `email` | `handle` + the run id + the email domain set on the target | `marta-2+run_m8x_4k2p@populace.test` |
| `tag` | the run itself | `populace:run_m8x_4k2p` |
| `password` | derived from the run and the person, so the same person re-provisioned gets the same one | `Pw-1f3k9x-marta-2` |

Two of those are worth a sentence more.

**`tag` is the only way home.** A sweep whose local rows are gone finds this run's accounts by
asking your endpoint for everything carrying that tag. Store it wherever you can — a column, a
custom claim, a metadata field. If you have nowhere at all, it is in the email address too, which
is why the address is shaped the way it is.

**`password` is optional and may be meaningless to you.** Passwordless products are ordinary now;
if yours has no passwords, ignore it.

### What if my product needs fields populace does not send?

Two answers, depending on whether the value differs between people.

**The same for everybody: write it in your own function.** `createPerson` is your code, so an
accepted-terms flag or a fixed locale is just something you pass to your own create call.

**Different per person: that is what `attributes` is for.** populace sends a sixth field — flat
key/values drawn from the persona this person was invented from, already merged with whatever the
cohort set and whatever was set on the person by hand.

```ts
async createPerson({ email, displayName, attributes }) {
  const user = await db.users.create({
    email,
    name: displayName,
    plan: attributes.plan === "paid" ? "paid" : "free",
    seats: typeof attributes.seats === "number" ? attributes.seats : 1,
  });
  return { userId: user.id, bearerToken: await sessionTokenFor(user.id) };
}
```

Those keys come from the persona's traits, so *half of these people are on the paid plan* becomes a
trait distribution you write once and populace samples per person — instead of a sentence in a
prompt that your database never sees.

Three rules:

- **Read what you recognise and ignore the rest.** The bag is whatever a persona author typed. It
  is not namespaced, and populace does not police it against your schema.
- **It is always present**, defaulting to `{}`, so destructuring is safe. A value the kit cannot
  use is dropped from the bag rather than failing the person.
- **It is never an authorization input.** `attributes.admin` is a sentence somebody wrote about a
  fictional user, not a claim anybody checked. Reading one into a role hands your test fixtures a
  privilege escalation.

Attributes need `@populace/tdk` **0.2.0 or later**. An older kit ignores them and every person
arrives the same, which is the behaviour you had before.

### How a person stays signed in

The question the fifteen lines above leave open: a token with an hour on it, and a population that
runs for days.

`createPerson` returns four things, and only the first two are required:

```ts
return {
  userId: user.id,                          // required — how populace names this person from now on
  bearerToken: await sessionTokenFor(user.id), // required — what goes in Authorization: Bearer
  expiresAt: session.expiresAt,             // when it dies. null means "it does not"
  refreshToken: session.refreshToken,       // whatever YOU need to mint the next one. null if nothing
};
```

`expiresAt` is what drives everything else. Before each visit, populace checks the bearer it holds:
if it has expired, or expires within the next **ten minutes**, it calls `refreshPerson` *before*
connecting — off the tool-dispatch path, so a renewal never appears in the person's transcript.

```ts
async refreshPerson({ userId, refreshToken }) {
  return { bearerToken: await sessionTokenFor(userId), expiresAt: null, refreshToken };
}
```

**Both arguments are sent every time, on purpose.** Some products can mint a fresh session from the
user id alone — Firebase can, `createCustomToken` needs nothing from the old one — and others can
only redeem a refresh token. Use whichever you have; ignore the other.

**Leaving `refreshPerson` out is allowed and is sometimes right.** The handshake then reports
`refresh: false`, populace knows not to try, and every person's session must outlive the whole run.
That is fine for a product whose sessions last a month. It is not fine for anything issuing
hour-long tokens: those people will be refused partway through, and their visits end as auth
failures.

**`expiresAt: null` means "never renew".** If your tokens do expire and you return `null`, nothing
will call `refreshPerson` and the failure arrives mid-run looking like your product broke.

### Where it mounts

The kit's core is a function from a request to a response and knows about no framework. What
`populaceProvisioning` returns is an Express middleware carrying the other shapes on it.

**Express, or a bare Node server:**

```ts
app.use("/populace", kit);
```

**A Next.js route handler** — a `fetch` handler is never told where it was mounted, so tell the
kit:

```ts
// app/api/populace/[...tdk]/route.ts
const kit = populaceProvisioning({ basePath: "/api/populace", secret: …, createPerson, removePerson });
export const GET = kit.fetch;
export const POST = kit.fetch;
```

**Hono, Cloudflare Workers, Deno, Bun:**

```ts
const kit = populaceProvisioning({ basePath: "/populace", secret: …, createPerson, removePerson });
app.all("/populace", (c) => kit.fetch(c.req.raw));
app.all("/populace/*", (c) => kit.fetch(c.req.raw));
```

**In a test, with no port bound:**

```ts
await kit.handle({ method, path, query, headers, body });
```

### If your product is Firebase-backed, you write even less

`firebase()` creates the user, tags it, exchanges the custom token for an ID token, renews it and
deletes it again:

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

If your API resolves its callers against your own database — a Firebase user is not yet a *user of
your product* — add the one hook that writes that row. It runs before populace is told the person
exists, so the account is usable the moment it is handed over:

```ts
backend: firebase({
  serviceAccount, apiKey,
  async afterCreate({ userId, email, displayName, tag }) {
    await db.users.insert({ id: userId, email, name: displayName, source: tag });
  },
  async beforeRemove({ userId }) { await db.users.delete(userId); },
}),
```

### The secret

populace generates one for you when you choose **My app makes them**, puts it in the form, and
prints it in the snippet. Copy it into your app's environment as `POPULACE_SECRET`. It is yours
from that moment; rotate it by changing those two places.

It is worth being precise about what it can do, because that is the argument for this way in. It is
**dev-scoped, revocable and single-purpose**: it can do exactly what you wrote into `createPerson`
and `removePerson`, on the deployment you mounted the kit in, and nothing else. The alternative it
replaces is a Firebase service account, which can mint a token for any uid on your project
including your own admins, kept in a SQLite file on somebody's laptop.

The kit **refuses every request in production by default**, including the handshake, and says so at
mount time. Give it its own dev or staging deployment with its own database if you can: the
accounts a population makes are real accounts and the mess they make is real mess. That is the
product working.

### Press "Check this endpoint"

Beside the two fields there is a button that asks your endpoint what it can do. It is a `GET` at
your mount point: it creates nobody, registers nothing and lists nothing, which is why it is safe
to offer before anything is saved.

It answers with one of four things:

- **Answered.** It tells you which contract version your kit speaks, which environment it says it
  is running in, and what you implemented — whether it can renew a session, remove an account and
  list them again. A capability is reported `true` only when there is a function behind it, so
  this is where you find out that you left `removePerson` out.
- **The secret is not the one it expects.** The address is right; `POPULACE_SECRET` in your app
  and the field on this screen are not the same string.
- **Nothing answered.** The address is wrong or the app is not running.
- **Something answered, but not as `@populace/tdk`.** Usually the address is a route *under* the
  mount rather than the mount itself.

---

## What to check when it does not work

**Nothing answered at all.** The address is the kit's **mount point** — the base, not a route under
it. If you wrote `app.use("/populace", kit)` on `https://dev.example.com`, the address is
`https://dev.example.com/populace`. Not `/populace/people`.

**`unauthorized`.** The secret in the form and `POPULACE_SECRET` in your app are different. Check
for a trailing newline in your env file; that is the usual one.

**Everything refuses, including the handshake.** The kit thinks it is in production. It reads
`NODE_ENV` unless you pass `environment` yourself. `allowProduction: true` overrides it and
announces itself loudly at mount — think about whether you want a test-user factory reachable there
at all.

**"This populace speaks TDK contract 2; this kit implements 1."** Upgrade `@populace/tdk` in your
app.

**The account is made, and the target refuses its token.** This is the one first contact exists to
catch, and it is not a populace problem — the bearer your `createPerson` returns is not one your
product's own API verifies. Usually it means the endpoint is pointed at a different environment
than the MCP address above, or that you are handing back a vendor token where your API expects a
session of your own.

**A sweep finds nothing.** The tag was dropped on the way in. populace finds a run's accounts by
`tag` and by nothing else, so store it wherever your app can — a column, a custom claim, the local
part of the email (populace puts it there too, for an app with nowhere else). Nothing in the kit
can check this for you, because the kit never sees your storage.

**Your app soft-deletes.** Set `capabilities: { teardown: false }`. populace will then report the
accounts it left behind, by name, instead of counting a no-op as a removal — and it will keep the
run's records, because they are the only remaining account of which accounts those were. A
declaration can only subtract: claiming a capability with no hook behind it is ignored.

---

## Then: one person through the front door

Once the target is saved, press **Can anybody actually get in?**. It provisions one account through
whatever way in you chose, makes one read-only call with it, and takes the account back down. It
calls no model, so it costs nothing, and it is the difference between finding out now and finding
out after forty people have been cast.

It answers in six words and each one sends you somewhere different: *accepted*, *connected-only*,
*tool-failed*, *rejected*, *provision-failed*, *unreachable*. Whatever it finds, it tells you
whether anything was left on your product.

---

## The two ways out, when you cannot change the app

Behind **Other ways** on the same screen. Both are real, both are for somebody who cannot deploy
code into the product, and both cost something the three above do not.

**Accounts I already have** — a JSON file of logins, one entry per person, keyed by cohort.
Nothing is created and nothing is removed afterwards. populace **cannot renew any of them**: there
is nothing in a pool file that says how to get a fresh token, so anything with an expiry (a
Firebase ID token lasts an hour) will be refused part-way through and those people stop there.
populace refuses to start a run whose pool is already dead, and says which entries.

**Minted with a Firebase service account** — populace holds a key that can `createCustomToken` for
*any* uid on your project, including an admin's, in a SQLite file on this machine. It is the only
option that needs no change to your app at all, which is a real capability for an evaluator or a
contractor. If you can add a dependency to your app, `@populace/tdk`'s `firebase()` preset does the
same job and the service account stays yours.

---

## A note on what to expect

Outcomes vary between executions by design. There is no determinism subsystem and nothing here
promises identical results: the same population pointed at the same product twice will not find
exactly the same things, and a problem absent from the newest execution is reported as an absence,
never as a fix. That is a property of sending forty different people into a product, and it is the
point.
