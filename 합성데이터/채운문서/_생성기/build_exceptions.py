# 예외 상황 합성 서류 생성기 — 정상 안건(채운문서 T01~T30)의 계약서·추계서를 바탕으로
#   C: 조건 변경(계약금액 변경) — 금액만 바뀐 계약서·추계서. 바뀐 계약금액만 다시 입력하면 공헌이익 등 계산이 그에 맞게 바뀐다
#   M: 값 누락 — 계약서나 추계서의 일부 칸이 비어 있는 서류
# 실행: python build_exceptions.py   → 합성데이터/예외문서/
import io, os, shutil, sys
from fractions import Fraction as Fr

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_docs as B  # noqa: E402
from build_docs import won, ymd, derive, to_docx, build_xlsx, inf_contract_md, cmp_contract_md, xround  # noqa: E402
from scenarios import SC, WRITERS  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.dirname(HERE)), '예외문서')
RAW = {s['tid']: s for s in SC}
BLANK = '[          ]'
CASES = []


def base(tid):
    return derive(dict(RAW[tid]))


def with_amount(s0, new):
    """계약금액만 바꾼 시나리오 — 캠페인은 새 요청금액, 전속계약은 새 연 고정 피. 예상 GMV·원가·수수료·반품 등 다른 입력은 그대로 두고, 금액에 딸린 계산(공헌이익·ROAS)만 다시 한다."""
    s = dict(s0)
    if s['kind'] == 'campaign':
        R, gmv = new, s['gmv']
        if s['fee_type'] == '혼합 피' and s.get('rate'):
            perf = xround(Fr(gmv) * Fr(str(s['rate'])) / 100); fixed = R - perf
        else:
            perf, fixed = 0, R
        cp = s['net'] - s['cogs_amt'] - s['fee_amt'] - s['ship_amt'] - s['retlog'] - R
        s.update(R=R, fixed=fixed, perf=perf, mk_inf=R, mk=R, cp=cp, real=cp / R, nominal=gmv / R, cp2=cp, real2=cp / R)
    else:
        fixed, perf = new, s['perf'] or 0
        cp2 = s['cp'] - fixed - perf
        s.update(R=fixed + perf, fixed=fixed, cp2=cp2, real2=cp2 / (s['mk'] + fixed + perf))
    return s


def pct(a, b):
    p = (b - a) / a * 100
    return f"{'+' if p > 0 else '−' if p < 0 else ''}{abs(p):.1f}%"


def sgn(n):
    return ('−' if n < 0 else '') + won(abs(n))


def row_set(md, label, fn):
    """표의 한 줄(`| 항목 | 값 |`)에서 값만 바꾼다"""
    hit, out = False, []
    for ln in md.split('\n'):
        if ln.startswith(label + ' | ') and ln.endswith(' |'):
            ln = f"{label} | {fn(ln[len(label) + 3:-2])} |"; hit = True
        out.append(ln)
    assert hit, label
    return '\n'.join(out)


def contract_md(s):
    return (inf_contract_md(s) if s['kind'] == 'influencer' else cmp_contract_md(s))[0]


def cname(s):
    return '03_표준계약서_인플루언서_전속계약' if s['kind'] == 'influencer' else '03_표준계약서_캠페인_계약'


def out_dir(folder):
    p = os.path.join(ROOT, folder); os.makedirs(p, exist_ok=True); return p


def xlsx(folder, name, s, **kw):
    docno = f"EST-2026-{s['doc'].month:02d}{s['doc'].day:02d}-{s['no']:03d}"
    try:
        build_xlsx(s, docno, os.path.join(out_dir(folder), name), **kw)
    except RuntimeError as e:
        if 'PermissionError' not in str(e): raise
        print('  ⚠', folder, name, '다른 프로그램에서 열려 있어 만들지 못했어요')


def copy_rest(folder, s, skip):
    """문제가 없는 서류는 정상 안건 폴더의 원본 파일을 그대로 복사한다 (skip: 바뀐 서류의 번호 접두어 — 그 서류는 바뀐 파일로 대신한다)"""
    src = os.path.join(os.path.dirname(HERE), s['folder'])
    for n in sorted(os.listdir(src)):
        if not n.startswith(skip):
            shutil.copy2(os.path.join(src, n), os.path.join(out_dir(folder), n))


