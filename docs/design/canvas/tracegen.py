#!/usr/bin/env python3
"""Generates Trace.dc.html, the one artboard with working controls.

Clicking a step moves the detail pane, so every step carries its own detail.
Entities are NOT decoded inside a <script data-dc-script> block, so every string
below is literal UTF-8.
"""
import json

MONO = "'IBM Plex Mono', ui-monospace, monospace"
SANS = "'Instrument Sans', system-ui, sans-serif"

def tool(ref, name, args, result, sub, meta, why=None, cite=None, suspect=False):
    return dict(kind='tool', ref=ref, title=name, sub=sub, meta=meta, suspect=suspect, d=dict(
        ref=ref, title=name, m1='default · http://127.0.0.1:4310/mcp', m2=meta, m3='14:31',
        aLabel='What she sent', a=args, bLabel='What came back', b=result,
        flag='reported success' if suspect else '', why=why or '', cite=cite or ''))

def turn(n, sub, meta, asked, decided):
    return dict(kind='model', title='Turn %d' % n, sub=sub, meta=meta, d=dict(
        ref='', title='Turn %d' % n, m1='claude-sonnet-5 · medium', m2=meta, m3='14:31',
        aLabel='What she was given', a=asked, bLabel='What she decided to do', b=decided,
        flag='', why='', cite=''))

CITE = 'Moving a deadline appears to work and does not stick'

