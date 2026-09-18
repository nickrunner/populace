#!/usr/bin/env python3
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
TAIL = '</x-dc>\n</body>\n</html>\n'


def node(x, y, w, h, title, sub, tone='solid'):
    if tone == 'solid':
        box = 'background: #fefdfb; border: 1px solid #cecac2;'
        tc, sc = '#1a1510', '#857f79'
    elif tone == 'key':
        box = 'background: #fefdfb; border: 2px solid #236292;'
        tc, sc = '#1a1510', '#57514c'
    elif tone == 'future':
        box = 'background: transparent; border: 1px dashed #cecac2;'
        tc, sc = '#857f79', '#a09a92'
    else:
        box = 'background: #fde9d4; border: 1px solid #f3d6b4;'
        tc, sc = '#6b431a', '#8a6540'
    return ('  <div style="position: absolute; left: %dpx; top: %dpx; width: %dpx; height: %dpx; %s border-radius: 7px; '
            'padding: 11px 14px; display: flex; flex-direction: column; justify-content: center;">\n'
            '    <div style="font-size: 14px; font-weight: 600; color: %s;">%s</div>\n'
            '    <div style="margin-top: 3px; font-size: 11.5px; line-height: 1.4; color: %s;">%s</div>\n'
            '  </div>\n') % (x, y, w, h, box, tc, title, sc, sub)


def group(x, y, w, h, label, color='#cecac2'):
    return ('  <div style="position: absolute; left: %dpx; top: %dpx; width: %dpx; height: %dpx; border: 1px dashed %s; border-radius: 12px;"></div>\n'
            '  <div style="position: absolute; left: %dpx; top: %dpx; padding: 3px 10px; background: #f9f6f2; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #857f79;">%s</div>\n'
            ) % (x, y, w, h, color, x + 18, y - 10, label)


def path(d, color='#cecac2', dash=''):
    da = ' stroke-dasharray="%s"' % dash if dash else ''
    return '    <path d="%s" fill="none" stroke="%s" stroke-width="1.6"%s marker-end="url(#ah-%s)"/>\n' % (d, color, da, color.lstrip('#'))


parts = [HEAD, '\n<div style="position: relative; width: 1440px; height: 880px; background: #f9f6f2; overflow: hidden;">\n']

parts.append('  <div style="position: absolute; left: 40px; top: 28px; font-size: 22px; font-weight: 600; letter-spacing: -0.01em;">How the screens connect</div>\n')
parts.append('  <div style="position: absolute; left: 40px; top: 60px; width: 900px; font-size: 13.5px; line-height: 1.55; color: #57514c;">'
             'One navigation, no role switch. The top band is what we found; the bottom band is how we know. The two ochre arrows are the seam — the only thing a product owner has to cross to see a tool call, and the only thing a developer has to cross to see who it hurt.</div>\n')

# M2 band
parts.append(group(40, 132, 1360, 100, 'M2 adds — set it up and drive it from the browser'))
parts.append(node(56, 152, 250, 60, 'Connect a target', 'paste an MCP URL, see its tools'))
parts.append(node(336, 152, 250, 60, 'Describe the people', 'persona editor and starter library'))
parts.append(node(616, 152, 250, 60, 'Set the limits', 'budget, turns, cadence, cost estimate'))
parts.append(node(896, 152, 250, 60, 'Start it, and stop it', 'live spend meter, kill switch'))
parts.append('  <div style="position: absolute; left: 1178px; top: 160px; width: 210px; font-size: 11.5px; line-height: 1.45; color: #857f79;">Everything below fills in while the run is still going.</div>\n')

# Evidence band
parts.append(group(40, 292, 1360, 200, 'What we found — for whoever owns the product'))
parts.append(node(56, 316, 200, 64, 'Overview', 'one sentence on how it went'))
parts.append(node(316, 316, 200, 64, 'Findings', 'clustered, worst first'))
parts.append(node(576, 316, 230, 64, 'A finding in full', 'in their words, and what it cost', tone='key'))
parts.append(node(846, 316, 300, 64, 'Re-run the people who complained', 'M3 — the fix-validation loop', tone='future'))
parts.append(node(316, 400, 200, 64, 'Coverage gaps', 'what they wanted and could not find'))
parts.append(node(576, 400, 230, 64, 'Who walked away', 'and whether they said they would return'))

