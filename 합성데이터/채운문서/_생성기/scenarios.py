# 합성 안건 시나리오 — 가상기업 기준일 2026-07-01 (data_dictionary), covenant 하회 예상 구간 2026-07-21 ~ 2026-08-21.
# 값은 모두 지어낸 가상 값이지만, 원본 자료(마스터·성과 집계·계약 통보서·승인 권한 규정)의 모양과 크기를 따라 정했어요.
#  · 캠페인·인플루언서 ID/이름: m_campaign_ms.csv · m_influencer_ms.csv (새 캠페인은 CMP-0026 이후, 새 인플루언서는 INF-011 이후)
#  · 비용률·출고비·반품 물류비: mkt_cost_master_ms.csv 와 같은 범위
#  · 기존 성과(순위·광고비 비중·공헌이익): 성과 집계(원본 표본) 값을 그대로 옮김
#  · 승인 경로: approval_authority_policy.md (건별 1천만 원 이하 팀 전결, 초과·기안 총액 1억 초과 Masil 대표 + 그룹 보고,
#    전속계약 연 10억 초과 CEO/이사회, 하회 구간 안 지급 → 금액 불문 CEO/이사회, 300억 대상 → CEO/이사회)
from datetime import date

AS_OF = date(2026, 7, 1)
BREACH_FROM, BREACH_TO = date(2026, 7, 21), date(2026, 8, 21)

# ───────── 기존 성과 (원본 표본 집계): 순위(10명 중), 광고비 비중, 실질 공헌이익, 캠페인별 공헌이익
PREV = {
    'INF-001': dict(rank=10, share=40.6, cp=-61308789, camps=[('CMP-0001', -22205482), ('CMP-0002', -8428972), ('CMP-0003', -30674335)]),
    'INF-002': dict(rank=1, share=2.4, cp=67656962, camps=[('CMP-0004', 21102335), ('CMP-0005', 21605708), ('CMP-0006', 24948920)]),
    'INF-003': dict(rank=2, share=13.9, cp=31962708, camps=[('CMP-0007', 7719822), ('CMP-0008', 9860600), ('CMP-0009', 14382286)]),
    'INF-004': dict(rank=5, share=2.9, cp=28586292, camps=[('CMP-0010', 11261950), ('CMP-0011', 17324342)]),
    'INF-005': dict(rank=9, share=22.1, cp=-36162212, camps=[('CMP-0012', -3484954), ('CMP-0013', -12622278), ('CMP-0014', -20054981)]),
    'INF-006': dict(rank=4, share=2.8, cp=29473649, camps=[('CMP-0015', 12908893), ('CMP-0016', 16564756)]),
    'INF-007': dict(rank=7, share=9.9, cp=16370078, camps=[('CMP-0017', 5220436), ('CMP-0018', 4734993), ('CMP-0019', 6414648)]),
    'INF-008': dict(rank=8, share=1.4, cp=11331333, camps=[('CMP-0020', 6110586), ('CMP-0021', 5220748)]),
    'INF-009': dict(rank=6, share=0.9, cp=21923009, camps=[('CMP-0022', 10560189), ('CMP-0023', 11362820)]),
    'INF-010': dict(rank=3, share=3.2, cp=31553596, camps=[('CMP-0024', 14177133), ('CMP-0025', 17376463)]),
}

# ───────── 인플루언서 프로필 (가상). 신규 INF-011·012 는 마스터에 아직 없는 새 인물
INF = {
    'INF-001': dict(name='혜인', real='서혜인', birth=(1995, 3, 12), country='국내', platform='YouTube', followers='구독자 3,200,000명', biz='개인사업자', bizno='000-00-10011', agency='블루포레스트 엔터(가상)', tier='대형'),
    'INF-002': dict(name='초혜핏', real='최혜진', birth=(1997, 8, 21), country='국내', platform='Instagram', followers='팔로워 640,000명', biz='개인', bizno='', agency='', tier='중형'),
    'INF-003': dict(name='토모카', real='타나카 토모카', birth=(1996, 11, 5), country='일본', platform='Instagram', followers='팔로워 1,450,000명', biz='법인', bizno='JP-0000-00003', agency='하나비 프로덕션(가상)', tier='대형'),
    'INF-004': dict(name='유키뷰티', real='이시다 유키', birth=(1998, 2, 18), country='일본', platform='YouTube', followers='구독자 420,000명', biz='개인사업자', bizno='JP-0000-00004', agency='', tier='중형'),
    'INF-005': dict(name='Ava Glow', real='Ava Collins', birth=(1999, 6, 30), country='미국', platform='TikTok', followers='팔로워 2,800,000명', biz='법인', bizno='US-00-0000005', agency='Glow Talent Group(가상)', tier='대형'),
    'INF-006': dict(name='Mia Skin', real='Mia Park', birth=(1994, 12, 2), country='미국', platform='Instagram', followers='팔로워 710,000명', biz='개인사업자', bizno='US-00-0000006', agency='', tier='중형'),
    'INF-007': dict(name='Lila SEA', real='Lila Santos', birth=(1997, 4, 9), country='동남아', platform='TikTok', followers='팔로워 2,100,000명', biz='개인사업자', bizno='SG-0000000-07', agency='SEA Creators(가상)', tier='대형'),
    'INF-008': dict(name='Nara Beauty', real='Nara Wijaya', birth=(2000, 9, 14), country='동남아', platform='Instagram', followers='팔로워 95,000명', biz='개인', bizno='', agency='', tier='마이크로'),
    'INF-009': dict(name='보미', real='김보미', birth=(2001, 5, 27), country='국내', platform='Instagram', followers='팔로워 120,000명', biz='개인', bizno='', agency='', tier='마이크로'),
    'INF-010': dict(name='코코라운지', real='박소연', birth=(1993, 10, 8), country='국내', platform='YouTube', followers='구독자 380,000명', biz='개인사업자', bizno='000-00-10010', agency='', tier='중형'),
    'INF-011': dict(name='Sora Mint', real='야마다 소라', birth=(2000, 1, 19), country='일본', platform='TikTok', followers='팔로워 1,100,000명', biz='개인사업자', bizno='JP-0000-00011', agency='미나토 크리에이터즈(가상)', tier='대형'),
    'INF-012': dict(name='다온', real='윤다온', birth=(1999, 7, 23), country='국내', platform='YouTube', followers='구독자 520,000명', biz='개인사업자', bizno='000-00-10012', agency='', tier='중형'),
}

