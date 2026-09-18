#!/usr/bin/env python3
# Generates the shell-based artboards. Run: python3 screens.py
from build import shell, write, RUN_PICKER

MONO = "'IBM Plex Mono', ui-monospace, monospace"
SEV = {
  'critical': ('#d03b3b', '#a32a2a'),
  'high':     ('#ec835a', '#a34a20'),
  'medium':   ('#fab219', '#8a6206'),
  'low':      ('#857f79', '#6b655e'),
}
TICK = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#0ca30c" stroke-width="2"><path d="M3 8.4 6.4 12 13 4.6"/></svg>'
QUERY = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#8a6206" stroke-width="1.6"><circle cx="8" cy="8" r="5.6"/><path d="M6.4 6.4a1.7 1.7 0 0 1 3.2.6c0 1.1-1.6 1.3-1.6 2.3"/><path d="M8 11.6v.01"/></svg>'


def cluster_row(sev, kindword, tool, title, line, verif, people, extra=''):
    bar, ink = SEV[sev]
    toolchip = ('<span style="font-family: %s; font-size: 11.5px; color: #864e18; background: #fde9d4; padding: 1px 6px; border-radius: 3px;">%s</span>' % (MONO, tool)) if tool else ''
    return '''          <div style="background: #fefdfb; border: 1px solid #e1ded7; border-radius: 7px; padding: 13px 15px; display: flex; gap: 13px;">
            <span style="width: 4px; align-self: stretch; border-radius: 2px; background: %(bar)s; flex-shrink: 0;"></span>
            <div style="min-width: 0; flex-grow: 1;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: %(ink)s;">%(kindword)s</span>
                %(toolchip)s%(extra)s
              </div>
              <div style="margin-top: 5px; font-size: 15px; font-weight: 600;">%(title)s</div>
              <div style="margin-top: 5px; font-size: 13px; color: #57514c; line-height: 1.5;">%(line)s</div>
              <div style="margin-top: 9px; display: flex; align-items: center; gap: 14px; font-size: 12px; color: #857f79;">%(verif)s<span>%(people)s</span></div>
            </div>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#cecac2" stroke-width="1.6" style="align-self: center; flex-shrink: 0;"><path d="M6.5 3.5 11 8l-4.5 4.5"/></svg>
          </div>''' % dict(bar=bar, ink=ink, kindword=kindword, toolchip=toolchip, title=title, line=line, verif=verif, people=people, extra=extra)


def confirmed(n):
    return '<span style="display: flex; align-items: center; gap: 5px;">%s%d confirmed</span>' % (TICK, n)


def unsure(n):
    return '<span style="display: flex; align-items: center; gap: 5px;">%s%d unsure</span>' % (QUERY, n)


COSTLY = '<span style="font-size: 11px; font-weight: 600; color: #d03b3b; background: #fbe4e4; padding: 1px 7px; border-radius: 3px;">cost us a user</span>'
PROMISED = '<span style="font-size: 11px; font-weight: 600; color: #864e18; background: #fde9d4; padding: 1px 7px; border-radius: 3px;">promised on the site</span>'


def section(title, note, rows):
    return '''        <div style="margin-top: 22px;">
          <div style="display: flex; align-items: baseline; gap: 10px;">
            <div style="font-size: 15px; font-weight: 600;">%s</div>
            <div style="font-size: 12px; color: #857f79;">%s</div>
          </div>
          <div style="margin-top: 10px; display: flex; flex-direction: column; gap: 8px;">
%s
          </div>
        </div>''' % (title, note, '\n'.join(rows))


def chip(text, on=False):
    if on:
        return '<span style="padding: 5px 12px; border-radius: 14px; background: #1a1510; color: #f9f6f2; font-size: 12.5px; font-weight: 500;">%s</span>' % text
    return '<span style="padding: 5px 12px; border-radius: 14px; border: 1px solid #e1ded7; background: #fefdfb; font-size: 12.5px; color: #57514c;">%s</span>' % text


