# 합성 안건 서류 생성기 — 빈 양식(합성데이터/빈양식)과 같은 구성으로 값을 채운 기안서(docx)·표준계약서(docx)·비용편익추계서(xlsx)를 만든다.
# 실행: python build_docs.py        (원본 데이터는 읽지 않고, scenarios.py 의 값만 쓴다)
import csv, html, io, json, math, os, re, shutil, subprocess, sys
from datetime import date, timedelta
from fractions import Fraction

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from scenarios import AD_RATIO, AS_OF, BREACH_FROM, BREACH_TO, INF, LEAD, PREV, SC, WRITERS  # noqa: E402
from docx_writer import build_docx  # noqa: E402

OUT = os.path.dirname(HERE)  # 합성데이터/채운문서
TMP = os.path.join(os.environ.get('TEMP', HERE), 'chaeun_html')
EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
os.makedirs(TMP, exist_ok=True)

won = lambda n: f'{int(round(n)):,}'
ymd = lambda x: x.isoformat() if x else '미확인'
def xround(x):  # 엑셀 ROUND 와 같은 반올림(0.5 는 올림)
    return int(math.floor(Fraction(x) + Fraction(1, 2)))
def cb(c): return '[x]' if c else '[ ]'
def serial(x): return (x - date(1899, 12, 30)).days


# ───────── 계산 (비용편익추계서 양식의 산식과 같다)
def derive(s):
    s = dict(s)
    inf = INF[s['infl']]
    s['inf'] = inf
    s['iname'] = inf['name']
    Fr = lambda v: Fraction(str(v))
    if s['kind'] == 'campaign':
        if s.get('R') is None:  # 성과 피 계약: 요청금액 = 귀속 GMV × 비율
            orders = s['orders_fixed']
            gmv = orders * s['aov']
            R = xround(Fr(gmv) * Fr(s['rate']) / 100)
        else:
            R = s['R']
            orders = max(10, round(R * s['k'] / s['aov'] / 10) * 10)
            gmv = orders * s['aov']
        ft = s['fee_type']
        if ft == '혼합 피':
            if s.get('rate'):
                perf = xround(Fr(gmv) * Fr(s['rate']) / 100)
                fixed = R - perf
            else:
                perf, fixed = None, R
        elif ft == '성과 피':
            perf, fixed = R, 0
        else:
            perf, fixed = 0, R
        s.update(R=R, orders=orders, gmv=gmv, fixed=fixed, perf=perf)
        mk_inf = s.get('mismatch') or R
    else:
        orders = round(s['gmv'] / s['aov'] / 10) * 10
        gmv = orders * s['aov']
        rate = s['rate'] if s.get('rate') else s.get('perf_assumed')
        perf = xround(Fr(s['attr']) * Fr(rate) / 100) if (s['fee_type'] != '고정 피' and rate) else 0
        R = s['fixed'] + perf
        s.update(R=R, orders=orders, gmv=gmv, perf=perf)
        mk_inf = R
    refund = xround(Fr(gmv) * Fr(str(s['retrate'])))
    net = gmv - refund
    # 원본 정의: 제품 원가 = 주문당 단가 × 수량, 채널 수수료 = GMV × 수수료율 (환불돼도 둘 다 회수하지 않는다)
    cogsunit = int(round(s['aov'] * s['cogs'] / 100) * 100)
    cogs = cogsunit * orders
    fee = xround(Fr(gmv) * Fr(str(s['fee'])))
    ship = s['ship'] * orders
    retcount = round(orders * s['retrate'] * 1.1)
    retlog = s['retunit'] * retcount
    mk_perf = 0
    if s['kind'] == 'influencer':
        # 전속계약: 공헌이익에는 건별 마케팅 지출만 넣는다 (연 고정 피·성과 피는 5번 구역에서 따로 반영). 금액은 원본 성과 집계의 광고비÷GMV 비율로 가정
        total = int(round(gmv * AD_RATIO[s['infl']] / 10000.0)) * 10000
        mk_inf = int(round(total * 0.4 / 10000.0)) * 10000
        mk_perf = total - mk_inf
    mk = mk_inf + mk_perf
    cp = net - cogs - fee - ship - retlog - mk
    fixed_fee = s['fixed'] if s['kind'] == 'influencer' else 0
    perf_fee = (s['perf'] or 0) if s['kind'] == 'influencer' else 0
    cp2 = cp - fixed_fee - perf_fee
    s.update(refund=refund, net=net, cogsunit=cogsunit, cogs_amt=cogs, fee_amt=fee, ship_amt=ship, retcount=retcount, retlog=retlog, mk=mk, mk_inf=mk_inf, mk_perf=mk_perf, cp=cp,
             cp2=cp2, real2=cp2 / (mk + fixed_fee + perf_fee) if (mk + fixed_fee + perf_fee) else None,
             real=cp / mk, nominal=gmv / mk, aov_=s['aov'])
    # 날짜 파생
    pay = s.get('pay')
    s['breach'] = '미확인' if pay is None else ('예' if BREACH_FROM <= pay <= BREACH_TO else '아니오')
    s['approver'], s['approver_why'] = approver(s)
    s['no'] = int(s['tid'][1:])
    s['writer_name'] = WRITERS[s['writer']]
    s['folder'] = f"{s['tid']}_{(s['deal'] if s['kind'] == 'campaign' else '전속')}_{s['iname'].replace(' ', '')}_{s.get('cname', s['ref']).split()[-1] if s['kind'] == 'campaign' else s['renew']}"
    return s


def approver(s):
    """작성자 판단 승인권자 (approval_authority_policy 기준) — (구분, 이유)"""
    why = []
    top = None
    if s['breach'] == '예':
        top = 'CEO/이사회'; why.append('지급 예정일이 현금 하회 예상 구간(7/21~8/21) 안 → 금액 불문')
    if s['g300'] == '대상':
        top = 'CEO/이사회'; why.append('그룹 300억 배분 대상')
    if s['kind'] == 'influencer':
        if s['R'] > 1_000_000_000:
            top = 'CEO/이사회'; why.append('연 계약금액 10억 초과')
        if top: return top, ' · '.join(why)
        return 'Masil 대표', '연 10억 이하 전속계약'
    if top: return top, ' · '.join(why)
    big = s['R'] > 10_000_000
    total = s['bundle'][1] > 100_000_000 if s.get('bundle') else False
    if big or total:
        why = (['건당 1천만 원 초과'] if big else []) + (['기안 총액 1억 초과'] if total else [])
        return 'Masil 대표 (+ 그룹 보고)', ' · '.join(why)
    if s['breach'] == '미확인':
        return '마케팅팀 전결 (잠정)', '1천만 원 이하이나 지급 예정일 미확인 — 확인 후 확정'
    return '마케팅팀 전결', '건당 1천만 원 이하 · 하회 구간 밖 · 300억 아님'


# ───────── 문서 조각
CO = dict(name='Masil 주식회사(가상)', bizno='000-00-00000(가상)', ceo='최민준(가상)', addr='서울특별시 성동구 가상로 100 (가상)', tel='02-0000-0000(가상)')

def contents_of(inf, kind_year=True):
    p = inf['platform']
    if p == 'YouTube': return '롱폼 12편, 숏폼 24편, 라이브 4회'
    if p == 'TikTok': return '숏폼 60편, 라이브 6회'
    return '피드 36편, 릴스 48편, 라이브 4회'


def prev_text(s):
    pv = PREV.get(s['infl'])
    if not pv:
        return '기존 실적 없음 (신규 인플루언서) — 외부 채널 성과 자료로 추정'
    parts = [f"{c} {('+' if v >= 0 else '−')}{won(abs(v))}원" for c, v in pv['camps']]
    allneg = all(v < 0 for _, v in pv['camps'])
    allpos = all(v >= 0 for _, v in pv['camps'])
    tag = ' (전부 손실)' if allneg else ' (전부 흑자)' if allpos else ''
    extra = ' · 확대 기안 PLAN-001~003 심사 진행 중' if s['infl'] == 'INF-001' else ''
    return ' · '.join(parts) + tag + extra + ' · 부결 이력 없음'