WRITERS = ['정다은', '오민재', '한서윤', '배지호']
LEAD = '박지훈'  # 마케팅 팀장 (가상)


def d(y, m, dd):
    return date(y, m, dd)


# ───────── 시나리오. kind: campaign(캠페인 집행) / influencer(전속계약)
# 캠페인: R(요청금액) k(예상 GMV ÷ 요청금액) aov retrate cogs fee ship retunit, 방식 fee_type [rate 성과 피 비율(%)]
# 전속계약: fixed(연 고정 피) attr(연 예상 귀속 GMV) rate(성과 피 비율 %) gmv(연 예상 GMV) …
SC = []


def camp(tid, **kw):
    kw.update(tid=tid, kind='campaign')
    SC.append(kw)


def contract(tid, **kw):
    kw.update(tid=tid, kind='influencer')
    SC.append(kw)


# ─────────────────── 캠페인 집행 ───────────────────
camp('T01', ref='CMP-0026', infl='INF-002', cname='초혜핏 선케어 캠페인4', line='선케어', channel='자사몰', fmt='Instagram 피드 3편', writer=0, doc=d(2026, 6, 29),
     start=d(2026, 9, 1), end=d(2026, 12, 31), deadline=d(2026, 7, 24), pay=d(2026, 9, 10), R=7_000_000, k=7.5, aov=84_000, retrate=0.040, cogs=0.20, fee=0.04, ship=3_100, retunit=3_800,
     fee_type='고정 피', g300='대상 아님', bundle=('2026년 3분기 확대 기안 A', 30_000_000),
     scenario='소액·구간 밖·300억 아님 → 마케팅팀 전결 (정상 경로)', purpose='초혜핏 선케어 캠페인1·2는 공헌이익이 상위(1위)였고, 9월 가을 자외선 차단 수요에 맞춰 후속 캠페인을 요청해요. 인플루언서 측이 7/24까지 일정 확정을 요청했어요.',
     consequence='7/24 이후 일정 확정이 늦으면 9월 초 게시 슬롯을 놓쳐요 (계약 확정기한 후에는 자동 확정되어 철회할 수 없어요).',
     alt='금액 축소(5백만 원) 시 노출량이 줄어 예상 GMV가 약 30% 감소 → 요청 금액 유지. 연기는 슬롯 경쟁으로 비추천.', risk='재고: 선케어 SKU 안전재고 4주분 확인 필요', missing=[('반품률 가정(4.0%)의 근거', '마케팅', d(2026, 7, 8), '회신 대기')])

camp('T02', ref='CMP-0027', infl='INF-010', cname='코코라운지 기초 캠페인3', line='기초', channel='자사몰', fmt='YouTube 숏츠 4편', writer=1, doc=d(2026, 6, 30),
     start=d(2026, 8, 5), end=d(2026, 11, 30), deadline=d(2026, 7, 28), pay=d(2026, 8, 5), R=9_800_000, k=3.6, aov=76_000, retrate=0.055, cogs=0.22, fee=0.04, ship=3_000, retunit=3_900,
     fee_type='혼합 피', rate=2.0, g300='대상 아님', bundle=('2026년 3분기 확대 기안 A', 30_000_000),
     scenario='소액이지만 지급일이 하회 구간(7/21~8/21) 안 → 금액 불문 CEO/이사회', purpose='코코라운지 기초 캠페인2가 공헌이익 상위(3위)를 유지해 후속 집행을 요청해요. 8월 초 시작을 원해 지급 예정일이 8/5예요.',
     consequence='7/28까지 확정하지 않으면 8월 초 방영 일정이 밀려요.', alt='지급일을 8/24로 늦추면 하회 구간 밖이라 팀 전결 가능 — 인플루언서와 정산 일정 협의 여부 확인 필요 (회신 대기)', risk='하회 구간 안 현금 유출 — 그룹 승인 지연 시 일정 지연', missing=[('지급 예정일을 8/24 이후로 조정 가능한지', '마케팅', d(2026, 7, 8), '회신 대기')])