# ---------------------------------------------------------------- Findings --
findings_content = '''    <div style="flex-grow: 1; display: flex; flex-direction: column; min-height: 0; padding: 22px 28px 0;">
      <div style="flex-shrink: 0;">
        <div style="font-size: 22px; font-weight: 600; letter-spacing: -0.01em;">Findings</div>
        <div style="margin-top: 5px; font-size: 13.5px; color: #57514c;">12 reports from 11 visits. One did not recur when we replayed it; the other 11 gather into 7 things that are actually wrong, because the same complaint from three people is one row here.</div>
        <div style="margin-top: 14px; display: flex; align-items: center; gap: 7px;">
          %(chips)s
          <div style="flex-grow: 1;"></div>
          <span style="font-size: 12px; color: #857f79;">Hiding 1 that did not recur</span>
          <span style="font-size: 12px; color: #857f79;">Worst first</span>
        </div>
      </div>
      <div style="flex-grow: 1; overflow-y: auto; padding-bottom: 24px;">
%(sections)s
      </div>
    </div>''' % dict(
    chips=' '.join([chip('Everything 7', True), chip('Bugs 3'), chip('Coverage gaps 2'), chip('Walked away 1'), chip('Friction 1')]),
    sections='\n'.join([
        section('Bugs', 'something is broken', [
            cluster_row('critical', 'Critical bug', 'search_tasks',
                        'Search finds nothing unless you type the capital letters',
                        'All three people searched for something they had just written down and were told it did not exist. Two of them wrote it again.',
                        confirmed(3), '3 of 3 people · 3 reports'),
            cluster_row('high', 'High bug', 'update_task',
                        'Moving a deadline appears to work and does not stick',
                        'The call reports success and hands back the old date. Priya tried four times across two visits before she left.',
                        confirmed(2), '2 of 3 people · 2 reports', extra=COSTLY),
            cluster_row('medium', 'Medium bug', 'list_tasks',
                        'Page two of a task list comes back empty',
                        'Tomás read the empty page as “my tasks are gone” and started the project again from scratch.',
                        confirmed(1) + unsure(1), '1 of 3 people · 2 reports'),
        ]),
        section('Things people wanted and could not find', 'the surface is missing something', [
            cluster_row('high', 'High gap', 'delete_task — missing',
                        'There is no way to delete a task, and the front page promises one',
                        'Two people went looking. Tomás deleted an entire project to get rid of one task in it.',
                        confirmed(2), '2 of 3 people · 2 reports', extra=PROMISED),
            cluster_row('low', 'Low gap', 'nothing exposes this',
                        'No way to see everything due this week',
                        'Priya listed each project in turn and gave up assembling the picture by hand.',
                        confirmed(1), '1 of 3 people · 1 report'),
        ]),
        section('People who left', 'and what it was over', [
            cluster_row('critical', 'Walked away', '',
                        'Priya stopped trusting Tasklet with deadlines',
                        '“I cannot plan around a date the app forgets.” She said she would come back if the due date saved.',
                        confirmed(1), 'visit 3 · she said she would come back'),
        ]),
        section('Friction', 'nothing broke, but it cost them', [
            cluster_row('medium', 'Medium friction', 'create_project',
                        'The free plan stops at three projects and only says so at the fourth',
                        'Tomás set up three, hit a wall on the fourth, and spent two turns working out whether he had done something wrong.',
                        confirmed(1), '1 of 3 people · 1 report'),
        ]),
    ]))

write('Evidence.dc.html', shell('findings', RUN_PICKER, findings_content, height=1300))


# ------------------------------------------------------------ Cluster view --
def quote(initials, name, visit, text):
    return '''            <div style="display: flex; gap: 12px; padding: 13px 0; border-bottom: 1px solid #e1ded7;">
              <span style="width: 28px; height: 28px; border-radius: 14px; background: #f3f0ea; color: #57514c; font-size: 11px; font-weight: 600; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">%s</span>
              <div style="min-width: 0;">
                <div style="font-size: 14px; line-height: 1.55; color: #1a1510;">“%s”</div>
                <div style="margin-top: 5px; display: flex; align-items: center; gap: 10px; font-size: 11.5px; color: #857f79;">
                  <span>%s · visit %s</span><a href="#" style="font-size: 11.5px;">watch this visit</a>
                </div>
              </div>
            </div>''' % (initials, text, name, visit)


def step(ref, call, result, bad=False):
    return '''              <div style="display: flex; gap: 10px; padding: 9px 12px; border-bottom: 1px solid #e1ded7; background: %(bg)s;">
                <span style="font-family: %(mono)s; font-size: 11px; font-weight: 600; color: #864e18; background: #fde9d4; padding: 1px 5px; border-radius: 3px; height: 17px; flex-shrink: 0;">%(ref)s</span>
                <div style="min-width: 0; flex-grow: 1;">
                  <div style="font-family: %(mono)s; font-size: 11.5px; color: #1a1510; word-break: break-word;">%(call)s</div>
                  <div style="margin-top: 3px; font-family: %(mono)s; font-size: 11.5px; color: %(rc)s; word-break: break-word;">→ %(result)s</div>
                </div>
              </div>''' % dict(ref=ref, call=call, result=result, mono=MONO,
                               bg='#fbe4e4' if bad else 'transparent', rc='#a32a2a' if bad else '#857f79')


