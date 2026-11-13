import io, os, re, zipfile
from xml.sax.saxutils import escape

import json
OUT = os.environ['XLSX_OUT']
_J = json.load(open(os.environ['XLSX_JSON'], encoding='utf-8')) if os.environ.get('XLSX_JSON') else {}
VALS, NOTES = _J.get('vals', {}), _J.get('notes', {})

# ───────── 서식 번호 (styles.xml 의 cellXfs 순서와 같다)
S = dict(default=0, title=1, section=2, label=3, in_won=4, in_pct=5, in_int=6, in_date=7, in_text=8, calc_won=9, calc_pct=10,
         calc_ratio=11, note=12, colhead=13, calc_key=14, in_ratio=15, sub=16)

# ───────── 양식 정의: (kind, key, label, fmt, formula/note, note)
# kind: title / info / section / sub / input / calc / key / text
ROWS = [
    ('title', None, '비용편익추계서 (공헌이익 계산)', None, None, None),
    ('hint', None, '노란 칸만 입력하세요. 회색 칸은 자동 계산돼요 (단위: 원). 모르는 값은 비워 두지 말고 "미확인"이라고 적고, 맨 아래 "가정·한계·미확인"에 올려 주세요.', None, None, None),
    ('colhead', None, ('항목', '값', '산식 · 설명', '근거 자료 · 비고'), None, None, None),
    ('section', None, '문서 정보', None, None, None),
    ('input', 'docno', '문서번호', 'text', '예: EST-2026-0701-001', None),
    ('input', 'ref', '안건 분류 ID', 'text', '인플루언서 INF-nnn / 캠페인 CMP-nnnn', None),
    ('input', 'date', '작성일', 'date', None, None),
    ('input', 'writer', '작성자', 'text', None, None),
    ('input', 'period', '추계 기간', 'text', '예: 2026-07-01 ~ 2026-12-31', None),
    ('input', 'scenario', '시나리오', 'text', '기준 / 낙관 / 보수 중 선택', None),

    ('section', None, '1. 매출 가정', None, None, None),
    ('input', 'orders', '예상 주문 수 (건)', 'int', None, None),
    ('input', 'aov', '평균 주문금액', 'won', '쿠폰 반영 후 · VAT 제외 (쿠폰 할인액은 GMV에 이미 반영되어 다시 빼지 않아요)', None),
    ('input', 'retrate', '예상 반품률 (금액 기준)', 'pct', '예상 반품 환불액 ÷ 예상 GMV', None),
    ('calc', 'gmv', '예상 GMV', 'won', '예상 주문 수 × 평균 주문금액', ('orders', 'aov', '{orders}*{aov}')),
    ('calc', 'refund', '예상 반품 환불액', 'won', '예상 GMV × 예상 반품률', ('gmv', 'retrate', '{gmv}*{retrate}')),
    ('calc', 'net', '순매출 (Net Revenue)', 'won', '예상 GMV − 예상 반품 환불액', ('gmv', 'refund', '{gmv}-{refund}')),

    ('section', None, '2. 비용 가정 (공헌이익에서 빼는 비용)', None, None, None),
    ('input', 'cogsrate', '제품 원가율 (순매출 대비)', 'pct', '사내 원가표 기준', None),
    ('input', 'feerate', '채널 수수료율 (순매출 대비)', 'pct', '사내 원가표 기준', None),
    ('input', 'shipunit', '주문당 출고(배송)비', 'won', '사내 원가표 기준', None),
    ('input', 'retcount', '예상 반품 건수 (건)', 'int', None, None),
    ('input', 'retunit', '반품 건당 물류비', 'won', '사내 원가표 기준', None),
    ('calc', 'cogs', '제품 원가 (COGS)', 'won', '순매출 × 제품 원가율', ('net', 'cogsrate', '{net}*{cogsrate}')),
    ('calc', 'fee', '채널 수수료', 'won', '순매출 × 채널 수수료율', ('net', 'feerate', '{net}*{feerate}')),
    ('calc', 'ship', '출고(배송)비', 'won', '주문당 출고비 × 예상 주문 수', ('shipunit', 'orders', '{shipunit}*{orders}')),
    ('calc', 'retlog', '반품 물류비', 'won', '반품 건당 물류비 × 예상 반품 건수', ('retunit', 'retcount', '{retunit}*{retcount}')),

    ('section', None, '3. 마케팅 지출 (요청금액)', None, None, None),
    ('input', 'mk_inf', '인플루언서 비용 (건별 진행비)', 'won', '연 전속 고정 피 · 성과 피와 별도인 건별 진행비', None),
    ('input', 'mk_perf', '퍼포먼스 광고비', 'won', '매체 · 노출 단가 × 노출량', None),
    ('input', 'mk_off', '오프라인 비용', 'won', None, None),
    ('calc', 'mk', '마케팅 지출 합계 (= 요청금액)', 'won', '위 세 항목의 합', ('mk_inf', 'mk_perf', 'mk_off', '{mk_inf}+{mk_perf}+{mk_off}')),

    ('section', None, '4. 결과 (공식 지표 — 사내 계산 정의 1.4)', None, None, None),
    ('key', 'cp', '공헌이익 (Contribution Profit)', 'won', '순매출 − 제품 원가 − 채널 수수료 − 출고(배송)비 − 반품 물류비 − 마케팅 지출  (주 판단기준)', ('net', 'mk', '{net}-{cogs}-{fee}-{ship}-{retlog}-{mk}')),
    ('calc', 'real', '실질 ROAS', 'ratio', '공헌이익 ÷ 마케팅 지출', ('cp', 'mk', '{cp}/{mk}')),
    ('calc', 'nominal', '명목 ROAS', 'ratio', '예상 GMV ÷ 마케팅 지출', ('gmv', 'mk', '{gmv}/{mk}')),

    ('section', None, '5. 공헌이익에 포함되지 않는 비용 (판단 보충용 · 공식 지표 아님)', None, None, None),
    ('input', 'fixed', '연 전속 고정 피', 'won', '계약서 고정 피 (고정 피·혼합 피 계약일 때)', None),
    ('input', 'attr', '예상 귀속 GMV (연)', 'won', '성과 피 기준: 귀속 GMV · 귀속 방식 last-click 7일 (고정)', None),
    ('input', 'prate', '성과 피 비율', 'pct', '귀속 GMV의 몇 %', None),
    ('input', 'pcap', '성과 피 연 상한 (선택)', 'won', '없으면 비워 두세요', None),
    ('input', 'pfloor', '성과 피 연 하한·보장 (선택)', 'won', '없으면 비워 두세요', None),
    ('calc', 'perf', '성과 피 (연 예상)', 'won', '귀속 GMV × 비율 (상한·하한 반영)', ('attr', 'prate', 'MAX(N({pfloor}),MIN(IF({pcap}="",9.99E+307,{pcap}),{attr}*{prate}))')),
    ('input', 'urgent', '긴급배송 추가 비용 (선택)', 'won', '품절·주문 급증 시. 자료가 없으면 "미확인"이라고 적고 아래 미확인 항목에 올리세요', None),
    ('input', 'cs', '고객 문의(CS) 비용 (선택)', 'won', '문의 건수 × 건당 비용', None),
    ('calc', 'cp2', '인플루언서 총비용 반영 공헌이익 (자체 정의)', 'won', '공헌이익 − 연 전속 고정 피 − 성과 피 − 긴급배송 − CS', ('cp', '{cp}-N({fixed})-N({perf})-N({urgent})-N({cs})')),
    ('calc', 'roas2', '인플루언서 총비용 반영 ROAS (자체 정의)', 'ratio', '위 값 ÷ (마케팅 지출 + 고정 피 + 성과 피)', ('cp2', 'mk', '{cp2}/({mk}+N({fixed})+N({perf}))')),

    ('section', None, '6. 현금 · 승인 확인', None, None, None),
    ('input', 'paydate', '지급 예정일 (돈이 나가는 날)', 'date', None, None),
    ('input', 'payamt', '지급액', 'won', None, None),
    ('input', 'breach', '현금 하회 예상 구간 안인가', 'text', '예 / 아니오 / 미확인 중 선택 — 지급 예정일을 재무팀 현금 전망과 대조 (예이면 금액 불문 CEO/이사회)', None),
    ('input', 'g300', '그룹 300억 배분 검토 대상 여부', 'text', '대상 / 대상 아님 / 미확정 중 선택 — 재무팀 판정, 집행 기준기간 향후 6개월 이내', None),

    ('section', None, '7. 비교 (판단 근거 · 실적)', None, None, None),
    ('input', 'prev_cp', '같은 인플루언서의 기존 실질 공헌이익', 'won', '사내 성과 집계 값', None),
    ('input', 'prev_share', '광고비 집행 비중', 'pct', '전체 광고비 중 이 인플루언서의 몫', None),
    ('input', 'prev_rank', '실질 공헌이익 순위 (예: 10명 중 10위)', 'text', None, None),

    ('section', None, '8. 가정 · 한계 · 미확인', None, None, None),
    ('input', 'assume', '가정 · 한계', 'text', '예: 원가·배송비는 주문 1건에 1회 적용 / 환불 시 원가·수수료 회수 없음 / 표본 자료라 순위·방향만 사용', None),
    ('input', 'unknown', '미확인 항목 (담당 · 회신 기한)', 'text', '예: 성과 피 비율 — 마케팅 회신 필요', None),
]