# Instrument band
parts.append(group(40, 602, 1360, 130, 'How it ran — for whoever owns the MCP server'))
parts.append(node(56, 626, 200, 64, 'Population', 'who we sent, and what they remember'))
parts.append(node(316, 626, 200, 64, 'Wakes', 'every visit, how each one ended'))
parts.append(node(576, 626, 230, 64, 'Watch a visit', 'turn by turn, call by call', tone='key'))
parts.append(node(846, 626, 200, 64, 'One call in full', 'arguments, result, timing'))

# seam labels
parts.append('  <div style="position: absolute; left: 790px; top: 500px; width: 470px;">\n'
             '    <div style="display: flex; gap: 9px; align-items: flex-start;">'
             '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#864e18" stroke-width="1.6" style="margin-top: 1px; flex-shrink: 0;"><path d="M8 2.5v11M4.5 10 8 13.5 11.5 10"/></svg>'
             '<div style="font-size: 13px; line-height: 1.45; color: #6b431a;">Every finding carries the calls that produced it.</div></div>\n'
             '    <div style="margin-top: 10px; display: flex; gap: 9px; align-items: flex-start;">'
             '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#864e18" stroke-width="1.6" style="margin-top: 1px; flex-shrink: 0;"><path d="M8 13.5v-11M4.5 6 8 2.5 11.5 6"/></svg>'
             '<div style="font-size: 13px; line-height: 1.45; color: #6b431a;">Every call says which finding cited it, and who was making it.</div></div>\n'
             '  </div>\n')

# arrows
ARROWS = [
    ('M 256 348 H 308', '#cecac2', ''),
    ('M 516 348 H 568', '#cecac2', ''),
    ('M 156 380 V 432 H 308', '#cecac2', ''),
    ('M 516 432 H 568', '#cecac2', ''),
    ('M 806 348 H 838', '#cecac2', '4 4'),
    ('M 650 380 V 618', '#864e18', ''),
    ('M 732 626 V 388', '#864e18', ''),
    ('M 256 658 H 308', '#cecac2', ''),
    ('M 516 658 H 568', '#cecac2', ''),
    ('M 806 658 H 838', '#cecac2', ''),
    ('M 720 232 V 284', '#cecac2', '4 4'),
]
svg = ['  <svg width="1440" height="880" style="position: absolute; left: 0; top: 0; pointer-events: none;">\n', '    <defs>\n']
for c in ('#cecac2', '#864e18'):
    svg.append('      <marker id="ah-%s" viewBox="0 0 8 8" refX="6.5" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M1 1 L6.5 4 L1 7" fill="none" stroke="%s" stroke-width="1.4"/></marker>\n' % (c.lstrip('#'), c))
svg.append('    </defs>\n')
for d, c, dash in ARROWS:
    svg.append(path(d, c, dash))
svg.append('  </svg>\n')
parts.append(''.join(svg))

# legend
parts.append('  <div style="position: absolute; left: 40px; top: 780px; display: flex; align-items: center; gap: 26px;">\n'
             '    <div style="display: flex; align-items: center; gap: 8px;"><span style="width: 26px; height: 16px; border-radius: 4px; border: 2px solid #236292; background: #fefdfb;"></span><span style="font-size: 12px; color: #57514c;">The two screens worth the most care</span></div>\n'
             '    <div style="display: flex; align-items: center; gap: 8px;"><span style="width: 26px; height: 16px; border-radius: 4px; border: 1px dashed #cecac2;"></span><span style="font-size: 12px; color: #57514c;">Later milestone, drawn so the layout leaves room for it</span></div>\n'
             '    <div style="display: flex; align-items: center; gap: 8px;"><svg width="26" height="10" viewBox="0 0 26 10"><path d="M0 5 H20" stroke="#864e18" stroke-width="1.6" fill="none"/><path d="M19 2 L24 5 L19 8" stroke="#864e18" stroke-width="1.4" fill="none"/></svg><span style="font-size: 12px; color: #57514c;">The seam between the two surfaces</span></div>\n'
             '  </div>\n')

parts.append('</div>\n')
parts.append(TAIL)
open('Flow.dc.html', 'w', encoding='utf-8').write(''.join(parts))
print('wrote Flow.dc.html')