cluster_content = '''    <div style="flex-grow: 1; overflow-y: auto; padding: 20px 28px 28px;">
      <div style="display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: #857f79;">
        <a href="#">Findings</a><span>/</span><a href="#">Bugs</a>
      </div>

      <div style="margin-top: 12px; display: flex; align-items: flex-start; gap: 14px;">
        <span style="width: 5px; height: 52px; border-radius: 3px; background: #d03b3b; flex-shrink: 0;"></span>
        <div style="flex-grow: 1; min-width: 0;">
          <div style="display: flex; align-items: center; gap: 9px;">
            <span style="font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: #a32a2a;">Critical bug</span>
            <span style="font-family: %(mono)s; font-size: 11.5px; color: #864e18; background: #fde9d4; padding: 1px 6px; border-radius: 3px;">search_tasks</span>
          </div>
          <div style="margin-top: 6px; font-size: 24px; font-weight: 600; letter-spacing: -0.01em;">Search finds nothing unless you type the capital letters</div>
          <div style="margin-top: 8px; display: flex; align-items: center; gap: 16px; font-size: 12.5px; color: #57514c;">
            <span>3 of 3 people</span><span>3 reports</span><span>first seen visit 1</span>
            <span style="display: flex; align-items: center; gap: 5px; color: #0a7a0a; font-weight: 600;">%(tick)s all 3 confirmed</span>
          </div>
        </div>
        <div style="display: flex; gap: 8px; flex-shrink: 0;">
          <span style="padding: 8px 14px; border-radius: 5px; border: 1px solid #cecac2; background: #fefdfb; font-size: 13px; font-weight: 500;">Copy the steps</span>
        </div>
      </div>

      <div style="margin-top: 22px; display: grid; grid-template-columns: minmax(0, 1fr) 470px; gap: 26px; align-items: start;">

        <div>
          <div style="font-size: 15px; font-weight: 600;">In their own words</div>
          <div style="margin-top: 4px;">
%(quotes)s
          </div>

          <div style="margin-top: 22px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px;">
            <div style="background: #fefdfb; border: 1px solid #e1ded7; border-radius: 7px; padding: 14px 16px;">
              <div style="font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #857f79;">They expected</div>
              <div style="margin-top: 7px; font-size: 14px; line-height: 1.55;">Searching “groceries” finds the task called “Buy Groceries”, the way the tool description says it will.</div>
            </div>
            <div style="background: #fefdfb; border: 1px solid #e1ded7; border-radius: 7px; padding: 14px 16px;">
              <div style="font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #857f79;">What happened</div>
              <div style="margin-top: 7px; font-size: 14px; line-height: 1.55;">Zero results. The same search with a capital G returns it. The match is case-sensitive; the description promises it is not.</div>
            </div>
          </div>

          <div style="margin-top: 14px; padding: 13px 16px; border-radius: 7px; background: #fde9d4; border: 1px solid #f3d6b4;">
            <div style="font-size: 13px; line-height: 1.55; color: #6b431a;"><strong style="font-weight: 600;">What it cost.</strong> Casey wrote the same task a second time rather than search again. Tomás stopped using search for the rest of his visit and paged through lists instead.</div>
          </div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 16px;">
          <div style="background: #fefdfb; border: 1px solid #e1ded7; border-radius: 7px; overflow: hidden;">
            <div style="padding: 12px 14px; border-bottom: 1px solid #e1ded7; display: flex; align-items: center; gap: 8px;">
              <div style="font-size: 13.5px; font-weight: 600;">The calls behind this</div>
              <span style="font-size: 11.5px; color: #857f79;">Casey, visit 1</span>
              <div style="flex-grow: 1;"></div>
              <a href="#" style="font-size: 11.5px;">open the full visit</a>
            </div>
%(steps)s
          </div>

          <div style="background: #fefdfb; border: 1px solid #e1ded7; border-radius: 7px; padding: 14px 16px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <div style="font-size: 13.5px; font-weight: 600;">We ran those calls again ourselves</div>
              <span style="display: flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 4px; background: #e2f6e2; color: #0a7a0a; font-size: 11.5px; font-weight: 600;">%(tick)s confirmed</span>
            </div>
            <div style="margin-top: 9px; font-size: 13px; line-height: 1.6; color: #57514c;">The replay reproduced it exactly: <span style="font-family: %(mono)s; font-size: 12px;">search_tasks({"q":"groceries"})</span> returned 0 results against a task that exists. The judge ruled the tool description wrong, not the person.</div>
            <div style="margin-top: 10px; display: flex; flex-wrap: wrap; gap: 14px; font-family: %(mono)s; font-size: 11px; color: #857f79;">
              <span>claude-opus-5 · high</span><span>14:12:40</span><span>$0.03</span>
            </div>
          </div>

          <div style="background: #fefdfb; border: 1px solid #e1ded7; border-radius: 7px; padding: 14px 16px;">
            <div style="font-size: 13.5px; font-weight: 600;">Also reported by</div>
            <div style="margin-top: 10px; display: flex; flex-direction: column; gap: 9px;">
              <div style="display: flex; align-items: center; gap: 9px; font-size: 13px;"><span style="width: 22px; height: 22px; border-radius: 11px; background: #f3f0ea; color: #57514c; font-size: 11px; font-weight: 600; display: flex; align-items: center; justify-content: center;">PD</span><span style="flex-grow: 1;">Priya Desai · visit 2</span><a href="#" style="font-size: 12px;">her calls</a></div>
              <div style="display: flex; align-items: center; gap: 9px; font-size: 13px;"><span style="width: 22px; height: 22px; border-radius: 11px; background: #f3f0ea; color: #57514c; font-size: 11px; font-weight: 600; display: flex; align-items: center; justify-content: center;">TR</span><span style="flex-grow: 1;">Tomás Ruiz · visit 2</span><a href="#" style="font-size: 12px;">his calls</a></div>
            </div>
          </div>
        </div>
      </div>
    </div>''' % dict(
    mono=MONO, tick=TICK,
    quotes='\n'.join([
        quote('CM', 'Casey Morgan', '1', 'I added Buy Groceries a minute ago and searching groceries says there is nothing there. I am not going to keep guessing how it wants me to type.'),
        quote('PD', 'Priya Desai', '2', 'Search only works if I remember exactly how I capitalised the task, which defeats the point of searching.'),
        quote('TR', 'Tomás Ruiz', '2', 'Case-sensitive search across two hundred tasks is unusable. I paged through the lists instead.'),
    ]),
    steps='\n'.join([
        step('c1', 'create_task({"projectId":"prj_2a9","title":"Buy Groceries"})', '{"task":{"id":"tsk_77c","title":"Buy Groceries"}}'),
        step('c2', 'search_tasks({"q":"groceries"})', '{"tasks":[],"total":0}', bad=True),
        step('c3', 'search_tasks({"q":"grocery"})', '{"tasks":[],"total":0}', bad=True),
        step('c4', 'search_tasks({"q":"Groceries"})', '{"tasks":[{"id":"tsk_77c",…}],"total":1}'),
    ]))