# ───────── 셀 주소 배정
addr = {}
r = 0
layout = []
for row in ROWS:
    r += 1
    layout.append((r, row))
    if row[1]:
        addr[row[1]] = f'B{r}'

def formula_for(spec, rounded=False):
    deps_and_expr = spec
    expr = deps_and_expr[-1]
    deps = deps_and_expr[:-1]
    # {key} → N(Bx) 로 바꿔 빈 칸을 0 으로 본다. 이미 N(...) 으로 감싼 식({fixed} 등)은 그대로 둔다.
    def sub(m):
        return f'N({addr[m.group(1)]})'
    body = re.sub(r'N\(\{(\w+)\}\)', lambda m: f'N({addr[m.group(1)]})', expr)
    body = re.sub(r'\{(\w+)\}', lambda m: addr[m.group(1)] if f'N({addr[m.group(1)]})' in body else f'N({addr[m.group(1)]})', body)
    # IF(조건)로 감싼 {pcap}="" 같은 비교는 원래 셀 주소를 써야 한다
    body = re.sub(r'IF\(N\((B\d+)\)=""', r'IF(\1=""', body)
    if rounded:
        body = f'ROUND({body},0)'  # 원 미만은 반올림 (표시와 합계가 1원도 어긋나지 않게)
    counts = ','.join(addr[d] for d in deps)
    return f'IFERROR(IF(COUNT({counts})=0,"",{body}),"")'