def target(s):
    return f"{s['cname']} ({s['deal']})" if s['kind'] == 'campaign' else f"{s['iname']} 전속계약 {s['renew']}"


# ═══════════ C: 조건 변경 (계약금액 변경) ═══════════
def change(x, tid, new, note):
    s0 = base(tid); s1 = with_amount(s0, new)
    folder = f"{x}_금액변경_{s0['folder'].split('_', 1)[1]}_{tid}"
    d = out_dir(folder)
    to_docx(contract_md(s1), os.path.join(d, cname(s0) + '_금액변경.docx'), f"{x} 금액변경 계약서")
    xlsx(folder, '02_비용편익추계서_금액변경.xlsx', s1)
    copy_rest(folder, s0, ('02_', '03_'))  # 바뀐 것은 추계서·계약서뿐 — 기안서·기존 계약서는 원본 그대로
    if s0['kind'] == 'campaign':
        a = f"요청금액(= 계약서 건별 계약금액) {won(s0['R'])}원 → {won(new)}원 ({pct(s0['R'], new)})"
        b = f"공헌이익 {sgn(s0['cp'])}원 → {sgn(s1['cp'])}원"
    else:
        a = f"연 고정 피 {won(s0['fixed'])}원 → {won(new)}원 → 연 계약금액 합계 {won(s0['R'])}원 → {won(s1['R'])}원 ({pct(s0['R'], s1['R'])})"
        b = f"5번 구역(고정 피·성과 피 반영) {sgn(s0['cp2'])}원 → {sgn(s1['cp2'])}원 (공식 공헌이익은 그대로)"
    CASES.append(('C', x, folder, tid, target(s0), a, b, note))


def change_cases():
    change('C01', 'T03', 12_000_000, '변동 5% 이내 → 수정 보고는 최초 승인권자(Masil 대표)에게 바로. 1천만 원 초과 상태 그대로.')
    change('C02', 'T11', 36_000_000, '변동 5% 초과 → 재무팀 절차부터 다시. 기안 묶음 총액도 1.35억 → 1.26억 원(여전히 1억 초과).')
    change('C03', 'T26', 9_800_000, '확대 안건. 금액이 1천만 원 아래로 내려가도(승인권한 기준을 넘나듦) 승인권자는 최초 결정자 그대로.')
    change('C04', 'T06', 10_400_000, '정확히 1천만 원(전결)이던 금액이 +4%로 1천만 원을 넘음 — 기준을 넘나들어도 승인권자는 유지.')
    change('C05', 'T16', 700_000_000, '전속계약 갱신. 연 고정 피 인하 → 연 계약금액 합계가 줄고 5번 구역 값이 바뀜.')
    change('C06', 'T17', 950_000_000, '전속계약 갱신. 연 계약금액 합계 10억 → 10.5억 원(정확히 +5.0% = 5% 이내 경계, 10억 초과 기준은 넘나듦).')


# ═══════════ M: 값 누락 ═══════════
def missing_contract(x, tid, what, edit_fn, note):
    s = base(tid); folder = f"{x}_값누락_계약서_{s['folder'].split('_', 1)[1]}_{tid}"
    to_docx(edit_fn(contract_md(s), s), os.path.join(out_dir(folder), cname(s) + '_누락.docx'), f"{x} 누락 계약서")
    copy_rest(folder, s, ('03_',))  # 문제 있는 것은 계약서뿐 — 나머지는 원본 그대로
    CASES.append(('M', x, folder, tid, target(s), '계약서', what, note))


def missing_xlsx(x, tid, what, drop, note):
    s = base(tid); folder = f"{x}_값누락_추계서_{s['folder'].split('_', 1)[1]}_{tid}"
    xlsx(folder, '02_비용편익추계서_누락.xlsx', s, drop=drop, extra_notes={k: '미기재 — 담당 확인 전' for k in drop})
    copy_rest(folder, s, ('02_',))  # 문제 있는 것은 추계서뿐 — 나머지는 원본 그대로
    CASES.append(('M', x, folder, tid, target(s), '추계서', what, note))


