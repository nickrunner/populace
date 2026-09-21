import { useQuery } from "@tanstack/react-query";
import { q } from "../queries.js";
import { useSimulation } from "../context.jsx";
import { inTheirWords } from "../format.js";
import {
  Card,
  DocumentPage,
  Dot,
  Heading,
  Inline,
  Ledger,
  LedgerRow,
  Link,
  PageHeader,
  PersonQuoteCard,
  Skeleton,
  Stack,
  StateBlock,
  Text,
  type StateKind,
} from "../design/index.js";

/**
 * Who walked away, and whether they said they would come back. The second half is what the
 * fix-validation loop runs on: a carry-forward only brings back the people who said they would
 * return (ADR-0020), so this screen is where that promise is recorded.
 *
 * It says their names. The copy here used to read "said she would come back if it were fixed" —
 * one gendered pronoun standing in for a whole population, which was wrong about most of them
 * and told the reader nothing. A person who leaves is the one thing worth naming on this screen.
 *
 * **A document-class screen** (DESIGN-SYSTEM §5.3): a reading column, the ledger stub down its
 * left edge, and the four query moments in the template's state slots rather than in branches
 * around the layout — so the header stays mounted and the screen never collapses to a line and
 * jumps back when the roster lands.
 *
 * **The stub holds the mark's own word for what this screen is about** (§8.6): a filled
 * `ink-muted` circle is *a person who walked away*, and the column of them down the page is the
 * departure itself, drawn. It carries no text and no state of its own — the title names the
 * screen and every row says in words what it is — so it is `aria-hidden` rather than announcing
 * "walked away" once per row to a reader who has already been told.
 *
 * **The quote is `PersonQuoteCard`, not markup.** `t-voice` is the system's only italic and it
 * belongs to a verbatim line somebody wrote (§4.7); the card carries the words, the name, the
 * cohort and the visit, which is every fact this screen used to spell out by hand beneath a
 * hand-rolled blockquote that `FindingInFull` spelled a second way.
 *
 * **The words are always shown, whether or not the roster knows who said them.** Findings and
 * the roster are two requests about one execution and they can disagree — a swept roster, a
 * carried-forward finding — and the port made the quote conditional on the lookup succeeding, so
 * such a row collapsed to a title and one sentence: the one thing this screen exists to print,
 * gone, in the one case where the reader has least else to go on. `Unattributed` is that case
 * drawn honestly: the same card's frame and the same voice, with no name, no cohort and no visit
 * invented to fill `PersonQuoteCard`'s attribution. **The persona slug is never the fallback**
 * (§7.4) — "casual-lister did not say whether they would come back" names a template where a
 * person is missing, which is the opposite of what this screen is for.
 */
export function WhoLeft({ runId }: { runId: string }) {
  const { href } = useSimulation();
  const findings = useQuery(q.findings(runId, "?kind=abandonment"));
  const participants = useQuery(q.participants(runId));

  // Both: the roster is a second request, and waiting on one that has already failed shows
  // "Reading who left…" for ever with nothing to say why.
  const failed = findings.isError || participants.isError;
  const findingData = findings.data;
  const participantData = participants.data;
  const waiting = findingData === undefined || participantData === undefined;

  const left = findingData?.items ?? [];
  const roster = participantData?.items ?? [];

  const state: StateKind | undefined = failed
    ? "failed"
    : waiting
      ? "loading"
      : left.length === 0
        ? "empty"
        : undefined;

  return (
    <DocumentPage
      header={
        <PageHeader
          title="Who walked away"
          lede="The people who stopped coming back, what it was over, and whether they said a fix would bring them back."
        />
      }
      state={state}
      loading={
        // A skeleton at the height of the rows it replaces, like the other sixteen screens: a
        // bare spinner here collapses the page to a line and jumps it back when the roster lands.
        <StateBlock
          kind="loading"
          what="who left"
          skeleton={<Skeleton variant="row" count={3} height={140} label="Reading who left" />}
        />
      }
      error={
        <StateBlock kind="failed" what="who left" error={findings.error ?? participants.error} />
      }
      empty={
        <StateBlock kind="empty" what="who left">
          Nobody has walked away. Everyone we sent is still coming back.
        </StateBlock>
      }
    >
      <Ledger>
        {left.map((finding) => {
          const person = roster.find((candidate) => candidate.id === finding.agentId);
          // The subject of the sentence below. A person on the roster is named; a person who is
          // not is "they", which is true of everybody and names nothing that is not a person.
          const who = person === undefined ? "They" : (person.name.split(/\s+/)[0] ?? person.name);

          return (
            <LedgerRow key={finding.id} stub={<Dot state="left" size="md" className="md:ml-auto" />}>
              <Stack gap={3}>
                <Heading level={2} size="finding">
                  {finding.title}
                </Heading>

                {person === undefined ? (
                  <Unattributed words={inTheirWords(finding)} />
                ) : (
                  <PersonQuoteCard
                    name={person.name}
                    words={inTheirWords(finding)}
                    cohort={person.cohortName || person.cohortSlug}
                    visit={person.visits}
                    to={href(`people/${encodeURIComponent(person.id)}`)}
                  />
                )}

                <Inline gap={4} align="baseline" wrap>
                  {/* Not `confirmed`: a judge replaying a finding is what that token means, and
                      §4.1 forbids it as a generic "good". Somebody saying a fix would bring them
                      back is the notable half of this sentence, so it takes full `ink` against
                      the `muted` of the other two — emphasis by ink against ink-soft (§4.7). */}
                  <Text size="ui" tone={person?.wouldReturn === true ? "ink" : "muted"}>
                    {person?.wouldReturn === true
                      ? `${who} said a fix would bring them back`
                      : person?.wouldReturn === false
                        ? `${who} said nothing would bring them back`
                        : `${who} did not say whether they would come back`}
                  </Text>
                  <Link size="ui" to={href(`visits/${encodeURIComponent(finding.wakeId)}`)}>
                    watch the visit they left on
                  </Link>
                </Inline>
              </Stack>
            </LedgerRow>
          );
        })}
      </Ledger>
    </DocumentPage>
  );
}

/**
 * The words, with nobody to put them to.
 *
 * `PersonQuoteCard` asks for a name, a cohort and a visit because a quote in this product is
 * normally somebody's, and none of those three may be guessed: a name would be invented, and a
 * visit number would be a figure the reader could read off the page and believe. So the one case
 * where the roster has no row for the person who filed gets the card's own frame and the same
 * `t-voice` step, and says plainly why there is no name under it — which is more than the
 * pre-port screen managed, since it printed the persona slug there (§7.4).
 */
function Unattributed({ words }: { words: string }) {
  return (
    <Card>
      <figure>
        <blockquote>
          <Text size="voice" tone="ink" as="p">
            {"\u201C"}
            {words}
            {"\u201D"}
          </Text>
        </blockquote>
        <Text size="meta" tone="muted" as="figcaption" className="mt-3 block">
          Said by somebody this execution&rsquo;s roster no longer lists.
        </Text>
      </figure>
    </Card>
  );
}
