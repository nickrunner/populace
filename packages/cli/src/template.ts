/** The config written by `populace init`: points at the mock target with three personas. */
export function configTemplate(mockTargetUrl: string): string {
  return `# populace configuration. Validate with: populace validate
version: 1

target:
  name: Tasklet
  mcp:
    - name: default
      url: ${mockTargetUrl}/mcp
      # bearerToken: my-gateway-token   # static token for gateways; identities override it. Environment variables can be referenced with \${...} syntax.
  webBaseUrl: ${mockTargetUrl}
  description: >-
    Tasklet keeps your projects and tasks in one place. Create projects, add tasks
    with due dates and priorities, search everything instantly, comment on tasks,
    and tick them off. Free for up to 3 projects; Pro is $6/month.

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

population:
  id: tasklet-trial
  scale: 1
  seed: populace
  cadence: { every: 2m, jitter: 30s }
  maxWakes: 4
  members:
    - persona:
        id: casual-lister
        name: Casey Morgan
        role: a hobbyist who keeps grocery and chore lists on their phone
        backstory: >-
          Casey has bounced between three list apps this year. They want something calm,
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
      count: 1
    - persona:
        id: project-planner
        name: Priya Desai
        role: a freelance designer who plans client projects with deadlines
        backstory: >-
          Priya runs four or five client projects at once and lives by due dates.
          She is methodical, reads docs, and expects fields she sets to stick.
        goals:
          - Track a client launch with dated tasks
          - Move deadlines when clients slip
          - See what is overdue at a glance
        patience: 4
        budgetUsd: { distribution: uniform, min: 5, max: 15 }
      count: 1
    - persona:
        id: power-organizer
        name: Tomás Ruiz
        role: an operations lead who organises a dozen parallel workstreams
        backstory: >-
          Tomás manages many projects and hundreds of tasks. He tests limits early,
          paginates through everything, and abandons tools that cannot scale with him.
        goals:
          - Set up many projects at once
          - Page through long task lists reliably
          - Delete tasks that are no longer relevant
        constraints:
          - Never deletes a whole project by accident
        patience: 3
        budgetUsd: 20
        # Tomás pushes hardest on scale and paging, so he gets the stronger model.
        model: { model: claude-opus-5, effort: high }
        tools:
          destructive: confirm
      count: 1
`;
}