def missing_cases():
    def m01(md, s):  # 캠페인 계약서: 건별 계약금액 · 지급 예정일 · 계약 체결 기한 비움
        md = row_set(md, '| **건별 계약금액** **필수**', lambda v: f"{BLANK}원 (고정 피 {BLANK}원 + 이 건 예상 성과 피 {BLANK}원)")
        md = row_set(md, '| 지급 예정일 **필수**', lambda v: BLANK)
        return row_set(md, '| **계약 체결 기한 (계약 확정기한)** **필수**', lambda v: BLANK + ' —' + v.split('—', 1)[1])
    missing_contract('M01', 'T07', '건별 계약금액 · 지급 예정일 · 계약 체결 기한(계약 확정기한)이 비어 있음', m01,
                     '요청금액·날짜가 비면 승인권자를 정할 수 없어요 → 확인 요청 / 보완 요청, AI 빈칸 채우기는 값을 지어내지 말고 비워 둬야 해요.')
    missing_xlsx('M02', 'T08', '주문당 제품 원가 · 채널 수수료율 칸이 비어 있음', ('cogsunit', 'feerate'),
                 '원가·수수료를 모르면 공헌이익을 계산할 수 없어요(계산 칸이 비어 보임) → 비용 자료 확인 요청.')
    missing_xlsx('M03', 'T09', '예상 주문 수 · 평균 주문금액 칸이 비어 있음 (예상 GMV 계산 불가)', ('orders', 'aov'),
                 'GMV가 없으면 순매출·공헌이익·ROAS를 모두 못 구해요 → 추계서 보완 요청.')
    missing_xlsx('M04', 'T13', '반품률 · 반품 건수 · 반품 건당 물류비 칸이 비어 있음', ('retrate', 'retcount', 'retunit'),
                 '환불·반품 물류비가 빠지면 공헌이익이 부풀려져요 → 최근 실적 반품률로 보완하거나 확인 요청.')

    def m05(md, s):  # 전속계약서: 연 고정 피 · 지급 일정 · 성과 피 비율 · 연 계약금액 합계 비움
        md = row_set(md, '| 고정 피 (연) · 지급 일정', lambda v: f"{BLANK}원 · 지급 예정일 {BLANK} · [ ] 선급 [ ] 후급")
        md = row_set(md, '| · 비율 · 상한 · 하한', lambda v: f"귀속 GMV의 {BLANK}% · 연 상한 {BLANK}원 · 연 하한(보장) {BLANK}원")
        md = row_set(md, '| · 연 예상 성과 피', lambda v: f"{BLANK}원")
        return row_set(md, '| **연 계약금액 합계** **필수**', lambda v: f"{BLANK}원 (= 고정 피 + 연 예상 성과 피)")
    missing_contract('M05', 'T20', '연 고정 피 · 고정 피 지급일 · 성과 피 비율 · 연 계약금액 합계가 비어 있음', m05,
                     '10억 초과 판단·하회 구간 판단에 필요한 값이 모두 빠져요 → 승인권자 미확정, 확인 요청.')
    missing_xlsx('M06', 'T21', '연 예상 귀속 GMV · 성과 피 비율 칸(5번 구역)이 비어 있음', ('attr', 'prate'),
                 '연 예상 성과 피를 못 구해 요청금액(고정 피 + 성과 피) 합계가 확정되지 않아요 → 성과 조건 확인 요청.')

    def m07(md, s):  # 확대 계약서: 확대 대상 기존 계약번호 · 집행 기간 · 건별 계약금액 비움
        md = row_set(md, '| 계약 구분 **필수**', lambda v: f"[ ] 신규 체결  [x] 확대 (확대 대상 기존 계약번호: {BLANK})")
        md = row_set(md, '| 집행 기간 **필수**', lambda v: f"{BLANK} ~ {BLANK}")
        return row_set(md, '| **건별 계약금액** **필수**', lambda v: f"{BLANK}원 (고정 피 {BLANK}원 + 이 건 예상 성과 피 {BLANK}원)")
    missing_contract('M07', 'T25', '확대 대상 기존 계약번호 · 집행 기간 · 건별 계약금액이 비어 있음', m07,
                     '확대는 어느 기존 계약의 추가인지·얼마인지가 핵심이라 접수 체크리스트(기존 계약서 조건 확인)에서 걸러야 해요.')