camp('T03', ref='CMP-0028', infl='INF-003', cname='토모카 색조 캠페인4', line='색조', channel='마켓플레이스', fmt='Instagram 릴스 3편 (일본)', writer=2, doc=d(2026, 6, 29),
     start=d(2026, 9, 25), end=d(2027, 2, 28), deadline=d(2026, 7, 31), pay=d(2026, 9, 25), R=12_500_000, k=2.4, aov=103_000, retrate=0.095, cogs=0.15, fee=0.14, ship=3_300, retunit=4_100,
     fee_type='고정 피', g300='대상 아님', bundle=('일본 시장 확대 기안', 45_000_000),
     scenario='건당 1천만 원 초과 → Masil 대표 + 그룹 보고, 일본 마켓플레이스 수수료율이 높음', purpose='토모카는 기존 실질 공헌이익 2위(광고비 비중 13.9%)예요. 일본 연말 쇼핑 시즌에 맞춰 색조 신제품 집행을 요청해요.',
     consequence='7/31 이후에는 현지 인플루언서 연말 일정이 마감돼요.', alt='금액을 1천만 원으로 줄이면 팀 전결이지만 콘텐츠 3편이 2편으로 줄어요. 효과 감소로 요청 금액 유지.', risk='일본 반품률이 9~10%로 높고 환율 변동', missing=[('일본 연말 프로모션 쿠폰 계획 (GMV에 반영되는지)', '재무', d(2026, 7, 10), '회신 대기')])

camp('T04', ref='CMP-0029', infl='INF-001', cname='혜인 색조 캠페인4', line='색조', channel='마켓플레이스', fmt='YouTube 숏츠 5편', writer=0, doc=d(2026, 6, 26),
     start=d(2026, 8, 1), end=d(2026, 12, 31), deadline=d(2026, 7, 17), pay=d(2026, 7, 31), R=18_000_000, k=10, aov=125_000, retrate=0.060, cogs=0.14, fee=0.12, ship=3_000, retunit=3_700,
     fee_type='혼합 피', rate=3.0, g300='미확정', bundle=('2026년 3분기 확대 기안 B', 85_000_000),
     scenario='낙관 추계(반품률 6%, 실제는 13%대)로 공헌이익이 좋아 보이나 기존 실적은 최하위 + 구간 안 지급 + 300억 미확정', purpose='혜인 색조 캠페인은 8월 신제품 출시와 맞물려 요청하는 건이에요. 전속계약 갱신 통보 기한(7/17)과 같은 날이 이 기안의 계약 확정기한이에요.',
     consequence='7/17까지 결정하지 않으면 계약이 자동 확정되어 철회할 수 없어요.', alt='전속계약 갱신 여부와 함께 판단 필요. 이 건만 부결해도 전속계약이 갱신되면 배분은 유지돼요.', risk='기존 실질 공헌이익이 인플루언서 10명 중 10위(−61,308,789원). 추계의 반품률 6%는 최근 실적(13.1%)의 절반 이하',
     missing=[('반품률 가정 6.0%의 근거 (최근 실적 13.1%와 차이)', '마케팅', d(2026, 7, 6), '회신 대기'), ('성과 피 비율 · 성과 조건', '마케팅', d(2026, 7, 6), '회신 대기'), ('그룹 300억 배분 대상 여부', '재무', d(2026, 7, 8), '회신 대기')])

camp('T05', ref='CMP-0030', infl='INF-005', cname='Ava Glow 선케어 캠페인4', line='선케어', channel='마켓플레이스', fmt='TikTok 숏폼 6편 (미국)', writer=1, doc=d(2026, 6, 30),
     start=d(2026, 10, 12), end=d(2027, 3, 31), deadline=d(2026, 8, 10), pay=d(2026, 10, 12), R=22_000_000, k=1.6, aov=108_000, retrate=0.120, cogs=0.14, fee=0.14, ship=3_300, retunit=4_100,
     fee_type='고정 피', g300='대상 아님', bundle=('미국 시장 확대 기안', 62_000_000),
     scenario='공헌이익 음수(광고비 대비 효율 낮음) + 광고비 비중 22.1%인데 성과 9위 → 부결·재검토 시험', purpose='Ava Glow 선케어 캠페인을 이어가자는 요청이에요. 미국 가을 시즌 노출이 목적이에요.',
     consequence='8/10 이후에는 자동 확정이에요.', alt='조건 변경(건별 금액 인하·성과 피 전환) 또는 미진행. 성과 피 전환 시 고정 비용이 줄어요.', risk='기존 캠페인 3건 모두 공헌이익 음수 (−3.5백만 · −12.6백만 · −20.1백만 원)', missing=[('성과 피 전환 가능 여부 (에이전시 회신)', '마케팅', d(2026, 7, 15), '회신 대기')])

camp('T06', ref='CMP-0031', infl='INF-006', cname='Mia Skin 색조 캠페인3', line='색조', channel='마켓플레이스', fmt='Instagram 피드 4편 (미국)', writer=2, doc=d(2026, 6, 29),
     start=d(2026, 9, 1), end=d(2026, 12, 31), deadline=d(2026, 7, 28), pay=d(2026, 9, 1), R=10_000_000, k=4.0, aov=88_000, retrate=0.038, cogs=0.20, fee=0.12, ship=3_200, retunit=4_000,
     fee_type='고정 피', g300='대상 아님', bundle=('미국 시장 확대 기안', 62_000_000),
     scenario='정확히 1천만 원 — "1천만 원 이하"라서 마케팅팀 전결 (경계값)', purpose='Mia Skin(실질 공헌이익 4위)의 색조 후속 캠페인이에요. 요청금액이 정확히 1천만 원이에요.',
     consequence='7/28 이후 자동 확정이에요.', alt='없음 (소액·성과 양호)', risk='환율, 미국 배송 지연 시 반품 증가', missing=[('없음', '-', None, '-')])