def terms_text(s):
    f = s['fee_type']
    if s['kind'] == 'influencer':
        if f == '고정 피':
            return f"고정 피 연 {won(s['fixed'])}원 · 성과 피 없음 · 위약금 잔여 고정 피의 {s['penalty']}% · 통보 기한 {ymd(s['deadline'])}"
        if f == '성과 피':
            return f"고정 피 없음 · 성과 피 귀속 GMV의 {s['rate']:g}% (연 예상 {won(s['perf'])}원) · 위약금 없음 · 통보 기한 {ymd(s['deadline'])}"
        rt = f"귀속 GMV의 {s['rate']:g}%" if s.get('rate') else '비율 미확인'
        return f"고정 피 연 {won(s['fixed'])}원 + 성과 피 {rt} (연 예상 {won(s['perf'])}원) · 위약금 잔여 고정 피의 {s['penalty']}% · 통보 기한 {ymd(s['deadline'])}"
    fee_kind = {'INF-001': '고정+성과', 'INF-002': '성과', 'INF-003': '고정', 'INF-004': '혼합', 'INF-005': '고정+성과', 'INF-006': '성과', 'INF-007': '고정', 'INF-008': '성과', 'INF-009': '성과', 'INF-010': '혼합'}[s['infl']]
    return f"{s['iname']} 전속 보수 구조: {fee_kind} (마스터 기준) · 이 건은 건별 계약 — 기존 전속계약서 참조"


def fee_line(s):
    f = s['fee_type']
    if f == '고정 피':
        return f"[x] 고정 피 [ ] 성과 피 [ ] 혼합 피 (고정 피 {won(s['fixed'])}원)"
    if f == '성과 피':
        return f"[ ] 고정 피 [x] 성과 피 [ ] 혼합 피 (연 예상 성과 피 {won(s['perf'])}원 · 성과 피 비율 {s['rate']:g}% — 귀속 GMV 기준 · last-click 7일)"
    pr = f"{s['rate']:g}%" if s.get('rate') else '미확인'
    pf = f"{won(s['perf'])}원" if s.get('perf') else '미확인'
    return f"[ ] 고정 피 [ ] 성과 피 [x] 혼합 피 (고정 피 {won(s['fixed'])}원 + 연 예상 성과 피 {pf} · 성과 피 비율 {pr} — 귀속 GMV 기준 · last-click 7일)"


# ───────── 기안서 (1쪽)
def draft_md(s):
    camp = s['kind'] == 'campaign'
    docno = f"DR-2026-{s['doc'].month:02d}{s['doc'].day:02d}-{s['no']:03d}"
    title = (f"{s['cname']} {'확대 요청' if s['deal'] == '확대' else '신규 집행 요청'}") if camp else f"{s['iname']} 연간 전속계약 {s['renew']} 요청"
    bundle = f"{s['bundle'][0]} (기안 총액 {won(s['bundle'][1])}원)" if s.get('bundle') else '단독 (기안 묶음 없음)'
    period = f"{ymd(s['start'])} ~ {ymd(s['end'])}"
    expiry = ymd(s['expiry']) if s.get('expiry') else ('해당 없음 (신규)' if s['kind'] == 'influencer' else '해당 없음')
    rk = PREV.get(s['infl'])
    rank_txt = f"{rk['rank']}위/10명 · {rk['share']:.1f}%" if rk else '해당 없음(신규) · 해당 없음'
    breach = s['breach']
    g = s['g300']
    ap = s['approver']
    misses = s['missing']
    mrows = ''.join(f"| {a} | {b} | {ymd(c) if c else '-'} | {st} |\n" for a, b, c, st in misses)
    missing_note = '없음' if misses[0][0] == '없음' else ''
    est_note = '비용편익추계서 · 추정'
    cp_s = f"{'−' if s['cp'] < 0 else ''}{won(abs(s['cp']))}원 · {s['real']:.2f}배"
    if not camp:
        cp_s += f" (고정 피·성과 피 반영 시 {'−' if s['cp2'] < 0 else ''}{won(abs(s['cp2']))}원)"
    attach_mark = '[x]'
    # 기존 계약서: 갱신(전속계약)·확대(캠페인)만 있다. 신규는 맺은 계약이 없어 첨부하지 않는다.
    has_old = (camp and s['deal'] == '확대') or (not camp and s['renew'] == '갱신')
    contract_att = '[x]' if has_old else '[ ]'
    if camp:
        deal_row = f"{cb(s['deal'] == '신규')} 신규 (새 캠페인 ID)  {cb(s['deal'] == '확대')} 확대 (이미 있는 캠페인의 추가 집행)"
    else:
        deal_row = f"{cb(s['renew'] == '신규')} 신규 (첫 전속계약)  {cb(s['renew'] == '갱신')} 갱신 (현 계약 있음)"
    if camp and s['deal'] == '확대':
        old_row = f"| 확대 대상 기존 캠페인 | {s['ref']} {s['cname']} · 기존 계약 {s['prev_no']} ({ymd(s['prev_start'])} ~ {ymd(s['prev_end'])}) · 기존 계약금액 {won(s['prev_amount'])}원 → 이번 확대 요청 {won(s['R'])}원 |\n"
    elif camp:
        old_row = "| 확대 대상 기존 캠페인 | 해당 없음 (새 캠페인 — 기존 계약서 없음) |\n"
    else:
        old_row = ''
    md = f"""# 기안서 (표준 양식) <span class="stamp">합성(가상) 데이터</span>

| 문서 정보 | 작성란 |
|---|---|
| 문서번호 · 작성일 **필수** | {docno} / {ymd(s['doc'])} |
| 작성자 · 부서 → 보고 대상 | {s['writer_name']} / 마케팅본부 인플루언서팀 → 마케팅 팀장 {LEAD} |
| 안건 종류 · 분류 ID **필수** | {cb(s['kind'] == 'influencer')} 인플루언서 계약(전속계약 신규·갱신)  {cb(camp)} 캠페인 집행(신규·확대) · {s['ref']} ({'소속 ' + s['infl'] if camp else s['iname']}) |
| 구분 **필수** | {deal_row} |
| 제목 · 같은 기안 묶음 | {title} · {bundle} |

## 1. 목적 · 배경 **필수**
- 목적과 왜 지금인가: {s['purpose']}
- 하지 않으면 생기는 일: {s['consequence']}

## 2. 요청 내용 **필수**
| 항목 | 작성란 |
|---|---|
| 요청금액 · 계약 방식 | **{won(s['R'])}원** · {fee_line(s)} |
| 계약·집행 기간 · 상대방 | {period} · {s['inf']['real']}({s['iname']}){' / 에이전시 ' + s['inf']['agency'] if s['inf']['agency'] else ''} |
| **계약 체결 기한** · **지급 예정일** | {ymd(s['deadline'])}{' (갱신 통보 기한)' if s['kind'] == 'influencer' and s['renew'] == '갱신' else ''} · {ymd(s.get('pay'))} |
| 현 계약 만료일 (갱신일 때) | {expiry} |
{old_row}
## 3. 판단 근거 **필수** (숫자는 비용편익추계서와 같아야 해요)
| 항목 | 값 | 근거 · 실적/추정 |
|---|---|---|
| 예상 공헌이익 · 실질 ROAS (주 판단기준) | {cp_s} | {est_note} |
| 해당 인플루언서의 기존 실질 공헌이익 순위 · 광고비 비중 | {rank_txt} | 성과 자료 · 실적 |
| 최근 1년 같은 인플루언서의 캠페인·전속계약 결과 | {prev_text(s)} | 기안 대장 · 실적 |
| 전속계약 조건 | {terms_text(s)} | 기존 계약서 |

## 4. 대안 · 제약 **필수**
| 항목 | 작성란 |
|---|---|
| 검토한 대안과 결과 | {s['alt']} |
| 지급 예정일이 현금 하회 예상 구간 안인가 | {cb(breach == '예')} 예 {cb(breach == '아니오')} 아니오 {cb(breach == '미확인')} 미확인 |
| 그룹 300억 배분 검토 대상인가 | {cb(g == '대상')} 대상 {cb(g == '대상 아님')} 대상 아님 {cb(g == '미확정')} 미확정 |
| 기한·재고·물류 등 위험 | {s['risk']} |
| 작성자 판단 승인권자 | {cb(ap.startswith('마케팅팀'))} 마케팅팀 전결 {cb(ap.startswith('Masil'))} Masil 대표 (+ 그룹 보고) {cb(ap.startswith('CEO'))} CEO/이사회 |

## 5. 부족한 정보 · 보충 계획 **필수 (없으면 "없음")**
| 부족한 정보 (왜 필요한가) | 담당 부서 | 회신 기한 | 상태 |
|---|---|---|---|
{mrows}
## 6. 첨부 · 결재
첨부: {attach_mark} 비용 및 성과 추계서(필수)  {contract_att} 기존 계약서(선택)  [ ] 협의서(메일·공문, 선택)  [ ] 기타

| | 작성 | 기안 접수(팀장) | 재무팀 | 계약 담당 | 승인권자 |
|---|---|---|---|---|---|
| 성명 · 일자 · 서명 | {s['writer_name']} · {s['doc'].strftime('%m/%d')} · 서명 | | | | |
| 의견 · 결정 | | [ ] 접수 | [ ] 300억 대상 [ ] 아님 | | [ ] 승인 [ ] 부결 [ ] 재검토 |
"""
    return md, docno