# ───────── 시트 XML
def cell(ref, style, value=None, formula=None, is_text=False):
    if formula is not None:
        return f'<c r="{ref}" s="{style}"><f>{escape(formula)}</f></c>'
    if value is None or value == '':
        return f'<c r="{ref}" s="{style}"/>'
    if is_text:
        return f'<c r="{ref}" s="{style}" t="inlineStr"><is><t xml:space="preserve">{escape(str(value))}</t></is></c>'
    return f'<c r="{ref}" s="{style}"><v>{value}</v></c>'

IN_STYLE = {'won': S['in_won'], 'pct': S['in_pct'], 'int': S['in_int'], 'date': S['in_date'], 'text': S['in_text']}
CALC_STYLE = {'won': S['calc_won'], 'pct': S['calc_pct'], 'ratio': S['calc_ratio'], 'int': S['calc_won']}

rows_xml, merges = [], []
heights = {}
for rn, row in layout:
    kind, key, label, fmt, note, spec = row
    cells = []
    if kind == 'title':
        cells = [cell(f'A{rn}', S['title'], label, is_text=True)]
        merges.append(f'A{rn}:D{rn}'); heights[rn] = 26
    elif kind == 'hint':
        cells = [cell(f'A{rn}', S['note'], label, is_text=True)] + [cell(f'{c}{rn}', S['note']) for c in 'BCD']
        merges.append(f'A{rn}:D{rn}'); heights[rn] = 32
    elif kind == 'colhead':
        cells = [cell(f'{c}{rn}', S['colhead'], t, is_text=True) for c, t in zip('ABCD', label)]
    elif kind == 'section':
        cells = [cell(f'A{rn}', S['section'], label, is_text=True)] + [cell(f'{c}{rn}', S['section']) for c in 'BCD']
        merges.append(f'A{rn}:D{rn}')
    elif kind == 'input':
        st = IN_STYLE[fmt]
        cells = [cell(f'A{rn}', S['label'], label, is_text=True), cell(f'B{rn}', st, VALS.get(key), is_text=isinstance(VALS.get(key), str)), cell(f'C{rn}', S['note'], note, is_text=True), cell(f'D{rn}', S['in_text'], NOTES.get(key), is_text=True)]
        if key in ('assume', 'unknown'):
            heights[rn] = 44
    else:  # calc / key
        st = S['calc_key'] if kind == 'key' else CALC_STYLE[fmt]
        cells = [cell(f'A{rn}', S['label'], label, is_text=True), cell(f'B{rn}', st, formula=formula_for(spec, rounded=(fmt == 'won'))), cell(f'C{rn}', S['note'], note, is_text=True), cell(f'D{rn}', S['in_text'], NOTES.get(key), is_text=True)]
    ht = f' ht="{heights[rn]}" customHeight="1"' if rn in heights else ''
    rows_xml.append(f'<row r="{rn}"{ht}>{"".join(cells)}</row>')