camp('T07', ref='CMP-0032', infl='INF-007', cname='Lila SEA 선케어 캠페인4', line='선케어', channel='마켓플레이스', fmt='TikTok 숏폼 4편 (동남아)', writer=3, doc=d(2026, 6, 30),
     start=d(2026, 8, 21), end=d(2026, 12, 31), deadline=d(2026, 7, 27), pay=d(2026, 8, 21), R=8_500_000, k=2.5, aov=94_000, retrate=0.110, cogs=0.16, fee=0.12, ship=3_300, retunit=4_100,
     fee_type='고정 피', g300='대상 아님', bundle=('동남아 확대 기안', 24_000_000),
     scenario='지급일이 하회 구간의 마지막 날(8/21) → 구간 안 → CEO/이사회 (경계값)', purpose='Lila SEA 선케어 후속 캠페인이에요. 동남아 건기 시작에 맞춰 8/21 지급을 요청해요.',
     consequence='7/27까지 확정하지 않으면 8월 중순 게시 일정이 밀려요.', alt='지급일을 8/22로 하루만 늦추면 구간 밖 — 인플루언서 동의 필요(회신 대기)', risk='동남아 반품률 11%대, 물류 지연', missing=[('지급일을 8/22 이후로 조정 가능한지', '마케팅', d(2026, 7, 7), '회신 대기')])

camp('T08', ref='CMP-0033', infl='INF-004', cname='유키뷰티 기초 캠페인3', line='기초', channel='마켓플레이스', fmt='YouTube 숏츠 4편 (일본)', writer=0, doc=d(2026, 6, 29),
     start=d(2026, 8, 22), end=d(2026, 12, 31), deadline=d(2026, 7, 20), pay=d(2026, 8, 22), R=6_000_000, k=4.0, aov=78_000, retrate=0.053, cogs=0.18, fee=0.14, ship=3_200, retunit=3_800,
     fee_type='고정 피', g300='대상 아님', bundle=('일본 시장 확대 기안', 45_000_000),
     scenario='지급일이 하회 구간 바로 다음 날(8/22) → 구간 밖 → 마케팅팀 전결 (경계값)', purpose='유키뷰티 기초 캠페인2가 성과 양호(5위)해 후속을 요청해요.',
     consequence='7/20 이후 자동 확정이에요.', alt='없음', risk='일본 마켓플레이스 수수료율 14%', missing=[('없음', '-', None, '-')])

camp('T09', ref='CMP-0034', infl='INF-009', cname='보미 색조 캠페인3', line='색조', channel='자사몰', fmt='Instagram 릴스 3편', writer=1, doc=d(2026, 6, 30),
     start=d(2026, 9, 15), end=d(2026, 12, 31), deadline=d(2026, 7, 6), pay=None, R=5_500_000, k=8.0, aov=82_000, retrate=0.025, cogs=0.22, fee=0.04, ship=3_000, retunit=3_500,
     fee_type='고정 피', g300='미확정', bundle=('2026년 3분기 확대 기안 A', 30_000_000),
     scenario='지급 예정일 미확인 + 마감 5일 전 → 승인권자 미확정 · 확인 요청 시험', purpose='보미 색조 캠페인의 후속이에요. 인플루언서가 7/6까지 확정을 요청했어요 (남은 기간 5일).',
     consequence='7/6 이후에는 자동 확정이에요 (철회 불가).', alt='회신 지연 시 기한 연장 요청(상대방 동의 필요)', risk='지급 예정일이 아직 정해지지 않아 현금 하회 구간 여부를 판단할 수 없음',
     missing=[('지급 예정일 (돈이 나가는 날)', '마케팅', d(2026, 7, 3), '회신 대기'), ('그룹 300억 배분 대상 여부', '재무', d(2026, 7, 3), '회신 대기')])

camp('T10', ref='CMP-0035', infl='INF-008', cname='Nara Beauty 선케어 캠페인3', line='선케어', channel='마켓플레이스', fmt='Instagram 릴스 2편 (동남아)', writer=2, doc=d(2026, 6, 27),
     start=d(2026, 12, 1), end=d(2027, 3, 31), deadline=d(2026, 10, 30), pay=d(2026, 12, 1), R=None, k=11, aov=62_000, retrate=0.055, cogs=0.24, fee=0.12, ship=3_300, retunit=4_000,
     fee_type='성과 피', rate=10.0, g300='대상', bundle=('2026년 4분기 확대 기안', 14_000_000), orders_fixed=480,
     scenario='마감이 먼 건(4개월 후) + 그룹 300억 배분 대상 → CEO/이사회, 성과 피 계약', purpose='Nara Beauty(마이크로)의 연말 선케어 캠페인으로, 성과 피 계약으로 요청해요. 그룹 300억 배분 검토 대상으로 분류돼요.',
     consequence='10/30 이후 자동 확정이에요 (아직 4개월 남음).', alt='성과 피 계약이라 고정 비용이 없어 위험이 낮아요.', risk='성과 피 정산 기준(귀속 GMV)과 환불 건 처리 확정 필요', missing=[('환불 건의 성과 피 공제 방식', '계약 담당', d(2026, 9, 15), '회신 대기')])

