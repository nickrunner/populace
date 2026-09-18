#!/usr/bin/env python3
# M2 artboards: setting populace up and driving it from the browser.
from build import HEAD, TAIL, ICONS, write

MONO = "'IBM Plex Mono', ui-monospace, monospace"

NAV2 = [
  ('item', 'overview', 'Overview', ''),
  ('label', None, 'What we found', None),
  ('item', 'findings', 'Findings', '12'),
  ('item', 'gaps', 'Coverage gaps', '2'),
  ('item', 'left', 'Who walked away', '1'),
  ('label', None, 'How it ran', None),
  ('item', 'population', 'Population', '3'),
  ('item', 'wakes', 'Wakes', '11'),
  ('item', 'cost', 'Cost', ''),
  ('label', None, 'Set up', None),
  ('item', 'target', 'The target', ''),
  ('item', 'people', 'The people', '3'),
  ('item', 'limits', 'Limits and spending', ''),
]
ICONS2 = dict(ICONS)
ICONS2['target'] = '<circle cx="8" cy="8" r="5.8"/><circle cx="8" cy="8" r="2.2"/>'
ICONS2['people'] = '<circle cx="8" cy="5.4" r="2.6"/><path d="M2.8 13.6c0-2.6 2.3-4.2 5.2-4.2s5.2 1.6 5.2 4.2"/>'
ICONS2['limits'] = '<path d="M2.5 5h11M2.5 11h11"/><circle cx="6" cy="5" r="1.8"/><circle cx="10.5" cy="11" r="1.8"/>'

START = '''      <div style="padding: 14px 12px 0;">
        <div style="display: flex; align-items: center; justify-content: center; gap: 8px; padding: 9px 12px; border-radius: 6px; background: #236292; color: #fefdfb; font-size: 13.5px; font-weight: 600;">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4.5 3.2v9.6l8-4.8z"/></svg>Start a run
        </div>
      </div>'''


def nav2(active, counts=None):
    out = ['    <div style="padding: 12px 12px; display: flex; flex-direction: column; gap: 14px;">',
           '      <div style="display: flex; flex-direction: column; gap: 2px;">']
    for kind, key, text, count in NAV2:
        if counts is not None and key in counts:
            count = counts[key]
        if kind == 'label':
            out.append('      </div>')
            out.append('      <div style="display: flex; flex-direction: column; gap: 2px;">')
            out.append('        <div style="padding: 0 10px 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.09em; text-transform: uppercase; color: #857f79;">%s</div>' % text)
            continue
        on = key == active
        style = ('padding: 8px 10px; border-radius: 5px; background: #dbeefe; color: #236292; font-size: 13.5px; font-weight: 600;'
                 if on else 'padding: 8px 10px; border-radius: 5px; color: #57514c; font-size: 13.5px;')
        badge = ('<span style="color: #857f79; font-size: 12px;">%s</span>' % count) if count else ''
        out.append('        <div style="display: flex; align-items: center; gap: 10px; %s">' % style)
        out.append('          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">%s</svg>' % ICONS2[key])
        out.append('          <span style="flex-grow: 1;">%s</span>%s' % (text, badge))
        out.append('        </div>')
    out.append('      </div>')
    out.append('    </div>')
    return '\n'.join(out)


def shell2(active, topbar_right, content, height=980, spend_block=None, counts=None):
    spend = spend_block or '''      <div style="display: flex; justify-content: space-between; align-items: baseline;">
        <div style="font-size: 11.5px; color: #57514c;">Spent today</div>
        <div style="font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 12px; font-weight: 600;">$4.37</div>
      </div>
      <div style="margin-top: 7px; height: 6px; border-radius: 3px; background: #dbeefe; overflow: hidden;">
        <div style="width: 9%; height: 6px; border-radius: 3px; background: #236292;"></div>
      </div>
      <div style="margin-top: 6px; font-size: 11px; color: #857f79;">of the $50.00 daily ceiling</div>'''
    return HEAD + '''
<div style="width: 1440px; height: %(h)dpx; display: flex; background: #f9f6f2; overflow: hidden;">

  <div style="width: 228px; flex-shrink: 0; background: #fefdfb; border-right: 1px solid #e1ded7; display: flex; flex-direction: column;">
    <div style="padding: 18px 20px 16px; border-bottom: 1px solid #e1ded7;">
      <div style="font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 13px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase;">populace</div>
      <div style="margin-top: 2px; font-size: 11px; color: #857f79;">running on this machine</div>
    </div>
%(start)s
%(nav)s
    <div style="margin-top: auto; padding: 16px 18px; border-top: 1px solid #e1ded7;">
%(spend)s
    </div>
  </div>

  <div style="flex-grow: 1; display: flex; flex-direction: column; min-width: 0;">
    <div style="height: 56px; flex-shrink: 0; border-bottom: 1px solid #e1ded7; background: #fefdfb; display: flex; align-items: center; gap: 14px; padding: 0 24px;">
%(right)s
    </div>

%(content)s
  </div>
</div>
''' % {'h': height, 'start': START, 'nav': nav2(active, counts), 'right': topbar_right, 'content': content, 'spend': spend} + TAIL


def field(label, value, hint='', mono=False, w=''):
    return '''        <div style="%(w)s">
          <div style="font-size: 12px; font-weight: 600; color: #57514c;">%(label)s</div>
          <div style="margin-top: 6px; padding: 9px 12px; border: 1px solid #cecac2; border-radius: 5px; background: #fefdfb; font-family: %(f)s; font-size: 13px; color: #1a1510;">%(value)s</div>
          %(hint)s
        </div>''' % dict(label=label, value=value, f=(MONO if mono else "'Instrument Sans', system-ui, sans-serif"),
                         hint=('<div style="margin-top: 5px; font-size: 11.5px; color: #857f79;">%s</div>' % hint) if hint else '',
                         w=w)