# ───────── 인플루언서 전속계약서
def inf_contract_md(s, ex=False):
    # ex=True: 이번 갱신 전에 맺어 둔 현행(기존) 계약서 — 직전 1년 기간, 계약번호는 직전 계약번호. 조건은 '동일 조건 갱신'의 기준이 되는 현 조건이다.
    inf = s['inf']; no = s['prev_no'] if ex else f"CT-INF-2026-{s['no']:03d}"
    y, m, d = inf['birth']
    f = s['fee_type']
    months = round(((s['end'] - s['start']).days + 1) / 30.4)
    a = inf['agency']
    ownbiz = {'개인': '[x] 개인(원천징수)  [ ] 개인사업자  [ ] 법인', '개인사업자': '[ ] 개인(원천징수)  [x] 개인사업자  [ ] 법인', '법인': '[ ] 개인(원천징수)  [ ] 개인사업자  [x] 법인'}[inf['biz']]
    tax = '원천징수 3.3%' if inf['biz'] == '개인' else '부가세 별도'
    fixed_row = f"{won(s['fixed'])}원 · 지급 예정일 {ymd(s.get('pay'))} · [x] 선급 [ ] 후급" if s['fixed'] else '해당 없음 (고정 피 없음) · 정산은 성과 피로만'
    if not s.get('pay') and s['fixed']:
        fixed_row = f"{won(s['fixed'])}원 · 지급 예정일 미확인 (갱신 합의 후 확정) · [ ] 선급 [x] 후급"
        if ex: fixed_row = f"{won(s['fixed'])}원 · 지급 일정 미기재 (별도 협의) · [ ] 선급 [x] 후급"
    perf_rate = f"귀속 GMV의 {s['rate']:g}%" if s.get('rate') else ('귀속 GMV의 미확인% (협의 중)' if f == '혼합 피' else '해당 없음')
    perf_est = won(s['perf']) + '원 (예상 귀속 GMV ' + won(s['attr']) + '원 × 비율' + ('' if s.get('rate') else ' — 가정값') + ')' if s['perf'] else '해당 없음'
    cap = f"{won(round(s['perf'] * 1.5))}원" if s['perf'] else '해당 없음'
    floor = f"{won(round(s['perf'] * 0.4))}원" if s['perf'] and f == '성과 피' else '없음'
    total = f"{won(s['R'])}원 (= 고정 피 {won(s['fixed'])}원 + 연 예상 성과 피 {won(s['perf'])}원)"
    if ex and f == '혼합 피' and not s.get('rate'):
        # 현행 계약서에는 성과 피 비율이 적혀 있지 않다 (별도 합의서) — 기안서 '부족한 정보'와 같은 빈칸
        perf_rate = '귀속 GMV의 비율 미기재 (별도 합의서에 따름)'; perf_est = '미기재'; cap = '미기재'
        total = f"{won(s['fixed'])}원 + 연 성과 피 (비율 미기재라 합계 확정 불가)"
    kind_row = f"| 문서 구분 | 현행(기존) 계약서 — 이번 갱신 요청 전에 맺은 계약이에요. 기간 {ymd(s['start'])} ~ {ymd(s['end'])} |\n" if ex else ''
    md = f"""# 인플루언서 전속계약서 (표준 양식) <span class="stamp">합성(가상) 데이터</span>

| 문서 정보 | 작성란 |
|---|---|
| 계약번호 · 작성일 | {no} · {ymd(s['doc'])} |
{kind_row}| 계약 구분 **필수** | {cb(s['renew'] == '신규')} 신규 체결  {cb(s['renew'] == '갱신')} 갱신 (직전 계약번호: {('' if ex else s['prev_no']) or '해당 없음'}) |

## 제1조 계약 당사자
| 구분 | 작성란 |
|---|---|
| 갑 (회사) | 상호 {CO['name']} · 사업자등록번호 {CO['bizno']} · 대표자 {CO['ceo']} · 주소 {CO['addr']} · 담당자·연락처 {s['writer_name']} / {CO['tel']} |
| 을 (인플루언서) **필수** | 관리번호 {s['infl']} · 활동명 {inf['name']} · 성명 {inf['real']} |
| 을 생년월일 **필수** | {y}년 {m}월 {d}일 (미성년자 여부 [ ] 예 [x] 아니오) |
| 을 연락처 · 주소 | 가상 연락처 010-0000-0000 / {inf['country']} 가상 주소 |
| 을 활동 채널 (플랫폼 · 계정 · 팔로워 수 · 기준일) | {inf['platform']} · @{inf['name'].replace(' ', '').lower()}_official(가상) · {inf['followers']} · {'2025-08-15' if ex else '2026-06-15'} 기준 |
| 을 사업자 구분 **필수** | {ownbiz} · 사업자등록번호 {inf['bizno'] or '해당 없음'} |
| 을 정산 계좌 (가상) | 은행 가상은행 · 예금주 {inf['real']} · 계좌번호 000-0000-000000 |
| 소속 에이전시 (선택) | {('에이전시명 ' + a + ' · 대리 권한 [x] 체결 [x] 통보 수령 [x] 정산 수령 · 수수료 부담 [ ] 갑 [x] 을') if a else '해당 없음'} |

## 제2조 계약 기간
| 항목 | 작성란 |
|---|---|
| 계약 기간 **필수** | {ymd(s['start'])} ~ {ymd(s['end'])} ({months}개월) · 현 계약 만료일(갱신일 때) {ymd(s['expiry']) if s.get('expiry') else '해당 없음'} |
| 자동 갱신 **필수** | {cb(s['auto_renew'])} 있음 (갱신 기간 12개월)  {cb(not s['auto_renew'])} 없음 |
| **해지·조건변경 통보 기한** **필수** | {ymd(s['deadline'])} — 이 날까지 통보하지 않으면 {cb(s['auto_renew'])} 동일 조건으로 자동 갱신(체결로 간주)  {cb(not s['auto_renew'])} 계약 종료 |
| 통보·수령 확인 방법 | [x] 서면(공문)  [x] 이메일 · 수신 확인 회신 메일 |

## 제3조 계약 방식 · 보수
| 항목 | 작성란 |
|---|---|
| 계약 방식 **필수** | {cb(f == '고정 피')} 고정 피  {cb(f == '성과 피')} 성과 피  {cb(f == '혼합 피')} 혼합 피 |
| 고정 피 (연) · 지급 일정 | {fixed_row} |
| **성과 피** (성과 피·혼합 피) | 기준: 귀속 GMV(쿠폰 반영 후·VAT 제외) — 고정 · 귀속 방식: last-click 7일 — 고정 |
| · 비율 · 상한 · 하한 | {perf_rate} · 연 상한 {cap} · 연 하한(보장) {floor} |
| · 연 예상 성과 피 | {perf_est} |
| · 환불 처리 · 정산 | [x] 환불 건 공제 [ ] 공제 없음 · 정산 [x] 월 [ ] 분기 · [x] 고정 피와 별도 [ ] 합산 |
| **연 계약금액 합계** **필수** | {total} |
| 비용 · 세금 | 제작·촬영비 [ ] 을 부담 [ ] 갑 부담 [x] 실비(상한 {won(round(s['R'] * 0.05 / 100000) * 100000 or 5_000_000)}원) · 부가세 [x] 별도 [ ] 포함 · 원천징수 {'3.3' if inf['biz'] == '개인' else '0'}% |

## 제4조 전속 조건
| 항목 | 작성란 |
|---|---|
| 전속 범위 · 지역 · 기간 | 카테고리 {s['exclusive']} · 지역 {inf['country']} · 계약 기간 중 + 종료 후 3개월 |
| 경쟁 브랜드 정의 · 예외 | 동일 카테고리의 국내외 경쟁 화장품 브랜드 · 사전 서면 승인 시 예외 |
| 위반 시 조치 | 시정 요구 14일 → 위약금 연 계약금액의 20% |

## 제5조 콘텐츠 · 활동 의무
| 항목 | 작성란 |
|---|---|
| 연간 콘텐츠 수량 · 형식 · 게시 일정 | {contents_of(inf)} · 분기별 균등 게시 |
| 검수 절차 · 광고 표시 방법 | 초안 게시 5일 전 제출 → 검수 3일 · 광고·협찬 표기 "유료 광고 포함" 문구와 해시태그 #광고 |
| 성과 목표 | 목표 귀속 GMV {won(s['attr'] or s['gmv'])}원 (성과 피 기준과 같은 GMV) |
| 미이행 시 조치 | 시정 14일 → 보수 감액 10% / 해지 |

## 제6조 지식재산 · 초상
| 항목 | 작성란 |
|---|---|
| 콘텐츠 저작권 귀속 · 2차 활용 | [ ] 을 [ ] 갑 [x] 공동 · 2차 활용 범위·기간·추가 대가 갑의 온라인 채널 12개월, 추가 대가 없음 |
| 초상·성명 사용 · 종료 후 콘텐츠 | 범위 갑의 온라인 광고·상세페이지 · [x] 유지 [ ] 삭제 요청 30일 이내 |

## 제7조 해지 · 위약금
| 항목 | 작성란 |
|---|---|
| 중도 해지 사유 · 귀책 사유 해지(시정 기간) | 계약 위반, 평판 훼손, 광고 표시 의무 위반 · 14일 |
| **갱신 후 중도 해지 위약금** | {('잔여 고정 피의 ' + str(s['penalty']) + '%') if s['fixed'] else '해당 없음 (고정 피 없음 — 위약금 없음)'} |
| 해지·종료 통지 · 손해배상 상한 | 서면(통지서)으로 하고 수령을 확인할 수 있는 방법으로 보낸다 · 상한 연 계약금액 |

## 제8조 비밀유지 · 개인정보 · 분쟁 · 변경
| 항목 | 작성란 |
|---|---|
| 비밀유지 · 개인정보 처리 | 종료 후 3년 · 수집 항목·보관 기간에 [x] 동의 (계약 이행에 필요한 항목, 계약 종료 후 5년) |
| 준거법 · 관할 · 분쟁 해결 | 대한민국 법 · 서울중앙지방법원 · 협의 → 조정 → 소송 |
| 계약 변경 · 특약 | 금액 등 변경은 서면 합의(변경 계약서)로 한다 · 특약 없음 |

## 서명 · 날인
| | 갑 | 을 | 에이전시 (있는 경우) |
|---|---|---|---|
| 상호 / 성명 · 서명(날인) · 일자 | {CO['name']} 대표 {CO['ceo']} · 서명 · {ymd(s['doc'])} | {inf['real']} · 서명 · {ymd(s['doc'])} | {a + ' · 서명' if a else '해당 없음'} |

첨부 서류: [x] 사업자등록증 또는 신분 확인 서류(가상)  [x] 통장 사본  [x] 활동 채널 성과 자료  {cb(bool(a))} 대리권 위임장(대리 체결 시)
"""
    return md, no