camp('T11', ref='CMP-0036', infl='INF-002', cname='초혜핏 색조 캠페인5', line='색조', channel='자사몰', fmt='Instagram 피드 6편 + 라이브 2회', writer=3, doc=d(2026, 6, 26),
     start=d(2026, 10, 5), end=d(2027, 3, 31), deadline=d(2026, 8, 14), pay=d(2026, 10, 5), R=45_000_000, k=7.8, aov=86_000, retrate=0.037, cogs=0.21, fee=0.04, ship=3_100, retunit=3_800,
     fee_type='혼합 피', rate=2.0, g300='대상 아님', bundle=('2026년 4분기 확대 기안 (대형)', 135_000_000),
     scenario='건당 1천만 원 초과 + 기안 총액 1억 초과 → Masil 대표 승인 + 그룹 보고. 공헌이익 최상위 인플루언서의 큰 금액', purpose='실질 공헌이익 1위 초혜핏의 대형 집행안이에요. 같은 기안 묶음(2026년 4분기)의 총액은 1.35억 원이에요.',
     consequence='8/14 이후 자동 확정이에요.', alt='금액을 3천만 원으로 줄이면 라이브 방송이 빠져 예상 GMV가 크게 줄어요.', risk='재고·물류: 색조 신제품 초도 물량 확인 필요', missing=[('색조 신제품 초도 물량 · 출고 일정', '마케팅', d(2026, 7, 20), '회신 대기')])

camp('T12', ref='CMP-0037', infl='INF-010', cname='코코라운지 색조 캠페인4', line='색조', channel='자사몰', fmt='YouTube 롱폼 2편', writer=0, doc=d(2026, 6, 30),
     start=d(2026, 9, 20), end=d(2026, 12, 31), deadline=d(2026, 8, 3), pay=d(2026, 9, 20), R=11_000_000, k=3.6, aov=79_000, retrate=0.055, cogs=0.22, fee=0.04, ship=3_000, retunit=3_900,
     fee_type='혼합 피', rate=None, g300='대상 아님', bundle=('2026년 3분기 확대 기안 A', 30_000_000), unknown_cost=True,
     scenario='정보 부족: 성과 피 비율·긴급배송·CS 비용 미확인 → 보완 요청 시험 (건당 1천만 원 초과 → Masil 대표)', purpose='코코라운지 색조 롱폼 후속이에요. 성과 피 비율이 협의 중이라 아직 정해지지 않았어요.',
     consequence='8/3 이후 자동 확정이에요.', alt='성과 피 비율이 확정될 때까지 보류하는 안도 있으나 기한이 짧아요.', risk='성과 피 비율을 모르면 인플루언서 총비용을 판단할 수 없음',
     missing=[('성과 피 비율 · 성과 조건 — 인플루언서 총비용 판단', '마케팅', d(2026, 7, 10), '회신 대기'), ('긴급배송 추가 비용 (품절·주문 급증 시)', '재무', d(2026, 7, 15), '회신 대기'), ('고객 문의(CS) 비용 가정', '마케팅', d(2026, 7, 15), '회신 대기')])

camp('T13', ref='CMP-0038', infl='INF-009', cname='보미 색조 캠페인4', line='색조', channel='자사몰', fmt='Instagram 릴스 2편', writer=1, doc=d(2026, 7, 1),
     start=d(2026, 9, 15), end=d(2026, 12, 31), deadline=d(2026, 6, 26), pay=d(2026, 9, 15), R=4_200_000, k=7.5, aov=80_000, retrate=0.025, cogs=0.22, fee=0.04, ship=3_000, retunit=3_500,
     fee_type='고정 피', g300='대상 아님', bundle=('2026년 3분기 확대 기안 A', 30_000_000),
     scenario='계약 확정기한 경과(6/26) — 이미 자동 확정되었을 수 있는 사후 상신 시험', purpose='보미 색조 캠페인4예요. 서류 준비가 늦어 계약 확정기한(6/26)이 이미 지난 뒤 상신해요.',
     consequence='기한이 지나 자동 확정된 것으로 볼 수 있어요 — 철회가 불가능한지 계약 담당 확인이 필요해요.', alt='철회 가능 여부를 계약 담당이 상대방에게 확인', risk='사후 상신: 승인 권한을 거치지 않은 체결로 볼 수 있음', missing=[('기한 경과 후 철회 가능 여부', '계약 담당', d(2026, 7, 3), '회신 대기')])

camp('T14', ref='CMP-0039', infl='INF-004', cname='유키뷰티 기초 캠페인4', line='기초', channel='마켓플레이스', fmt='YouTube 숏츠 3편 (일본)', writer=2, doc=d(2026, 6, 29),
     start=d(2026, 9, 14), end=d(2026, 12, 31), deadline=d(2026, 7, 30), pay=d(2026, 9, 14), R=8_000_000, k=4.0, aov=78_000, retrate=0.053, cogs=0.18, fee=0.14, ship=3_200, retunit=3_800,
     fee_type='고정 피', g300='대상 아님', bundle=('일본 시장 확대 기안', 45_000_000), mismatch=7_600_000,
     scenario='서류 불일치 시험: 기안서·계약서 요청금액 8,000,000원 vs 추계서 마케팅 지출 합계 7,600,000원 — 접수 체크리스트(금액 일치)에서 걸러져야 함', purpose='유키뷰티 기초 후속이에요. (의도적으로 추계서 금액을 400,000원 다르게 만든 시험용 서류예요.)',
     consequence='7/30 이후 자동 확정이에요.', alt='없음', risk='서류 간 금액 불일치 — 팀장 접수 단계에서 반려 대상', missing=[('없음', '-', None, '-')])