def tool_row(name, desc, flag=''):
    return '''          <div style="display: flex; align-items: baseline; gap: 10px; padding: 7px 14px; border-bottom: 1px solid #e1ded7;">
            <span style="font-family: %s; font-size: 12px; width: 132px; flex-shrink: 0;">%s</span>
            <span style="font-size: 12px; color: #857f79; flex-grow: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">%s</span>%s
          </div>''' % (MONO, name, desc, flag)


DESTRUCTIVE = '<span style="font-size: 11px; font-weight: 600; color: #a34a20; background: #fde9d4; padding: 1px 6px; border-radius: 3px; flex-shrink: 0;">destructive</span>'
FOUND = '<span style="font-size: 11px; font-weight: 600; color: #0a7a0a; background: #e2f6e2; padding: 1px 6px; border-radius: 3px; flex-shrink: 0;">we think this is the sign-up</span>'

TOP_SETUP = '''      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="width: 7px; height: 7px; border-radius: 4px; background: #0ca30c;"></span>
        <span style="font-size: 15px; font-weight: 600;">Tasklet</span>
        <span style="font-size: 11.5px; color: #0a7a0a;">connected</span>
      </div>
      <span style="font-size: 12px; color: #857f79;">saved 4 minutes ago</span>
      <div style="flex-grow: 1;"></div>
      <span style="padding: 8px 13px; border-radius: 5px; border: 1px solid #cecac2; background: #fefdfb; font-size: 12.5px; font-weight: 500;">Export as YAML</span>
      <span style="padding: 8px 13px; border-radius: 5px; background: #236292; color: #fefdfb; font-size: 12.5px; font-weight: 600;">Save</span>'''