write('Cluster.dc.html', shell('findings', RUN_PICKER, cluster_content, height=980))


# ---------------------------------------------------------- Coverage gaps --
def gap_card(tool, title, line, asks, quotes, instead, flag=''):
    qs = '\n'.join(['''              <div style="padding: 10px 0; border-bottom: 1px solid #e1ded7;">
                <div style="font-size: 13.5px; line-height: 1.55;">“%s”</div>
                <div style="margin-top: 4px; font-size: 11.5px; color: #857f79;">%s</div>
              </div>''' % (t, who) for t, who in quotes])
    return '''        <div style="background: #fefdfb; border: 1px solid #e1ded7; border-radius: 7px; padding: 16px 18px;">
          <div style="display: flex; align-items: center; gap: 9px;">
            <span style="font-family: %(mono)s; font-size: 12px; color: #864e18; background: #fde9d4; padding: 2px 7px; border-radius: 3px;">%(tool)s</span>
            %(flag)s
            <div style="flex-grow: 1;"></div>
            <span style="font-size: 12px; color: #857f79;">%(asks)s</span>
          </div>
          <div style="margin-top: 9px; font-size: 17px; font-weight: 600;">%(title)s</div>
          <div style="margin-top: 6px; font-size: 13.5px; color: #57514c; line-height: 1.55;">%(line)s</div>
          <div style="margin-top: 12px; display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 20px; align-items: start;">
            <div>
%(qs)s
            </div>
            <div style="background: #f3f0ea; border-radius: 6px; padding: 12px 14px;">
              <div style="font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #857f79;">What they did instead</div>
              <div style="margin-top: 7px; font-size: 13px; line-height: 1.55; color: #1a1510;">%(instead)s</div>
            </div>
          </div>
        </div>''' % dict(mono=MONO, tool=tool, title=title, line=line, asks=asks, qs=qs, instead=instead, flag=flag)


