/** The config written by `populace init`: points at the mock target with three personas. */
export function configTemplate(mockTargetUrl: string): string {
  return `# populace configuration. Validate with: populace validate
version: 2

target:
  name: Tasklet
  mcp:
    - name: default
      url: ${mockTargetUrl}/mcp
      # bearerToken: my-gateway-token   # static token for gateways; identities override it. Environment variables can be referenced with \${...} syntax.
  webBaseUrl: ${mockTargetUrl}
  # How an ephemeral execution puts the target back before its first visit. Without one, ephemeral
  # means fresh people, memory and accounts only — the target keeps whatever the last lot left.
  # reset:
  #   kind: http                 # none | tool | http
  #   url: ${mockTargetUrl}/admin/reset
  #   method: POST
  #   headers: { x-admin-token: admin }
  description: >-
    Tasklet keeps your projects and tasks in one place. Create projects, add tasks
    with due dates and priorities, search everything instantly, comment on tasks,
    and tick them off. Free for up to 3 projects; Pro is $6/month.
  # What ANYBODY sent here may touch, whatever persona they wear. A persona's own \`tools\` block is
  # merged onto this one: deny wins and allow intersects, so a persona can only ever narrow this
  # and never widen it. Put the tools nobody should reach here rather than on every persona —
  # a persona added later would otherwise inherit the whole surface.
  tools:
    allow: []                  # globs; empty means everything the target exposes
    deny: []                   # globs; always wins over allow
    destructive: confirm       # allow | confirm | deny, for tools annotated destructiveHint

identity:
  strategy: self-signup        # self-signup | static | admin-mint
  signupTool: sign_up
  tokenPath: token
  userIdPath: user.id
  teardownTool: delete_account
  emailDomain: populace.test

# What the agents run. A persona can override model/effort/maxTokens for itself.
model:
  model: claude-sonnet-5
  effort: medium               # low | medium | high | xhigh | max
  maxTokens: 16000
  fallbacks: true              # server-side refusal fallbacks

guardrails:
  perWake: { maxTokens: 400000, maxUsd: 3, maxTurns: 40 }
  dailyUsd: 50
  webFetch: true

store:
  kind: sqlite
  path: .populace/populace.sqlite

daemon:
  tick: 5s
  concurrency: 2

verifier:
  judge: model                 # model | heuristic
  maxFindings: 50
  # The judge decides what reaches the digest, so it runs stronger than the agents it judges.
  model: { model: claude-opus-5, effort: high }

digestDir: digests

# Who exists. A COHORT is people who share a condition (its context, which every one of them is
# told) drawn from one persona or a MIX of them in a ratio; size is how many of them this
# population sends, split across the mix. There is no scale factor.
population:
  id: tasklet-trial
  name: Everyone

# What to run. A simulation is the population against the target, in one of two modes:
#   ephemeral    - clean slate every execution, bounded by visitsPerPerson, ends on its own
#   longitudinal - memory, accounts and visits accumulate; paused and resumed rather than re-run
simulations:
  - slug: trial
    name: Tasklet trial
    mode: ephemeral
    visitsPerPerson: 4         # required for ephemeral; omit it for longitudinal
    cadence: { every: 2m, jitter: 30s }
    seed: populace
    autoSweep: true            # delete the accounts this execution created when it ends

cohorts:
  - slug: casual-listers
    name: Casual listers
    context: You keep your lists on your phone, in the gaps between other things.
    size: 1
    persona:
      id: casual-lister
      name: Casual lister
      role: a hobbyist who keeps grocery and chore lists on their phone
      backstory: >-
        They have bounced between three list apps this year. They want something calm,
        fast and free, and they leave the moment an app feels like work.
      goals:
        - Keep one grocery list and one chores list going
        - Find things again quickly by searching
      constraints:
        - Will not pay for a list app
      patience: 2
      budgetUsd: 0
      traits:
        device: { distribution: choice, values: [phone, laptop], weights: [3, 1] }
  - slug: project-planners
    name: Project planners
    context: You are trying this in the middle of a working week, with client dates you will be held to.
    size: 1
    persona:
      id: project-planner
      name: Project planner
      role: a freelance designer who plans client projects with deadlines
      backstory: >-
        They run four or five client projects at once and live by due dates.
        Methodical, reads docs, and expects fields they set to stick.
      goals:
        - Track a client launch with dated tasks
        - Move deadlines when clients slip
        - See what is overdue at a glance
      patience: 4
      budgetUsd: { distribution: uniform, min: 5, max: 15 }
  # A cohort can mix personas in a ratio instead of naming one:
  #   mix:
  #     - { persona: casual-lister-persona.yaml, weight: 3 }
  #     - { persona: power-organizer-persona.yaml, weight: 1 }
  - slug: power-organizers
    name: Power organizers
    context: You are sizing this up for a team that will lean on it hard, and you push on it the way they would.
    size: 1
    persona:
      id: power-organizer
      name: Power organizer
      role: an operations lead who organises a dozen parallel workstreams
      backstory: >-
        They manage many projects and hundreds of tasks. They test limits early,
        paginate through everything, and abandon tools that cannot scale with them.
      goals:
        - Set up many projects at once
        - Page through long task lists reliably
        - Delete tasks that are no longer relevant
      constraints:
        - Never deletes a whole project by accident
      patience: 3
      budgetUsd: 20
      # This cohort pushes hardest on scale and paging, so it gets the stronger model.
      model: { model: claude-opus-5, effort: high }
      tools:
        destructive: confirm
`;
}
