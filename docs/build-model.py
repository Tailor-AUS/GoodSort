from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

wb = Workbook()

hdr_font = Font(bold=True, size=11, name='Arial', color='FFFFFF')
hdr_fill = PatternFill('solid', fgColor='16A34A')
blue = Font(color='0000FF', name='Arial', size=10)
black = Font(color='000000', name='Arial', size=10)
bold_font = Font(bold=True, name='Arial', size=10)
red_font = Font(color='FF0000', name='Arial', size=10, bold=True)
green_bold = Font(color='008000', name='Arial', size=10, bold=True)
grey_fill = PatternFill('solid', fgColor='F2F2F2')
green_fill = PatternFill('solid', fgColor='DCFCE7')
red_fill = PatternFill('solid', fgColor='FEE2E2')
yellow_fill = PatternFill('solid', fgColor='FFFF00')
thin = Border(left=Side('thin'), right=Side('thin'), top=Side('thin'), bottom=Side('thin'))

def hdr(ws, headers):
    for j, h in enumerate(headers, 1):
        c = ws.cell(row=1, column=j, value=h)
        c.font = hdr_font; c.fill = hdr_fill
        c.alignment = Alignment(horizontal='center', wrap_text=True)
        c.border = thin

def cell(ws, r, c, v, fmt='#,##0', font=None, fill=None):
    cl = ws.cell(row=r, column=c, value=v)
    cl.border = thin; cl.number_format = fmt
    if font: cl.font = font
    if fill: cl.fill = fill
    return cl

# ═══════════════════════════════════════
# SHEET 1: ASSUMPTIONS
# ═══════════════════════════════════════
ws = wb.active; ws.title = 'Assumptions'
ws.column_dimensions['A'].width = 45
ws.column_dimensions['B'].width = 18
ws.column_dimensions['C'].width = 50

hdr(ws, ['Parameter', 'Value', 'Source'])

data = [
    ('COEX REVENUE (as registered CRP)', None, None),
    ('CDS refund per container', 0.10, 'Passed to sorter — net $0 to platform'),
    ('Handling fee per container (depot rate)', 0.0768, 'COEX SEQ 2025 — YOU KEEP THIS'),
    ('', None, None),
    ('SCRAP MATERIAL VALUE', None, None),
    ('Aluminium scrap $/kg', 1.20, 'BNE Copper Recycling April 2026'),
    ('PET scrap $/kg', 0.60, 'Domestic recycler rate'),
    ('Glass scrap $/kg', 0.08, 'Low value — heavy'),
    ('Aluminium can weight (g)', 14, 'Standard 375ml'),
    ('PET bottle weight (g)', 25, 'Standard 600ml'),
    ('Glass bottle weight (g)', 200, 'Standard stubby'),
    ('Scrap value per aluminium can', '=B9*B6/1000', '14g × $1.20/kg'),
    ('Scrap value per PET bottle', '=B10*B7/1000', '25g × $0.60/kg'),
    ('Scrap value per glass bottle', '=B11*B8/1000', '200g × $0.08/kg'),
    ('', None, None),
    ('BIN COMPOSITION ASSUMPTIONS', None, None),
    ('% Aluminium in residential bin', 0.55, 'Cans dominate in houses'),
    ('% PET in residential bin', 0.30, 'Water + soft drink bottles'),
    ('% Glass in residential bin', 0.12, 'Beer stubbies, wine'),
    ('% Other in residential bin', 0.03, 'Cartons, poppers'),
    ('Blended scrap value per container', '=B17*B12+B18*B13+B19*B14+B20*0.005', 'Weighted average'),
    ('TOTAL revenue per container (kept)', '=B3+B21', 'Handling fee + scrap'),
    ('', None, None),
    ('COLLECTION COSTS', None, None),
    ('Fuel cost per km', 0.21, 'ULP $2.30/L April 2026'),
    ('Round trip circuit (5 houses + depot)', 10, 'Moorooka area + Yeerongpilly'),
    ('Fuel per collection run', '=B25*B26', 'Derived'),
    ('Your time per run (minutes)', 50, 'Drive+pickup+depot+process'),
    ('Your time value per hour', 30, 'Opportunity cost'),
    ('Time cost per run', '=B28/60*B29', 'Derived'),
    ('TOTAL cost per collection run', '=B27+B30', 'Fuel + time'),
    ('', None, None),
    ('BREAK EVEN PER RUN', None, None),
    ('Containers needed (fuel only)', '=CEILING(B27/B22,1)', 'Just covering petrol'),
    ('Containers needed (fuel + time)', '=CEILING(B31/B22,1)', 'Covering your time too'),
    ('Containers per bin needed (5 bins)', '=CEILING(B34/5,1)', 'Each bin must have this many'),
]