connect_content = '''    <div style="flex-grow: 1; overflow-y: auto; padding: 22px 28px 28px;">
      <div style="font-size: 22px; font-weight: 600; letter-spacing: -0.01em;">The target</div>
      <div style="margin-top: 5px; font-size: 13.5px; color: #57514c; max-width: 800px;">The app you want people sent at. Populace talks to it over MCP and nothing else, so an address and a working tool list is the whole of what it needs.</div>

      <div style="margin-top: 20px; display: grid; grid-template-columns: minmax(0, 1fr) 520px; gap: 26px; align-items: start;">

        <div style="display: flex; flex-direction: column; gap: 18px;">
%(fields)s

          <div>
            <div style="font-size: 15px; font-weight: 600;">How our people get an account</div>
            <div style="margin-top: 4px; font-size: 12.5px; color: #57514c;">Every person we send needs to be a real account, so we can delete every one of them afterwards.</div>
            <div style="margin-top: 11px; display: flex; flex-direction: column; gap: 8px;">
              <div style="border: 2px solid #236292; border-radius: 7px; background: #fefdfb; padding: 13px 15px;">
                <div style="display: flex; align-items: center; gap: 9px;">
                  <span style="width: 15px; height: 15px; border-radius: 8px; border: 4px solid #236292;"></span>
                  <span style="font-size: 13.5px; font-weight: 600;">They sign themselves up, through your own tools</span>
                </div>
                <div style="margin-top: 4px; margin-left: 24px; font-size: 12.5px; color: #57514c;">The honest one: whatever a real person would go through on their first visit, they go through too.</div>
                <div style="margin-top: 12px; margin-left: 24px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px;">
%(identity)s
                </div>
              </div>
              <div style="border: 1px solid #cecac2; border-radius: 7px; background: #fefdfb; padding: 12px 15px; display: flex; align-items: center; gap: 9px;">
                <span style="width: 15px; height: 15px; border-radius: 8px; border: 1px solid #cecac2;"></span>
                <span style="font-size: 13.5px;">Everyone shares one account I give you</span>
                <span style="font-size: 12px; color: #857f79;">— fine for a read-only look, no first-run signal</span>
              </div>
              <div style="border: 1px solid #cecac2; border-radius: 7px; background: #fefdfb; padding: 12px 15px; display: flex; align-items: center; gap: 9px;">
                <span style="width: 15px; height: 15px; border-radius: 8px; border: 1px solid #cecac2;"></span>
                <span style="font-size: 13.5px;">Mint accounts through an admin API</span>
                <span style="font-size: 12px; color: #857f79;">— when sign-up is not exposed over MCP</span>
              </div>
            </div>
          </div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 14px;">
          <div style="background: #fefdfb; border: 1px solid #e1ded7; border-radius: 7px; overflow: hidden;">
            <div style="padding: 13px 15px; border-bottom: 1px solid #e1ded7; display: flex; align-items: center; gap: 9px;">
              <span style="display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: #0a7a0a;">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#0ca30c" stroke-width="2"><path d="M3 8.4 6.4 12 13 4.6"/></svg>Connected
              </span>
              <span style="font-family: %(mono)s; font-size: 11.5px; color: #857f79;">240ms · MCP 2025-06-18 · 19 tools</span>
              <div style="flex-grow: 1;"></div>
              <span style="font-size: 12px; color: #236292;">Check again</span>
            </div>
%(tools)s
            <div style="padding: 9px 14px; font-size: 11.5px; color: #857f79;">and 11 more</div>
          </div>

          <div style="background: #fde9d4; border: 1px solid #f3d6b4; border-radius: 7px; padding: 13px 15px;">
            <div style="display: flex; gap: 9px;">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#864e18" stroke-width="1.5" style="flex-shrink: 0; margin-top: 1px;"><path d="M8 5v3.6M8 11.2v.01"/><circle cx="8" cy="8" r="5.8"/></svg>
              <div style="font-size: 12.5px; line-height: 1.55; color: #6b431a;"><strong style="font-weight: 600;">Two tools have no description.</strong> People decide what to try from the descriptions alone, so <span style="font-family: %(mono)s; font-size: 11.5px;">get_stats</span> and <span style="font-family: %(mono)s; font-size: 11.5px;">reopen_task</span> will most likely never be touched. That is worth fixing before a run, not after.</div>
            </div>
          </div>

          <div style="background: #fefdfb; border: 1px solid #e1ded7; border-radius: 7px; padding: 13px 15px;">
            <div style="font-size: 13px; font-weight: 600;">What your website promises</div>
            <div style="margin-top: 6px; font-size: 12.5px; line-height: 1.55; color: #57514c;">Fetched from the web address above, and it says one thing your own description does not. A promise here that no tool keeps is exactly what comes back as a coverage gap.</div>
            <div style="margin-top: 9px; padding: 10px 12px; border-radius: 6px; background: #f3f0ea; font-size: 12.5px; line-height: 1.55; color: #1a1510;">“Tasklet keeps your projects and tasks in one place. Create projects, add tasks with due dates and priorities, search everything instantly, comment on tasks, and tick them off. <span style="background: #fde9d4; color: #6b431a; font-weight: 600; padding: 0 3px; border-radius: 2px;">Delete tasks you no longer need.</span> Free for up to 3 projects; Pro is $6/month.”</div>
            <div style="margin-top: 8px; font-size: 11.5px; color: #6b431a;">Nothing in the tool list deletes a task.</div>
          </div>
        </div>
      </div>
    </div>''' % dict(
    mono=MONO,
    fields='\n'.join([
        field('What it is called', 'Tasklet', 'Only ever shown to you.'),
        '''        <div>
          <div style="font-size: 12px; font-weight: 600; color: #57514c;">Where its MCP server is</div>
          <div style="margin-top: 6px; display: flex; gap: 8px;">
            <div style="flex-grow: 1; padding: 9px 12px; border: 1px solid #236292; border-radius: 5px; background: #fefdfb; font-family: %s; font-size: 13px;">http://127.0.0.1:4310/mcp</div>
            <div style="padding: 9px 12px; border: 1px solid #cecac2; border-radius: 5px; background: #fefdfb; font-size: 13px; color: #857f79; width: 190px;">bearer token, if it needs one</div>
          </div>
          <div style="margin-top: 7px; font-size: 12px; color: #236292;">+ Add another endpoint</div>
        </div>''' % MONO,
        field('Its web address', 'http://127.0.0.1:4310', 'Optional. People read the landing page the way anyone would before signing up.', mono=True),
        '''        <div>
          <div style="font-size: 12px; font-weight: 600; color: #57514c;">What it says it does</div>
          <div style="margin-top: 6px; padding: 10px 12px; border: 1px solid #cecac2; border-radius: 5px; background: #fefdfb; font-size: 13px; line-height: 1.55; color: #1a1510; height: 78px;">Tasklet keeps your projects and tasks in one place. Create projects, add tasks with due dates and priorities, search everything instantly, comment on tasks, and tick them off. Free for up to 3 projects; Pro is $6/month.</div>
          <div style="margin-top: 5px; font-size: 11.5px; color: #857f79;">Your own words, handed to every person before their first visit.</div>
        </div>''',
    ]),
    identity='\n'.join([
        field('The sign-up tool', 'sign_up', 'Found by matching the tool list.', mono=True),
        field('Where the token is in the reply', 'token', 'From the sign-up tool’s own result.', mono=True),
        field('Where the account id is', 'user.id', 'So a visit traces back to an account.', mono=True),
        field('The tool that deletes an account', 'delete_account', 'Used by sweep, so nothing we create is left behind.', mono=True),
    ]),
    tools='\n'.join([
        tool_row('sign_up', 'Create an account and get a token', FOUND),
        tool_row('create_project', 'Start a new project', ''),
        tool_row('create_task', 'Add a task to a project', ''),
        tool_row('search_tasks', 'Find tasks by text, case-insensitive', ''),
        tool_row('update_task', 'Change a task: title, due date, priority', ''),
        tool_row('list_tasks', 'List a project’s tasks, 20 to a page', ''),
        tool_row('delete_project', 'Delete a project and everything in it', DESTRUCTIVE),
        tool_row('delete_account', 'Delete this account and all its data', DESTRUCTIVE),
    ]))

write('Connect.dc.html', shell2('target', TOP_SETUP, connect_content, height=1120))


# ----------------------------------------------------------- Persona editor --
def lib_card(initials, name, role, on=False):
    return '''          <div style="display: flex; gap: 10px; padding: 10px 11px; border-radius: 6px; %s">
            <span style="width: 26px; height: 26px; border-radius: 13px; background: #f3f0ea; color: #57514c; font-size: 11px; font-weight: 600; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">%s</span>
            <div style="min-width: 0;">
              <div style="font-size: 13px; font-weight: 600;">%s</div>
              <div style="margin-top: 2px; font-size: 11.5px; color: #857f79; line-height: 1.35;">%s</div>
            </div>
          </div>''' % ('background: #dbeefe; border: 1px solid #236292;' if on else 'border: 1px solid transparent;', initials, name, role)


def listfield(label, items, hint=''):
    rows = '\n'.join(['''            <div style="display: flex; align-items: center; gap: 9px; padding: 8px 11px; border: 1px solid #cecac2; border-radius: 5px; background: #fefdfb;">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#cecac2" stroke-width="1.6" style="flex-shrink: 0;"><path d="M3 5h10M3 8h10M3 11h10"/></svg>
              <span style="font-size: 13px; flex-grow: 1;">%s</span>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#857f79" stroke-width="1.6" style="flex-shrink: 0;"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>
            </div>''' % i for i in items])
    return '''        <div>
          <div style="font-size: 12px; font-weight: 600; color: #57514c;">%s</div>
          <div style="margin-top: 6px; display: flex; flex-direction: column; gap: 6px;">
%s
          </div>
          <div style="margin-top: 7px; font-size: 12px; color: #236292;">+ Add one</div>
          %s
        </div>''' % (label, rows, ('<div style="margin-top: 5px; font-size: 11.5px; color: #857f79;">%s</div>' % hint) if hint else '')


