# 마크다운(제목·표·문단·목록) → 워드(docx) 변환 — 패키지 없이 docx(zip 안의 XML)를 직접 만든다.
# 빈 양식·채운 서류가 같은 변환을 쓴다. 체크박스는 ☑ / ☐, "필수"는 빨간 굵은 글씨, 맨 위 [합성(가상) 데이터] 표시는 오른쪽 맞춤이다.
import io, re, zipfile
from xml.sax.saxutils import escape

FONT = '맑은 고딕'
W_PAGE, H_PAGE = 11906, 16838  # A4 (twips)


def _runs(text, size, base_bold=False):
    """인라인 표시(**굵게**, **필수**, [x], [ ])를 워드의 글자 조각(run)으로 바꾼다"""
    text = text.replace('[x]', '☑').replace('[ ]', '☐')
    out = []
    pos = 0
    for m in re.finditer(r'\*\*(.+?)\*\*', text):
        if m.start() > pos:
            out.append((text[pos:m.start()], base_bold, None))
        inner = m.group(1)
        out.append((inner, True, 'C00000' if inner == '필수' else None))
        pos = m.end()
    if pos < len(text):
        out.append((text[pos:], base_bold, None))
    xml = []
    for t, b, color in out:
        rpr = f'<w:rFonts w:ascii="{FONT}" w:hAnsi="{FONT}" w:eastAsia="{FONT}"/>' + ('<w:b/>' if b else '') + (f'<w:color w:val="{color}"/>' if color else '') + f'<w:sz w:val="{size}"/><w:szCs w:val="{size}"/>'
        xml.append(f'<w:r><w:rPr>{rpr}</w:rPr><w:t xml:space="preserve">{escape(t)}</w:t></w:r>')
    return ''.join(xml)


def _p(text, size, bold=False, align=None, before=40, after=40, style=None, shade=None, color=None, keep_next=False):
    ppr = (f'<w:pStyle w:val="{style}"/>' if style else '') + ('<w:keepNext/>' if keep_next else '') + f'<w:spacing w:before="{before}" w:after="{after}"/>' + (f'<w:jc w:val="{align}"/>' if align else '')
    if shade:
        ppr += f'<w:shd w:val="clear" w:color="auto" w:fill="{shade}"/>'
    runs = _runs(text, size, bold)
    if color:
        runs = runs.replace('<w:sz ', f'<w:color w:val="{color}"/><w:sz ', 1) if '<w:color' not in runs else runs
    return f'<w:p><w:pPr>{ppr}</w:pPr>{runs}</w:p>'


def _cell(text, width, size, header=False, first=False):
    shade = 'DCE6F2' if header else ('F5F5F5' if first else None)
    tcpr = f'<w:tcW w:w="{width}" w:type="dxa"/>' + (f'<w:shd w:val="clear" w:color="auto" w:fill="{shade}"/>' if shade else '')
    paras = ''.join(_p(t, size, bold=(header or first), before=10, after=10) for t in (text.split('<br>') if text else ['']))
    return f'<w:tc><w:tcPr>{tcpr}</w:tcPr>{paras}</w:tc>'