# ─────────────────── 인플루언서 전속계약 ───────────────────
contract('T15', ref='INF-001', infl='INF-001', renew='갱신', writer=0, doc=d(2026, 6, 24), start=d(2026, 9, 1), end=d(2027, 8, 31), expiry=d(2026, 8, 31), deadline=d(2026, 7, 17), pay=None,
         fixed=2_800_000_000, attr=3_500_000_000, rate=None, perf_assumed=5.0, gmv=4_100_000_000, aov=125_000, retrate=0.131, cogs=0.14, fee=0.14, ship=3_000, retunit=3_700, fee_type='혼합 피', g300='미확정', prev_no='CT-INF-2025-001',
         scenario='원본 통보서(inf001_exclusive_contract_notice)와 같은 조건: 연 28억 고정 피 + 성과 피, 통보 기한 7/17, 성과 피 비율·지급일 미확인 → CEO/이사회(10억 초과)',
         purpose='혜인(INF-001) 연간 전속계약의 갱신 통보가 도래했어요. 소속 에이전시 통보서 기준으로 현 계약은 2026-08-31 만료, 통보 기한은 2026-07-17이에요.',
         consequence='7/17까지 해지·조건 변경을 통보하지 않으면 동일 조건(고정 피 연 28억)으로 1년 자동 갱신되고, 갱신 후 중도 해지 시 잔여 고정 피의 50%가 위약금이에요.',
         alt='조건 변경(고정 피 축소·성과 피 확대 전환), 1년 미갱신, 갱신 — 기존 실질 공헌이익이 10명 중 10위(−61,308,789원)라 현 조건 유지는 근거가 약해요.',
         risk='고정 피 28억은 성과와 무관하게 발생하고 향후 1년 배분을 선점해요. 캠페인 확대 기안(혜인 3건)의 확정기한도 같은 날이에요.',
         missing=[('성과 피 비율 · 성과 조건 — 인플루언서 총비용 판단', '마케팅', d(2026, 7, 6), '회신 대기'), ('고정 피 지급 예정일', '마케팅', d(2026, 7, 6), '회신 대기'), ('그룹 300억 배분 대상 여부', '재무', d(2026, 7, 8), '회신 대기')],
         fee_fixed_year='미확인', exclusive='색조·기초', penalty=50, auto_renew=True, bundle=None)

contract('T16', ref='INF-003', infl='INF-003', renew='갱신', writer=1, doc=d(2026, 6, 29), start=d(2026, 10, 1), end=d(2027, 9, 30), expiry=d(2026, 9, 30), deadline=d(2026, 7, 22), pay=d(2026, 9, 15),
         fixed=800_000_000, attr=0, rate=None, gmv=1_900_000_000, aov=103_000, retrate=0.095, cogs=0.15, fee=0.14, ship=3_300, retunit=4_100, fee_type='고정 피', g300='대상 아님', prev_no='CT-INF-2025-003',
         scenario='연 8억(10억 이하) · 지급일 구간 밖 → Masil 대표 (고정 피 계약)',
         purpose='토모카(INF-003) 연간 전속계약 갱신이에요. 현 계약은 2026-09-30 만료이고 통보 기한은 7/22예요.',
         consequence='7/22까지 통보하지 않으면 동일 조건으로 1년 자동 갱신되고 갱신 후 중도 해지 시 잔여 고정 피의 50%가 위약금이에요.',
         alt='고정 피를 7억으로 낮추는 협상안, 성과 피 혼합 전환안, 미갱신. 실적(2위)은 양호해 협상안을 추천해요.',
         risk='일본 환율 변동, 기존 캠페인 반품률 9~10%', missing=[('고정 피 인하 협상안에 대한 에이전시 회신', '마케팅', d(2026, 7, 14), '회신 대기')],
         fee_fixed_year='', exclusive='색조·기초', penalty=50, auto_renew=True, bundle=None)

contract('T17', ref='INF-005', infl='INF-005', renew='갱신', writer=2, doc=d(2026, 6, 29), start=d(2026, 10, 1), end=d(2027, 9, 30), expiry=d(2026, 9, 30), deadline=d(2026, 7, 23), pay=d(2026, 9, 20),
         fixed=900_000_000, attr=1_250_000_000, rate=8.0, gmv=1_320_000_000, aov=110_000, retrate=0.120, cogs=0.14, fee=0.14, ship=3_300, retunit=4_100, fee_type='혼합 피', g300='대상 아님', prev_no='CT-INF-2025-005',
         scenario='연 계약금액 합계(고정 9억 + 성과 1억)가 정확히 10억 — "10억 초과"가 아니므로 Masil 대표 (경계값) · 기존 실적은 하위(9위)',
         purpose='Ava Glow(INF-005) 연간 전속계약 갱신이에요. 고정 피 연 9억 원과 연 예상 성과 피 1억 원을 합한 연 계약금액이 정확히 10억 원이에요.',
         consequence='7/23까지 통보하지 않으면 동일 조건으로 자동 갱신이에요.', alt='고정 피를 5억으로 낮추고 성과 피 비중을 늘리는 안, 미갱신. 기존 실질 공헌이익이 −36,162,212원(9위)이라 조건 변경을 권해요.',
         risk='광고비 비중 22.1%(2위)인데 공헌이익은 9위 — 배분과 성과가 반대 방향', missing=[('고정 피 인하안에 대한 에이전시 회신', '마케팅', d(2026, 7, 13), '회신 대기')],
         fee_fixed_year='', exclusive='선케어·기초', penalty=50, auto_renew=True, bundle=None)