# ───────── 캠페인 계약서
def cmp_contract_md(s, ex=False):
    # ex=True: 확대 대상인 기존 캠페인의 현행(기존) 계약서 — 기존 기간·직전 계약번호·기존 계약금액
    inf = s['inf']; no = s['prev_no'] if ex else f"CT-CMP-2026-{s['no']:03d}"
    y, m, d = inf['birth']
    f = s['fee_type']
    a = inf['agency']
    ownbiz = {'개인': '[x] 개인 [ ] 개인사업자 [ ] 법인', '개인사업자': '[ ] 개인 [x] 개인사업자 [ ] 법인', '법인': '[ ] 개인 [ ] 개인사업자 [x] 법인'}[inf['biz']]
    perf = s['perf']
    perf_txt = f"{won(perf)}원" if perf else ('미정(비율 협의 중)' if f == '혼합 피' and not s.get('rate') else '0')
    amt_line = f"{won(s['R'])}원 (고정 피 {won(s['fixed'])}원 + 이 건 예상 성과 피 {perf_txt})"
    rate = f"{s['rate']:g}%" if s.get('rate') else ('미확인' if f == '혼합 피' else '해당 없음')
    cap = f"{won(round(perf * 1.5))}원" if perf else '해당 없음'
    floor_ = '없음'
    after_cancel = '20' if s['deadline'] >= AS_OF else '30'
    deal_new = ex or s['deal'] == '신규'
    kind_row = f"| 문서 구분 | 현행(기존) 계약서 — 이번 확대 요청 전에 맺은 계약이에요. 기간 {ymd(s['start'])} ~ {ymd(s['end'])} |\n" if ex else (f"| 문서 구분 | 확대 계약서 — 기존 캠페인 {s['ref']}({s['prev_no']})의 추가 집행. 기존 계약금액 {won(s['prev_amount'])}원은 그대로이고, 아래 금액은 이번에 추가하는 금액이에요 |\n" if s['deal'] == '확대' else '')
    md = f"""# 캠페인 계약서 (표준 양식) <span class="stamp">합성(가상) 데이터</span>

| 문서 정보 | 작성란 |
|---|---|
| 계약번호 · 작성일 | {no} · {ymd(s['doc'])} |
{kind_row}| 계약 구분 **필수** | {cb(deal_new)} 신규 체결  {cb(not deal_new)} 확대 (확대 대상 기존 계약번호: {('해당 없음' if deal_new else s['prev_no'])}) |

## 제1조 계약 당사자
| 구분 | 작성란 |
|---|---|
| 갑 (회사) | 상호 {CO['name']} · 사업자등록번호 {CO['bizno']} · 대표자 {CO['ceo']} · 담당자·연락처 {s['writer_name']} / {CO['tel']} |
| 을 (인플루언서 또는 에이전시) **필수** | 활동명 {inf['name']} · 성명 {inf['real']} · 생년월일 {y}년 {m}월 {d}일 |
| 을 사업자 구분 · 연락처 | {ownbiz} · 사업자등록번호 {inf['bizno'] or '해당 없음'} · 가상 연락처 010-0000-0000 |
| 을 정산 계좌 (가상) | 은행 가상은행 · 예금주 {inf['real']} · 계좌번호 000-0000-000000 |
| 대리인 (에이전시가 체결할 때) | {('상호 ' + a + ' · 대리 권한 [x] 체결 [x] 정산 수령 · 위임장 [x]') if a else '해당 없음'} |

## 제2조 캠페인 정보
| 항목 | 작성란 |
|---|---|
| 캠페인 관리번호 · 캠페인명 **필수** | {s['ref']} · {s['cname']} |
| 소속 인플루언서 관리번호 **필수** | {s['infl']} · 연결 전속계약 {('CT-INF-2025-' + s['infl'][-3:]) if s['infl'] in PREV else '없음'} |
| 목적 · 대상 상품 · 대상 고객 | 신제품 인지도와 구매 전환 · {s['line']} 라인 · {inf['country']} 20~30대 |
| 집행 채널 · 포맷 · 지역 | {s['fmt']} · {s['channel']} · {inf['country']} |

## 제3조 기간 · 금액
| 항목 | 작성란 |
|---|---|
| 집행 기간 **필수** | {ymd(s['start'])} ~ {ymd(s['end'])} |
| **계약 체결 기한 (계약 확정기한)** **필수** | {ymd(s['deadline'])} — 이 날이 지나면 [x] 자동 확정되어 철회할 수 없어요 [ ] 기타 |
| 지급 예정일 **필수** | {ymd(s.get('pay'))}{' (집행일 협의 중 — 확정 후 서면 통지)' if not s.get('pay') else ''} |
| 계약 방식 **필수** | {cb(f == '고정 피')} 고정 피(건별 정액)  {cb(f == '성과 피')} 성과 피  {cb(f == '혼합 피')} 혼합 피 |
| **건별 계약금액** **필수** | {amt_line} |
| **성과 피** (성과 피·혼합 피) | 기준: 귀속 GMV(쿠폰 반영 후·VAT 제외) — 고정 · 귀속 방식: last-click 7일 — 고정 · 비율 {rate} · 상한 {cap} · 하한 {floor_} · 환불 건 [x] 공제 [ ] 공제 없음 |
| 부가세 · 원천징수 | [x] 별도 [ ] 포함 · {'3.3' if inf['biz'] == '개인' else '0'}% |

## 제4조 콘텐츠 · 활동 사양
| 항목 | 작성란 |
|---|---|
| 콘텐츠 수량 · 형식 · 게시 일정 | {s['fmt']} · 집행 기간 중 균등 게시 |
| 필수 포함 사항 · 광고 표시 방법 | 상품 노출·코드·링크·해시태그 제품명 해시태그와 전용 할인코드 · 광고 표시 "유료 광고 포함" |
| 검수 절차 | 초안 5일 전 제출 → 검수 3일 |
| 성과 목표 | 목표 귀속 GMV {won(s['gmv'])}원 · 반품률 상한 {s['retrate'] * 100 + 3:.0f}% |
| 제품·샘플 제공 (선택) | [x] 갑이 제공 (수량 콘텐츠당 2세트 · 시기 게시 14일 전) |

## 제5조 변경 · 취소 · 위약금
| 항목 | 작성란 |
|---|---|
| 계약 체결 기한 전 / 후 취소 | 전: [x] 가능 (위약금 없음) [ ] 불가 · 후: 위약금 {after_cancel}% · 손해배상 실손해 (건별 계약금액 한도) |
| 계약 변경 · 불가항력 | 금액 등 변경은 서면 합의(변경 계약서) · 불가항력·플랫폼 정책 변경 시 일정 조정, 이미 게시된 콘텐츠는 정산 |

## 제6조 권리 · 비밀 · 분쟁
| 항목 | 작성란 |
|---|---|
| 저작권 · 2차 활용 · 초상 사용 | 귀속 [ ] 을 [ ] 갑 [x] 공동 · 2차 활용 범위·기간 갑의 온라인 채널 6개월 · 초상·성명 사용 범위 갑의 온라인 광고 |
| 비밀유지 · 개인정보 · 준거법·관할 | 종료 후 2년 · 계약 이행 목적 외 사용 금지 · 대한민국 법, 서울중앙지방법원 |
| 특약 사항 | {('금액 미확정 항목(성과 피 비율)은 확정 후 변경 계약서로 정한다' if f == '혼합 피' and not s.get('rate') else '없음')} |

## 서명 · 날인
| | 갑 | 을 (또는 대리인) |
|---|---|---|
| 상호 / 성명 · 서명(날인) · 일자 | {CO['name']} 대표 {CO['ceo']} · 서명 · {ymd(s['doc'])} | {inf['real']} · 서명 · {ymd(s['doc'])} |

첨부 서류: [x] 사업자등록증 또는 신분 확인 서류(가상)  [x] 통장 사본  {cb(bool(a))} 위임장(에이전시 체결 시)  [ ] 콘텐츠 제작 가이드(있는 경우)
"""
    return md, no