TOP_PEOPLE = '''      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="width: 7px; height: 7px; border-radius: 4px; background: #0ca30c;"></span>
        <span style="font-size: 15px; font-weight: 600;">Tasklet</span>
        <span style="font-size: 11.5px; color: #0a7a0a;">connected</span>
      </div>
      <span style="width: 1px; height: 20px; background: #e1ded7;"></span>
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 15px; font-weight: 600;">Priya Desai</span>
        <span style="font-family: %s; font-size: 11.5px; color: #857f79; display: flex; align-items: center; gap: 5px;">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="#857f79" stroke-width="1.6"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.6 7V5.2a2.4 2.4 0 0 1 4.8 0V7"/></svg>project-planner</span>
      </div>
      <span style="font-size: 12px; color: #857f79;">in 1 population · saved 2 minutes ago</span>
      <div style="flex-grow: 1;"></div>
      <span style="padding: 8px 13px; border-radius: 5px; border: 1px solid #cecac2; background: #fefdfb; font-size: 12.5px; font-weight: 500;">Duplicate</span>
      <span style="padding: 8px 13px; border-radius: 5px; background: #236292; color: #fefdfb; font-size: 12.5px; font-weight: 600;">Save</span>''' % MONO

personas_content = '''    <div style="flex-grow: 1; display: flex; min-height: 0;">

      <div style="width: 282px; flex-shrink: 0; border-right: 1px solid #e1ded7; background: #fefdfb; overflow-y: auto; padding: 16px 12px;">
        <div style="padding: 0 6px 8px; font-size: 11px; font-weight: 600; letter-spacing: 0.09em; text-transform: uppercase; color: #857f79;">In this project</div>
        <div style="display: flex; flex-direction: column; gap: 3px;">
%(mine)s
        </div>
        <div style="margin-top: 20px; padding: 0 6px 8px; font-size: 11px; font-weight: 600; letter-spacing: 0.09em; text-transform: uppercase; color: #857f79;">Start from someone</div>
        <div style="display: flex; flex-direction: column; gap: 3px;">
%(starters)s
        </div>
      </div>

      <div style="flex-grow: 1; min-width: 0; overflow-y: auto; padding: 22px 26px 28px;">
        <div style="font-size: 20px; font-weight: 600; letter-spacing: -0.01em;">Who they are</div>
        <div style="margin-top: 14px; display: flex; flex-direction: column; gap: 16px;">
%(who)s
        </div>

        <div style="margin-top: 26px; font-size: 20px; font-weight: 600; letter-spacing: -0.01em;">What they came to do</div>
        <div style="margin-top: 14px; display: flex; flex-direction: column; gap: 16px;">
%(goals)s
        </div>

        <div style="margin-top: 26px; font-size: 20px; font-weight: 600; letter-spacing: -0.01em;">How they behave</div>
        <div style="margin-top: 14px;">
          <div style="font-size: 12px; font-weight: 600; color: #57514c;">How much they will put up with</div>
          <div style="margin-top: 10px; position: relative; height: 22px;">
            <div style="position: absolute; left: 0; top: 9px; width: 100%%; height: 4px; border-radius: 2px; background: #e1ded7;"></div>
            <div style="position: absolute; left: 0; top: 9px; width: 75%%; height: 4px; border-radius: 2px; background: #236292;"></div>
            <div style="position: absolute; left: 75%%; top: 0; width: 22px; height: 22px; margin-left: -11px; border-radius: 11px; background: #fefdfb; border: 2px solid #236292;"></div>
          </div>
          <div style="margin-top: 7px; display: flex; justify-content: space-between; font-size: 11.5px; color: #857f79;">
            <span>leaves at the first snag</span><span style="color: #1a1510; font-weight: 600;">4 of 5 — reads the docs before giving up</span><span>will grind through anything</span>
          </div>
        </div>
        <div style="margin-top: 18px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px;">
%(behave)s
        </div>

        <div style="margin-top: 26px; display: flex; flex-direction: column; gap: 8px;">
%(advanced)s
        </div>
      </div>

      <div style="width: 330px; flex-shrink: 0; border-left: 1px solid #e1ded7; background: #fefdfb; overflow-y: auto; padding: 20px 22px;">
        <div style="font-size: 13px; font-weight: 600;">What she will be told</div>
        <div style="margin-top: 5px; font-size: 11.5px; line-height: 1.5; color: #857f79;">Everything above, assembled the way she receives it at the start of every visit. Nothing else is in there.</div>
        <div style="margin-top: 12px; padding: 13px 14px; border-radius: 6px; background: #f3f0ea; font-size: 12.5px; line-height: 1.65; color: #1a1510;">
          You are Priya Desai, a freelance designer who plans client projects with deadlines. You run four or five client projects at once and live by due dates. You are methodical, read the docs, and expect fields you set to stick.<br><br>
          You are here to track a client launch with dated tasks, move deadlines when clients slip, and see what is overdue at a glance.<br><br>
          You would pay about $12 a month for something that did this well, and you will not hand over a card without a trial. You are on a laptop. You give a product a fair try before walking away.
        </div>
        <div style="margin-top: 16px; padding: 12px 14px; border-radius: 6px; border: 1px solid #e1ded7;">
          <div style="font-size: 12px; font-weight: 600;">Renaming her is safe</div>
          <div style="margin-top: 5px; font-size: 12px; line-height: 1.55; color: #57514c;">Her id stays <span style="font-family: %(mono)s; font-size: 11.5px;">project-planner</span> whatever you call her, so a re-run months from now still recognises her as the same person and hands her back her own memory.</div>
        </div>
      </div>
    </div>''' % dict(
    mono=MONO,
    mine='\n'.join([
        lib_card('CM', 'Casey Morgan', 'A hobbyist who keeps lists on their phone'),
        lib_card('PD', 'Priya Desai', 'A freelance designer who plans by deadline', on=True),
        lib_card('TR', 'Tomás Ruiz', 'An operations lead with a dozen workstreams'),
    ]),
    starters='\n'.join([
        lib_card('+', 'The first-timer', 'Has never heard of you and reads nothing'),
        lib_card('+', 'The deadline planner', 'Lives by dates and expects them to stick'),
        lib_card('+', 'The power user', 'Tests every limit on the first visit'),
        lib_card('+', 'The sceptic', 'Assumes it will not work and leaves fast'),
        lib_card('+', 'The bargain hunter', 'Will not pay, and says so'),
        lib_card('+', 'The one who already left', 'Comes back only if you fixed it'),
    ]),
    who='\n'.join([
        field('Their name', 'Priya Desai'),
        field('What they do', 'A freelance designer who plans client projects with deadlines'),
        '''        <div>
          <div style="font-size: 12px; font-weight: 600; color: #57514c;">Where they are coming from</div>
          <div style="margin-top: 6px; padding: 10px 12px; border: 1px solid #cecac2; border-radius: 5px; background: #fefdfb; font-size: 13px; line-height: 1.55; height: 72px;">Priya runs four or five client projects at once and lives by due dates. She is methodical, reads docs, and expects fields she sets to stick.</div>
          <div style="margin-top: 5px; font-size: 11.5px; color: #857f79;">The more specific this is, the less she behaves like everyone else you send.</div>
        </div>''',
    ]),
    goals='\n'.join([
        listfield('Their errands, in the order they would try them', [
            'Track a client launch with dated tasks',
            'Move deadlines when clients slip',
            'See what is overdue at a glance',
        ], 'They report on whether they finished each of these, not on whether your tools returned 200.'),
        listfield('What they will not do', ['Will not hand over a card without a trial']),
    ]),
    behave='\n'.join([
        field('What they would pay a month', '$12', 'Sampled between $5 and $15 for each person grown from her.'),
        field('Anything else true of them', 'device: laptop', 'Free-form. Reaches her word for word.', mono=True),
    ]),
    advanced='\n'.join(['''          <div style="display: flex; align-items: center; gap: 10px; padding: 12px 14px; border: 1px solid #e1ded7; border-radius: 6px; background: #fefdfb;">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#857f79" stroke-width="1.6"><path d="M6 4l4 4-4 4"/></svg>
            <span style="font-size: 13.5px; font-weight: 600; flex-grow: 1;">%s</span>
            <span style="font-size: 12.5px; color: #857f79;">%s</span>
          </div>''' % (t, v) for t, v in [
        ('Which of your tools she may touch', 'all 19'),
        ('What happens with destructive tools', 'ask her to confirm first'),
        ('Which model she runs on', 'the run’s default'),
    ]]))