contract('T18', ref='INF-007', infl='INF-007', renew='갱신', writer=3, doc=d(2026, 6, 29), start=d(2026, 10, 1), end=d(2027, 9, 30), expiry=d(2026, 9, 30), deadline=d(2026, 7, 23), pay=d(2026, 9, 20),
         fixed=1_010_000_000, attr=0, rate=None, gmv=2_250_000_000, aov=94_000, retrate=0.114, cogs=0.16, fee=0.12, ship=3_300, retunit=4_100, fee_type='고정 피', g300='대상 아님', prev_no='CT-INF-2025-007',
         scenario='연 10억 + 1천만 원 → "10억 초과" → CEO/이사회 (경계값)',
         purpose='Lila SEA(INF-007) 연간 전속계약 갱신이에요. 고정 피가 연 10억 1천만 원이에요.',
         consequence='7/23까지 통보하지 않으면 동일 조건으로 자동 갱신(체결로 간주)이에요.', alt='1천만 원만 줄이면 10억 이하(Masil 대표) — 인상분 1천만 원이 물가 연동 조항인지 에이전시에 확인',
         risk='동남아 물류 지연·반품률 11%대', missing=[('인상분 1천만 원의 근거 (물가 연동 조항인지)', '마케팅', d(2026, 7, 10), '회신 대기')],
         fee_fixed_year='', exclusive='선케어·더마', penalty=50, auto_renew=True, bundle=None)

contract('T19', ref='INF-006', infl='INF-006', renew='갱신', writer=0, doc=d(2026, 6, 30), start=d(2026, 11, 1), end=d(2027, 10, 31), expiry=d(2026, 10, 31), deadline=d(2026, 8, 3), pay=d(2026, 10, 5),
         fixed=0, attr=4_500_000_000, rate=8.0, gmv=4_500_000_000, aov=88_000, retrate=0.035, cogs=0.20, fee=0.12, ship=3_200, retunit=4_000, fee_type='성과 피', g300='대상 아님', prev_no='CT-INF-2025-006',
         scenario='성과 피 계약(고정 피 없음): 연 예상 성과 피 3.6억 → Masil 대표, 성과 양호(4위)',
         purpose='Mia Skin(INF-006)은 성과 피 방식 계약이에요. 갱신 통보 기한이 8/3이에요.',
         consequence='8/3까지 통보하지 않으면 동일 조건으로 1년 자동 갱신이에요 (고정 피가 없어 위약금 위험은 낮아요).', alt='성과 피 비율 8% → 7%로 낮추는 협상안',
         risk='환불 건 공제 방식과 정산 주기', missing=[('환불 건 성과 피 공제 방식 확인', '계약 담당', d(2026, 7, 15), '회신 대기')],
         fee_fixed_year='', exclusive='색조·선케어', penalty=0, auto_renew=True, bundle=None)

contract('T20', ref='INF-010', infl='INF-010', renew='갱신', writer=1, doc=d(2026, 6, 30), start=d(2026, 10, 1), end=d(2027, 9, 30), expiry=d(2026, 9, 30), deadline=d(2026, 7, 25), pay=d(2026, 8, 14),
         fixed=450_000_000, attr=1_800_000_000, rate=5.0, gmv=2_100_000_000, aov=77_000, retrate=0.054, cogs=0.22, fee=0.04, ship=3_000, retunit=3_900, fee_type='혼합 피', g300='대상 아님', prev_no='CT-INF-2025-010',
         scenario='고정 4.5억 + 성과 0.9억 = 5.4억 (10억 이하)이지만 고정 피 지급일 8/14가 하회 구간 안 → CEO/이사회',
         purpose='코코라운지(INF-010) 혼합 피 계약 갱신이에요. 고정 피를 갱신 직후 8/14에 선급하는 조건이에요.',
         consequence='7/25까지 통보하지 않으면 동일 조건으로 자동 갱신이에요.', alt='고정 피 선급을 9/1로 늦추면 구간 밖 (인플루언서 동의 필요)',
         risk='선급 고정 피가 하회 구간 현금을 소비', missing=[('고정 피 지급일을 9/1 이후로 늦출 수 있는지', '마케팅', d(2026, 7, 8), '회신 대기')],
         fee_fixed_year='', exclusive='색조·기초', penalty=50, auto_renew=True, bundle=None)