# ───────── md → html → pdf
CSS = """
@page { size: A4; margin: 13mm 12mm 14mm 12mm; }
* { box-sizing: border-box; }
body { font-family: 'Malgun Gothic', 'Noto Sans KR', sans-serif; font-size: 9.4pt; line-height: 1.45; color: #111; }
h1 { font-size: 16pt; margin: 0 0 6px; padding-bottom: 5px; border-bottom: 2px solid #111; }
h2 { font-size: 11pt; margin: 13px 0 5px; padding: 2px 8px; background: #e9eef6; border-left: 4px solid #2f4b7c; break-after: avoid; }
p { margin: 3px 0; }
table { width: 100%; border-collapse: collapse; margin: 5px 0 8px; table-layout: auto; }
th, td { border: 1px solid #555; padding: 3px 6px; vertical-align: top; word-break: keep-all; overflow-wrap: anywhere; font-size: 8.8pt; }
th { background: #eceff3; text-align: left; }
tr { break-inside: avoid; }
td:first-child { background: #fafafa; font-weight: 600; width: 27%; }
ul { margin: 3px 0 6px 18px; padding: 0; } li { margin: 2px 0; }
.cb { display: inline-block; width: 0.82em; height: 0.82em; border: 1px solid #333; vertical-align: -1px; margin-right: 2px; text-align: center; line-height: 0.8em; font-size: 0.8em; font-weight: 700; }
.cb.on { background: #2f4b7c; color: #fff; border-color: #2f4b7c; }
.req { color: #b00020; font-weight: 700; }
.stamp { float: right; font-size: 8pt; color: #b00020; border: 1px solid #b00020; padding: 1px 6px; margin-top: 2px; font-weight: 400; }
"""
ONEPAGE = " body{font-size:8.4pt;line-height:1.32} h1{font-size:13.5pt;margin-bottom:3px;padding-bottom:3px} h2{font-size:9.4pt;margin:6px 0 2px;padding:1px 6px} table{margin:2px 0 4px} th,td{padding:1.5px 5px;font-size:7.9pt} td:first-child{width:24%} ul{margin:1px 0 3px 16px} li{margin:1px 0} @page{margin:8mm 10mm} "


def inline(t):
    # <span class="stamp"> 는 그대로 두고 나머지는 이스케이프
    parts = re.split(r'(<span class="stamp">.*?</span>)', t)
    out = []
    for p in parts:
        if p.startswith('<span class="stamp">'):
            out.append(p); continue
        p = html.escape(p)
        p = re.sub(r'\*\*필수\*\*', '<span class="req">필수</span>', p)
        p = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', p)
        p = p.replace('[x]', '<span class="cb on">✓</span>').replace('[ ]', '<span class="cb"></span>')
        out.append(p)
    return ''.join(out)


def md_to_html(md):
    lines = md.split('\n'); out = []; i = 0
    while i < len(lines):
        ln = lines[i]
        if not ln.strip():
            i += 1; continue
        m = re.match(r'^(#{1,3}) (.*)$', ln)
        if m:
            n = len(m.group(1)); out.append(f'<h{n}>{inline(m.group(2))}</h{n}>'); i += 1; continue
        if ln.startswith('|') and i + 1 < len(lines) and re.match(r'^\|[\s\-:|]+\|\s*$', lines[i + 1]):
            head = [c.strip() for c in ln.strip().strip('|').split('|')]; i += 2; rows = []
            while i < len(lines) and lines[i].startswith('|'):
                rows.append([c.strip() for c in lines[i].strip().strip('|').split('|')]); i += 1
            hh = ''.join(f'<th>{inline(c)}</th>' for c in head)
            body = ''.join('<tr>' + ''.join(f'<td>{inline(c) if c else "&nbsp;"}</td>' for c in r) + '</tr>' for r in rows)
            out.append(f'<table><thead><tr>{hh}</tr></thead><tbody>{body}</tbody></table>'); continue
        out.append('<p>' + inline(re.sub(r'^- ', '• ', ln)) + '</p>'); i += 1
    return '\n'.join(out)


def to_docx(md, path, name, onepage=False):
    if os.path.exists(path): os.remove(path)
    build_docx(md, path, name, compact=onepage)
    return 1