write('Personas.dc.html', shell2('people', TOP_PEOPLE, personas_content, height=1120))


# --------------------------------------------------------------- New run ----
def stepper(value):
    return '''<div style="display: flex; align-items: center; gap: 0; border: 1px solid #cecac2; border-radius: 5px; overflow: hidden; background: #fefdfb;">
              <span style="padding: 8px 11px; font-size: 14px; color: #57514c; border-right: 1px solid #e1ded7;">&minus;</span>
              <span style="padding: 8px 14px; font-family: %s; font-size: 13px; font-weight: 600;">%s</span>
              <span style="padding: 8px 11px; font-size: 14px; color: #57514c; border-left: 1px solid #e1ded7;">+</span>
            </div>''' % (MONO, value)


def limit_row(label, value, note):
    return '''          <div style="display: flex; align-items: center; gap: 14px; padding: 11px 15px; border-bottom: 1px solid #e1ded7;">
            <span style="font-size: 13.5px; flex-grow: 1;">%s</span>
            <span style="padding: 8px 12px; border: 1px solid #cecac2; border-radius: 5px; background: #fefdfb; font-family: %s; font-size: 13px; font-weight: 500; width: 196px; text-align: right;">%s</span>
            <span style="font-size: 12px; color: #857f79; width: 214px;">%s</span>
          </div>''' % (label, MONO, value, note)


TOP_RUN = '''      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="width: 7px; height: 7px; border-radius: 4px; background: #0ca30c;"></span>
        <span style="font-size: 15px; font-weight: 600;">Tasklet</span>
        <span style="font-size: 11.5px; color: #0a7a0a;">connected</span>
      </div>
      <span style="font-size: 12px; color: #857f79;">nothing is running</span>
      <div style="flex-grow: 1;"></div>
      <span style="padding: 8px 13px; border-radius: 5px; border: 1px solid #cecac2; background: #fefdfb; font-size: 12.5px; font-weight: 500;">Carry on from an earlier run</span>'''