def unused(tool, calls, note):
    return '''            <div style="display: flex; align-items: center; gap: 12px; padding: 9px 14px; border-bottom: 1px solid #e1ded7;">
              <span style="font-family: %s; font-size: 12.5px; flex-grow: 1;">%s</span>
              <span style="font-family: %s; font-size: 12px; color: %s; width: 58px; text-align: right;">%s</span>
              <span style="font-size: 12px; color: #857f79; width: 230px;">%s</span>
            </div>''' % (MONO, tool, MONO, '#857f79' if calls == '0' else '#1a1510', calls, note)


gaps_content = '''    <div style="flex-grow: 1; overflow-y: auto; padding: 22px 28px 28px;">
      <div style="font-size: 22px; font-weight: 600; letter-spacing: -0.01em;">Coverage gaps</div>
      <div style="margin-top: 5px; font-size: 13.5px; color: #57514c; max-width: 780px;">What people came to Tasklet to do and found no way to do. This is the part of the report that is about what to build next rather than what to fix.</div>

      <div style="margin-top: 18px; display: flex; flex-direction: column; gap: 12px;">
%(cards)s
      </div>

      <div style="margin-top: 26px;">
        <div style="display: flex; align-items: baseline; gap: 10px;">
          <div style="font-size: 15px; font-weight: 600;">Tools you expose that nobody reached for</div>
          <div style="font-size: 12px; color: #857f79;">5 of your 19 were never called at all; one was reached once and abandoned</div>
        </div>
        <div style="margin-top: 10px; background: #fefdfb; border: 1px solid #e1ded7; border-radius: 7px; overflow: hidden;">
          <div style="display: flex; align-items: center; gap: 12px; padding: 8px 14px; border-bottom: 1px solid #e1ded7; background: #f3f0ea; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: #857f79;">
            <span style="flex-grow: 1;">Tool</span><span style="width: 58px; text-align: right;">Calls</span><span style="width: 230px;">Worth a look because</span>
          </div>
%(rows)s
        </div>
      </div>
    </div>''' % dict(
    cards='\n'.join([
        gap_card('delete_task — no such tool',
                 'There is no way to delete a task',
                 'Your landing page says “Delete tasks you no longer need.” Nothing in the MCP surface does it. Only whole projects can be deleted, and someone did exactly that.',
                 '2 people · 3 asks',
                 [('I finished the wrong task and I just want it gone. There is complete_task and there is delete_project and nothing in between.', 'Tomás Ruiz · visit 2'),
                  ('I made a typo in a task title on a client project. I could not remove it, so it is still sitting there wrong.', 'Priya Desai · visit 1')],
                 'Tomás deleted the whole project — nine other tasks with it — to get rid of one. Priya left the wrong task in place.',
                 flag=PROMISED),
        gap_card('nothing exposes this',
                 'No way to see everything due this week',
                 'Due dates exist per task, and tasks are only listable per project. Anyone working across projects has to assemble the week by hand.',
                 '1 person · 1 ask',
                 [('I have four clients. I want one list of what is due by Friday, not four lists I hold in my head.', 'Priya Desai · visit 2')],
                 'Listed each project in turn, then gave up on assembling it.'),
    ]),
    rows='\n'.join([
        unused('reopen_task', '0', 'nobody ever un-completed anything'),
        unused('add_comment', '0', 'no one treated tasks as a place to talk'),
        unused('list_comments', '0', 'follows from the above'),
        unused('get_stats', '0', 'never discovered, never asked for'),
        unused('upgrade_plan', '1', 'reached once, at the project cap, and abandoned'),
        unused('log_in', '0', 'everyone signed up fresh; the return path is untested'),
    ]))

write('Gaps.dc.html', shell('gaps', RUN_PICKER, gaps_content, height=1040))


# ------------------------------------------------------------ Population ---
def memory_col(title, items, tint):
    lis = '\n'.join(['''            <div style="padding: 8px 0; border-bottom: 1px solid #e1ded7;">
              <div style="font-size: 12.5px; line-height: 1.5; color: #1a1510;">%s</div>
              <div style="margin-top: 3px; font-size: 11px; color: #857f79;">visit %s</div>
            </div>''' % (t, v) for t, v in items])
    return '''          <div>
            <div style="display: flex; align-items: center; gap: 7px;">
              <span style="width: 7px; height: 7px; border-radius: 4px; background: %s;"></span>
              <div style="font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #857f79;">%s</div>
            </div>
            <div style="margin-top: 6px;">
%s
            </div>
          </div>''' % (tint, title, lis)


