#!/usr/bin/env python3
"""R1 artboards: the returning verdict, drawn in the app Nick built.

Tokens, type scale and component anatomy are lifted from packages/web/src/theme.css and
packages/web/src/components/ui.tsx, with Tailwind's alpha borders resolved to literal hexes
because an artboard carries no stylesheet. The shell is App.tsx's Frame: the 236px rail from
Sidebar.tsx beside a main pane capped at 1100px with 36px/40px padding.

Writes Returned, LeftWithAction, FindingWithAction, CarryForward and ReturnFlow.
"""

# --- theme.css, verbatim -----------------------------------------------------
PAPER, CARD, WELL = '#f9f6f2', '#fefdfb', '#f3f0ea'
INK, SOFT, MUTED = '#1a1510', '#57514c', '#857f79'
ACCENT, ACCENT_WASH = '#236292', '#dbeefe'
EVID, EVID_WASH = '#864e18', '#fde9d4'
RULE, RULE_STRONG = '#e1ded7', '#cecac2'
CRITICAL, HIGH, MEDIUM, LOW, CONFIRMED = '#a3242f', '#b4551b', '#8a6d1f', '#6b6560', '#2f6b3c'
# border-critical/40, border-confirmed/40, border-accent/40, border-accent/30 over card
CRITICAL_40, CONFIRMED_40, ACCENT_40, ACCENT_30 = '#d9a6a9', '#abc3af', '#a6bfd1', '#bccedc'
MONO = "'IBM Plex Mono', ui-monospace, monospace"

# --- the type scale, as inline styles ----------------------------------------
T_DISPLAY = 'font-size: 27px; font-weight: 600; line-height: 1.2; letter-spacing: -0.01em;'
T_TITLE = 'font-size: 22px; font-weight: 600; line-height: 1.25;'
T_SECTION = 'font-size: 16px; font-weight: 600;'
T_FINDING = 'font-size: 15px; font-weight: 600; line-height: 1.35;'
T_BODY = 'font-size: 13.5px; font-weight: 400; line-height: 1.55;'
T_META = 'font-size: 12px; font-weight: 400;'
T_LABEL = 'font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;'

HEAD = '''<!doctype html>
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
    body { margin: 0; background: %s; color: %s; font-family: "Instrument Sans", system-ui, sans-serif; font-size: 13.5px; -webkit-font-smoothing: antialiased; }
    a { color: %s; text-decoration: none; }
  </style>
</helmet>
''' % (PAPER, INK, ACCENT)
TAIL = '</x-dc>\n</body>\n</html>\n'


# --- ui.tsx, as inline-styled HTML -------------------------------------------
def card(inner, pad='16px', extra=''):
    return '<div style="background: %s; border: 1px solid %s; border-radius: 8px; padding: %s; %s">%s</div>' % (CARD, RULE, pad, extra, inner)