newrun_content = '''    <div style="flex-grow: 1; overflow-y: auto; padding: 22px 28px 28px;">
      <div style="font-size: 22px; font-weight: 600; letter-spacing: -0.01em;">Start a run</div>
      <div style="margin-top: 5px; font-size: 13.5px; color: #57514c; max-width: 820px;">A run is a fresh start: everyone forgets what they knew and meets Tasklet for the first time. Nothing is spent until you press the button.</div>

      <div style="margin-top: 20px; display: grid; grid-template-columns: minmax(0, 1fr) 396px; gap: 26px; align-items: start;">

        <div style="display: flex; flex-direction: column; gap: 22px;">
          <div>
            <div style="font-size: 15px; font-weight: 600;">Who goes</div>
            <div style="margin-top: 10px; background: #fefdfb; border: 1px solid #e1ded7; border-radius: 7px; overflow: hidden;">
%(members)s
              <div style="padding: 11px 15px; display: flex; align-items: center; gap: 12px;">
                <span style="font-size: 12.5px; color: #236292;">+ Add someone</span>
                <div style="flex-grow: 1;"></div>
                <span style="font-size: 12.5px; color: #57514c;">Send this many of each</span>
                %(scale)s
              </div>
            </div>
          </div>

          <div>
            <div style="font-size: 15px; font-weight: 600;">How often they come back</div>
            <div style="margin-top: 10px; background: #fefdfb; border: 1px solid #e1ded7; border-radius: 7px; overflow: hidden;">
%(cadence)s
            </div>
          </div>

          <div>
            <div style="font-size: 15px; font-weight: 600;">What it may spend</div>
            <div style="margin-top: 10px; background: #fefdfb; border: 1px solid #e1ded7; border-radius: 7px; overflow: hidden;">
%(limits)s
            </div>
          </div>

          <div>
            <div style="font-size: 15px; font-weight: 600;">Which models</div>
            <div style="margin-top: 10px; background: #fefdfb; border: 1px solid #e1ded7; border-radius: 7px; overflow: hidden;">
%(models)s
            </div>
          </div>
        </div>

        <div style="position: sticky; top: 0; display: flex; flex-direction: column; gap: 14px;">
          <div style="background: #fefdfb; border: 2px solid #236292; border-radius: 7px; padding: 17px 19px;">
            <div style="font-size: 15px; font-weight: 600;">Before you press go</div>
            <div style="margin-top: 14px; display: flex; align-items: baseline; gap: 8px;">
              <span style="font-size: 32px; font-weight: 600; letter-spacing: -0.02em;">$4.80</span>
              <span style="font-size: 16px; color: #57514c;">give or take a dollar</span>
            </div>
            <div style="margin-top: 5px; font-size: 12.5px; line-height: 1.5; color: #57514c;">12 visits in all, three people coming back four times each. Worked out from what a visit actually cost on your last run, which was 40&cent; on average.</div>
            <div style="margin-top: 15px; height: 1px; background: #e1ded7;"></div>
            <div style="margin-top: 14px; font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #857f79;">It stops on its own when</div>
            <div style="margin-top: 9px; display: flex; flex-direction: column; gap: 8px;">
%(stops)s
            </div>
            <div style="margin-top: 17px; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 12px; border-radius: 6px; background: #236292; color: #fefdfb; font-size: 14.5px; font-weight: 600;">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4.5 3.2v9.6l8-4.8z"/></svg>Start the run
            </div>
            <div style="margin-top: 9px; text-align: center; font-size: 12px; color: #857f79;">You can stop it at any moment.</div>
          </div>

          <div style="background: #fefdfb; border: 1px solid #e1ded7; border-radius: 7px; padding: 14px 16px;">
            <div style="font-size: 13px; font-weight: 600;">Every account gets cleaned up</div>
            <div style="margin-top: 6px; font-size: 12.5px; line-height: 1.55; color: #57514c;">The three accounts this run signs up are tagged with the run, and deleting the run deletes them from Tasklet through <span style="font-family: %(mono)s; font-size: 11.5px;">delete_account</span>.</div>
          </div>
        </div>
      </div>
    </div>''' % dict(
    mono=MONO,
    scale=stepper('1 each'),
    members='\n'.join(['''              <div style="display: flex; align-items: center; gap: 13px; padding: 12px 15px; border-bottom: 1px solid #e1ded7;">
                <span style="width: 28px; height: 28px; border-radius: 14px; background: #f3f0ea; color: #57514c; font-size: 11px; font-weight: 600; display: flex; align-items: center; justify-content: center;">%s</span>
                <div style="width: 210px;"><div style="font-size: 13.5px; font-weight: 600;">%s</div></div>
                <div style="flex-grow: 1; font-size: 12.5px; color: #857f79;">%s</div>
                %s
              </div>''' % (i, n, r, stepper(c)) for i, n, r, c in [
        ('CM', 'Casey Morgan', 'leaves fast, will not pay', '1'),
        ('PD', 'Priya Desai', 'patient, lives by dates', '1'),
        ('TR', 'Tomás Ruiz', 'pushes every limit', '1'),
    ]]),
    cadence='\n'.join([
        limit_row('A visit every', '2 minutes', 'Short, so you see results while you watch.'),
        limit_row('Give or take', '30 seconds', 'So they do not all arrive at once.'),
        limit_row('Stop each person after', '4 visits', 'Leave empty and they keep coming back.'),
    ]),
    limits='\n'.join([
        limit_row('Spend, per visit', '$3.00', 'The visit ends and says why.'),
        limit_row('Turns, per visit', '40', 'Long enough to finish an errand, short enough to catch a loop.'),
        limit_row('Spend, this whole run', '$8.00', 'Roughly twice the estimate, so a surprise stops it.'),
        limit_row('Spend, today, everyone', '$50.00', 'Across every run on this machine.'),
        limit_row('Destructive tools', 'ask them first', 'Driven by the tool’s own destructive flag.'),
    ]),
    models='\n'.join([
        limit_row('The people', 'claude-sonnet-5 · medium', 'What each of them thinks with.'),
        limit_row('The judge', 'claude-opus-5 · high', 'It decides what reaches your report, so it runs stronger than the people it judges.'),
    ]),
    stops='\n'.join(['''              <div style="display: flex; gap: 9px; align-items: flex-start;">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#857f79" stroke-width="1.6" style="flex-shrink: 0; margin-top: 2px;"><circle cx="8" cy="8" r="5.6"/><path d="M8 5v3.4l2.2 1.3"/></svg>
                <span style="font-size: 12.5px; line-height: 1.5; color: #57514c;">%s</span>
              </div>''' % t for t in [
        'All three have been back four times',
        'This run has spent its $8.00',
        'The day’s $50.00 is gone',
        'You stop it',
    ]]))