contract('T21', ref='INF-008', infl='INF-008', renew='갱신', writer=2, doc=d(2026, 7, 1), start=d(2026, 9, 1), end=d(2027, 8, 31), expiry=d(2026, 8, 31), deadline=d(2026, 6, 26), pay=d(2026, 9, 10),
         fixed=0, attr=600_000_000, rate=6.0, gmv=600_000_000, aov=62_000, retrate=0.053, cogs=0.24, fee=0.12, ship=3_300, retunit=4_000, fee_type='성과 피', g300='대상 아님', prev_no='CT-INF-2025-008',
         scenario='갱신 통보 기한 경과(6/26): 미통보 → 이미 동일 조건으로 자동 갱신된 것으로 봄(체결로 간주) → 사후 상신 시험',
         purpose='Nara Beauty(INF-008) 성과 피 계약의 갱신 통보 기한(6/26)이 지난 뒤에 발견되어 상신해요.',
         consequence='통보 기한이 지나 동일 조건(성과 피 6%)으로 1년 자동 갱신된 것으로 봐요. 승인 권한을 거치지 않은 체결일 수 있어요.', alt='에이전시와 합의해 갱신 철회 가능한지 확인 (성과 피 계약이라 위약금은 없어요)',
         risk='절차 누락: 통보 기한 관리 담당 지정 필요', missing=[('자동 갱신 철회 가능 여부', '계약 담당', d(2026, 7, 3), '회신 대기')],
         fee_fixed_year='', exclusive='선케어·색조', penalty=0, auto_renew=True, bundle=None)

contract('T22', ref='INF-011', infl='INF-011', renew='신규', writer=3, doc=d(2026, 6, 25), start=d(2026, 10, 1), end=d(2027, 9, 30), expiry=None, deadline=d(2026, 8, 28), pay=d(2027, 1, 15),
         fixed=1_200_000_000, attr=0, rate=None, gmv=2_700_000_000, aov=96_000, retrate=0.065, cogs=0.17, fee=0.14, ship=3_200, retunit=4_000, fee_type='고정 피', g300='대상', prev_no='',
         scenario='신규 체결 + 연 12억(10억 초과) + 그룹 300억 대상 → CEO/이사회 · 기존 실적 없음(추정값만으로 비교)',
         purpose='일본 TikTok 대형 인플루언서 Sora Mint(INF-011, 신규)와 첫 연간 전속계약을 체결하려는 안이에요. 일본 시장 신규 유입이 목적이에요.',
         consequence='8/28까지 결정하지 않으면 경쟁 브랜드가 먼저 전속 계약을 맺을 가능성이 높아요 (확정 기한은 상대방이 제시).', alt='연 8억 + 성과 피 4% 혼합 제안, 6개월 시범 계약, 미진행',
         risk='기존 성과 자료가 없어 추정에만 의존. 일본 환율·반품률', missing=[('인플루언서 채널 성과 자료 검증 (팔로워 · 참여율)', '마케팅', d(2026, 7, 15), '회신 대기')],
         fee_fixed_year='', exclusive='색조·기초', penalty=50, auto_renew=False, bundle=None)

contract('T23', ref='INF-012', infl='INF-012', renew='신규', writer=0, doc=d(2026, 6, 30), start=d(2026, 7, 15), end=d(2027, 7, 14), expiry=None, deadline=d(2026, 7, 4), pay=d(2026, 7, 15),
         fixed=200_000_000, attr=0, rate=None, gmv=800_000_000, aov=79_000, retrate=0.045, cogs=0.22, fee=0.04, ship=3_000, retunit=3_800, fee_type='고정 피', g300='대상 아님', prev_no='',
         scenario='신규 소액(연 2억) · 체결 기한 3일 전 · 지급일 7/15(구간 시작 전) → Masil 대표',
         purpose='국내 YouTube 중형 인플루언서 다온(INF-012)과의 신규 전속계약이에요. 체결 기한이 7/4로 얼마 남지 않았어요.',
         consequence='7/4 이후 상대방이 다른 브랜드 제안을 수락할 수 있어요.', alt='6개월 시범 계약(1억)', risk='기존 성과 자료 없음',
         missing=[('채널 성과 자료 (최근 6개월 조회수 · 전환)', '마케팅', d(2026, 7, 3), '회신 대기')],
         fee_fixed_year='', exclusive='기초', penalty=50, auto_renew=False, bundle=None)

contract('T24', ref='INF-002', infl='INF-002', renew='갱신', writer=1, doc=d(2026, 6, 29), start=d(2026, 11, 1), end=d(2027, 10, 31), expiry=d(2026, 10, 31), deadline=d(2026, 8, 10), pay=d(2026, 11, 5),
         fixed=0, attr=4_000_000_000, rate=6.0, gmv=4_000_000_000, aov=84_000, retrate=0.037, cogs=0.20, fee=0.04, ship=3_100, retunit=3_800, fee_type='성과 피', g300='대상 아님', prev_no='CT-INF-2025-002',
         scenario='성과 피 계약(연 예상 성과 피 2.4억) · 실질 공헌이익 1위 — 승인 기대 안건 → Masil 대표',
         purpose='초혜핏(INF-002)은 실질 공헌이익 1위, 광고비 비중은 2.4%에 그쳐요. 성과 피 계약 갱신을 요청해요.',
         consequence='8/10까지 통보하지 않으면 동일 조건으로 자동 갱신이에요.', alt='성과 피 비율 6% → 7%로 인상하는 대신 전속 범위 확대 제안',
         risk='성과가 좋은데 배분이 적어 오히려 확대 여지가 있음', missing=[('없음', '-', None, '-')],
         fee_fixed_year='', exclusive='색조·선케어', penalty=0, auto_renew=True, bundle=None)