# ───────── 비용편익추계서 (xlsx)
def xlsx_values(s, docno):
    camp = s['kind'] == 'campaign'
    v = dict(docno=f"EST-2026-{s['doc'].month:02d}{s['doc'].day:02d}-{s['no']:03d}", ref=s['ref'], date=serial(s['doc']), writer=s['writer_name'],
             period=f"{ymd(s['start'])} ~ {ymd(s['end'])}", scenario='기준',
             orders=s['orders'], aov=s['aov'], retrate=s['retrate'],
             cogsunit=s['cogsunit'], feerate=s['fee'], shipunit=s['ship'], retcount=s['retcount'], retunit=s['retunit'],
             mk_inf=s['mk_inf'], mk_perf=s['mk_perf'], mk_off=0)
    notes = {}
    if camp:
        notes['mk_inf'] = f"인플루언서 건별 진행비 = 계약서 건별 계약금액 ({s['fee_type']})"
    else:
        notes['mk_inf'] = '연간 건별 인플루언서 진행비 (건별 마케팅 지출의 40%)'
        notes['mk_perf'] = f"연간 퍼포먼스 광고비 (건별 마케팅 지출의 60%) — 원본 성과 집계의 광고비÷GMV 비율 {AD_RATIO[s['infl']] * 100:.1f}% 기준 가정"
        notes['orders'] = '연간 예상 주문 수 (연 예상 GMV ÷ 평균 주문금액)'
        # 5번 구역: 연 전속 고정 피·성과 피 (공헌이익에는 들어가지 않고 여기서 따로 반영)
        rate = s['rate'] if s.get('rate') else s.get('perf_assumed')
        if s['fixed']:
            v['fixed'] = s['fixed']
            notes['fixed'] = f"계약서 연 고정 피 · 요청금액 = 고정 피 {won(s['fixed'])}원 + 연 예상 성과 피 {won(s['perf'])}원 = {won(s['R'])}원"
        if s['perf']:
            v['attr'] = s['attr']; v['prate'] = rate / 100
            notes['attr'] = '연 예상 귀속 GMV (성과 피 기준 — 귀속 방식 last-click 7일 고정)'
            notes['prate'] = '성과 피 비율' + ('' if s.get('rate') else ' (협의 전 가정값)')
    if s.get('unknown_cost'):
        v['urgent'] = '미확인'; v['cs'] = '미확인'
        notes['urgent'] = '재고·물류 담당 자료 없음 — 기안서 5항에 올림'; notes['cs'] = 'CS 건당 비용 자료 없음 — 기안서 5항에 올림'
    if s.get('pay'):
        v['paydate'] = serial(s['pay'])
    else:
        v['paydate'] = '미확인'
        notes['paydate'] = '마케팅 회신 대기 (기안서 5항)'
    v['payamt'] = s['R']
    v['breach'] = s['breach']
    v['g300'] = s['g300']
    pv = PREV.get(s['infl'])
    if pv:
        v['prev_cp'] = pv['cp']; v['prev_share'] = pv['share'] / 100; v['prev_rank'] = f"10명 중 {pv['rank']}위"
        notes['prev_cp'] = '성과 자료(원본 표본) — 금액으로 환산하지 않고 순위·방향만 사용'
    else:
        v['prev_rank'] = '해당 없음 (신규)'; notes['prev_cp'] = '신규 인플루언서: 기존 실적 없음'
    assume = ['원가는 주문당 단가 × 주문 수, 채널 수수료는 GMV × 수수료율 (원본 정의 — 환불돼도 원가·수수료는 회수하지 않음)', '출고비는 주문 1건에 1회 적용', '쿠폰 할인액은 GMV에 이미 반영']
    if not camp:
        assume.append('공헌이익에는 건별 마케팅 지출만 넣고, 연 전속 고정 피·성과 피는 5번 구역에서 따로 반영 (원본 정의)')
        if s['fee_type'] != '고정 피' and s['perf']:
            r = s['rate'] if s.get('rate') else s.get('perf_assumed')
            assume.append(f"연 예상 성과 피 = 예상 귀속 GMV {won(s['attr'])}원 × {r:g}%" + ('' if s.get('rate') else ' (비율은 협의 전 가정값)'))
    if PREV.get(s['infl']) and s['retrate'] < 0.08 and s['infl'] == 'INF-001':
        assume.append('반품률 6.0%는 마케팅 낙관 가정 (최근 실적 13.1%)')
    v['assume'] = ' / '.join(assume)
    miss = [f"{a} ({b} · {ymd(c)})" for a, b, c, st in s['missing'] if a != '없음']
    v['unknown'] = ' / '.join(miss) if miss else '없음'
    if s.get('mismatch'):
        notes['mk_inf'] += ' — 주의: 기안서·계약서 요청금액과 다름 (시험용 불일치)'
    return v, notes


def build_xlsx(s, docno, path, drop=(), over=None, extra_notes=None):
    # drop: 일부러 비워 둘 입력 칸(값 누락 시험), over: 값을 덮어쓸 칸, extra_notes: 비고 칸에 덧붙일 말
    v, notes = xlsx_values(s, docno)
    for k in drop: v.pop(k, None)
    v.update(over or {}); notes.update(extra_notes or {})
    jp = os.path.join(TMP, 'x.json')
    # 계산 칸의 결과 (엑셀이 다시 계산하는 값과 같다) — 파일에 함께 저장한다
    calc = dict(gmv=s['gmv'], refund=s['refund'], net=s['net'], cogs=s['cogs_amt'], fee=s['fee_amt'], ship=s['ship_amt'], retlog=s['retlog'], mk=s['mk'], cp=s['cp'], real=s['real'], nominal=s['nominal'])
    if s['kind'] == 'influencer':
        calc.update(perf=s['perf'] or 0, cp2=s['cp2'], roas2=s['real2'])
    else:
        calc.update(perf=0, cp2=s['cp'], roas2=s['cp'] / s['mk'])
    if drop: calc = {}  # 입력 칸이 비어 있으면 계산 결과도 저장하지 않는다 (엑셀이 열 때 다시 계산)
    io.open(jp, 'w', encoding='utf-8').write(json.dumps({'vals': v, 'notes': notes, 'calc': calc}, ensure_ascii=False))
    env = dict(os.environ, XLSX_OUT=path, XLSX_JSON=jp)
    r = subprocess.run([sys.executable, os.path.join(HERE, 'xlsx_form.py')], env=env, capture_output=True, text=True, encoding='utf-8')
    if r.returncode: raise RuntimeError(r.stderr)
    return v

def dday(x):
    if not x: return '미확인'
    n = (x - AS_OF).days
    return f'D-{n}' if n > 0 else ('D-day' if n == 0 else f'D+{-n} (지남)')