write('NewRun.dc.html', shell2('', TOP_RUN, newrun_content, height=1200))


# --------------------------------------------------------------- Live run ---
LIVE_SPEND = '''      <div style="display: flex; justify-content: space-between; align-items: baseline;">
        <div style="font-size: 11.5px; color: #57514c;">This run</div>
        <div style="font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 12px; font-weight: 600;">$2.14</div>
      </div>
      <div style="margin-top: 7px; height: 6px; border-radius: 3px; background: #dbeefe; overflow: hidden;">
        <div style="width: 27%; height: 6px; border-radius: 3px; background: #236292;"></div>
      </div>
      <div style="margin-top: 6px; font-size: 11px; color: #857f79;">of the $8.00 you set for it</div>'''

TOP_LIVE = '''      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="width: 7px; height: 7px; border-radius: 4px; background: #0ca30c;"></span>
        <span style="font-size: 15px; font-weight: 600;">Tasklet</span>
        <span style="font-size: 11.5px; color: #0a7a0a;">connected</span>
      </div>
      <span style="display: flex; align-items: center; gap: 6px; padding: 4px 11px; border-radius: 13px; background: #e2f6e2; color: #0a7a0a; font-size: 12px; font-weight: 600;">
        <span style="width: 6px; height: 6px; border-radius: 3px; background: #0ca30c;"></span>Running
      </span>
      <span style="font-size: 12px; color: #857f79;">6 minutes in · 7 of 12 visits done</span>
      <div style="flex-grow: 1;"></div>
      <span style="padding: 8px 13px; border-radius: 5px; border: 1px solid #cecac2; background: #fefdfb; font-size: 12.5px; font-weight: 500;">Send one more round</span>
      <span style="padding: 8px 13px; border-radius: 5px; border: 1px solid #cecac2; background: #fefdfb; font-size: 12.5px; font-weight: 500;">Let them finish, then stop</span>
      <span style="padding: 8px 13px; border-radius: 5px; background: #fbe4e4; border: 1px solid #f0c9c9; color: #a32a2a; font-size: 12.5px; font-weight: 600;">Stop everything now</span>'''


def person_now(initials, name, line, call, done, total, state):
    bar = int(round(100.0 * done / total))
    return '''          <div style="background: #fefdfb; border: 1px solid %(bd)s; border-radius: 7px; padding: 12px 13px;">
            <div style="display: flex; align-items: center; gap: 9px;">
              <span style="width: 26px; height: 26px; border-radius: 13px; background: #f3f0ea; color: #57514c; font-size: 11px; font-weight: 600; display: flex; align-items: center; justify-content: center;">%(i)s</span>
              <div style="flex-grow: 1; min-width: 0;">
                <div style="font-size: 13px; font-weight: 600;">%(name)s</div>
                <div style="font-size: 11.5px; color: #857f79;">%(line)s</div>
              </div>
              <span style="font-size: 11px; font-weight: 600; color: %(sc)s;">%(state)s</span>
            </div>
            <div style="margin-top: 9px; font-family: %(mono)s; font-size: 11.5px; color: %(cc)s; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">%(call)s</div>
            <div style="margin-top: 9px; height: 4px; border-radius: 2px; background: #e1ded7; overflow: hidden;">
              <div style="width: %(bar)d%%; height: 4px; border-radius: 2px; background: #236292;"></div>
            </div>
            <div style="margin-top: 5px; font-size: 11px; color: #857f79;">%(done)d of %(total)d visits</div>
          </div>''' % dict(i=initials, name=name, line=line, call=call, done=done, total=total, state=state,
                           mono=MONO, bar=bar,
                           bd='#236292' if state == 'here now' else '#e1ded7',
                           sc='#0a7a0a' if state == 'here now' else '#857f79',
                           cc='#1a1510' if state == 'here now' else '#a09a92')


def live_event(when, dot, text, sub=''):
    return '''            <div style="display: flex; gap: 10px; padding: 10px 0; border-bottom: 1px solid #e1ded7;">
              <span style="width: 7px; height: 7px; border-radius: 4px; background: %(dot)s; flex-shrink: 0; margin-top: 5px;"></span>
              <div style="min-width: 0; flex-grow: 1;">
                <div style="font-size: 12.5px; line-height: 1.45; color: #1a1510;">%(text)s</div>
                %(sub)s
              </div>
              <span style="font-family: %(mono)s; font-size: 11px; color: #a09a92; flex-shrink: 0;">%(when)s</span>
            </div>''' % dict(dot=dot, text=text, when=when, mono=MONO,
                             sub=('<div style="margin-top: 3px; font-family: %s; font-size: 11px; color: #857f79;">%s</div>' % (MONO, sub)) if sub else '')