def avatar(text, size=28):
    return ('<span style="flex-shrink: 0; display: grid; place-items: center; width: %dpx; height: %dpx; border-radius: %dpx; '
            'background: %s; border: 1px solid %s; %s color: %s;">%s</span>') % (size, size, size // 2, WELL, RULE, T_LABEL, SOFT, text)


def button(text, tone='quiet'):
    tones = {
        'go': 'background: %s; color: #ffffff; border-color: %s;' % (ACCENT, ACCENT),
        'quiet': 'background: %s; color: %s; border-color: %s;' % (CARD, SOFT, RULE),
        'stop': 'background: %s; color: %s; border-color: %s;' % (CARD, CRITICAL, CRITICAL_40),
    }
    return '<span style="%s display: inline-block; padding: 6px 12px; border-radius: 6px; border: 1px solid; %s">%s</span>' % (T_BODY, tones[tone], text)


def chip(text, tone='neutral'):
    tones = {
        'neutral': 'color: %s; border-color: %s;' % (MUTED, RULE),
        'good': 'color: %s; border-color: %s;' % (CONFIRMED, CONFIRMED_40),
        'bad': 'color: %s; border-color: %s;' % (CRITICAL, CRITICAL_40),
        'live': 'color: %s; border-color: %s; background: %s;' % (ACCENT, ACCENT_40, ACCENT_WASH),
    }
    return '<span style="%s display: inline-flex; align-items: center; gap: 6px; border: 1px solid; border-radius: 999px; padding: 2px 8px; white-space: nowrap; %s">%s</span>' % (T_LABEL, tones[tone], text)


def callref(text):
    return '<span style="font-family: %s; font-size: 11px; color: %s; background: %s; border-radius: 4px; padding: 1px 4px;">%s</span>' % (MONO, EVID, EVID_WASH, text)


def mono(text, size='12px', color=None):
    return '<span style="font-family: %s; font-size: %s; color: %s;">%s</span>' % (MONO, size, color or MUTED, text)


def toolname(text):
    return '<span style="font-family: %s; font-size: 12.5px; color: %s;">%s</span>' % (MONO, EVID, text)


def severity(word, kind):
    ink = {'critical': CRITICAL, 'high': HIGH, 'medium': MEDIUM, 'low': LOW}[word]
    return '<span style="%s color: %s;">%s<span style="color: %s;"> %s</span></span>' % (T_LABEL, ink, word, MUTED, kind)


def label(text, color=None):
    return '<div style="%s color: %s;">%s</div>' % (T_LABEL, color or MUTED, text)


def link(text, size=None):
    return '<a href="#" style="%s color: %s;">%s</a>' % (size or T_BODY, ACCENT, text)


def page_header(title, lede='', trail=''):
    out = ['<header style="margin-bottom: 28px;">']
    if trail:
        out.append('<div style="%s color: %s; margin-bottom: 8px;">%s</div>' % (T_META, MUTED, trail))
    out.append('<h1 style="%s margin: 0; max-width: 46ch;">%s</h1>' % (T_TITLE, title))
    if lede:
        out.append('<p style="%s color: %s; margin: 8px 0 0; max-width: 68ch;">%s</p>' % (T_BODY, SOFT, lede))
    out.append('</header>')
    return ''.join(out)


def section(title, sub=''):
    out = '<h2 style="%s margin: 0 0 %s;">%s</h2>' % (T_SECTION, '4px' if sub else '12px', title)
    if sub:
        out += '<p style="%s color: %s; margin: 0 0 12px; max-width: 72ch;">%s</p>' % (T_META, MUTED, sub)
    return out


# --- Sidebar.tsx -------------------------------------------------------------
NAV_ACTIVE = 'background: %s; color: %s; font-weight: 500;' % (ACCENT_WASH, ACCENT)
NAV_IDLE = 'color: %s;' % SOFT


def nav_item(text, count=None, active=False):
    c = '' if count is None else '<span style="%s color: %s; font-variant-numeric: tabular-nums;">%s</span>' % (T_META, MUTED, count)
    return ('<div style="display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 6px 12px; '
            'border-radius: 6px; %s %s"><span>%s</span>%s</div>') % (T_BODY, NAV_ACTIVE if active else NAV_IDLE, text, c)


def group(title, items):
    head = '<div style="%s color: %s; padding: 0 12px; margin-bottom: 8px;">%s</div>' % (T_LABEL, MUTED, title) if title else ''
    return '<div style="margin-bottom: 24px;">%s<div style="display: flex; flex-direction: column; gap: 2px;">%s</div></div>' % (head, ''.join(items))


def sidebar(active, came_back=True, executions=4, visits=6, spent='$6.51'):
    pct = round(100 * float(spent.lstrip('$')) / 50.0)
    """The rail from Sidebar.tsx. `came_back` adds the one item this work proposes, which the
    real rail would render only when the latest execution carries a parent."""
    sim = [
        nav_item('Results', active=active == 'results'),
        nav_item('Coverage gaps', active=active == 'gaps'),
        nav_item('Who walked away', active=active == 'left'),
    ]
    if came_back:
        sim.append(nav_item('Who came back', active=active == 'back'))
    sim += [
        nav_item('Population', count=3, active=active == 'population'),
        nav_item('Executions', count=executions, active=active == 'executions'),
        nav_item('Visits', count=visits, active=active == 'visits'),
    ]
    return '''<aside style="width: 236px; flex-shrink: 0; border-right: 1px solid %(rule)s; background: %(card)s; display: flex; flex-direction: column; height: 100%%; overflow: hidden;">
  <div style="padding: 16px 12px;">
    <div style="%(meta)s color: %(muted)s; line-height: 20px; height: 20px;">populace</div>
    <div style="display: flex; align-items: baseline; gap: 6px; %(section)s">
      <span>Tasklet</span><span style="%(meta)s color: %(muted)s;">&#9662;</span>
    </div>
    <div style="%(meta)s color: %(muted)s;">3 people &middot; 2 simulations</div>
  </div>
  <div style="flex-grow: 1;">
    %(g0)s%(g1)s%(g2)s
    <div style="padding: 0 12px; margin-bottom: 24px;">
      <div style="%(meta)s color: %(muted)s;">Spent today</div>
      <div style="%(section)s font-variant-numeric: tabular-nums;">%(spent)s</div>
      <div style="margin-top: 8px; height: 4px; border-radius: 4px; background: %(well)s; overflow: hidden;">
        <div style="height: 4px; width: %(pct)d%%; background: %(accent)s;"></div>
      </div>
      <div style="%(meta)s color: %(muted)s; margin-top: 6px;">of the $50.00 daily ceiling</div>
    </div>
  </div>
  <div style="padding: 16px 12px; border-top: 1px solid %(rule)s;">
    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
      <span style="%(label)s color: %(muted)s;">Tasklet</span>%(chip)s
    </div>
    <span style="font-family: %(mono)s; font-size: 11px; color: %(muted)s;">http://127.0.0.1:4310/mcp</span>
  </div>
</aside>''' % dict(rule=RULE, card=CARD, well=WELL, muted=MUTED, accent=ACCENT, mono=MONO,
                   meta=T_META, section=T_SECTION, label=T_LABEL, spent=spent, pct=pct,
                   chip=chip('configured'),
                   g0=group('', [nav_item('Simulations', count=2)]),
                   g1=group('Trial week', sim),
                   g2=group('Set up', [nav_item('The target'), nav_item('Personas', count=3), nav_item('The people', count=3), nav_item('Settings')]))


def frame(active, content, height, came_back=True, overlay='', dim=False, **kw):
    inner = '<div style="max-width: 1100px; padding: 36px 40px;%s">%s</div>' % (
        ' filter: blur(1.5px);' if dim else '', content)
    veil = ('<div style="position: absolute; left: 0; top: 0; right: 0; bottom: 0; '
            'background: rgba(249, 246, 242, 0.66);"></div>') if dim else ''
    return HEAD + '''
<div style="position: relative; width: 1440px; height: %(h)dpx; display: flex; background: %(paper)s; overflow: hidden;">
  %(side)s
  <main style="flex-grow: 1; min-width: 0; overflow: hidden;">%(inner)s</main>
  %(veil)s%(overlay)s
</div>
''' % dict(h=height, paper=PAPER, side=sidebar(active, came_back, **kw), inner=inner, veil=veil, overlay=overlay) + TAIL


def write(name, text):
    open(name, 'w', encoding='utf-8').write(text)
    print('wrote', name, len(text), 'bytes')


# =============================================================================
# The world these five screens read.
#
# Execution 3 is the run the M1 and M2 pages already draw: three people, eleven visits, twelve
# reports, seven problems, and Priya walking out at visit 3 over a due date that would not stick.
# Execution 4 is the carry-forward that follows a fix to `update_task`. Every number below is
# derived from that pair and nothing else.
# =============================================================================

CLAIM = 'update_task now keeps the dueDate you set.'
OLD_SIG = 'update_task reports success and hands back the old dueDate'
NEW_SIG = 'dueDate set on a task inside a project is dropped'


# --- 1. Who came back --------------------------------------------------------

def verdict_card(initials, name, cohort, visit, quote, chip_html, waiting, instrument, links, caution=''):
    left = avatar(initials, 32)
    head = ('<div style="display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 10px;">'
            '<span style="%s color: %s;">%s</span>'
            '<span style="%s color: %s;">%s &middot; %s</span>'
            '<span style="margin-left: auto;">%s</span></div>') % (T_FINDING, ACCENT, name, T_META, MUTED, cohort, visit, chip_html)
    body = '<p style="%s color: %s; font-style: italic; margin: 0 0 14px; max-width: 64ch;">&ldquo;%s&rdquo;</p>' % (
        'font-size: 14.5px; font-weight: 400; line-height: 1.6;', INK, quote)
    caution_html = ''
    if caution:
        caution_html = '<p style="%s color: %s; margin: 0 0 12px; max-width: 64ch;">%s</p>' % (T_BODY, HIGH, caution)
    rows = ['<div style="border-top: 1px solid %s; padding-top: 12px; display: flex; flex-direction: column; gap: 7px;">' % RULE]
    rows.append('<div style="%s color: %s;">%s</div>' % (T_BODY, SOFT, waiting))
    rows.append('<div style="%s color: %s;">%s</div>' % (T_META, MUTED, instrument))
    rows.append('<div style="display: flex; gap: 18px; margin-top: 2px;">%s</div>' % ''.join(link(t, T_META) for t in links))
    rows.append('</div>')
    inner = '<div style="display: flex; gap: 14px;">%s<div style="min-width: 0; flex-grow: 1;">%s%s%s%s</div></div>' % (
        left, head, body, caution_html, ''.join(rows))
    return card(inner, pad='20px')


def returned():
    claim = card(
        label('What you changed') +
        '<p style="%s color: %s; margin: 6px 0 0; max-width: 64ch;">%s</p>' % ('font-size: 15px; line-height: 1.55;', INK, CLAIM) +
        '<div style="%s color: %s; margin-top: 10px; font-variant-numeric: tabular-nums;">'
        'carried forward from execution 3 &middot; 3 people came back &middot; 1 of them had given up &middot; '
        '6 visits &middot; ran 16:02 to 16:31 &middot; $2.14</div>' % (T_META, MUTED),
        pad='18px 20px', extra='background: %s;' % WELL)

    priya = verdict_card(
        'PD', 'Priya Desai', 'project-planner', 'visit 4, her first back',
        'I put Thursday on the client review, shut the tab, came back the next morning and it still said Thursday. '
        'That was the whole thing. I have put the rest of the week in.',
        chip('won back', 'good'),
        'She had been waiting on <em>the date I set to still be there when I come back</em>. It cleared on this visit, and she has stopped checking it.',
        'Filed nothing. %s was not reported by her again. She says she is coming back.' % mono(OLD_SIG, '11.5px', EVID),
        ['watch the visit she came back on', 'her page'])

    tomas = verdict_card(
        'TR', 'Tom&aacute;s Ruiz', 'power-organizer', 'visit 5, his second back',
        'Dates on a loose task stick now. Dates on a task inside a project still don&rsquo;t &mdash; I set four on '
        'Monday&rsquo;s list and they were blank when I opened it after lunch. Same afternoon lost, different door.',
        chip('says it is not fixed', 'bad'),
        'He had been waiting on <em>dates to stop disappearing</em>. Still open, and he has gone back to writing them in the title.',
        'Filed %s &mdash; a different key from the one he filed in execution 3.' % mono(NEW_SIG, '11.5px', EVID),
        ['read what he filed', 'watch the visit', 'his page'],
        caution='His two reports key differently, so the comparison below counts the old one as gone and this one as new. '
                'He is describing one problem, and he is the reason this screen leads with what they said.')

    casey = verdict_card(
        'CM', 'Casey Morgan', 'casual-lister', 'visit 6, his second back',
        'I didn&rsquo;t notice anything different. Put six things on the shop list, crossed four off, done.',
        chip('nothing to say about it', 'neutral'),
        'He never hit this. In six visits Casey has not set a due date once, so his coming back is not evidence either way.',
        'Filed nothing this execution. Still coming back.',
        ['watch the visit', 'his page'])

    tally = ('<p style="%s color: %s; margin: 18px 0 0; max-width: 72ch;">Two of the three hit this problem. '
             'One of them says it is gone and one says it is not. The third has never set a due date, so his '
             'coming back says nothing about it either way.</p>') % (T_BODY, SOFT)

    col = lambda title, n, sub, rows: (
        '<div><div style="%s margin-bottom: 2px;">%s <span style="%s color: %s; font-weight: 400; font-variant-numeric: tabular-nums;">%d</span></div>'
        '<p style="%s color: %s; margin: 0 0 10px; max-width: 34ch;">%s</p>%s</div>'
    ) % (T_SECTION, title, T_META, MUTED, n, T_META, MUTED, sub, rows)

    row = lambda text, sev, kind, tool: card(
        '<div style="display: flex; align-items: baseline; gap: 10px; margin-bottom: 4px;">%s%s</div>'
        '<div style="%s color: %s;">%s</div>' % (severity(sev, kind), toolname(tool), T_BODY, INK, text),
        pad='12px 14px')

    signatures = (
        section('What the signatures say',
                'The machine&rsquo;s answer to the same question, matched on the exact words of each title. It is the weaker of the two, and it is here rather than at the top for that reason.') +
        '<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; align-items: start;">' +
        col('Reported in both', 5, 'Came up either side. The reliable half.',
            '<div style="%s color: %s;">Case-sensitive search, list paging, no way to delete, and two more.</div>' % (T_BODY, SOFT)) +
        col('Not reported in execution 4', 2, 'An absence, and only an absence.',
            row('Tasklet drops the due date you set', 'critical', 'bug', 'update_task') +
            '<div style="height: 8px;"></div>' +
            '<div style="%s color: %s;">and one more.</div>' % (T_BODY, SOFT)) +
        col('Only in execution 4', 1, 'Either genuinely new, or the same thing in other words.',
            row('Due dates vanish from tasks inside a project', 'critical', 'bug', 'update_task')) +
        '</div>' +
        '<div style="margin-top: 18px;">' + card(
            '<p style="%s color: %s; margin: 0; max-width: 78ch;">A problem is matched between executions by the exact '
            'words in its title, so a complaint worded differently the second time reads as gone and as new at once. '
            'Open one and read the evidence before you call anything fixed.</p>'
            '<p style="%s color: %s; margin: 8px 0 0;">Both executions sent the same people, so a difference here is '
            'not a difference in who went.</p>'
            '<p style="%s color: %s; margin: 8px 0 0;">Tom&aacute;s is on both sides of this comparison. His words are above.</p>'
            % (T_BODY, INK, T_META, MUTED, T_META, MUTED),
            pad='16px', extra='background: %s;' % WELL) + '</div>' +
        '<div style="margin-top: 14px;">%s</div>' % link('Execution 3 and execution 4 side by side &rarr;'))

    content = (
        page_header('Who came back',
                    'Execution 4 carried everybody forward from execution 3 to see whether your change won them back. '
                    'This is what each of them said when they got here.') +
        claim +
        '<div style="height: 30px;"></div>' +
        section('What they said when they got back',
                'The person who walked away first, then the people who stayed.') +
        '<div style="display: flex; flex-direction: column; gap: 14px;">%s%s%s</div>' % (priya, tomas, casey) +
        tally +
        '<div style="height: 40px; margin-top: 36px; border-top: 1px solid %s;"></div>' % RULE +
        signatures)
    return frame('back', content, 1740)


# --- 2. Who walked away, with the way out ------------------------------------

def left_with_action():
    """WhoLeft.tsx as main renders it, plus the one thing it is missing: something to do about it.

    The action sits UNDER the person, not above her. The promise is the reason the button exists,
    so the button cannot be the first thing on the page."""
    person = card(
        '<div style="display: flex; gap: 14px;">%s<div style="min-width: 0; flex-grow: 1;">'
        '<h2 style="%s margin: 0 0 6px;">Priya stopped trusting Tasklet with deadlines</h2>'
        '<p style="%s color: %s; font-style: italic; margin: 0 0 12px; max-width: 64ch;">&ldquo;I have moved this '
        'deadline four times and it keeps coming back as the old one. I can&rsquo;t plan around a thing that '
        'forgets.&rdquo;</p>'
        '<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 16px; %s color: %s;">'
        '<span>%s &middot; project-planner &middot; visit 3</span>'
        '<span style="color: %s;">Priya said a fix would bring them back</span>'
        '%s</div></div></div>' % (
            avatar('PD', 32), T_FINDING, 'font-size: 14.5px; line-height: 1.6;', INK, T_META, MUTED,
            link('Priya Desai', T_META), CONFIRMED, link('watch the visit they left on', T_META)),
        pad='20px')

    action = card(
        '<h2 style="%s margin: 0 0 6px;">When you have made a change, send them back</h2>'
        '<p style="%s color: %s; margin: 0 0 4px; max-width: 76ch;">Carrying this simulation forward starts execution 4 '
        'with the same three people, everything they remember and the accounts they already hold on Tasklet. Priya '
        'comes with them because she said a fix would bring her back &mdash; that promise is the only thing it is for.</p>'
        '<p style="%s color: %s; margin: 0 0 16px; max-width: 76ch;">It sends everybody, not only the people who walked '
        'away. There is no way to carry back a subset, and a clean execution answers a different question: whether a '
        'stranger walks into the same wall. Neither stands in for the other.</p>'
        '<div style="display: flex; align-items: center; gap: 14px;">%s%s</div>' % (
            T_SECTION, T_BODY, SOFT, T_BODY, SOFT,
            button('Send them back', 'go'),
            link('or run it again from scratch, with three strangers', T_BODY)),
        pad='20px', extra='background: %s;' % WELL)

    content = (
        page_header('Who walked away',
                    'The people who stopped coming back, what it was over, and whether they said a fix would bring them back.') +
        person +
        '<div style="height: 28px;"></div>' + action)
    return frame('left', content, 770, came_back=False, executions=3, visits=11, spent='$4.37')


# --- 3. A problem in full, with the check ------------------------------------

def finding_with_action():
    """FindingInFull.tsx, plus the band at the foot. It is at the foot deliberately: the offer to
    check a fix follows the evidence and the triage decision, it does not compete with them."""
    triage = ('<div style="flex-shrink: 0; min-width: 16rem;">%s'
              '<p style="%s color: %s; margin: 6px 0 0; max-width: 34ch;">Kept against the problem, not against this '
              'execution, so it is still here the next time the simulation runs.</p></div>') % (
        link('We have fixed it &#9656;'), T_META, MUTED)

    quote = lambda initials, name, cohort, text, visit: (
        '<div style="display: flex; gap: 12px;">%s<div style="min-width: 0;">'
        '<p style="%s color: %s; font-style: italic; margin: 0;">&ldquo;%s&rdquo;</p>'
        '<div style="%s color: %s; margin-top: 4px;">%s &middot; %s &middot; %s</div></div></div>' % (
            avatar(initials), 'font-size: 14px; line-height: 1.6;', INK, text, T_META, MUTED, name, cohort,
            link('visit %s' % visit, T_META)))

    step = lambda ref, call, latency, result, bad: (
        '<li style="margin-bottom: 12px;"><div style="display: flex; align-items: baseline; gap: 8px; margin-bottom: 5px;">'
        '%s<span style="font-family: %s; font-size: 12px; color: %s;">%s</span>'
        '<span style="%s color: %s; margin-left: auto; flex-shrink: 0;">%s</span></div>'
        '<div style="background: %s; border: 1px solid %s; border-radius: 5px; padding: 7px 9px; font-family: %s; '
        'font-size: 11.5px; line-height: 1.5; color: %s;">&rarr; %s</div></li>' % (
            callref(ref), MONO, INK, call, T_META, MUTED, latency, WELL, RULE, MONO,
            CRITICAL if bad else SOFT, result))

    steps = card(
        '<div style="display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 12px;">'
        '%s%s</div><ol style="margin: 0; padding: 0; list-style: none;">%s%s</ol>' % (
            label('Steps that reproduce it'), link('open the full visit', T_META),
            step('c3', 'update_task({"id":"t_41","dueDate":"2026-09-24"})', '41 ms',
                 '{"ok":true,"task":{"id":"t_41","dueDate":"2026-09-17"}}', False),
            step('c4', 'get_task({"id":"t_41"})', '12 ms',
                 '{"id":"t_41","title":"Client review","dueDate":"2026-09-17"}', False)),
        pad='16px')

    replay = card(
        '<div style="display: flex; align-items: baseline; gap: 12px; margin-bottom: 6px;">%s%s</div>'
        '<p style="%s color: %s; margin: 0;">The call returns ok and the date it returns is the old one. Read back '
        'immediately afterwards, the task still carries 17 September. The write is accepted and discarded.</p>'
        '<div style="%s color: %s; margin-top: 10px; font-family: %s;">claude-opus-5 judge &middot; 14:52 &middot; $0.0412</div>' % (
            label('We ran those calls again ourselves'), chip('confirmed', 'good'), T_BODY, SOFT, T_META, MUTED, MONO),
        pad='16px')

    dots = ''.join(
        '<span style="%s font-variant-numeric: tabular-nums; padding: 1px 6px; border-radius: 4px; %s">%d %s</span>' % (
            T_META, 'background: %s; color: %s;' % (ACCENT_WASH, ACCENT) if hit else 'color: %s;' % MUTED,
            n, '&#9679;' if hit else '&#9675;')
        for n, hit in [(1, True), (2, True), (3, True)])
    across = card(
        label('Across executions') +
        '<div style="display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0;">%s</div>'
        '<p style="%s color: %s; margin: 0;">Reported in every execution this simulation has had.</p>' % (
            dots, T_BODY, SOFT),
        pad='16px')

    incidence = lambda name, hit, of, tone: (
        '<div style="display: flex; align-items: center; gap: 12px; margin-bottom: 9px;">'
        '<span style="%s color: %s; width: 140px; flex-shrink: 0;">%s</span>'
        '<span style="flex-grow: 1; height: 4px; border-radius: 4px; background: %s; overflow: hidden; display: block;">'
        '<span style="display: block; height: 4px; width: %d%%; background: %s;"></span></span>'
        '<span style="%s color: %s; flex-shrink: 0; font-variant-numeric: tabular-nums; width: 118px; text-align: right;">%s</span></div>' % (
            T_META, MUTED, name, WELL, int(100 * hit / of) if of else 0,
            CRITICAL if tone == 'hit' else RULE_STRONG, T_META, MUTED,
            '%d of %d hit it' % (hit, of) if tone == 'hit' else '%d did not hit it' % of))

    band = card(
        '<h2 style="%s margin: 0 0 6px;">You said you fixed this. Ask them.</h2>'
        '<p style="%s color: %s; margin: 0 0 16px; max-width: 76ch;">Sending them back starts execution 4 from where '
        'execution 3 stopped, with the whole cast &mdash; not only the two people who hit this. They keep what they '
        'remember and the accounts they hold, and Priya comes too, because she said a fix would bring her back. Nobody '
        'is asked about this problem in particular; you find out what each of them says when they get there.</p>'
        '<div style="max-width: 560px;">%s'
        '<div style="margin-top: 6px; background: %s; border: 1px solid %s; border-radius: 6px; padding: 9px 11px; %s color: %s;">%s</div>'
        '<div style="%s color: %s; margin-top: 6px;">Kept against the new execution as the claim it tests. Nobody in '
        'the simulation is told about it.</div></div>'
        '<div style="display: flex; align-items: center; gap: 14px; margin-top: 18px;">%s%s</div>' % (
            T_SECTION, T_BODY, SOFT,
            label('What you changed &mdash; optional'),
            CARD, RULE_STRONG, T_BODY, INK, CLAIM, T_META, MUTED,
            button('Send them back', 'go'),
            link('Run it again from scratch instead', T_BODY)),
        pad='20px', extra='background: %s;' % WELL)

    content = (
        '<div style="%s color: %s; margin-bottom: 10px;">%s <span style="color: %s;">/</span> Tasklet drops the due date you set</div>' % (
            T_META, MUTED, link('Results', T_META), RULE_STRONG) +
        '<div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 10px;">'
        '<h1 style="%s margin: 0; max-width: 46ch;">Tasklet drops the due date you set</h1>%s</div>' % (T_TITLE, triage) +
        '<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 14px; margin-bottom: 10px;">'
        '%s%s%s<span style="%s color: %s;">open</span><span style="%s color: %s;">reported in all 3 executions</span></div>' % (
            severity('critical', 'bug'), toolname('update_task'), chip('confirmed', 'good'),
            T_LABEL, CRITICAL, T_META, MUTED) +
        '<p style="%s color: %s; margin: 0 0 28px; padding-bottom: 22px; border-bottom: 1px solid %s; font-variant-numeric: tabular-nums;">'
        '2 of 3 people hit this &middot; 6 reports &middot; %s</p>' % (
            T_BODY, SOFT, RULE, mono('b7c1f4a2', '11px')) +
        '<div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 32px; align-items: start;">'
        '<div>%s<div style="display: flex; flex-direction: column; gap: 16px; margin-bottom: 30px;">%s%s</div>'
        '%s<p style="%s color: %s; margin: 0 0 20px;">The date she typed to be the date the task carries afterwards.</p>'
        '%s<p style="%s color: %s; margin: 0;">The call answers ok and hands back the date the task had before. '
        'Read the task again and it still carries the old one. Priya moved it four times across two visits and then '
        'stopped opening Tasklet.</p></div>'
        '<div style="display: flex; flex-direction: column; gap: 16px;">%s%s%s</div></div>' % (
            section('In their own words'),
            quote('PD', 'Priya Desai', 'project-planner',
                  'I have moved this deadline four times and it keeps coming back as the old one. I can&rsquo;t plan '
                  'around a thing that forgets.', '3'),
            quote('TR', 'Tom&aacute;s Ruiz', 'power-organizer',
                  'Set the date, it says saved, reopen it, it&rsquo;s the old date. I stopped setting dates and put '
                  'them in the title instead.', '2'),
            section('They expected'), T_BODY, SOFT,
            section('What happened'), T_BODY, SOFT,
            steps, replay, across) +
        '<section style="margin-top: 40px; padding-top: 32px; border-top: 1px solid %s;">%s'
        '<div style="max-width: 34rem;">%s%s%s</div>%s</section>' % (
            RULE, section('Who hit it'),
            incidence('project-planner', 1, 1, 'hit'),
            incidence('power-organizer', 1, 1, 'hit'),
            incidence('casual-lister', 0, 1, 'miss'),
            '<div style="margin-top: 20px;">%s</div>' % link('All 2 people who hit this &rarr;')) +
        '<div style="height: 36px;"></div>' + band)
    return frame('results', content, 1330, came_back=False, executions=3, visits=11, spent='$4.37')


# --- 4. The confirm step -----------------------------------------------------

def carry_forward():
    """The one screen that has to be explicit about what carrying forward is NOT. ROADMAP 6.2:
    a carry-forward and a clean execution answer different questions and must never be offered as
    answers to each other. The dialog is where that sentence can actually be read."""
    who = lambda initials, name, cohort, state: (
        '<div style="display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid %s;">%s'
        '<div style="min-width: 0; flex-grow: 1;"><div style="%s">%s</div>'
        '<div style="%s color: %s;">%s</div></div>'
        '<div style="flex-shrink: 0; text-align: right; width: 300px;">%s</div></div>' % (
            RULE, avatar(initials), T_BODY, name, T_META, MUTED, cohort, state))

    dialog = (
        '<h2 style="%s margin: 0 0 6px;">Send them back?</h2>'
        '<p style="%s color: %s; margin: 0 0 20px;">Execution 4 starts where execution 3 stopped.</p>'
        '%s<div style="margin: 8px 0 8px;">%s%s%s</div>'
        '<p style="%s color: %s; margin: 0 0 22px; border-top: 1px solid %s; padding-top: 10px;">Each of them keeps '
        'what they remember and the account they already hold on Tasklet. Nobody signs up again.</p>'
        '%s<div style="margin-top: 6px; background: %s; border: 1px solid %s; border-radius: 6px; padding: 9px 11px; %s color: %s;">%s</div>'
        '<div style="%s color: %s; margin-top: 6px; margin-bottom: 20px;">Kept against the execution as the claim it '
        'tests. Nobody in the simulation is told about it.</div>'
        '<div style="display: flex; align-items: baseline; justify-content: space-between; gap: 12px; %s color: %s; '
        'font-variant-numeric: tabular-nums; padding: 12px 0; border-top: 1px solid %s; border-bottom: 1px solid %s; margin-bottom: 18px;">'
        '<span>About 6 visits</span><span>$1.80 to $2.40</span></div>'
        '<div style="%s color: %s; margin: -8px 0 18px;">From what a visit cost in execution 3. It counts against the '
        '$50.00 daily ceiling, which has $43.49 left on it.</div>'
        '<div style="background: %s; border-radius: 6px; padding: 14px 16px; margin-bottom: 22px;">'
        '<p style="%s color: %s; margin: 0;">This is not the same question as running it again. A clean execution asks '
        'whether a stranger walks into the problem. Carrying forward asks whether the person who walked out is '
        'satisfied. Neither answers the other, so do both if you want both.</p></div>'
        '<div style="display: flex; align-items: center; gap: 12px;">%s%s</div>' % (
            T_TITLE, T_BODY, MUTED,
            label('Who goes'),
            who('PD', 'Priya Desai', 'project-planner',
                '<div style="%s color: %s;">walked away at visit 3</div>'
                '<div style="%s color: %s;">returning &mdash; she said a fix would bring her back</div>' % (
                    T_META, MUTED, T_META, CONFIRMED)),
            who('TR', 'Tom&aacute;s Ruiz', 'power-organizer',
                '<div style="%s color: %s;">4 visits &middot; still coming back</div>' % (T_META, MUTED)),
            who('CM', 'Casey Morgan', 'casual-lister',
                '<div style="%s color: %s;">4 visits &middot; still coming back</div>' % (T_META, MUTED)),
            T_META, MUTED, RULE,
            label('What you changed &mdash; optional'),
            CARD, RULE_STRONG, T_BODY, INK, CLAIM, T_META, MUTED,
            T_BODY, INK, RULE, RULE,
            T_META, MUTED,
            WELL, T_BODY, SOFT,
            button('Send them back', 'go'), button('Cancel', 'quiet')))

    overlay = ('<div style="position: absolute; left: 50%%; top: 50%%; transform: translate(-50%%, -50%%); width: 580px; '
               'background: %s; border: 1px solid %s; border-radius: 10px; padding: 26px 28px; '
               'box-shadow: 0 18px 44px rgba(26, 21, 16, 0.22);">%s</div>') % (CARD, RULE_STRONG, dialog)

    behind = (
        '<div style="%s color: %s; margin-bottom: 10px;">Results / Tasklet drops the due date you set</div>' % (T_META, MUTED) +
        '<h1 style="%s margin: 0 0 14px;">Tasklet drops the due date you set</h1>' % T_TITLE +
        '<div style="display: flex; gap: 14px; margin-bottom: 24px;">%s%s%s</div>' % (
            severity('critical', 'bug'), toolname('update_task'), chip('confirmed', 'good')) +
        ''.join(card('<div style="height: %dpx;"></div>' % h, pad='16px') + '<div style="height: 16px;"></div>'
                for h in (120, 90, 150, 110)))
    return frame('results', behind, 900, came_back=False, executions=3, visits=11, spent='$4.37',
                 overlay=overlay, dim=True)


# --- 5. How the loop closes --------------------------------------------------

NODE_W, NODE_H = 250, 108


def node(x, y, title, sub, w=NODE_W, h=NODE_H, strong=False):
    border = ACCENT if strong else RULE_STRONG
    bg = ACCENT_WASH if strong else CARD
    return ('<div style="position: absolute; left: %dpx; top: %dpx; width: %dpx; height: %dpx; background: %s; '
            'border: 1px solid %s; border-radius: 8px; padding: 13px 15px;">'
            '<div style="%s color: %s;">%s</div>'
            '<div style="%s color: %s; margin-top: 6px;">%s</div></div>') % (
        x, y, w, h, bg, border, T_FINDING, ACCENT if strong else INK, title, T_META, SOFT if strong else MUTED, sub)


def return_flow():
    boxes = ''.join([
        node(56, 170, 'A problem in full', 'You marked it fixed. The check is offered at the foot of the page.'),
        node(56, 340, 'Who walked away', 'Priya said a fix would bring her back. That promise is the offer here.'),
        node(420, 255, 'Send them back?', 'Who goes, what they carry, what it will cost, and what this is not.', w=230),
        node(760, 255, 'Execution 4 runs', 'Same cast, same memory, same accounts. Watch it on Live.', w=230),
        node(1104, 160, 'Who came back', 'Each person&rsquo;s own verdict, in their own words. The new screen.', w=260, h=128, strong=True),
        node(1104, 366, 'Side by side', 'The signature diff. Supporting context, never the headline.', w=260),
    ])
    arrows = '''<svg width="1440" height="560" viewBox="0 0 1440 560" style="position: absolute; left: 0; top: 0; pointer-events: none;">
  <defs>
    <marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="%(rs)s"></path>
    </marker>
    <marker id="headq" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="%(muted)s"></path>
    </marker>
  </defs>
  <g fill="none" stroke="%(rs)s" stroke-width="1.5" marker-end="url(#head)">
    <path d="M 306 224 H 363 V 286 H 412"></path>
    <path d="M 306 394 H 363 V 330 H 412"></path>
    <path d="M 650 309 H 752"></path>
    <path d="M 990 292 H 1042 V 224 H 1096"></path>
  </g>
  <g fill="none" stroke="%(muted)s" stroke-width="1.5" stroke-dasharray="5 4" marker-end="url(#headq)">
    <path d="M 990 326 H 1042 V 420 H 1096"></path>
    <path d="M 1234 160 V 116 H 181 V 162"></path>
  </g>
</svg>''' % dict(rs=RULE_STRONG, muted=MUTED)

    caption = ('<div style="position: absolute; left: 200px; top: 74px; %s color: %s;">'
               'a returning person&rsquo;s new report is a problem in full again</div>') % (T_META, MUTED)

    body = ('<div style="position: relative; width: 1440px; height: 660px; background: %s; overflow: hidden; '
            'font-family: \'Instrument Sans\', system-ui, sans-serif;">'
            '<div style="position: absolute; left: 56px; top: 30px; width: 820px;">'
            '<h1 style="%s margin: 0;">How the loop closes</h1></div>'
            '<div style="position: absolute; left: 56px; top: 500px; width: 620px;">'
            '<p style="%s color: %s; margin: 0;">Two doors into the same act, and both of them are places where a '
            'reader has just finished being persuaded: the problem they have decided to fix, and the person who left '
            'over it. Nothing else in the product offers it, because nowhere else has the reader earned the right to '
            'press it.</p></div>'
            '<div style="position: absolute; left: 760px; top: 500px; width: 600px;">'
            '<p style="%s color: %s; margin: 0;">The verdict screen is solid and the comparison is dashed on purpose. '
            'What a named person says when they come back is the answer; matching titles between executions is a '
            'hint, and it is wrong in both directions.</p></div>'
            '%s%s%s</div>') % (PAPER, T_TITLE, T_BODY, SOFT, T_BODY, SOFT, arrows, boxes, caption)
    return HEAD + body + TAIL


if __name__ == '__main__':
    write('Returned.dc.html', returned())
    write('LeftWithAction.dc.html', left_with_action())
    write('FindingWithAction.dc.html', finding_with_action())
    write('CarryForward.dc.html', carry_forward())
    write('ReturnFlow.dc.html', return_flow())
