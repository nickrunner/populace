/**
 * "Tasklet": a deliberately small task-list product used as the reference target.
 * The domain is in-memory (optionally mirrored to a JSON file) and carries three
 * planted defects and one missing capability. See README.md for the list.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

export const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  passwordHash: z.string(),
  token: z.string(),
  plan: z.enum(["free", "pro"]),
  createdAt: z.string(),
});
export type User = z.infer<typeof UserSchema>;

export const ProjectSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  name: z.string(),
  description: z.string(),
  createdAt: z.string(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  ownerId: z.string(),
  title: z.string(),
  notes: z.string(),
  dueDate: z.string().nullable(),
  priority: z.enum(["low", "normal", "high"]),
  status: z.enum(["open", "done"]),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type Task = z.infer<typeof TaskSchema>;

export const CommentSchema = z.object({ id: z.string(), taskId: z.string(), authorId: z.string(), body: z.string(), createdAt: z.string() });
export type Comment = z.infer<typeof CommentSchema>;

const StateSchema = z.object({
  users: z.array(UserSchema),
  projects: z.array(ProjectSchema),
  tasks: z.array(TaskSchema),
  comments: z.array(CommentSchema),
});

export class AppError extends Error {
  constructor(
    readonly code: "unauthorized" | "not_found" | "conflict" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

export const FREE_PLAN_PROJECT_LIMIT = 3;

export function publicUser(user: User): { id: string; email: string; displayName: string; plan: string; createdAt: string } {
  return { id: user.id, email: user.email, displayName: user.displayName, plan: user.plan, createdAt: user.createdAt };
}

export class TaskletApp {
  private users = new Map<string, User>();
  private projects = new Map<string, Project>();
  private tasks = new Map<string, Task>();
  private comments = new Map<string, Comment>();

  constructor(private readonly stateFile?: string) {
    if (stateFile) this.load(stateFile);
  }

  // ---- persistence -------------------------------------------------------

  private load(file: string): void {
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      return;
    }
    // eslint-disable-next-line no-restricted-syntax -- JSON file boundary, parsed with zod immediately.
    const parsed = StateSchema.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success) return;
    for (const u of parsed.data.users) this.users.set(u.id, u);
    for (const p of parsed.data.projects) this.projects.set(p.id, p);
    for (const t of parsed.data.tasks) this.tasks.set(t.id, t);
    for (const c of parsed.data.comments) this.comments.set(c.id, c);
  }

  private persist(): void {
    if (!this.stateFile) return;
    mkdirSync(dirname(this.stateFile), { recursive: true });
    const state = {
      users: [...this.users.values()],
      projects: [...this.projects.values()],
      tasks: [...this.tasks.values()],
      comments: [...this.comments.values()],
    };
    writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
  }

  reset(): void {
    this.users.clear();
    this.projects.clear();
    this.tasks.clear();
    this.comments.clear();
    this.persist();
  }

  // ---- auth --------------------------------------------------------------

  signUp(input: { email: string; displayName: string; password: string }): { token: string; user: ReturnType<typeof publicUser> } {
    const email = input.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AppError("invalid", "email is not valid");
    if (input.password.length < 8) throw new AppError("invalid", "password must be at least 8 characters");
    if ([...this.users.values()].some((u) => u.email === email)) throw new AppError("conflict", "an account with this email already exists");
    const user: User = {
      id: `usr_${randomUUID().slice(0, 8)}`,
      email,
      displayName: input.displayName.trim() || email.split("@")[0] || "user",
      passwordHash: `plain:${input.password}`,
      token: `tk_${randomBytes(18).toString("base64url")}`,
      plan: "free",
      createdAt: new Date().toISOString(),
    };
    this.users.set(user.id, user);
    this.persist();
    return { token: user.token, user: publicUser(user) };
  }

  logIn(input: { email: string; password: string }): { token: string; user: ReturnType<typeof publicUser> } {
    const email = input.email.trim().toLowerCase();
    const user = [...this.users.values()].find((u) => u.email === email);
    if (!user || user.passwordHash !== `plain:${input.password}`) throw new AppError("unauthorized", "email or password is wrong");
    return { token: user.token, user: publicUser(user) };
  }

  userForToken(token: string | undefined): User {
    if (!token) throw new AppError("unauthorized", "this tool requires a bearer token; call sign_up or log_in first");
    const user = [...this.users.values()].find((u) => u.token === token);
    if (!user) throw new AppError("unauthorized", "bearer token is not valid");
    return user;
  }

  deleteAccount(user: User): void {
    for (const p of [...this.projects.values()]) if (p.ownerId === user.id) this.deleteProject(user, p.id);
    this.users.delete(user.id);
    this.persist();
  }

  // ---- admin -------------------------------------------------------------

  listUsers(filter?: { emailContains?: string }): ReturnType<typeof publicUser>[] {
    return [...this.users.values()]
      .filter((u) => !filter?.emailContains || u.email.includes(filter.emailContains.toLowerCase()))
      .map(publicUser);
  }

  adminDeleteUser(id: string): boolean {
    const user = this.users.get(id);
    if (!user) return false;
    this.deleteAccount(user);
    return true;
  }

  // ---- projects ----------------------------------------------------------

  createProject(user: User, input: { name: string; description?: string }): Project {
    const owned = [...this.projects.values()].filter((p) => p.ownerId === user.id);
    if (user.plan === "free" && owned.length >= FREE_PLAN_PROJECT_LIMIT) {
      throw new AppError("invalid", `the free plan allows ${FREE_PLAN_PROJECT_LIMIT} projects; upgrade to pro for unlimited projects`);
    }
    const name = input.name.trim();
    if (!name) throw new AppError("invalid", "project name is required");
    const project: Project = {
      id: `prj_${randomUUID().slice(0, 8)}`,
      ownerId: user.id,
      name,
      description: input.description?.trim() ?? "",
      createdAt: new Date().toISOString(),
    };
    this.projects.set(project.id, project);
    this.persist();
    return project;
  }

  listProjects(user: User): (Project & { openTasks: number; doneTasks: number })[] {
    return [...this.projects.values()]
      .filter((p) => p.ownerId === user.id)
      .map((p) => {
        const tasks = [...this.tasks.values()].filter((t) => t.projectId === p.id);
        return { ...p, openTasks: tasks.filter((t) => t.status === "open").length, doneTasks: tasks.filter((t) => t.status === "done").length };
      });
  }

  private ownedProject(user: User, projectId: string): Project {
    const project = this.projects.get(projectId);
    if (!project || project.ownerId !== user.id) throw new AppError("not_found", `project ${projectId} not found`);
    return project;
  }

  deleteProject(user: User, projectId: string): { deletedTasks: number } {
    this.ownedProject(user, projectId);
    let deletedTasks = 0;
    for (const t of [...this.tasks.values()]) {
      if (t.projectId === projectId) {
        this.tasks.delete(t.id);
        for (const c of [...this.comments.values()]) if (c.taskId === t.id) this.comments.delete(c.id);
        deletedTasks++;
      }
    }
    this.projects.delete(projectId);
    this.persist();
    return { deletedTasks };
  }

  // ---- tasks -------------------------------------------------------------

  createTask(user: User, input: { projectId: string; title: string; notes?: string; dueDate?: string; priority?: Task["priority"] }): Task {
    this.ownedProject(user, input.projectId);
    const title = input.title.trim();
    if (!title) throw new AppError("invalid", "task title is required");
    if (input.dueDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) throw new AppError("invalid", "dueDate must be YYYY-MM-DD");
    const task: Task = {
      id: `tsk_${randomUUID().slice(0, 8)}`,
      projectId: input.projectId,
      ownerId: user.id,
      title,
      notes: input.notes?.trim() ?? "",
      dueDate: input.dueDate ?? null,
      priority: input.priority ?? "normal",
      status: "open",
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    this.tasks.set(task.id, task);
    this.persist();
    return task;
  }

  private ownedTask(user: User, taskId: string): Task {
    const task = this.tasks.get(taskId);
    if (!task || task.ownerId !== user.id) throw new AppError("not_found", `task ${taskId} not found`);
    return task;
  }

  getTask(user: User, taskId: string): Task {
    return this.ownedTask(user, taskId);
  }

  /**
   * PLANTED BUG #3 (pagination off by one): the description promises a 1-based
   * `page`, but an explicit page is used as a 0-based offset multiplier, so
   * `page: 1` skips the first page and `page: 2` returns the third.
   */
  listTasks(user: User, input: { projectId?: string; status?: Task["status"]; page?: number; pageSize?: number }): { tasks: Task[]; page: number; pageSize: number; total: number } {
    if (input.projectId) this.ownedProject(user, input.projectId);
    const pageSize = input.pageSize ?? 20;
    const all = [...this.tasks.values()]
      .filter((t) => t.ownerId === user.id)
      .filter((t) => !input.projectId || t.projectId === input.projectId)
      .filter((t) => !input.status || t.status === input.status)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const page = input.page ?? 1;
    const offset = input.page === undefined ? 0 : input.page * pageSize; // <- should be (page - 1) * pageSize
    return { tasks: all.slice(offset, offset + pageSize), page, pageSize, total: all.length };
  }

  /**
   * PLANTED BUG #2 (silently dropped field): `dueDate` is accepted, validated and
   * then never written, so the returned task still shows the old due date.
   */
  updateTask(user: User, input: { taskId: string; title?: string; notes?: string; dueDate?: string | null; priority?: Task["priority"] }): Task {
    const task = this.ownedTask(user, input.taskId);
    if (input.dueDate !== undefined && input.dueDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) throw new AppError("invalid", "dueDate must be YYYY-MM-DD");
    const next: Task = {
      ...task,
      title: input.title?.trim() || task.title,
      notes: input.notes !== undefined ? input.notes.trim() : task.notes,
      priority: input.priority ?? task.priority,
      // dueDate intentionally not applied
    };
    this.tasks.set(task.id, next);
    this.persist();
    return next;
  }

  completeTask(user: User, taskId: string): Task {
    const task = this.ownedTask(user, taskId);
    const next: Task = { ...task, status: "done", completedAt: new Date().toISOString() };
    this.tasks.set(task.id, next);
    this.persist();
    return next;
  }

  reopenTask(user: User, taskId: string): Task {
    const task = this.ownedTask(user, taskId);
    const next: Task = { ...task, status: "open", completedAt: null };
    this.tasks.set(task.id, next);
    this.persist();
    return next;
  }

  /**
   * PLANTED BUG #1 (case-sensitive search): the description promises a
   * case-insensitive match, but the comparison is exact-case.
   */
  searchTasks(user: User, query: string): { query: string; tasks: Task[] } {
    const q = query.trim();
    const tasks = [...this.tasks.values()].filter((t) => t.ownerId === user.id && (t.title.includes(q) || t.notes.includes(q)));
    return { query: q, tasks };
  }

  // ---- comments ----------------------------------------------------------

  addComment(user: User, input: { taskId: string; body: string }): Comment {
    this.ownedTask(user, input.taskId);
    const body = input.body.trim();
    if (!body) throw new AppError("invalid", "comment body is required");
    const comment: Comment = { id: `cmt_${randomUUID().slice(0, 8)}`, taskId: input.taskId, authorId: user.id, body, createdAt: new Date().toISOString() };
    this.comments.set(comment.id, comment);
    this.persist();
    return comment;
  }

  listComments(user: User, taskId: string): Comment[] {
    this.ownedTask(user, taskId);
    return [...this.comments.values()].filter((c) => c.taskId === taskId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  // ---- stats -------------------------------------------------------------

  stats(user: User): { projects: number; openTasks: number; doneTasks: number; overdueTasks: number; comments: number } {
    const today = new Date().toISOString().slice(0, 10);
    const tasks = [...this.tasks.values()].filter((t) => t.ownerId === user.id);
    return {
      projects: [...this.projects.values()].filter((p) => p.ownerId === user.id).length,
      openTasks: tasks.filter((t) => t.status === "open").length,
      doneTasks: tasks.filter((t) => t.status === "done").length,
      overdueTasks: tasks.filter((t) => t.status === "open" && t.dueDate !== null && t.dueDate < today).length,
      comments: [...this.comments.values()].filter((c) => tasks.some((t) => t.id === c.taskId)).length,
    };
  }

  upgradePlan(user: User): ReturnType<typeof publicUser> {
    const next: User = { ...user, plan: "pro" };
    this.users.set(user.id, next);
    this.persist();
    return publicUser(next);
  }
}

export const PRODUCT_INFO = {
  name: "Tasklet",
  tagline: "A calm task list for people with too many projects.",
  description:
    "Tasklet keeps your projects and tasks in one place. Create projects, add tasks with due dates and priorities, " +
    "search everything instantly, comment on tasks, and tick them off. Free for up to 3 projects; Pro is $6/month for unlimited projects.",
  features: [
    "Unlimited tasks in up to 3 projects on the free plan",
    "Due dates and priorities on every task",
    "Instant search across titles and notes (search ignores case)",
    "Comments on tasks",
    "Delete tasks you no longer need",
    "Simple stats: open, done and overdue counts",
  ],
  plans: [
    { id: "free", priceUsdPerMonth: 0, projects: FREE_PLAN_PROJECT_LIMIT },
    { id: "pro", priceUsdPerMonth: 6, projects: "unlimited" },
  ],
};
