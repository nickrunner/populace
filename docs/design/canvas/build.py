#!/usr/bin/env python3
"""Generates the app-shell artboards of the Populace design canvas.

Main.dc.html and Trace.dc.html are hand-authored; every other screen shares the
same chrome, so it is written once here and filled with per-screen content.
"""
import io, sys, pathlib

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
    body { margin: 0; background: #f9f6f2; color: #1a1510; font-family: "Instrument Sans", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
    a { color: #236292; text-decoration: none; }
    a:hover { color: #4280b2; text-decoration: underline; }
  </style>
</helmet>
'''

TAIL = '''</x-dc>
</body>
</html>
'''

ICONS = {
  'overview': '<rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/>',
  'findings': '<path d="M3.5 14V2.5h8l-1.6 2.6 1.6 2.6h-8"/>',
  'gaps': '<rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke-dasharray="2.4 2"/><path d="M8 5.5v5M5.5 8h5"/>',
  'left': '<path d="M9.5 2.5h3v11h-3M9.5 8H2.5M5 5l-2.5 3L5 11"/>',
  'population': '<circle cx="6" cy="5.5" r="2.3"/><path d="M2 13.5c0-2.2 1.8-3.6 4-3.6s4 1.4 4 3.6"/><path d="M10.6 3.6a2.3 2.3 0 0 1 0 4.4M11.6 10.4c1.5.4 2.4 1.6 2.4 3.1"/>',
  'wakes': '<path d="M1.5 8h3l2-4.5 3 9 2-4.5h3"/>',
  'cost': '<circle cx="8" cy="8" r="5.5"/><path d="M8 4.8v6.4M9.8 6.3c-.4-.6-1-.9-1.8-.9-1 0-1.7.5-1.7 1.3 0 1.9 3.6.9 3.6 2.8 0 .8-.8 1.4-1.9 1.4-.9 0-1.5-.3-1.9-1"/>',
}

NAV = [
  ('group', None, None, None),
  ('item', 'overview', 'Overview', ''),
  ('label', None, 'What we found', None),
  ('item', 'findings', 'Findings', '12'),
  ('item', 'gaps', 'Coverage gaps', '2'),
  ('item', 'left', 'Who walked away', '1'),
  ('label', None, 'How it ran', None),
  ('item', 'population', 'Population', '3'),
  ('item', 'wakes', 'Wakes', '11'),
  ('item', 'cost', 'Cost', ''),
]


def nav(active):
    out = []
    out.append('    <div style="padding: 14px 12px; display: flex; flex-direction: column; gap: 14px;">')
    open_group = False
    for kind, key, text, count in NAV:
        if kind == 'group':
            out.append('      <div style="display: flex; flex-direction: column; gap: 2px;">')
            open_group = True
            continue
        if kind == 'label':
            if open_group:
                out.append('      </div>')
            out.append('      <div style="display: flex; flex-direction: column; gap: 2px;">')
            open_group = True
            out.append('        <div style="padding: 0 10px 6px; font-size: 10.5px; font-weight: 600; letter-spacing: 0.09em; text-transform: uppercase; color: #857f79;">%s</div>' % text)
            continue
        on = key == active
        style = ('padding: 8px 10px; border-radius: 5px; background: #dbeefe; color: #236292; font-size: 13.5px; font-weight: 600;'
                 if on else 'padding: 8px 10px; border-radius: 5px; color: #57514c; font-size: 13.5px;')
        badge = ('<span style="color: #857f79; font-size: 12px;">%s</span>' % count) if count else ''
        out.append('        <div style="display: flex; align-items: center; gap: 10px; %s">' % style)
        out.append('          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">%s</svg>' % ICONS[key])
        out.append('          <span style="flex-grow: 1;">%s</span>%s' % (text, badge))
        out.append('        </div>')
    if open_group:
        out.append('      </div>')
    out.append('    </div>')
    return '\n'.join(out)


def shell(active, topbar_right, content, height=980):
    return HEAD + '''
<div style="width: 1440px; height: %(h)dpx; display: flex; background: #f9f6f2; overflow: hidden;">

  <div style="width: 228px; flex-shrink: 0; background: #fefdfb; border-right: 1px solid #e1ded7; display: flex; flex-direction: column;">
    <div style="padding: 18px 20px 16px; border-bottom: 1px solid #e1ded7;">
      <div style="font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 13px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase;">populace</div>
      <div style="margin-top: 2px; font-size: 11px; color: #857f79;">running on this machine</div>
    </div>
%(nav)s
    <div style="margin-top: auto; padding: 16px 18px; border-top: 1px solid #e1ded7;">
      <div style="display: flex; justify-content: space-between; align-items: baseline;">
        <div style="font-size: 11.5px; color: #57514c;">Spent today</div>
        <div style="font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 12px; font-weight: 600;">$4.37</div>
      </div>
      <div style="margin-top: 7px; height: 6px; border-radius: 3px; background: #dbeefe; overflow: hidden;">
        <div style="width: 9%%; height: 6px; border-radius: 3px; background: #236292;"></div>
      </div>
      <div style="margin-top: 6px; font-size: 11px; color: #857f79;">of the $50.00 daily ceiling</div>
    </div>
  </div>

  <div style="flex-grow: 1; display: flex; flex-direction: column; min-width: 0;">
    <div style="height: 56px; flex-shrink: 0; border-bottom: 1px solid #e1ded7; background: #fefdfb; display: flex; align-items: center; gap: 14px; padding: 0 24px;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="width: 7px; height: 7px; border-radius: 4px; background: #0ca30c;"></span>
        <span style="font-size: 15px; font-weight: 600;">Tasklet</span>
      </div>
      <span style="font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 11.5px; color: #857f79;">http://127.0.0.1:4310/mcp</span>
      <div style="flex-grow: 1;"></div>
%(right)s
    </div>

%(content)s
  </div>
</div>
''' % {'h': height, 'nav': nav(active), 'right': topbar_right, 'content': content} + TAIL


RUN_PICKER = '''      <div style="display: flex; align-items: center; gap: 8px; padding: 5px 11px; border: 1px solid #e1ded7; border-radius: 5px; background: #fefdfb;">
        <span style="font-size: 12px; color: #57514c;">Run</span>
        <span style="font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 12px; font-weight: 500;">run_m1abc2de_x7k9q2</span>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#857f79" stroke-width="1.5"><path d="M4 6.5 8 10.5l4-4"/></svg>
      </div>
      <div style="padding: 5px 10px; border-radius: 5px; background: #f3f0ea; font-size: 11.5px; color: #57514c;">Read-only</div>'''


def write(name, text):
    pathlib.Path(name).write_text(text, encoding='utf-8')
    print('wrote', name, len(text), 'bytes')