def readme():
    L = ['# 예외 상황 합성 서류', '',
         '정상 안건(`합성데이터/채운문서` T01~T30)의 **계약서·추계서**를 바탕으로 만든 예외 서류예요. 폴더 이름 끝의 `T##`가 바탕 안건이에요. **각 폴더에 그 안건의 서류가 한 벌 다 들어 있어요** — 문제가 있는(바뀐) 서류는 `_금액변경`·`_누락`이 붙은 파일이고, 나머지 문제없는 서류는 `채운문서`의 원본 파일 그대로예요 (바뀐 서류의 원본은 빼고 바뀐 파일로 대신했어요).',
         '값은 모두 가상이고 원본 데이터는 건드리지 않았어요.', '',
         '## C. 조건 변경 — 계약금액이 바뀐 계약서·추계서', '',
         '계약금액만 바뀌고 나머지는 모두 원래 서류와 같아요. 안건에서 **바뀐 계약금액만 다시 입력하면** 공헌이익·ROAS 등 계산식이 그에 맞게 바뀌어요 (예상 GMV·원가·수수료·반품 같은 다른 입력은 그대로).',
         '수정 보고에서는 이 계약서·추계서를 **추가 첨부**로 올려요. 승인 뒤 최종 종결 전이라 승인권자는 최초 결정한 사람이 그대로예요.', '',
         '| 폴더 | 바탕 안건 | 대상 | 금액 변경 | 계산 결과 | 확인할 점 |', '|---|---|---|---|---|---|']
    for k, x, f, t, tg, a, b, n in [c for c in CASES if c[0] == 'C']:
        L.append(f'| [{x}]({f}) | {t} | {tg} | {a} | {b} | {n} |')
    L += ['', '바뀐 서류는 `03_표준계약서_…_금액변경.docx`(금액만 바뀐 계약서)와 `02_비용편익추계서_금액변경.xlsx`(바뀐 금액이 반영된 추계서)예요. 기안서(`01_`)와 기존 계약서(`04_`)는 원본 그대로 들어 있어요.', '',
          '## M. 값 누락 — 계약서나 추계서의 칸이 비어 있음', '',
          '서류 안의 일부 칸이 `[          ]`(계약서·docx)이거나 입력 칸이 비어 있어요(추계서·xlsx, 계산 결과도 비어 보여요). 정보 부족 상황을 시험해요 — 값을 지어내지 않고 비워 두거나, 확인 요청·보완 요청으로 이어져야 해요.', '',
          '| 폴더 | 바탕 안건 | 대상 | 서류 | 비어 있는 값 | 기대하는 처리 |', '|---|---|---|---|---|---|']
    for k, x, f, t, tg, a, b, n in [c for c in CASES if c[0] == 'M']:
        L.append(f'| [{x}]({f}) | {t} | {tg} | {a} | {b} | {n} |')
    L += ['', '## 이미 `채운문서`에 있는 예외 (참고)', '',
          '- 값 누락: T09(지급 예정일 미확인) · T12(성과 피 비율·긴급배송·CS 미확인) · T15(성과 피 비율·지급일·300억 미확인)',
          '- 서류 불일치: T14(요청금액 ↔ 추계서) · 낙관 추정: T04 · 기한 경과 사후 상신: T13', '',
          '## 다시 만들려면', '', '```bash', 'python 합성데이터/채운문서/_생성기/build_exceptions.py', '```']
    io.open(os.path.join(ROOT, 'README.md'), 'w', encoding='utf-8').write('\n'.join(L) + '\n')


if __name__ == '__main__':
    if os.path.isdir(ROOT): shutil.rmtree(ROOT)  # 이 스크립트가 만든 폴더만 다시 만든다
    os.makedirs(ROOT)
    change_cases(); missing_cases(); readme()
    print(len(CASES), '건 완료')