def agent_row(initials, name, persona, role, visits, findings, state, state_color, last):
    return '''      <div style="background: #fefdfb; border: 1px solid #e1ded7; border-radius: 7px; padding: 14px 16px; display: flex; align-items: center; gap: 13px;">
        <span style="width: 32px; height: 32px; border-radius: 16px; background: #f3f0ea; color: #57514c; font-size: 12px; font-weight: 600; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">%(i)s</span>
        <div style="min-width: 0; width: 250px;">
          <div style="font-size: 14.5px; font-weight: 600;">%(name)s</div>
          <div style="font-family: %(mono)s; font-size: 11px; color: #857f79;">%(persona)s</div>
        </div>
        <div style="flex-grow: 1; min-width: 0; font-size: 13px; color: #57514c;">%(role)s</div>
        <div style="width: 90px; font-size: 12.5px; color: #57514c;">%(visits)s visits</div>
        <div style="width: 110px; font-size: 12.5px; color: #57514c;">%(findings)s findings</div>
        <div style="width: 150px; font-size: 12.5px; font-weight: 600; color: %(sc)s;">%(state)s</div>
        <div style="width: 130px; font-size: 12px; color: #857f79;">%(last)s</div>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#cecac2" stroke-width="1.6" style="flex-shrink: 0;"><path d="M4 6.5 8 10.5l4-4"/></svg>
      </div>''' % dict(i=initials, name=name, persona=persona, role=role, visits=visits, findings=findings, state=state, sc=state_color, last=last, mono=MONO)


population_content = '''    <div style="flex-grow: 1; overflow-y: auto; padding: 22px 28px 28px;">
      <div style="font-size: 22px; font-weight: 600; letter-spacing: -0.01em;">Population</div>
      <div style="margin-top: 5px; font-size: 13.5px; color: #57514c; max-width: 820px;">Three people, grown from three personas, each on their own schedule. Everything they remember between visits is here — it is what makes the fourth visit different from the first.</div>

      <div style="margin-top: 18px; display: flex; flex-direction: column; gap: 10px;">
%(rows)s

        <div style="background: #fefdfb; border: 1px solid #236292; border-radius: 7px; overflow: hidden;">
          <div style="padding: 15px 18px; display: flex; align-items: flex-start; gap: 13px; border-bottom: 1px solid #e1ded7;">
            <span style="width: 34px; height: 34px; border-radius: 17px; background: #f3f0ea; color: #57514c; font-size: 12.5px; font-weight: 600; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">PD</span>
            <div style="flex-grow: 1; min-width: 0;">
              <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 16px; font-weight: 600;">Priya Desai</span>
                <span style="font-family: %(mono)s; font-size: 11px; color: #857f79;">tasklet-trial/project-planner#0</span>
                <span style="padding: 2px 9px; border-radius: 4px; background: #fbe4e4; color: #a32a2a; font-size: 11.5px; font-weight: 600;">left at visit 3</span>
                <span style="padding: 2px 9px; border-radius: 4px; background: #e2f6e2; color: #0a7a0a; font-size: 11.5px; font-weight: 600;">said she would come back</span>
              </div>
              <div style="margin-top: 5px; font-size: 13px; color: #57514c;">A freelance designer who plans client projects with deadlines. Methodical, reads the docs, expects fields she sets to stick.</div>
              <div style="margin-top: 9px; display: flex; flex-wrap: wrap; gap: 16px; font-size: 11.5px; color: #857f79;">
                <span>patience 4 of 5</span><span>would pay $12 a month</span><span>claude-sonnet-5 · medium</span>
                <span style="font-family: %(mono)s;">priya.desai+m1abc2de@populace.test</span>
              </div>
            </div>
            <div style="display: flex; flex-direction: column; align-items: flex-end; flex-shrink: 0;">
              <div style="display: flex; align-items: center; gap: 5px;">
              <span style="font-size: 11.5px; color: #857f79; margin-right: 4px;">visits</span>
              <span style="width: 22px; height: 22px; border-radius: 4px; background: #e2f6e2; color: #0a7a0a; font-size: 11px; font-weight: 600; display: flex; align-items: center; justify-content: center;">1</span>
              <span style="width: 22px; height: 22px; border-radius: 4px; background: #e2f6e2; color: #0a7a0a; font-size: 11px; font-weight: 600; display: flex; align-items: center; justify-content: center;">2</span>
              <span style="width: 22px; height: 22px; border-radius: 4px; background: #fbe4e4; color: #a32a2a; font-size: 11px; font-weight: 600; display: flex; align-items: center; justify-content: center;">3</span>
              <span style="width: 22px; height: 22px; border-radius: 4px; background: #f3f0ea; color: #857f79; font-size: 11px; display: flex; align-items: center; justify-content: center;">4</span>
              </div>
              <div style="margin-top: 6px; font-size: 11.5px; color: #857f79;">1 and 2 went fine, she gave up on 3, and 4 never happened</div>
            </div>
          </div>
          <div style="padding: 15px 18px;">
            <div style="font-size: 13.5px; font-weight: 600;">What she is carrying</div>
            <div style="margin-top: 12px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px;">
%(cols)s
            </div>
          </div>
        </div>
      </div>
    </div>''' % dict(
    mono=MONO,
    rows='\n'.join([
        agent_row('CM', 'Casey Morgan', 'tasklet-trial/casual-lister#0', 'A hobbyist who keeps grocery and chore lists on their phone', '4', '3', 'Still coming back', '#0a7a0a', 'last visit 14:38'),
        agent_row('TR', 'Tomás Ruiz', 'tasklet-trial/power-organizer#0', 'An operations lead who organises a dozen parallel workstreams', '4', '5', 'Still coming back', '#0a7a0a', 'last visit 14:41'),
    ]),
    cols='\n'.join([
        memory_col('Waiting on', [('A due date that saves when she changes it', '2'), ('One list of everything due this week', '2')], '#fab219'),
        memory_col('What annoyed her', [('update_task said it saved the new due date and it did not', '2'), ('Search only matches if the capitals line up', '2'), ('Tried the same deadline change four times', '3')], '#d03b3b'),
        memory_col('Already done', [('Signed up and confirmed the account works', '1'), ('Set up the client launch project', '1'), ('Added six dated tasks', '1'), ('Found where overdue work shows up', '2')], '#0ca30c'),
    ]))