r = 2
for param, val_data, src in data:
    if param and param == param.upper() and val_data is None:
        cell(ws, r, 1, param, font=bold_font, fill=grey_fill)
        cell(ws, r, 2, '', fill=grey_fill)
        cell(ws, r, 3, '', fill=grey_fill)
    elif not param:
        r += 1; continue
    else:
        cell(ws, r, 1, param)
        c = cell(ws, r, 2, val_data, font=blue if isinstance(val_data, (int, float)) else black)
        if isinstance(val_data, float) and 0 < val_data < 1:
            c.number_format = '0.00%' if val_data < 0.1 else '0.0%'
        elif isinstance(val_data, (int, float)) and val_data is not None and val_data >= 1000:
            c.number_format = '#,##0'
        elif isinstance(val_data, (int, float)) and val_data is not None:
            c.number_format = '$#,##0.00' if val_data < 10 else '#,##0'
        elif isinstance(val_data, str) and val_data.startswith('='):
            c.number_format = '$#,##0.00'
        cell(ws, r, 3, src)
    r += 1

# Highlight key outputs
for highlight_row in [22, 33, 34, 35]:
    for c in range(1, 4):
        ws.cell(row=highlight_row, column=c).fill = yellow_fill

# ═══════════════════════════════════════
# SHEET 2: WHEN TO COLLECT
# ═══════════════════════════════════════
ws2 = wb.create_sheet('When To Collect')
ws2.column_dimensions['A'].width = 30
for c in range(2, 12):
    ws2.column_dimensions[get_column_letter(c)].width = 14

hdr(ws2, ['Scenario', 'Bin 1', 'Bin 2', 'Bin 3', 'Bin 4', 'Bin 5',
          'Total Cans', 'Revenue (kept)', 'Cost (run)', 'Profit/Loss'])

scenarios = [
    ('Nearly empty (10 each)', [10, 10, 10, 10, 10]),
    ('Barely started (20 each)', [20, 20, 20, 20, 20]),
    ('Building up (40 each)', [40, 40, 40, 40, 40]),
    ('Break even - fuel only (2 each)', [2, 2, 2, 2, 2]),
    ('BREAK EVEN - fuel+time', [61, 61, 61, 61, 61]),
    ('One bin hot, rest cold', [200, 20, 20, 10, 10]),
    ('Two bins hot', [150, 120, 30, 20, 10]),
    ('All bins moderate', [80, 80, 80, 80, 80]),
    ('All bins busy', [150, 150, 150, 150, 150]),
    ('Full bags (300 each)', [300, 300, 300, 300, 300]),
    ('', [0, 0, 0, 0, 0]),
    ('REALISTIC WEEK 4', [40, 35, 25, 20, 15]),
    ('REALISTIC WEEK 8', [70, 60, 50, 40, 30]),
    ('REALISTIC WEEK 12', [100, 90, 80, 60, 50]),
    ('REALISTIC WEEK 24', [150, 130, 120, 100, 80]),
]