def tl_row(ref, title, sub, tone='tool', now=False):
    dot = {'tool': '#864e18', 'model': '#cecac2', 'memory': '#4280b2', 'finding': '#ec835a'}[tone]
    font = MONO if tone == 'tool' else "'Instrument Sans', system-ui, sans-serif"
    refchip = ('<span style="font-family: %s; font-size: 11px; font-weight: 600; color: #864e18; background: #fde9d4; padding: 1px 5px; border-radius: 3px;">%s</span>' % (MONO, ref)) if ref else ''
    return '''            <div style="display: flex; gap: 10px; padding: 9px 14px; %(bg)s">
              <span style="width: 7px; height: 7px; border-radius: 4px; background: %(dot)s; flex-shrink: 0; margin-top: 5px;"></span>
              <div style="min-width: 0; flex-grow: 1;">
                <div style="display: flex; align-items: center; gap: 8px;">%(ref)s<span style="font-family: %(font)s; font-size: 12.5px; font-weight: %(w)s;">%(title)s</span>%(nowchip)s</div>
                <div style="margin-top: 3px; font-family: %(mono)s; font-size: 11px; color: #857f79; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">%(sub)s</div>
              </div>
            </div>''' % dict(dot=dot, ref=refchip, font=font, title=title, sub=sub, mono=MONO,
                             w='600' if tone == 'tool' else '500',
                             bg='background: #dbeefe;' if now else '',
                             nowchip='<span style="padding: 1px 7px; border-radius: 3px; background: #236292; color: #fefdfb; font-size: 11px; font-weight: 600;">happening now</span>' if now else '')


liverun_content = '''    <div style="flex-grow: 1; display: flex; min-height: 0;">

      <div style="width: 306px; flex-shrink: 0; border-right: 1px solid #e1ded7; padding: 18px 16px; overflow-y: auto;">
        <div style="font-size: 13px; font-weight: 600;">Where everyone is</div>
        <div style="margin-top: 11px; display: flex; flex-direction: column; gap: 9px;">
%(people)s
        </div>
        <div style="margin-top: 18px; padding: 12px 13px; border-radius: 7px; background: #f3f0ea;">
          <div style="font-size: 12px; font-weight: 600;">Next visit in</div>
          <div style="margin-top: 4px; font-family: %(mono)s; font-size: 20px; font-weight: 600;">1m 12s</div>
          <div style="margin-top: 4px; font-size: 11.5px; color: #857f79;">Casey, visit 4.</div>
        </div>
      </div>

      <div style="flex-grow: 1; min-width: 0; display: flex; flex-direction: column; border-right: 1px solid #e1ded7;">
        <div style="flex-shrink: 0; padding: 14px 18px 12px; border-bottom: 1px solid #e1ded7; display: flex; align-items: center; gap: 10px;">
          <span style="width: 26px; height: 26px; border-radius: 13px; background: #f3f0ea; color: #57514c; font-size: 11px; font-weight: 600; display: flex; align-items: center; justify-content: center;">PD</span>
          <div style="flex-grow: 1;">
            <div style="font-size: 13.5px; font-weight: 600;">Priya Desai, visit 3</div>
            <div style="font-family: %(mono)s; font-size: 11px; color: #857f79;">turn 6 · 6 calls · $0.31 so far</div>
          </div>
          <span style="font-size: 12px; color: #236292;">Follow whoever is active</span>
        </div>
        <div style="flex-grow: 1; overflow-y: auto; padding: 6px 0;">
%(timeline)s
        </div>
      </div>

      <div style="width: 340px; flex-shrink: 0; padding: 18px 18px; overflow-y: auto;">
        <div style="font-size: 13px; font-weight: 600;">As it happens</div>
        <div style="margin-top: 6px;">
%(events)s
        </div>
      </div>
    </div>''' % dict(
    mono=MONO,
    people='\n'.join([
        person_now('PD', 'Priya Desai', 'visit 3, turn 6, thinking', 'last call c6 update_task → ok, date unchanged', 2, 4, 'here now'),
        person_now('TR', 'Tomás Ruiz', 'visit 3, turn 2', 'c3 list_tasks({ projectId: "prj_8x1", page: 1 })', 2, 4, 'here now'),
        person_now('CM', 'Casey Morgan', 'finished visit 3', 'away until the next visit', 3, 4, 'away'),
    ]),
    timeline='\n'.join([
        tl_row('', 'Turn 4', 'notices the date came back unchanged', tone='model'),
        tl_row('c5', 'get_task', '{ taskId: "tsk_91b7" } → dueDate 2026-10-01'),
        tl_row('', 'Writes it down', 'annoyance: the deadline did not save again', tone='memory'),
        tl_row('', 'Turn 5', 'tries once more with a different date format', tone='model'),
        tl_row('c6', 'update_task', '{ dueDate: "2026-12-24T00:00:00Z" } → ok, dueDate 2026-10-01'),
        tl_row('', 'Files a bug', 'Moving a deadline appears to work and does not stick · c4 c5 c6', tone='finding'),
        tl_row('', 'Turn 6', 'deciding what to do next', tone='model', now=True),
    ]),
    events='\n'.join([
        live_event('just now', '#ec835a', 'Priya filed a bug about <strong style="font-weight: 600;">update_task</strong>', 'high · evidence c4 c5 c6'),
        live_event('40s', '#fab219', 'Tomás was held back from <strong style="font-weight: 600;">delete_project</strong>', 'guardrail · he has to confirm destructive tools'),
        live_event('1m', '#0ca30c', 'Casey finished visit 3 and said they would be back', 'finished · 7 turns · 9 calls · $0.22'),
        live_event('3m', '#fab219', 'Tomás filed friction about the free plan cap', 'medium · evidence c4'),
        live_event('4m', '#4280b2', 'Tomás signed up', 'account created · tomas.ruiz+m1abc2de@populace.test'),
        live_event('6m', '#857f79', 'The run started', '3 people · 12 visits planned · $8.00 ceiling'),
    ]))

write('LiveRun.dc.html', shell2('overview', TOP_LIVE, liverun_content, height=980, spend_block=LIVE_SPEND,
                                     counts={'findings': '4', 'gaps': '1', 'left': '', 'population': '3', 'wakes': '7'}))