write('Population.dc.html', shell('population', RUN_PICKER, population_content, height=980))


# ---------------------------------------------------------------- Wakes ----
STATUS = {
  'done': ('#0ca30c', '#0a7a0a', 'finished'),
  'gave-up': ('#d03b3b', '#a32a2a', 'gave up'),
  'max-turns': ('#fab219', '#8a6206', 'ran out of turns'),
  'budget-exceeded': ('#ec835a', '#a34a20', 'hit its budget'),
  'running': ('#236292', '#236292', 'still going'),
}


def wake_row(when, initials, who, persona, n, status, turns, calls, found, cost, ret):
    dot, ink, label = STATUS[status]
    return '''          <div style="display: flex; align-items: center; gap: 14px; padding: 11px 16px; border-bottom: 1px solid #e1ded7;">
            <span style="font-family: %(mono)s; font-size: 11.5px; color: #857f79; width: 52px;">%(when)s</span>
            <span style="width: 24px; height: 24px; border-radius: 12px; background: #f3f0ea; color: #57514c; font-size: 11px; font-weight: 600; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">%(i)s</span>
            <div style="width: 220px; min-width: 0;">
              <div style="font-size: 13px; font-weight: 500;">%(who)s</div>
              <div style="font-family: %(mono)s; font-size: 11px; color: #857f79;">%(persona)s</div>
            </div>
            <span style="font-size: 12.5px; color: #57514c; width: 54px;">visit %(n)s</span>
            <div style="width: 150px; display: flex; align-items: center; gap: 7px;">
              <span style="width: 7px; height: 7px; border-radius: 4px; background: %(dot)s;"></span>
              <span style="font-size: 12.5px; font-weight: 600; color: %(ink)s;">%(label)s</span>
            </div>
            <span style="font-family: %(mono)s; font-size: 12px; color: #57514c; width: 62px; text-align: right;">%(turns)s</span>
            <span style="font-family: %(mono)s; font-size: 12px; color: #57514c; width: 62px; text-align: right;">%(calls)s</span>
            <span style="font-family: %(mono)s; font-size: 12px; color: %(fc)s; width: 62px; text-align: right;">%(found)s</span>
            <span style="font-family: %(mono)s; font-size: 12px; color: #57514c; width: 62px; text-align: right;">%(cost)s</span>
            <span style="font-size: 12px; color: #857f79; width: 96px;">%(ret)s</span>
            <a href="#" style="font-size: 12.5px; flex-shrink: 0;">watch</a>
          </div>''' % dict(mono=MONO, when=when, i=initials, who=who, persona=persona, n=n, dot=dot, ink=ink,
                           label=label, turns=turns, calls=calls, found=found, cost=cost, ret=ret,
                           fc='#1a1510' if found != '0' else '#a09a92')


