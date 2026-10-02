# Filing problems as GitHub issues

This is for somebody who has a study finding things and wants those things to turn up in their
issue tracker instead of only in populace.

What it does: a problem that survived the digest becomes a GitHub issue whose body is the fix
prompt — the whole reproduction call by call, who was trying to do what, the verdict, with
credential-shaped values removed. The same problem is never filed twice; when it shows up again
the existing issue gets a comment, and when it stops showing up the issue is told that too, as an
absence rather than as a repair.

## The token

populace needs a token that can open an issue in one repository and do nothing else. Make a
**fine-grained personal access token**:

1. Go to **<https://github.com/settings/personal-access-tokens/new>**.
2. **Resource owner** — pick yourself, or the organisation that owns the repository. This matters;
   see *If the repository belongs to an organisation* below.
3. **Expiration** — your call. populace reads the expiry back and says on the Settings screen when
   a token is near it, so a token that dies does not look like a target that stopped misbehaving.
4. **Repository access** — choose **Only select repositories** and select the one repository. Not
   "All repositories": the whole point of a fine-grained token here is that it reaches one repo.
5. **Permissions → Repository permissions → Issues** — set it to **Read and write**.
   GitHub will add **Metadata: Read-only** by itself and will not let you remove it; that is normal
   and is the minimum any repository permission carries.
6. Generate it, and copy it. GitHub shows it once.

Then, in populace: **Settings → Filing problems as GitHub issues**, type the repository as
`owner/name`, paste the token, and press **Check this repository**. The check asks github.com
whether that token can open an issue there and reports what it said. It files nothing.

Nothing else needs to be granted. populace reads the repository (to learn whether it is private),
creates issues, comments on them, reopens one that has been closed, and creates the labels it uses.
It does not read your code, your pull requests or your actions.

> A classic token with the `repo` scope also works, if that is all you can make. It is a much
> broader credential — `repo` reaches code, not just issues, on every repository you can push to —
> so prefer the fine-grained one where you have the choice.

### The token goes up and never comes back down

Once stored, populace will not show it to you again — not on a reload, not on this screen, not in
any API response. What you see afterwards is "a token is stored". To change it, paste a new one; to
remove it, use **Forget this connection**. It is never written into a config snapshot, a trace, an
event or a log line, and it never reaches the people a study sends: they get their own accounts on
your product, which is a different credential entirely (see [setting up a target](TARGET-SETUP.md)).

### If the repository belongs to an organisation

Two things catch people here, and both look like a bad token:

- The organisation has to **allow fine-grained personal access tokens** at all. Some have them
  switched off.
- Depending on the organisation's settings, your token may need **an owner to approve it** before it
  works. Until then it exists and is refused.

If the Check says the token was refused on a repository you can plainly open in a browser, this is
usually why.

## What ends up in the issue

Worth knowing before you point this at a repository other people read.

The body carries: the problem in the reporter's own words, the exact tool calls and what came back,
which cohorts were hit and how far, the product's own description, and the brief each hit cohort was
given. Credential-shaped values are replaced in place with a marker and the body says how many went.

**On a repository populace cannot confirm is private, it reduces every address you configured to its
bare host** and says so in the body. It fails safe: a repository it has not checked, or has just been
re-pointed at, is treated as public for that decision.

**It does not scrub the product's own replies.** Those are quoted as they came back, so any address,
identifier or internal name your product printed is in the issue in full. If that is a problem, file
to a private repository.

## Filing by itself

`Filing by itself` on the same screen turns on automatic filing. What happens then depends on the
kind of study, and the difference is not cosmetic:

- An **ephemeral** study files when an execution finishes.
- A **longitudinal** study never finishes, so it files on a **report cycle** — every so often, or
  every so many visits, whichever comes first. That rhythm is the dial on how often populace writes
  to your tracker, and it is set per study on the study's own screen.

Two things to decide before you switch it on.