for i, (name, bins) in enumerate(scenarios, 2):
    r = i
    cell(ws2, r, 1, name, font=bold_font if 'BREAK' in name or 'REALISTIC' in name else black)
    for j, b in enumerate(bins, 2):
        cell(ws2, r, j, b, font=blue)
    cell(ws2, r, 7, f'=SUM(B{r}:F{r})', '#,##0')
    cell(ws2, r, 8, f'=G{r}*Assumptions!B22', '$#,##0.00')
    cell(ws2, r, 9, f'=Assumptions!B31', '$#,##0.00')
    # Profit/loss
    cell(ws2, r, 10, f'=H{r}-I{r}', '$#,##0.00;($#,##0.00);-')

    # Color the profit/loss
    if name and 'BREAK' not in name:
        pass  # Conditional formatting would need openpyxl rules, skip for now

# ═══════════════════════════════════════
# SHEET 3: WAIT vs COLLECT NOW
# ═══════════════════════════════════════
ws3 = wb.create_sheet('Wait vs Collect')
ws3.column_dimensions['A'].width = 40
ws3.column_dimensions['B'].width = 18
ws3.column_dimensions['C'].width = 45
hdr(ws3, ['Question', 'Answer', 'Insight'])

qa = [
    ('HOW LONG TO WAIT?', None, None),
    ('If bins fill at 10/week each', '=CEILING(Assumptions!B35*5/50,1)', 'Weeks until all bins have enough'),
    ('If bins fill at 20/week each', '=CEILING(Assumptions!B35*5/100,1)', 'Faster adoption'),
    ('If bins fill at 40/week each', '=CEILING(Assumptions!B35*5/200,1)', 'Good adoption'),
    ('', None, None),
    ('OPTIMAL STRATEGY', None, None),
    ('Collect when total across 5 bins hits', '=Assumptions!B34', 'This is your trigger number'),
    ('Revenue from that run', '=B7*Assumptions!B22', 'What you earn'),
    ('Cost of that run', '=Assumptions!B31', 'Fuel + your time'),
    ('Profit from that run', '=B8-B9', 'Worth doing'),
    ('', None, None),
    ('COMPOSITION MATTERS', None, None),
    ('If 100% aluminium (best case)', '=Assumptions!B3+Assumptions!B12', 'Handling + full scrap value per can'),
    ('If 100% glass (worst case)', '=Assumptions!B3+Assumptions!B14', 'Heavy, low scrap but same handling fee'),
    ('The handling fee is the same regardless', '=Assumptions!B3', '7.68c whether its a can or a bottle'),
    ('So material mix mainly affects WEIGHT not revenue', '', 'More glass = heavier bags, same money'),
    ('', None, None),
    ('REAL TALK', None, None),
    ('At $0.092/container you need volume', '', 'This is a volume game'),
    ('5 bins × 60/week = 300/week = $27.60/week', '=5*60*Assumptions!B22', 'After costs: ~$0/week (just covers time)'),
    ('5 bins × 100/week = 500/week = $46/week', '=5*100*Assumptions!B22', 'After costs: ~$18/week profit'),
    ('5 bins × 150/week = 750/week = $69/week', '=5*150*Assumptions!B22', 'After costs: ~$41/week profit'),
    ('To make $500/week you need', '=CEILING(500/Assumptions!B22+Assumptions!B34,1)', 'Containers per week'),
    ('Thats how many bins @ 100/wk', '=CEILING(B24/100,1)', 'This is the scale target'),
]

r = 2
for q, a, n in qa:
    if q and q == q.upper() and a is None:
        cell(ws3, r, 1, q, font=bold_font, fill=grey_fill)
        cell(ws3, r, 2, '', fill=grey_fill)
        cell(ws3, r, 3, '', fill=grey_fill)
    elif not q:
        r += 1; continue
    else:
        cell(ws3, r, 1, q)
        c = cell(ws3, r, 2, a, '$#,##0.00;($#,##0.00);-', font=blue if isinstance(a, (int, float)) else black)
        cell(ws3, r, 3, n)
    r += 1

wb.save('docs/unit-economics-model.xlsx')
print('Created: docs/unit-economics-model.xlsx')