last = layout[-1][0]

def validation(key, items):
    ref = addr[key]
    return f'<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="{ref}"><formula1>"{items}"</formula1></dataValidation>'

dvs = [
    validation('scenario', '기준,낙관,보수'),
    validation('breach', '예,아니오,미확인'),
    validation('g300', '대상,대상 아님,미확정'),
]

sheet1 = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:D{last}"/>
<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="18"/>
<cols><col min="1" max="1" width="40" customWidth="1"/><col min="2" max="2" width="22" customWidth="1"/><col min="3" max="3" width="62" customWidth="1"/><col min="4" max="4" width="30" customWidth="1"/></cols>
<sheetData>{"".join(rows_xml)}</sheetData>
<mergeCells count="{len(merges)}">{"".join(f'<mergeCell ref="{m}"/>' for m in merges)}</mergeCells>
<dataValidations count="{len(dvs)}">{"".join(dvs)}</dataValidations>
<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>
</worksheet>'''

# ───────── 작성 안내 시트
GUIDE = [
    '작성 안내',
    '1. 노란 칸만 입력해요. 회색 칸(예상 GMV, 순매출, 원가, 공헌이익, ROAS 등)은 입력값에서 자동 계산돼요.',
    '2. 모든 금액은 원 단위(1원까지)예요. 쿠폰 할인액은 GMV에 이미 반영되어 있어서 다시 빼지 않아요.',
    '3. 공식 지표는 4번 구역(공헌이익·실질 ROAS·명목 ROAS)이에요. 5번 구역은 판단 보충용이라 공식 지표가 아니에요.',
    '4. 성과 피는 귀속 GMV 기준, 귀속 방식은 last-click 7일로 고정이에요.',
    '5. 모르는 값은 비워 두지 말고 "미확인"이라고 적은 뒤 8번 구역과 기안서의 "부족한 정보"에 올려요.',
    '6. 요청금액(마케팅 지출 합계)은 계약서 금액·기안서 요청금액과 같아야 해요.',
    '7. 이 문서는 합성(가상) 데이터예요. 실제 계약·실제 성과가 아니에요.' if VALS else '7. 이 문서는 합성(가상) 데이터를 만들 때 쓰는 빈 양식이에요.',
]
g_rows = []
for i, t in enumerate(GUIDE, start=1):
    g_rows.append(f'<row r="{i}">{cell(f"A{i}", S["title"] if i == 1 else S["default"], t, is_text=True)}</row>')
sheet2 = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:A{len(GUIDE)}"/>
<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>
<sheetFormatPr defaultRowHeight="20"/>
<cols><col min="1" max="1" width="110" customWidth="1"/></cols>
<sheetData>{"".join(g_rows)}</sheetData>
<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>'''