**The judge costs money, and automatic filing runs one every cycle.** Filing itself spends nothing —
it opens no model call and does not touch your product. But a cycle builds a digest first, and the
digest's default judge is the strongest model at high effort, on up to fifty problems a pass. On the
price list's own arithmetic that is order of $3 a cycle, for as long as the study runs. The Settings
screen states the figure for each judge beside the choice; the mechanical judge is free and the typed
one is around a penny a cycle. Pick deliberately rather than leaving the default on an unattended
study.

**Automatic filing and auto-sweep fight each other on an ephemeral study.** Auto-sweep takes the
population's accounts down as soon as the execution ends. The reports survive, so filing still works
— but re-checking a report means calling your product again *as the person who filed it*, and that
account is gone. So every issue filed that way carries a verdict that can never be checked. Turn
auto-sweep off for a study that files, or accept that its verdicts are permanently unverifiable.
The Settings screen warns when both are on.

## Reading the comments

An issue populace filed is a record it keeps current. Three things it will say:

- **Reported again** — people hit it again in a later window, with this window's count and the
  running total stated separately.
- **Gone quiet** — nobody reported it in the window just read. It says how many of the people who
  hit it are still visiting, how many have been back since, and how many walked away over it and
  have not been brought back. It says this **once**, not every cycle.
- **Back** — it went quiet and then returned. That is the one populace calls a regression, because
  it is a sequence populace watched: present, gone, present.

None of these says anything was fixed. populace cannot know that — a problem that stops appearing
may be repaired, or may have been described in different words by somebody who hit it just as hard
(the measured recurrence of a reworded complaint is 0%, which is why an absence is only ever
reported as an absence). Whether it is fixed is your call, and the triage control on the problem's
own page is where you say so.

populace never closes an issue it filed.

## Handing an issue to a Claude integration

If you have something watching the repository that picks up work from issues — Claude on GitHub, a
webhook of your own, anything that reacts to an issue being labelled — populace can hand each
problem it files straight to it.

**The trigger is a label.** populace applies the labels you configure to every issue it opens, so
whichever label your integration watches is the one that hands the problem over. This is the
recommended path and it needs nothing else to work.

**populace does not write an `@claude` mention, and that is on purpose.** A mention is the trigger
belonging to the Claude GitHub Actions product, and on a repository that does not have that product
installed it does nothing at all — the line sits in the body and nobody reads it. A label is a
trigger anything can watch, that product included. So if you came here looking for the mention: it
is not missing, it is not the mechanism.

### Setting it

On **Settings → Filing problems as GitHub issues**, beside the labels every issue carries, is the
field for the hand-off label. Type the one label your integration is configured to watch, spelled
the way the integration spells it — whatever you set on its side. Leave it empty and nothing is
handed over; the issues still carry their ordinary labels.

populace creates the label on the repository if it is not there yet. It has to: github.com refuses
an issue outright if it names a label the repository has never heard of, so the definition goes in
before the issue does.

### What it means in practice

Worth reading before you switch it on, because the arithmetic is the whole of it: **every problem
populace files is handed immediately to something that may open a pull request.** One problem, one
hand-off, one more pull request to read.

With `Filing by itself` on, that happens at whatever rate the study finds things — a report cycle
that files six problems hands over six problems. So the report cycle is the dial here too, the same
one described above, and it is worth setting deliberately rather than leaving an unattended study on
a short one. The step that keeps the rest of it sane is a human reading and approving the pull
request: nothing populace does, and nothing the hand-off starts, merges anything.

### Once when it files, and again only when it comes back

populace hands a problem over **once**, when it files it. After that it hands the same problem over
again only when the problem **comes back** — the **back** comment above: reported, gone quiet,
reported again. That sequence is the one case worth a second look, because something in between
plainly did not hold.

Because the trigger is the label being *added*, and by then the label is already on the issue,
populace removes it and adds it again so the trigger fires. Nothing else about the issue changes,
and it does this once per coming-back, not on every pass.

It does **not** hand a problem over again on a **reported again** comment: the problem never went
away, the hand-off already happened, and the count is the only thing that is new.

And it never hands one over on a **gone quiet** comment. That is the one that matters. A problem
nobody has reported lately is the last thing to send anybody off to change — populace does not know
why it stopped, only that it stopped, and asking for a change on the strength of an absence is
worse than doing nothing.