def write_index(rows):
    # ── 제출값.csv: 안건 제출 화면에 옮겨 적는 값 (GMV·환불·원가·수수료·출고비·반품 물류비는 추계서의 계산 결과와 같다)
    head = ['안건', '폴더', '분류', '구분', '분류ID', '작성일', '계약 체결 기한', '지급 예정일', '현 계약 만료일', '계약 방식', '요청금액', '고정 피', '연(건) 예상 성과 피', '성과 피 비율(%)',
            'GMV', '환불', '제품 원가', '채널 수수료', '출고비', '반품 물류비',
            '마케팅 지출(추계서 3번)', '공헌이익(추계서 4번 · 고정·성과 피 제외)', '고정·성과 피 반영 공헌이익(추계서 5번 · 자체 정의)', '앱 제출화면 공헌이익(요청금액을 마케팅 지출로 뺌)',
            '기대 승인권자', '기대 이유', '시험 상황', '기존 계약서(첨부)']
    out = [head]
    for s in rows:
        # 앱 제출 화면은 요청금액 전체를 마케팅 지출로 빼서 계산한다 (캠페인은 같은 값, 전속계약은 고정 피·성과 피가 함께 빠진다)
        form_cp = s['cp'] + s['mk'] - s['R']
        out.append([s['tid'], s['folder'], '캠페인 집행' if s['kind'] == 'campaign' else '인플루언서 전속계약', s['deal'] if s['kind'] == 'campaign' else s['renew'], s['ref'], ymd(s['doc']), ymd(s['deadline']), ymd(s.get('pay')), ymd(s.get('expiry')) if s.get('expiry') else '',
                    s['fee_type'], s['R'], s['fixed'], s['perf'] if s['perf'] is not None else '', f"{s['rate']:g}" if s.get('rate') else '',
                    s['gmv'], s['refund'], s['cogs_amt'], s['fee_amt'], s['ship_amt'], s['retlog'], s['mk'], s['cp'], s['cp2'], form_cp, s['approver'], s['approver_why'], s['scenario'], ('04_기존계약서 ' + s['existing']) if s.get('existing') else '없음 (신규 — 기존 계약서 칸 없음)'])
    with io.open(os.path.join(OUT, '제출값.csv'), 'w', encoding='utf-8-sig', newline='') as f:
        csv.writer(f).writerows(out)
    # ── README.md
    n_c = sum(1 for s in rows if s['kind'] == 'campaign')
    L = [f'# 채운 문서 (합성 안건 {len(rows)}건)', '',
         '`합성데이터/빈양식`의 빈 양식을 같은 구성으로 채운 **가상 서류**예요. 안건마다 기안서(워드 docx) · 비용편익추계서(엑셀) · 표준계약서(워드 docx)가 들어 있고, 전속계약 **갱신**·캠페인 **확대** 안건에는 **기존(현행) 계약서**(`04_…`)가 더 있어요.',
         '- `03_표준계약서_…` 는 이번 건으로 **새로 맺을 계약서**예요 (계약 담당 단계에서 만들어지는 문서에 가까워서, 기안 접수 화면의 "기존 계약서" 칸에 올리는 서류가 아니에요).',
         '- `04_기존계약서_…docx` 는 **이미 맺어 둔 현행 계약서**예요. 전속계약 **갱신**(T15~T21·T24)은 직전 1년 기간·직전 계약번호(CT-INF-2025-…)이고, 캠페인 **확대**(T25~T30)는 확대 대상 캠페인의 기존 계약(CT-CMP-2025-…, 기간은 캠페인 마스터와 같아요)이에요. 기안 접수 화면의 **"기존 계약서"** 칸에 올려요. 신규(캠페인 신규 T01~T14, 전속 신규 T22·T23)는 기존 계약이 없어서 이 문서도, 올릴 칸도 없어요.',
         '- **캠페인도 인플루언서처럼 구분이 있어요**: 신규(새 캠페인 ID, `CMP-0026`~) / 확대(이미 있는 캠페인 ID의 추가 집행). 기안서 "구분" 줄에 표시하고, 계약서(03)의 "계약 구분"과 확대 대상 기존 계약번호가 맞춰져 있어요. 확대의 03 계약서는 **추가하는 금액**만 적어요.',
         '값은 모두 지어낸 가상 값이지만 **원본 자료의 모양과 크기**를 따랐어요 (원본 데이터는 읽기만 했고 한 글자도 고치지 않았어요).', '',
         '## 공헌이익은 어떻게 계산했나 (원본 정의 `calculation_definitions.md` 1.4 · 시맨틱 레이어와 같아요)', '',
         '- **순매출** = GMV − 환불 (GMV는 쿠폰 반영 후·VAT 제외라서 쿠폰을 다시 빼지 않아요)',
         '- **제품 원가** = 주문당 제품 원가(원가표 단가) × 주문 수, **채널 수수료** = GMV × 수수료율 — 환불돼도 원가·수수료는 회수하지 않아요 (원본 기본 가정)',
         '- **출고비** = 주문당 출고비 × 주문 수, **반품 물류비** = 반품 건수 × 건당 물류비',
         '- **공헌이익** = 순매출 − 제품 원가 − 채널 수수료 − 출고비 − 반품 물류비 − **마케팅 지출**',
         '- **마케팅 지출**은 건별 지출(인플루언서 건별 진행비 + 퍼포먼스 광고비 + 오프라인)이에요. **연 전속 고정 피·성과 피는 공헌이익에 넣지 않아요.**', '',
         '### 캠페인 추계서와 전속계약 추계서의 차이', '',
         '| 구분 | 캠페인 집행 | 인플루언서 전속계약 |', '|---|---|---|',
         '| 규모·기간 | 건별, 몇 개월 | 연 단위 |',
         '| 마케팅 지출(3번) | 건별 진행비 = **요청금액** (= 계약서 건별 금액) | 연간 건별 진행비 + 퍼포먼스 광고비 — 원본 성과 집계의 광고비÷GMV 비율로 가정. 요청금액과 같지 않아요 |',
         '| 연 전속 고정 피·성과 피 | 없음 (건별 금액에 이미 들어 있음) | **5번 구역**에 따로: 고정 피 + 연 예상 성과 피(귀속 GMV × 비율) = **요청금액** |',
         '| 공헌이익 | 4번 (마케팅 지출까지) | 4번 = 원본 정의(고정·성과 피 제외), 5번 = 고정·성과 피까지 반영한 자체 정의(판단 보충용) |', '',
         '> **앱 제출 화면과 다른 점**: 앱의 공헌이익 계산 칸은 요청금액 전체를 마케팅 지출로 빼요. 캠페인은 값이 같지만, 전속계약은 고정 피·성과 피가 함께 빠져서 `제출값.csv`의 "앱 제출화면 공헌이익"이 서류의 4번 값과 달라요 (앱 쪽을 같은 정의로 맞추는 일은 아직 하지 않았어요).', '',
         '## 어떻게 값을 정했나', '',
         '- **ID·이름**: `m_influencer_ms.csv` · `m_campaign_ms.csv`의 10명·25개 캠페인을 이어서 썼어요. 새 캠페인은 `CMP-0026`부터, 신규 인플루언서는 `INF-011`·`INF-012`예요.',
         '- **비용**: 주문당 제품 원가는 평균 주문금액의 14~24% 수준, 채널 수수료 4%(자사몰)·12~14%(마켓플레이스), 출고비 3,000~3,300원, 반품 물류비 3,500~4,100원 — `mkt_cost_master_ms.csv`의 범위예요.',
         '- **반품률·광고비 효율**: 인플루언서별 실제 성과 집계(혜인 반품률 13.1%·광고비÷GMV 73%, 초혜핏 3.7%·15% …)에 가깝게 잡았어요. 같은 인플루언서의 기존 순위·광고비 비중·캠페인별 공헌이익은 성과 집계 값을 그대로 옮겼어요.',
         '- **낙관 추계 시험**: `T04`는 반품률을 6%로 낙관적으로 잡았어요 (실제 최근 13.1%). 원본 기안이 예상 GMV를 요청금액의 약 11배로 적는 것과 같은 함정이에요.',
         '- **승인 경로**: `approval_authority_policy.md` 기준이에요. 건당 1천만 원 이하 팀 전결 / 초과 또는 기안 총액 1억 초과 Masil 대표 + 그룹 보고 / 연 10억 초과 전속계약 CEO/이사회 / 지급일이 현금 하회 예상 구간 안이면 금액 불문 CEO/이사회 / 그룹 300억 대상 CEO/이사회.',
         '- **날짜**: 가상기업 기준일은 **2026-07-01**이고, 현금 하회 예상 구간은 **2026-07-21 ~ 2026-08-21**이에요. 작성일은 6/24~7/1 사이, 계약 체결 기한은 기준일 대비 **5일 지남 ~ 4개월 뒤**로 흩었어요. 경계값(구간 시작·마지막 날·직후, 정확히 1천만 원, 정확히 10억, 10억 + 1천만 원)을 일부러 넣었어요.',
         '- **서류 사이의 숫자**: 요청금액 = 계약서 금액이에요 (캠페인은 추계서 마케팅 지출 합계, 전속계약은 추계서 5번 구역의 고정 피 + 연 예상 성과 피와도 같아요). 예외: `T14`는 일부러 어긋나게 만든 시험용이에요. 계약 방식·성과 피(귀속 GMV 기준, last-click 7일 고정)도 같아요.', '',
         '## 안건 목록', '',
         f'캠페인 {n_c}건 (신규 T01~T14 · 확대 T25~T30) + 인플루언서 전속계약 {len(rows) - n_c}건 (T15~T24). 기대 승인권자는 위 규정을 사람이 풀어 본 값이에요 (앱이 계산한 값과 다르면 알려 주세요).', '',
         '| 안건 | 대상 | 요청금액 | 계약 체결 기한 | 지급 예정일 | 공헌이익(추계) | 고정·성과 피 반영 | 기대 승인권자 | 이 안건이 시험하는 것 |', '|---|---|---:|---|---|---:|---:|---|---|']
    sg = lambda v: ('−' if v < 0 else '') + won(abs(v))
    for s in rows:
        what = f"{s['cname']} {s['deal']}" if s['kind'] == 'campaign' else f"{s['iname']} 전속 {s['renew']}"
        L.append(f"| [{s['tid']}]({s['folder']}) | {what} (`{s['ref']}`) | {won(s['R'])} | {ymd(s['deadline'])} ({dday(s['deadline'])}) | {ymd(s.get('pay'))} | {sg(s['cp'])} | {sg(s['cp2']) if s['kind'] == 'influencer' else '—'} | {s['approver']} | {s['scenario']} |")
    L += ['', '## 쓰는 법', '',
          '1. 마케팅 팀원 계정으로 **기안 제출** 화면을 열어요.',
          '2. 분류(캠페인 집행 / 인플루언서 전속계약)와 구분(캠페인 신규·확대 / 전속 신규·갱신)을 고르고 — 확대는 이미 있는 캠페인 ID(`CMP-0001`~`CMP-0025`)를 골라요 (T25~T30은 원본 확대 기안 PLAN-001·004·005·016·021·024와 같은 금액·기한·지급일이에요) — 첨부서류를 올린 뒤 **"AI 로 첨부서류 읽고 빈칸 채우기"**를 눌러도 되고, 직접 적어도 돼요 (새 ID는 `CMP-0026`~·`INF-011`~).',
          '3. 직접 적을 때는 `제출값.csv`의 해당 줄을 보고 날짜·금액·계약 방식·공헌이익 계산 칸(GMV·환불·제품 원가·채널 수수료·출고비·반품 물류비)을 채워요. 추계서(엑셀)의 계산 결과와 같은 값이에요 (`T14`만 요청금액과 추계서 지출이 일부러 달라요).',
          '4. 첨부는 **기안서**(`01_기안서.docx`) · **비용 및 성과 추계서**(`02_비용편익추계서.xlsx`)가 필수예요. 전속계약 갱신·캠페인 확대면 **기존 계약서**(`04_기존계약서_…docx`)도 올려요 (`03_…docx` 는 새로 맺을 계약서라 올리지 않아도 돼요).',
          '5. 이어서 팀장 → 재무팀 → 계약 담당 → 승인권자로 처리하면서 승인권자·경고·보완요청 흐름을 확인해요.', '',
          '## 알아 둘 것', '',
          '- 엑셀은 계산 결과가 파일에 저장돼 있고, 열 때 수식이 다시 계산돼요. 원 미만은 반올림하도록 계산 칸 식에 `ROUND`를 넣었어요 (빈 양식도 같은 식이에요).',
          '- 워드 문서는 Word 가 아닌 도구로 만들어서 모양을 직접 확인하지 못했어요. 열어 보시고 어색한 곳이 있으면 알려 주세요.',
          '- `T09`(지급 예정일 미확인), `T12`(성과 피 비율·긴급배송·CS 미확인), `T15`(성과 피 비율·지급일 미확인)는 일부러 비워 둔 값이 있어요. 기안서 5항 "부족한 정보"에 올라가 있어요.',
          '- 계약서·기안서의 이름·계좌·사업자번호·주소는 모두 가상이에요. 실제 계약·실제 성과가 아니에요.', '',
          '## 다시 만들려면', '',
          '```bash', 'python 합성데이터/채운문서/_생성기/build_docs.py          # 전체', 'python 합성데이터/채운문서/_생성기/build_docs.py T04 T15   # 일부만', '```',
          '값은 `_생성기/scenarios.py`에서 바꿔요. 엑셀의 계산 결과를 파일에 저장하려면 만든 뒤 Excel 에서 한 번 열어 저장해야 해요 (Windows + Excel 필요).']
    io.open(os.path.join(OUT, 'README.md'), 'w', encoding='utf-8').write('\n'.join(L) + '\n')