# ───────── styles.xml
def xf(numFmt=0, font=0, fill=0, border=0, align=None):
    a = f'<alignment {align}/>' if align else ''
    apply = f'applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"' + (' applyAlignment="1"' if align else '')
    return f'<xf numFmtId="{numFmt}" fontId="{font}" fillId="{fill}" borderId="{border}" xfId="0" {apply}>{a}</xf>'

WRAP = 'vertical="center" wrapText="1"'
styles = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4"><numFmt numFmtId="164" formatCode="0.0%"/><numFmt numFmtId="165" formatCode="0.00&quot;배&quot;"/><numFmt numFmtId="166" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="167" formatCode="#,##0&quot;원&quot;"/></numFmts>
<fonts count="5">
<font><sz val="10"/><name val="맑은 고딕"/><family val="2"/></font>
<font><b/><sz val="10"/><name val="맑은 고딕"/><family val="2"/></font>
<font><b/><sz val="15"/><name val="맑은 고딕"/><family val="2"/></font>
<font><sz val="9"/><color rgb="FF595959"/><name val="맑은 고딕"/><family val="2"/></font>
<font><b/><sz val="10"/><color rgb="FF1F3864"/><name val="맑은 고딕"/><family val="2"/></font>
</fonts>
<fills count="6">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD9E1F2"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD9D9D9"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FF7F7F7F"/></left><right style="thin"><color rgb="FF7F7F7F"/></right><top style="thin"><color rgb="FF7F7F7F"/></top><bottom style="thin"><color rgb="FF7F7F7F"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="17">
{xf()}
{xf(0, 2, 0, 0, 'vertical="center"')}
{xf(0, 4, 4, 1, 'vertical="center"')}
{xf(0, 0, 0, 1, WRAP)}
{xf(3, 0, 2, 1, 'vertical="center"')}
{xf(164, 0, 2, 1, 'vertical="center"')}
{xf(3, 0, 2, 1, 'vertical="center"')}
{xf(166, 0, 2, 1, 'vertical="center" horizontal="right"')}
{xf(0, 0, 2, 1, WRAP)}
{xf(3, 0, 3, 1, 'vertical="center"')}
{xf(164, 0, 3, 1, 'vertical="center"')}
{xf(165, 0, 3, 1, 'vertical="center"')}
{xf(0, 3, 0, 1, WRAP)}
{xf(0, 1, 5, 1, 'vertical="center"')}
{xf(3, 1, 3, 1, 'vertical="center"')}
{xf(165, 0, 2, 1, 'vertical="center"')}
{xf(0, 1, 0, 1, WRAP)}
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>'''

workbook = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews>
<sheets><sheet name="추계서" sheetId="1" r:id="rId1"/><sheet name="작성 안내" sheetId="2" r:id="rId2"/></sheets>
<calcPr calcId="191029" fullCalcOnLoad="1"/>
</workbook>'''

wb_rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>'''

root_rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>'''

content_types = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>'''

if os.path.exists(OUT):
    os.remove(OUT)
with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', content_types)
    z.writestr('_rels/.rels', root_rels)
    z.writestr('xl/workbook.xml', workbook)
    z.writestr('xl/_rels/workbook.xml.rels', wb_rels)
    z.writestr('xl/styles.xml', styles)
    z.writestr('xl/worksheets/sheet1.xml', sheet1)
    z.writestr('xl/worksheets/sheet2.xml', sheet2)
print('written', os.path.getsize(OUT), 'rows', last)


print('ADDR', json.dumps(addr))