def _table(head, rows, size, usable):
    n = len(head)
    if n == 2:
        ws = [round(usable * 0.27), usable - round(usable * 0.27)]
    elif n == 3:
        a = round(usable * 0.30); b = round(usable * 0.47); ws = [a, b, usable - a - b]
    else:
        first = round(usable * 0.16)
        rest = (usable - first) // (n - 1)
        ws = [first] + [rest] * (n - 1)
        ws[-1] += usable - sum(ws)
    border = ''.join(f'<w:{s} w:val="single" w:sz="4" w:space="0" w:color="666666"/>' for s in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'))
    xml = [f'<w:tbl><w:tblPr><w:tblW w:w="{usable}" w:type="dxa"/><w:tblBorders>{border}</w:tblBorders><w:tblLayout w:type="fixed"/>'
           '<w:tblCellMar><w:top w:w="20" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="20" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>']
    xml.append('<w:tblGrid>' + ''.join(f'<w:gridCol w:w="{w}"/>' for w in ws) + '</w:tblGrid>')
    xml.append('<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>' + ''.join(_cell(h, w, size, header=True) for h, w in zip(head, ws)) + '</w:tr>')
    for r in rows:
        r = (r + [''] * n)[:n]
        xml.append('<w:tr><w:trPr><w:cantSplit/></w:trPr>' + ''.join(_cell(c, w, size, first=(i == 0)) for i, (c, w) in enumerate(zip(r, ws))) + '</w:tr>')
    xml.append('</w:tbl>')
    return ''.join(xml)


def md_to_body(md, size, margins):
    usable = W_PAGE - margins * 2
    lines = md.split('\n')
    out, i = [], 0
    while i < len(lines):
        ln = lines[i]
        if not ln.strip():
            i += 1; continue
        stamp = re.search(r'<span class="stamp">(.*?)</span>', ln)
        if stamp:
            ln = re.sub(r'\s*<span class="stamp">.*?</span>', '', ln)
        m = re.match(r'^(#{1,3}) (.*)$', ln)
        if m:
            lvl = len(m.group(1))
            if stamp:
                out.append(_p(f'[{stamp.group(1)}]', size - 2, bold=True, align='right', before=0, after=0, color='C00000'))
            out.append(_p(m.group(2), size + 14 if lvl == 1 else size + 3, bold=True, style=f'Heading{lvl}', before=60 if lvl == 1 else 120, after=40, keep_next=True))
            i += 1; continue
        if ln.startswith('>'):
            buf = []
            while i < len(lines) and lines[i].startswith('>'):
                buf.append(lines[i].lstrip('> ').strip()); i += 1
            for b in buf:
                out.append(_p(b, size - 1, before=20, after=20, shade='F2F2F2'))
            continue
        if ln.startswith('|') and i + 1 < len(lines) and re.match(r'^\|[\s\-:|]+\|\s*$', lines[i + 1]):
            head = [c.strip() for c in ln.strip().strip('|').split('|')]
            i += 2
            rows = []
            while i < len(lines) and lines[i].startswith('|'):
                rows.append([c.strip() for c in lines[i].strip().strip('|').split('|')]); i += 1
            out.append(_table(head, rows, size, usable))
            out.append(_p('', 6, before=0, after=0))
            continue
        out.append(_p(re.sub(r'^- ', '• ', ln), size, before=30, after=30))
        i += 1
    return ''.join(out)


def build_docx(md, path, title, compact=False):
    size = 16 if compact else 18  # 반 포인트 단위 (8pt / 9pt)
    margins = 567 if compact else 680
    vmargin = 454 if compact else 680
    body = md_to_body(md, size, margins)
    sect = f'<w:sectPr><w:pgSz w:w="{W_PAGE}" w:h="{H_PAGE}"/><w:pgMar w:top="{vmargin}" w:right="{margins}" w:bottom="{vmargin}" w:left="{margins}" w:header="283" w:footer="283" w:gutter="0"/></w:sectPr>'
    document = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + sect + '</w:body></w:document>')
    fonts = f'<w:rFonts w:ascii="{FONT}" w:hAnsi="{FONT}" w:eastAsia="{FONT}" w:cs="{FONT}"/>'
    styles = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
              '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
              f'<w:docDefaults><w:rPrDefault><w:rPr>{fonts}<w:sz w:val="{size}"/><w:szCs w:val="{size}"/><w:lang w:val="ko-KR" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault>'
              '<w:pPrDefault><w:pPr><w:spacing w:after="40" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
              '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
              '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="12" w:space="2" w:color="111111"/></w:pBdr><w:outlineLvl w:val="0"/></w:pPr></w:style>'
              '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:shd w:val="clear" w:color="auto" w:fill="E3EAF4"/><w:outlineLvl w:val="1"/></w:pPr></w:style>'
              '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:outlineLvl w:val="2"/></w:pPr></w:style>'
              '</w:styles>')
    content_types = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                     '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                     '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
                     '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                     '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
                     '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>')
    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>')
    doc_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
    core = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">'
            f'<dc:title>{escape(title)}</dc:title><dc:creator>합성 데이터</dc:creator></cp:coreProperties>')
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', content_types)
        z.writestr('_rels/.rels', rels)
        z.writestr('word/document.xml', document)
        z.writestr('word/styles.xml', styles)
        z.writestr('word/_rels/document.xml.rels', doc_rels)
        z.writestr('docProps/core.xml', core)