ROWS = [
    dict(kind='start', title='Visit 3 begins', sub='project-planner#0 · run_m1abc2de_x7k9q2', meta='14:31:02', d=dict(
        ref='', title='Visit 3 begins', m1='project-planner#0', m2='visit 3 of 4 scheduled', m3='14:31:02',
        aLabel='Who arrived', a='Priya Desai\na freelance designer who plans client\nprojects with deadlines\n\npatience 4 of 5\nwould pay $12 a month',
        bLabel='What she was carrying', b='waiting on:\n  a due date that saves when she changes it\n\nannoyed by:\n  update_task, visit 2\n  case-sensitive search, visit 2',
        flag='', why='', cite='')),
    dict(kind='memory', title='Reads her own notes', sub='waiting on: a due date that saves · annoyed by: update_task, visit 2', meta='', d=dict(
        ref='', title='Reads her own notes', m1='memory for this run', m2='2 notes carried in', m3='14:31:02',
        aLabel='Still waiting on', a='A due date that saves when she changes it\nOne list of everything due this week',
        bLabel='Still annoyed about', b='update_task said it saved the new due date\nand it did not (visit 2)\nSearch only matches if the capitals line up (visit 2)',
        flag='', why='This is the whole of what makes a returning visit different from a first one. A fresh run starts her with none of it.', cite='')),
    turn(1, 'Decides to check whether last visit’s deadline finally stuck', '2.1s · $0.06',
         'It is visit 3. Here is what you remember, here is your account,\nhere is what you came to do.',
         'She goes straight to the client launch project to see whether\nthe date she moved last time is the date it shows now.'),
    tool('c1', 'list_projects', '{}', '{\n  "projects": [\n    { "id": "prj_4k2v", "name": "Client launch" },\n    { "id": "prj_8x1m", "name": "Studio admin" }\n  ]\n}', '{} → 2 projects', '18ms'),
    tool('c2', 'list_tasks', '{\n  "projectId": "prj_4k2v"\n}', '{\n  "tasks": [ 6 tasks ],\n  "total": 6,\n  "page": 0\n}', '{ projectId: "prj_4k2v" } → 6 tasks', '22ms'),
    turn(2, 'Finds the launch task she moved last time', '1.7s · $0.05',
         'The six tasks in the client launch project.',
         'She picks out “Launch review with client”, the one whose date\nshe moved on her last visit.'),
    tool('c3', 'get_task', '{\n  "taskId": "tsk_91b7"\n}', '{\n  "task": {\n    "id": "tsk_91b7",\n    "title": "Launch review with client",\n    "dueDate": "2026-10-01"\n  }\n}', '{ taskId: "tsk_91b7" } → dueDate 2026-10-01', '14ms',
         why='The date is still 1 October. The change she made last visit never landed.', cite=CITE + ' · step 1 of 4'),
    turn(3, 'Moves the deadline to 24 December', '2.4s · $0.07',
         'The task, still dated 1 October.',
         'She sets the due date again, this time to 24 December, and expects\nit to hold.'),
    tool('c4', 'update_task', '{\n  "taskId": "tsk_91b7",\n  "dueDate": "2026-12-24"\n}', '{\n  "task": {\n    "id": "tsk_91b7",\n    "title": "Launch review with client",\n    "dueDate": "2026-10-01",\n    "priority": "high",\n    "status": "open"\n  }\n}', '{ taskId: "tsk_91b7", dueDate: "2026-12-24" } → ok, dueDate 2026-10-01', '27ms', suspect=True,
         why='She asked for 24 December, the call reported success, and the task it handed back still says 1 October.',
         cite=CITE + ' · step 2 of 4'),
    turn(4, 'Notices the date came back unchanged and reads the task again', '2.0s · $0.06',
         'The task as update_task returned it, dated 1 October.',
         'She does not trust what the write returned, so she reads the task\nback on its own to see which date is really stored.'),
    tool('c5', 'get_task', '{\n  "taskId": "tsk_91b7"\n}', '{\n  "task": {\n    "id": "tsk_91b7",\n    "dueDate": "2026-10-01"\n  }\n}', '{ taskId: "tsk_91b7" } → dueDate 2026-10-01', '12ms', suspect=True,
         why='The independent read confirms it: the write was accepted and nothing changed.', cite=CITE + ' · step 3 of 4'),
    dict(kind='memory', title='Writes it down', sub='annoyance: “the deadline did not save again”', meta='', d=dict(
        ref='', title='Writes it down', m1='annoyance', m2='kept for every later visit', m3='14:32',
        aLabel='What she wrote', a='the deadline did not save again',
        bLabel='Where it goes', b='Into her memory for this run, under “annoyances”.\nShe will still be carrying it on visit 4, and a run\nstarted with --continue-from hands it back to her.',
        flag='', why='', cite='')),
    turn(5, 'Tries once more with a different date format', '1.9s · $0.09',
         'Two reads agreeing that the date did not change.',
         'Before blaming the product she checks whether it is her fault, and\nsends the same date in full ISO form.'),
    tool('c6', 'update_task', '{\n  "taskId": "tsk_91b7",\n  "dueDate": "2026-12-24T00:00:00Z"\n}', '{\n  "task": {\n    "id": "tsk_91b7",\n    "dueDate": "2026-10-01"\n  }\n}', '{ dueDate: "2026-12-24T00:00:00Z" } → ok, dueDate 2026-10-01', '25ms', suspect=True,
         why='A second format, the same silence. It is not how she typed it.', cite=CITE + ' · step 4 of 4'),
    dict(kind='finding', title='Files a bug', sub='Moving a deadline appears to work and does not stick · high · evidence c3 c4 c5 c6', meta='', d=dict(
        ref='', title='Files a bug', m1='bug · high · confidence 0.9', m2='evidence c3 c4 c5 c6', m3='14:33',
        aLabel='What she expected', a='Setting a due date to 24 December and reading the\ntask back shows 24 December.',
        bLabel='What happened', b='update_task accepts the new date, reports success, and\nreturns the task with the old date. get_task agrees.\nTwo different date formats, same result.',
        flag='', why='The four calls she cited become the reproduction steps, which is what lets the verifier replay this without her.', cite=CITE)),
    turn(6, 'Considers deleting the project and starting over', '2.2s · $0.09',
         'A bug filed, and a project she no longer trusts.',
         'She weighs starting the project again from scratch rather than\nworking around a date that will not save.'),
    dict(kind='guard', title='Held back: delete_project', sub='destructive-confirm — this persona must confirm before destructive tools run', meta='', d=dict(
        ref='', title='Held back: delete_project', m1='guardrail · destructive-confirm', m2='policy from her persona', m3='14:33',
        aLabel='What she reached for', a='delete_project({ "projectId": "prj_4k2v" })',
        bLabel='What the runner did instead', b='Did not call it. Told her the tool is marked destructive\nand that she has to confirm, which she was not willing\nto do on a client project.',
        flag='', why='The guardrail is in the runner, not in her instructions, so it holds however she is feeling about the product.', cite='')),
    dict(kind='give', title='Gives up', sub='“I cannot plan around a date the app forgets. I would come back if update_task kept my dates.”', meta='', d=dict(
        ref='', title='Gives up', m1='give_up · would return: yes', m2='visit 3 of 4 scheduled', m3='14:34',
        aLabel='Why she is leaving', a='I cannot plan around a date the app forgets. Every deadline\nI set is a deadline I have to check twice.',
        bLabel='What would bring her back', b='If update_task kept my dates, I would try it again.',
        flag='', why='“Would return: yes” is what makes her eligible for a re-run once the bug is fixed. An agent who leaves without saying that stays gone.', cite='')),
    dict(kind='end', title='Visit ends — gave up', sub='6 turns · 6 tool calls · $0.42 · would return: yes', meta='14:34:14', d=dict(
        ref='', title='Visit ends — gave up', m1='gave-up', m2='3m 12s', m3='14:34:14',
        aLabel='What it cost', a='6 turns · 6 tool calls\n41,206 tokens, 92% of them read from cache\n$0.42',
        bLabel='What it produced', b='1 finding, high severity\n2 memory writes\n1 guardrail trip\nVisit 4 was never scheduled: she had already left.',
        flag='', why='', cite='')),
]