HEADCELL = '''          <div style="display: flex; align-items: center; gap: 14px; padding: 8px 16px; border-bottom: 1px solid #e1ded7; background: #f3f0ea; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: #857f79;">
            <span style="width: 52px;">Time</span><span style="width: 24px;"></span><span style="width: 220px;">Who</span><span style="width: 54px;"></span><span style="width: 150px;">How it ended</span>
            <span style="width: 62px; text-align: right;">Turns</span><span style="width: 62px; text-align: right;">Calls</span><span style="width: 62px; text-align: right;">Found</span><span style="width: 62px; text-align: right;">Cost</span><span style="width: 96px;">Coming back</span><span style="width: 38px;"></span>
          </div>'''

wakes_content = '''    <div style="flex-grow: 1; display: flex; flex-direction: column; min-height: 0; padding: 22px 28px 0;">
      <div style="flex-shrink: 0;">
        <div style="font-size: 22px; font-weight: 600; letter-spacing: -0.01em;">Wakes</div>
        <div style="margin-top: 5px; font-size: 13.5px; color: #57514c;">Every visit anyone made to Tasklet in this run, newest first. Open one to watch it happen call by call.</div>
        <div style="margin-top: 14px; display: flex; align-items: center; gap: 7px;">
          %(chips)s
          <div style="flex-grow: 1;"></div>
          <span style="font-family: %(mono)s; font-size: 11.5px; color: #857f79;">11 visits · 141 calls · $3.67 on the visits, $0.70 checking what they found</span>
        </div>
      </div>
      <div style="margin-top: 14px; flex-grow: 1; overflow-y: auto; background: #fefdfb; border: 1px solid #e1ded7; border-top-left-radius: 7px; border-top-right-radius: 7px;">
%(head)s
%(rows)s
      </div>
    </div>''' % dict(
    mono=MONO, head=HEADCELL,
    chips=' '.join([chip('All 11', True), chip('Finished 8'), chip('Gave up 1'), chip('Ran out of turns 2'), chip('Hit a budget 0'), chip('Errored 0')]),
    rows='\n'.join([
        wake_row('14:41', 'TR', 'Tomás Ruiz', 'power-organizer#0', '4', 'done', '11', '19', '1', '$0.61', 'yes'),
        wake_row('14:38', 'CM', 'Casey Morgan', 'casual-lister#0', '4', 'max-turns', '40', '22', '1', '$0.44', '—'),
        wake_row('14:34', 'PD', 'Priya Desai', 'project-planner#0', '3', 'gave-up', '6', '6', '1', '$0.42', 'yes'),
        wake_row('14:30', 'TR', 'Tomás Ruiz', 'power-organizer#0', '3', 'done', '9', '17', '1', '$0.58', 'yes'),
        wake_row('14:27', 'CM', 'Casey Morgan', 'casual-lister#0', '3', 'done', '7', '9', '1', '$0.22', 'yes'),
        wake_row('14:23', 'PD', 'Priya Desai', 'project-planner#0', '2', 'done', '12', '18', '2', '$0.48', 'yes'),
        wake_row('14:19', 'TR', 'Tomás Ruiz', 'power-organizer#0', '2', 'max-turns', '40', '16', '1', '$0.39', '—'),
        wake_row('14:15', 'CM', 'Casey Morgan', 'casual-lister#0', '2', 'done', '6', '8', '0', '$0.18', 'yes'),
        wake_row('14:10', 'PD', 'Priya Desai', 'project-planner#0', '1', 'done', '10', '9', '1', '$0.15', 'yes'),
        wake_row('14:06', 'TR', 'Tomás Ruiz', 'power-organizer#0', '1', 'done', '8', '10', '2', '$0.14', 'yes'),
        wake_row('14:02', 'CM', 'Casey Morgan', 'casual-lister#0', '1', 'done', '7', '7', '1', '$0.06', 'yes'),
    ]))

write('Wakes.dc.html', shell('wakes', RUN_PICKER, wakes_content, height=900))