def main():
    only = set(a for a in sys.argv[1:] if a.startswith('T'))
    rows = []
    for raw in SC:
        s = derive(raw)
        if only and s['tid'] not in only:
            continue
        fdir = os.path.join(OUT, s['folder'])
        os.makedirs(fdir, exist_ok=True)
        dmd, docno = draft_md(s)
        pages_d = to_docx(dmd, os.path.join(fdir, '01_기안서.docx'), f"{s['tid']} 기안서", onepage=True)
        try:
            build_xlsx(s, docno, os.path.join(fdir, '02_비용편익추계서.xlsx'))
        except RuntimeError as e:
            if 'PermissionError' not in str(e): raise
            print(f"  ⚠ {s['tid']} 추계서(xlsx)가 다른 프로그램에서 열려 있어 새로 만들지 못했어요 — 닫고 `python build_docs.py {s['tid']}` 를 다시 실행하세요", flush=True)
        cmd, cno = (inf_contract_md(s) if s['kind'] == 'influencer' else cmp_contract_md(s))
        cname = '03_표준계약서_인플루언서_전속계약.docx' if s['kind'] == 'influencer' else '03_표준계약서_캠페인_계약.docx'
        pages_c = to_docx(cmd, os.path.join(fdir, cname), f"{s['tid']} 표준계약서")
        if s['kind'] == 'influencer' and s['renew'] == '갱신':
            # 기존(현행) 계약서: 현 계약 만료일에 끝나는 직전 1년 계약. 신규 안건에는 기존 계약서가 없다.
            ex = dict(s, end=s['expiry'], start=s['expiry'].replace(year=s['expiry'].year - 1) + timedelta(days=1), renew='신규', expiry=None)
            ex['doc'] = ex['start'] - timedelta(days=14)
            if s.get('pay'): ex['pay'] = s['pay'].replace(year=s['pay'].year - 1)
            exmd, _ = inf_contract_md(ex, ex=True)
            to_docx(exmd, os.path.join(fdir, '04_기존계약서_인플루언서_전속계약.docx'), f"{s['tid']} 기존 계약서")
            s['existing'] = f"{s['prev_no']} ({ymd(ex['start'])}~{ymd(ex['end'])})"
        elif s['kind'] == 'campaign' and s['deal'] == '확대':
            # 기존 캠페인 계약서: 확대 대상 캠페인을 처음 맺은 계약 (고정 피 건별 정액, 기존 기간·금액). 신규 캠페인에는 기존 계약서가 없다.
            ex = dict(s, start=s['prev_start'], end=s['prev_end'], doc=s['prev_start'] - timedelta(days=14), deadline=s['prev_start'] - timedelta(days=5), pay=s['prev_start'],
                      R=s['prev_amount'], fixed=s['prev_amount'], perf=0, rate=None, fee_type='고정 피', gmv=int(s['prev_amount'] * s['k'] / 1000) * 1000, deal='신규', mismatch=None)
            exmd, _ = cmp_contract_md(ex, ex=True)
            to_docx(exmd, os.path.join(fdir, '04_기존계약서_캠페인_계약.docx'), f"{s['tid']} 기존 계약서")
            s['existing'] = f"{s['prev_no']} ({ymd(s['prev_start'])}~{ymd(s['prev_end'])})"
        else:
            s['existing'] = ''
        s['pages'] = (pages_d, pages_c)
        rows.append(s)
        print(s['tid'], s['folder'], '요청', won(s['R']), '공헌이익', won(s['cp']), '(고정·성과 피 반영', won(s['cp2']) + ')', s['approver'], flush=True)
    if not only: write_index(rows)
    io.open(os.path.join(TMP, 'rows.json'), 'w', encoding='utf-8').write(json.dumps([{k: (str(v) if isinstance(v, date) else v) for k, v in r.items() if k not in ('inf',)} for r in rows], ensure_ascii=False, default=str))
    return rows


if __name__ == '__main__':
    main()