for i, r in enumerate(ROWS):
    r['seq'] = '%04d' % (i + 1)

HTML = '''<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #f9f6f2; color: #1a1510; font-family: "Instrument Sans", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
    a { color: #236292; text-decoration: none; }
    a:hover { color: #4280b2; text-decoration: underline; }
    .tl::-webkit-scrollbar { width: 8px; }
    .tl::-webkit-scrollbar-thumb { background: #cecac2; border-radius: 4px; }
  </style>
</helmet>

<div style="width: 1440px; height: 980px; display: flex; flex-direction: column; background: #f9f6f2; overflow: hidden;">

  <div style="height: 56px; flex-shrink: 0; border-bottom: 1px solid #e1ded7; background: #fefdfb; display: flex; align-items: center; gap: 14px; padding: 0 24px;">
    <a href="#" style="display: flex; align-items: center; gap: 6px; font-size: 13px; color: #57514c;">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9.5 3.5 5 8l4.5 4.5"/></svg>Wakes
    </a>
    <span style="width: 1px; height: 20px; background: #e1ded7;"></span>
    <span style="font-family: MONO; font-size: 13px; font-weight: 500;">wake_m1b7x2_q4k8vd</span>
    <div style="flex-grow: 1;"></div>
    <a href="#" style="font-size: 12.5px;">Her visit 2</a>
  </div>

  <div style="flex-shrink: 0; padding: 16px 24px 14px; background: #fefdfb; border-bottom: 1px solid #e1ded7;">
    <div style="display: flex; align-items: flex-start; gap: 14px;">
      <span style="width: 34px; height: 34px; border-radius: 17px; background: #f3f0ea; color: #57514c; font-size: 12.5px; font-weight: 600; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">PD</span>
      <div style="flex-grow: 1; min-width: 0;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 17px; font-weight: 600;">Priya Desai</span>
          <span style="font-family: MONO; font-size: 11.5px; color: #857f79;">project-planner#0</span>
          <span style="font-size: 12.5px; color: #57514c;">visit 3 of 4 scheduled</span>
          <span style="display: flex; align-items: center; gap: 5px; padding: 2px 9px; border-radius: 4px; background: #fbe4e4; color: #a32a2a; font-size: 11.5px; font-weight: 600;">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9.5 2.5h3v11h-3M9.5 8H2.5M5 5l-2.5 3L5 11"/></svg>gave up
          </span>
        </div>
        <div style="margin-top: 7px; display: flex; align-items: center; gap: 18px; font-family: MONO; font-size: 11.5px; color: #57514c;">
          <span>6 turns</span><span>6 tool calls</span><span>41,206 tokens</span><span>92% cached</span><span>$0.42</span><span>3m 12s</span><span>claude-sonnet-5 · medium</span>
        </div>
      </div>
    </div>

    <div style="margin-top: 13px; display: flex; align-items: center; gap: 9px; padding: 9px 12px; border-radius: 6px; background: #fde9d4; border: 1px solid #f3d6b4;">
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#864e18" stroke-width="1.5" style="flex-shrink: 0;"><path d="M8 4.2v4.3l2.6 1.6"/><circle cx="8" cy="8" r="5.8"/></svg>
      <span style="font-size: 12px; font-weight: 600; color: #864e18;">Came back remembering</span>
      <span style="font-size: 12.5px; color: #6b431a;">&ldquo;update_task said it saved my new due date, but the task still showed the old one&rdquo; &mdash; visit 2</span>
    </div>
  </div>

  <div style="flex-grow: 1; display: flex; min-height: 0;">

    <div style="width: 776px; flex-shrink: 0; border-right: 1px solid #e1ded7; display: flex; flex-direction: column; min-height: 0;">
      <div style="flex-shrink: 0; padding: 12px 20px; display: flex; align-items: center; gap: 7px; border-bottom: 1px solid #e1ded7;">
        <span style="padding: 4px 11px; border-radius: 13px; background: #1a1510; color: #f9f6f2; font-size: 12px; font-weight: 500;">Everything</span>
        <span style="padding: 4px 11px; border-radius: 13px; border: 1px solid #e1ded7; background: #fefdfb; font-size: 12px; color: #57514c;">Tool calls 6</span>
        <span style="padding: 4px 11px; border-radius: 13px; border: 1px solid #e1ded7; background: #fefdfb; font-size: 12px; color: #57514c;">Findings 1</span>
        <span style="padding: 4px 11px; border-radius: 13px; border: 1px solid #e1ded7; background: #fefdfb; font-size: 12px; color: #57514c;">Guardrails 1</span>
        <span style="padding: 4px 11px; border-radius: 13px; border: 1px solid #e1ded7; background: #fefdfb; font-size: 12px; color: #57514c;">Memory 2</span>
        <div style="flex-grow: 1;"></div>
        <span style="font-size: 11.5px; color: #857f79;">Click a step to inspect it</span>
      </div>

      <div class="tl" style="flex-grow: 1; overflow-y: auto; padding: 8px 0 20px;">
        <sc-for list="{{events}}" as="e" hint-placeholder-count="6">
          <div onClick="{{e.pick}}" style="display: flex; gap: 0; cursor: pointer; background: {{e.bg}}; border-left: 3px solid {{e.bar}};">
            <div style="width: 58px; flex-shrink: 0; padding: 9px 0 9px 13px; font-family: MONO; font-size: 11px; color: #857f79;">{{e.seq}}</div>
            <div style="width: 20px; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; padding-top: 12px;">
              <span style="width: 7px; height: 7px; border-radius: 4px; background: {{e.dot}}; flex-shrink: 0;"></span>
              <span style="width: 1px; flex-grow: 1; background: #e1ded7;"></span>
            </div>
            <div style="flex-grow: 1; min-width: 0; padding: 8px 16px 9px 10px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <sc-if value="{{e.hasRef}}" hint-placeholder-val="{{true}}">
                  <span style="font-family: MONO; font-size: 11px; font-weight: 600; color: #864e18; background: #fde9d4; padding: 1px 5px; border-radius: 3px;">{{e.ref}}</span>
                </sc-if>
                <span style="font-family: {{e.titleFont}}; font-size: 13px; font-weight: {{e.titleWeight}}; color: {{e.titleColor}};">{{e.title}}</span>
                <div style="flex-grow: 1;"></div>
                <span style="font-family: MONO; font-size: 11px; color: #857f79;">{{e.meta}}</span>
              </div>
              <sc-if value="{{e.hasSub}}" hint-placeholder-val="{{true}}">
                <div style="margin-top: 3px; font-family: {{e.subFont}}; font-size: 11.5px; color: {{e.subColor}}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{{e.sub}}</div>
              </sc-if>
            </div>
          </div>
        </sc-for>
      </div>
    </div>

    <div style="flex-grow: 1; min-width: 0; display: flex; flex-direction: column; background: #fefdfb;">
      <div style="flex-shrink: 0; padding: 14px 20px 12px; border-bottom: 1px solid #e1ded7;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <sc-if value="{{detail.hasRef}}" hint-placeholder-val="{{true}}">
            <span style="font-family: MONO; font-size: 11px; font-weight: 600; color: #864e18; background: #fde9d4; padding: 2px 6px; border-radius: 3px;">{{detail.ref}}</span>
          </sc-if>
          <span style="font-family: {{detail.titleFont}}; font-size: 15px; font-weight: 600;">{{detail.title}}</span>
        </div>
        <div style="margin-top: 7px; display: flex; flex-wrap: wrap; gap: 14px; font-size: 11.5px; color: #57514c;">
          <span>{{detail.m1}}</span><span>{{detail.m2}}</span><span>{{detail.m3}}</span>
        </div>
      </div>

      <div style="flex-grow: 1; overflow-y: auto; padding: 16px 20px;">
        <div style="font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #857f79;">{{detail.aLabel}}</div>
        <pre style="margin: 8px 0 0; padding: 12px 13px; background: #f3f0ea; border: 1px solid #e1ded7; border-radius: 6px; font-family: {{detail.bodyFont}}; font-size: 11.5px; line-height: 1.65; color: #1a1510; white-space: pre-wrap; word-break: break-word;">{{detail.a}}</pre>

        <div style="margin-top: 18px; display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #857f79;">{{detail.bLabel}}</span>
          <sc-if value="{{detail.hasFlag}}" hint-placeholder-val="{{true}}">
            <span style="padding: 1px 7px; border-radius: 3px; background: #fbe4e4; color: #a32a2a; font-size: 11px; font-weight: 600;">{{detail.flag}}</span>
          </sc-if>
        </div>
        <pre style="margin: 8px 0 0; padding: 12px 13px; background: #f3f0ea; border: 1px solid #e1ded7; border-radius: 6px; font-family: {{detail.bodyFont}}; font-size: 11.5px; line-height: 1.65; color: #1a1510; white-space: pre-wrap; word-break: break-word;">{{detail.b}}</pre>

        <sc-if value="{{detail.hasWhy}}" hint-placeholder-val="{{true}}">
          <div style="margin-top: 18px; padding: 12px 13px; border: 1px solid #e1ded7; border-radius: 6px; background: #fefdfb;">
            <div style="font-size: 12px; font-weight: 600;">Why this one matters</div>
            <div style="margin-top: 5px; font-size: 12.5px; line-height: 1.55; color: #57514c;">{{detail.why}}</div>
          </div>
        </sc-if>

        <sc-if value="{{detail.hasCite}}" hint-placeholder-val="{{true}}">
          <div style="margin-top: 16px;">
            <div style="font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #857f79;">Cited as evidence</div>
            <a href="#" style="margin-top: 8px; display: flex; align-items: center; gap: 10px; padding: 11px 13px; border: 1px solid #e1ded7; border-radius: 6px; background: #fefdfb; text-decoration: none;">
              <span style="width: 3px; align-self: stretch; border-radius: 2px; background: #ec835a;"></span>
              <div style="flex-grow: 1; min-width: 0;">
                <div style="font-size: 13px; font-weight: 600; color: #1a1510;">{{detail.cite}}</div>
              </div>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#857f79" stroke-width="1.5"><path d="M6.5 3.5 11 8l-4.5 4.5"/></svg>
            </a>
          </div>
        </sc-if>

        <div style="margin-top: 16px; display: flex; gap: 8px;">
          <span style="padding: 8px 13px; border-radius: 5px; border: 1px solid #cecac2; background: #fefdfb; font-size: 12.5px; font-weight: 500; color: #1a1510;">Copy these steps</span>
          <span style="padding: 8px 13px; border-radius: 5px; border: 1px solid #cecac2; background: #fefdfb; font-size: 12.5px; font-weight: 500; color: #1a1510;">Open raw event</span>
        </div>
      </div>
    </div>
  </div>
</div>
</x-dc>

<script data-dc-script data-props='{}'>
class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { sel: 9 };
  }

  rows() {
    return ROWS_JSON;
  }

  style(kind) {
    const map = {
      start:   { dot: '#857f79', color: '#57514c', font: SANS_JS, weight: '500' },
      memory:  { dot: '#4280b2', color: '#57514c', font: SANS_JS, weight: '500' },
      model:   { dot: '#cecac2', color: '#57514c', font: SANS_JS, weight: '500' },
      tool:    { dot: '#864e18', color: '#1a1510', font: MONO_JS, weight: '600' },
      finding: { dot: '#ec835a', color: '#1a1510', font: SANS_JS, weight: '600' },
      guard:   { dot: '#fab219', color: '#8a6206', font: SANS_JS, weight: '600' },
      give:    { dot: '#d03b3b', color: '#a32a2a', font: SANS_JS, weight: '600' },
      end:     { dot: '#857f79', color: '#57514c', font: SANS_JS, weight: '500' },
    };
    return map[kind] || map.model;
  }

  renderVals() {
    const all = this.rows();
    const sel = Math.min(this.state.sel, all.length);
    const events = all.map((r, i) => {
      const n = i + 1;
      const s = this.style(r.kind);
      const on = n === sel;
      return {
        seq: r.seq,
        title: r.title,
        sub: r.sub || '',
        hasSub: Boolean(r.sub),
        meta: r.meta || '',
        ref: r.ref || '',
        hasRef: Boolean(r.ref),
        dot: s.dot,
        titleFont: s.font,
        titleWeight: s.weight,
        titleColor: s.color,
        subFont: r.kind === 'tool' ? MONO_JS : SANS_JS,
        subColor: r.suspect ? '#a34a20' : '#857f79',
        bg: on ? '#dbeefe' : 'transparent',
        bar: on ? '#236292' : 'transparent',
        pick: () => this.setState({ sel: n }),
      };
    });

    const picked = all[sel - 1];
    const d = picked.d;
    return {
      events,
      detail: {
        ref: d.ref,
        hasRef: Boolean(d.ref),
        title: d.title,
        titleFont: picked.kind === 'tool' ? MONO_JS : SANS_JS,
        bodyFont: picked.kind === 'tool' ? MONO_JS : SANS_JS,
        m1: d.m1,
        m2: d.m2,
        m3: d.m3,
        aLabel: d.aLabel,
        a: d.a,
        bLabel: d.bLabel,
        b: d.b,
        flag: d.flag,
        hasFlag: Boolean(d.flag),
        why: d.why,
        hasWhy: Boolean(d.why),
        cite: d.cite,
        hasCite: Boolean(d.cite),
      },
    };
  }
}
</script>
</body>
</html>
'''

out = (HTML
       .replace('ROWS_JSON', json.dumps(ROWS, ensure_ascii=False, indent=6))
       .replace('SANS_JS', "'" + SANS.strip("'").replace("'", "") + "'" if False else '\'Instrument Sans\', system-ui, sans-serif'.join(['"', '"']))
       .replace('MONO_JS', '\'IBM Plex Mono\', ui-monospace, monospace'.join(['"', '"']))
       .replace('font-family: MONO;', "font-family: 'IBM Plex Mono', ui-monospace, monospace;"))
open('Trace.dc.html', 'w', encoding='utf-8').write(out)
print('wrote Trace.dc.html')
