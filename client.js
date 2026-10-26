// dsh-booth-search — 客户端视图
// 在会话标题栏的「对话 / 轨迹 / 上下文 / 画廊 / BOOTH / 编队」这一排里注册一个 BOOTH 视图。
// 视图内分两页：搜索（原有）与选购台（性别 → 风格 → 素体 → 衣服 → 饰品 → 汇总）。
// 数据走宿主侧 /api/booth-search/* 的 JSON 接口，图片走同源代理，避免防盗链。
// 关键词只收中文：转日文发生在宿主侧，日文串不回传前端。

window.__ModuleLoader__.load({
  id: 'dsh-booth-search',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const KIND_OPTIONS = [
      ['auto', '全部分类'],
      ['clothing', '衣装'],
      ['shader', '着色器'],
      ['base_model', '素体'],
      ['accessory', '配饰'],
      ['texture', '贴图'],
      ['animation', '动画'],
      ['prop', '小物'],
    ]
    const SORT_OPTIONS = [
      ['recommended', '相关度'],
      ['newest', '最新'],
      ['price_asc', '价格↑'],
      ['price_desc', '价格↓'],
    ]
    const PAGE_SIZE = 24

    const COLORS = {
      text: 'var(--dsw-alias-label-primary)',
      sub: 'var(--dsw-alias-label-secondary)',
      border: 'var(--dsw-alias-border-l1)',
      borderStrong: 'var(--dsw-alias-border-l2)',
      layer: 'var(--dsw-alias-bg-layer-1)',
      layer2: 'var(--dsw-alias-bg-layer-2)',
      brand: 'var(--dsw-alias-brand-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
      brandSoft: 'var(--dsw-alias-brand-primary-soft, color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent))',
      brandBorder: 'var(--dsw-alias-brand-primary-border, color-mix(in srgb, var(--dsw-alias-brand-primary) 38%, transparent))',
      brandText: 'var(--dsw-alias-brand-primary)',
    }

    function imageProxy(src) {
      return 'api/booth-search/image?src=' + encodeURIComponent(src || '')
    }

    async function getJson(path) {
      const response = await fetch(path, { headers: { accept: 'application/json' } })
      let payload = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (!response.ok || !payload || payload.ok !== true) {
        throw new Error((payload && payload.error) || ('请求失败：HTTP ' + response.status))
      }
      return payload
    }

    const s = {
      root: { display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, padding: '16px 20px 16px', boxSizing: 'border-box', color: COLORS.text },
      toolbar: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
      input: { flex: '1 1 240px', minWidth: 160, height: 34, padding: '0 12px', borderRadius: 8, border: '1px solid ' + COLORS.border, background: COLORS.layer, color: COLORS.text, fontSize: 14, outline: 'none' },
      select: { height: 34, padding: '0 8px', borderRadius: 8, border: '1px solid ' + COLORS.border, background: COLORS.layer, color: COLORS.text, fontSize: 13 },
      button: { height: 34, padding: '0 16px', borderRadius: 8, border: '1px solid transparent', background: COLORS.brand, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
      body: { display: 'flex', alignItems: 'flex-start', gap: 16, flex: 1, minHeight: 0 },
      grid: { flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))', gap: 12, alignContent: 'start', paddingRight: 4 },
      card: { display: 'flex', flexDirection: 'column', gap: 6, border: '1px solid ' + COLORS.border, borderRadius: 10, background: COLORS.layer, padding: 8, cursor: 'pointer', textAlign: 'left', color: 'inherit' },
      cardActive: { borderColor: COLORS.brand, boxShadow: '0 0 0 1px ' + COLORS.brand + ' inset' },
      coverWrap: { position: 'relative', display: 'block' },
      cover: { width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 6, background: COLORS.layer2, display: 'block' },
      tick: { position: 'absolute', top: 5, right: 5, width: 20, height: 20, borderRadius: 10, background: COLORS.brand, color: '#fff', fontSize: 12, lineHeight: '20px', textAlign: 'center', fontWeight: 700 },
      pickRow: { display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 },
      pickBtn: { flex: 1, height: 28, borderRadius: 7, border: '1px solid transparent', background: COLORS.brand, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
      pickBtnOn: { flex: 1, height: 28, borderRadius: 7, border: '1px solid ' + COLORS.brand, background: 'transparent', color: COLORS.brand, fontSize: 12, fontWeight: 600, cursor: 'pointer' },
      pickBtnGhost: { height: 28, padding: '0 10px', borderRadius: 7, border: '1px solid ' + COLORS.border, background: COLORS.layer2, color: COLORS.text, fontSize: 12, cursor: 'pointer' },
      drawer: {
        position: 'sticky', top: 12, alignSelf: 'flex-start',
        flex: '0 0 340px', width: 340, maxHeight: 'calc(100vh - 210px)', overflowY: 'auto',
        display: 'flex', flexDirection: 'column', gap: 10, boxSizing: 'border-box',
        paddingLeft: 16, borderLeft: '1px solid ' + COLORS.border,
      },
      drawerCover: { width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 10, background: COLORS.layer2 },
      drawerBtns: { display: 'flex', gap: 8, marginTop: 4 },
      supportYes: { padding: '6px 10px', borderRadius: 8, background: 'rgba(34,160,90,0.12)', border: '1px solid rgba(34,160,90,0.4)', color: '#1e8a4f', fontSize: 12.5 },
      supportNo: { padding: '6px 10px', borderRadius: 8, background: 'rgba(220,70,70,0.10)', border: '1px solid rgba(220,70,70,0.38)', color: '#c33', fontSize: 12.5 },
      supportUnknown: { padding: '6px 10px', borderRadius: 8, background: COLORS.layer2, border: '1px solid ' + COLORS.border, color: COLORS.sub, fontSize: 12.5 },
      cardTitle: { fontSize: 12.5, lineHeight: '17px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 34 },
      price: { fontSize: 13, fontWeight: 700, color: COLORS.brand },
      shop: { fontSize: 11.5, color: COLORS.sub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      // 详情在右侧栏并用 sticky 吸顶：页面滚轮滚的是商品列表，详情固定不动、始终可见。
      side: {
        position: 'sticky', top: 12, alignSelf: 'flex-start',
        flex: '0 0 340px', width: 340, maxHeight: 'calc(100vh - 170px)', overflowY: 'auto',
        display: 'flex', flexDirection: 'column', gap: 10, boxSizing: 'border-box',
        paddingLeft: 16, borderLeft: '1px solid ' + COLORS.border,
      },
      sideHead: { display: 'flex', alignItems: 'flex-start', gap: 8 },
      close: { marginLeft: 'auto', flex: '0 0 auto', width: 26, height: 26, borderRadius: 8, border: '1px solid ' + COLORS.border, background: COLORS.layer, color: COLORS.sub, fontSize: 13, lineHeight: '22px', textAlign: 'center', cursor: 'pointer', padding: 0 },
      detailCover: { width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 10, background: COLORS.layer2 },
      detailTitle: { fontSize: 15, lineHeight: '21px', fontWeight: 600, margin: 0, flex: 1 },
      meta: { fontSize: 12, color: COLORS.sub, lineHeight: '18px', whiteSpace: 'pre-wrap' },
      desc: { fontSize: 12.5, lineHeight: '20px', whiteSpace: 'pre-wrap', color: COLORS.text, opacity: 0.9 },
      link: { display: 'inline-block', textAlign: 'center', padding: '8px 14px', borderRadius: 8, background: COLORS.layer2, color: COLORS.text, fontSize: 13, textDecoration: 'none', border: '1px solid ' + COLORS.borderStrong },
      hint: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: COLORS.sub, fontSize: 13, textAlign: 'center' },
      status: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: COLORS.sub, minHeight: 18 },
      error: { fontSize: 12.5, color: COLORS.error },
      count: { marginLeft: 'auto' },
      clear: { height: 34, padding: '0 10px', borderRadius: 8, border: '1px solid ' + COLORS.border, background: 'transparent', color: COLORS.sub, fontSize: 12, cursor: 'pointer' },
      pager: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 2 },
      pageBtn: { height: 30, minWidth: 72, padding: '0 12px', borderRadius: 8, border: '1px solid ' + COLORS.border, background: COLORS.layer, color: COLORS.text, fontSize: 12.5, cursor: 'pointer' },
      pageBtnOff: { height: 30, minWidth: 72, padding: '0 12px', borderRadius: 8, border: '1px solid ' + COLORS.border, background: 'transparent', color: COLORS.sub, fontSize: 12.5, cursor: 'default', opacity: 0.5 },
      pageLabel: { fontSize: 12.5, color: COLORS.sub, minWidth: 64, textAlign: 'center' },
      // ---- 选购台
      tabs: { display: 'flex', gap: 8, alignItems: 'center', paddingBottom: 8, borderBottom: '1px solid ' + COLORS.border },
      tab: { height: 30, padding: '0 16px', borderRadius: 8, border: '1px solid ' + COLORS.border, background: 'transparent', color: COLORS.sub, fontSize: 13, cursor: 'pointer' },
      tabOn: { height: 30, padding: '0 16px', borderRadius: 8, border: '1px solid ' + COLORS.brand, background: COLORS.brand, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
      steps: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', fontSize: 12, color: COLORS.sub },
      stepChip: { padding: '3px 10px', borderRadius: 99, border: '1px solid ' + COLORS.border, color: COLORS.sub },
      stepChipOn: { padding: '3px 10px', borderRadius: 99, border: '1px solid ' + COLORS.brand, background: COLORS.brand, color: '#fff', fontWeight: 600 },
      stepChipDone: { padding: '3px 10px', borderRadius: 99, border: '1px solid ' + COLORS.border, background: COLORS.layer2, color: COLORS.text },
      question: { fontSize: 16, fontWeight: 600, margin: '2px 0 0' },
      questionSub: { fontSize: 12.5, color: COLORS.sub, margin: 0 },
      bigOpts: { display: 'flex', flexWrap: 'wrap', gap: 12, paddingTop: 4 },
      bigOpt: { display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start', minWidth: 172, padding: '16px 20px', borderRadius: 12, border: '1px solid ' + COLORS.border, background: COLORS.layer, color: 'inherit', cursor: 'pointer', textAlign: 'left' },
      bigOptOn: { display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start', minWidth: 172, padding: '16px 20px', borderRadius: 12, border: '1px solid ' + COLORS.brand, boxShadow: '0 0 0 1px ' + COLORS.brand + ' inset', background: COLORS.layer, color: 'inherit', cursor: 'pointer', textAlign: 'left' },
      bigTitle: { fontSize: 15, fontWeight: 600 },
      bigNote: { fontSize: 12, color: COLORS.sub },
      groupTitle: { fontSize: 12.5, fontWeight: 600, color: COLORS.sub, paddingTop: 6 },
      chips: { display: 'flex', flexWrap: 'wrap', gap: 8, paddingTop: 6 },
      chip: { padding: '7px 15px', borderRadius: 99, border: '1px solid ' + COLORS.border, background: COLORS.layer, color: COLORS.text, fontSize: 13, cursor: 'pointer' },
      chipOn: { padding: '7px 15px', borderRadius: 99, border: '1px solid ' + COLORS.brand, background: COLORS.brand, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
      navBar: { display: 'flex', alignItems: 'center', gap: 10, paddingTop: 6 },
      stepRow: { display: 'flex', alignItems: 'flex-start', gap: 16, flex: 1, minHeight: 0 },
      stepMain: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 },
      navBtn: { height: 32, padding: '0 16px', borderRadius: 8, border: '1px solid ' + COLORS.border, background: COLORS.layer, color: COLORS.text, fontSize: 13, cursor: 'pointer' },
      navBtnOn: { height: 32, padding: '0 16px', borderRadius: 8, border: '1px solid transparent', background: COLORS.brand, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
      pickedChip: { padding: '2px 9px', borderRadius: 99, background: COLORS.layer2, fontSize: 11.5, color: COLORS.text },
      remind: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '8px 12px', borderRadius: 10, background: COLORS.brandSoft, border: '1px solid ' + COLORS.brandBorder },
      remindLabel: { fontSize: 12, fontWeight: 700, color: COLORS.brandText },
      remindChip: { padding: '3px 10px', borderRadius: 99, background: '#fff', border: '1px solid ' + COLORS.brandBorder, fontSize: 12, color: COLORS.brandText },
      remindBtn: { marginLeft: 'auto', padding: '3px 12px', borderRadius: 99, border: '1px solid ' + COLORS.brandBorder, background: '#fff', color: COLORS.brandText, fontSize: 12, cursor: 'pointer' },
      sumGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12, alignContent: 'start' },
      sumCard: { display: 'flex', flexDirection: 'column', gap: 6, border: '1px solid ' + COLORS.border, borderRadius: 10, background: COLORS.layer, padding: 8, textAlign: 'left', color: 'inherit' },
    }

    function Card({ item, active, onSelect }) {
      return h('button', {
        type: 'button',
        style: active ? Object.assign({}, s.card, s.cardActive) : s.card,
        onClick: () => onSelect(item),
        title: item.title,
      },
        item.image
          ? h('img', { style: s.cover, src: imageProxy(item.image), alt: '', loading: 'lazy' })
          : h('div', { style: s.cover }),
        h('div', { style: s.cardTitle }, item.title || '(无标题)'),
        h('div', { style: s.price }, item.priceLabel || '价格待查'),
        h('div', { style: s.shop }, item.shop || '未知店铺'),
      )
    }

    function PickCard({ item, picked, onOpen, onOpenExternal }) {
      return h('div', {
        style: picked ? Object.assign({}, s.card, s.cardActive) : s.card,
        onDoubleClick: () => onOpen(item),
        onClick: () => onOpen(item),
        title: '点击查看详情：' + (item.title || ''),
      },
        h('div', { style: s.coverWrap },
          item.image
            ? h('img', { style: s.cover, src: imageProxy(item.image), alt: '', loading: 'lazy' })
            : h('div', { style: s.cover }),
          picked ? h('span', { style: s.tick }, '✓') : null,
        ),
        h('div', { style: s.cardTitle }, item.title || '(无标题)'),
        h('div', { style: s.price }, item.priceLabel || '价格待查'),
        h('div', { style: s.shop }, item.shop || '未知店铺'),
        h('div', { style: s.pickRow },
          h('button', {
            type: 'button',
            style: s.pickBtn,
            onClick: event => { event.stopPropagation(); onOpen(item) },
          }, '详情'),
          h('button', {
            type: 'button',
            style: s.pickBtnGhost,
            onClick: event => { event.stopPropagation(); onOpenExternal(item) },
          }, 'BOOTH'),
        ),
      )
    }

    function Detail({ item, detail, loading, onClose }) {
      return h('aside', { style: s.side, 'aria-label': '商品详情' },
        h('div', { style: s.sideHead },
          h('h3', { style: s.detailTitle }, item.title || '(无标题)'),
          h('button', { type: 'button', style: s.close, onClick: onClose, title: '关闭详情' }, '×'),
        ),
        item.image ? h('img', { style: s.detailCover, src: imageProxy(item.image), alt: '' }) : null,
        h('div', { style: s.meta }, [item.priceLabel, item.shop].filter(Boolean).join(' ｜ ') || '价格/店铺待查'),
        h('div', { style: s.meta }, '商品编号：' + item.id),
        loading
          ? h('div', { style: s.meta }, '简介加载中…')
          : (detail && detail.description ? h('div', { style: s.desc }, detail.description) : h('div', { style: s.meta }, detail ? '这个商品没有简介。' : '简介加载失败。')),
        h('a', { style: s.link, href: item.url, target: '_blank', rel: 'noreferrer' }, '在 BOOTH 打开这件商品'),
      )
    }

    function WizardDrawer({ item, data, loading, picked, avatarName, checkSupport, onAdd, onOpenExternal, onClose }) {
      const support = data ? data.support : 'unknown'
      const matched = (data && data.avatarName) || avatarName || ''
      const list = (data && Array.isArray(data.supported)) ? data.supported : []
      let badge = null
      if (!checkSupport) {
        badge = null
      } else if (!avatarName && !(data && data.avatarName)) {
        badge = h('div', { style: s.supportUnknown }, '还没选素体，适配情况不知道')
      } else if (loading) {
        badge = h('div', { style: s.supportUnknown }, '正在核对是否适配「' + avatarName + '」…')
      } else if (support === 'yes') {
        badge = h('div', { style: s.supportYes }, '✓ 适配名单里有「' + matched + '」')
      } else if (support === 'no' && list.length > 0) {
        badge = h('div', { style: s.supportNo }, '✗ 适配名单（' + list.length + ' 个）里没有当前素体')
      } else {
        badge = h('div', { style: s.supportUnknown }, '? 这件商品页没解析出适配名单，只能点「去 BOOTH」自己确认')
      }
      const listLine = list.length === 0
        ? null
        : h('div', { style: s.meta },
            '适配名单 ' + list.length + ' 个：' +
            list.slice(0, 6).map(entry => entry.name || ('#' + entry.id)).join(' / ') +
            (list.length > 6 ? ' 等' : ''),
          )
      const description = data && data.item && data.item.descriptionFull
        ? data.item.descriptionFull
        : (data && data.item && data.item.description) || ''
      return h('aside', { style: s.drawer, 'aria-label': '商品详情' },
        h('div', { style: s.sideHead },
          h('h3', { style: s.detailTitle }, item.title || '(无标题)'),
          h('button', { type: 'button', style: s.close, onClick: onClose, title: '关闭详情' }, '×'),
        ),
        item.image ? h('img', { style: s.drawerCover, src: imageProxy(item.image), alt: '' }) : null,
        h('div', { style: s.meta }, [item.priceLabel, item.shop].filter(Boolean).join(' ｜ ') || '价格/店铺待查'),
        h('div', { style: s.meta }, '商品编号：' + item.id),
        badge,
        listLine,
        h('div', { style: s.drawerBtns },
          h('button', { type: 'button', style: picked ? s.pickBtnOn : s.pickBtn, onClick: () => onAdd(item) }, picked ? '已加入 ✓（再点移除）' : '加入选购'),
          h('button', { type: 'button', style: s.pickBtnGhost, onClick: () => onOpenExternal(item) }, '去 BOOTH ↗'),
        ),
        loading
          ? h('div', { style: s.meta }, '简介加载中…')
          : (description ? h('div', { style: s.desc }, description) : h('div', { style: s.meta }, '这个商品没有简介。')),
      )
    }

    function Pager({ page, busy, canNext, onFlip }) {
      return h('div', { style: s.pager },
        page > 1
          ? h('button', { type: 'button', style: s.pageBtn, onClick: () => onFlip(-1), disabled: busy }, '← 上一页')
          : h('button', { type: 'button', style: s.pageBtnOff, disabled: true }, '← 上一页'),
        h('span', { style: s.pageLabel }, '第 ' + page + ' 页'),
        h('button', { type: 'button', style: s.pageBtn, onClick: () => onFlip(1), disabled: busy || !canNext }, '下一页 →'),
      )
    }

    // ---------------------------------------------------------------- 搜索页
    function SearchPanel() {
      const [query, setQuery] = useState('')
      const [kind, setKind] = useState('auto')
      const [sort, setSort] = useState('recommended')
      const [page, setPage] = useState(1)
      const [items, setItems] = useState([])
      const [total, setTotal] = useState(0)
      const [translated, setTranslated] = useState(false)
      const [mode, setMode] = useState('ranking')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [selected, setSelected] = useState(null)
      const [detail, setDetail] = useState(null)
      const [detailBusy, setDetailBusy] = useState(false)
      const searchedRef = useRef(false)

      const runSearch = useCallback(async (q, k, st, pg) => {
        const text = String(q == null ? query : q).trim()
        const targetPage = Number.isFinite(Number(pg)) && Number(pg) > 0 ? Math.trunc(Number(pg)) : 1
        setBusy(true)
        setError('')
        try {
          const params = new URLSearchParams({ q: text, kind: k == null ? kind : k, sort: st == null ? sort : st, page: String(targetPage), limit: String(PAGE_SIZE) })
          const payload = await getJson('api/booth-search/search?' + params.toString())
          setItems(Array.isArray(payload.results) ? payload.results : [])
          setTotal(Number(payload.totalOnPage) || 0)
          setTranslated(payload.queryTranslated === true)
          setMode(payload.mode === 'search' ? 'search' : 'ranking')
          setPage(targetPage)
          setSelected(null)
          setDetail(null)
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
          setItems([])
        } finally {
          setBusy(false)
        }
      }, [query, kind, sort])

      useEffect(() => {
        if (!searchedRef.current) {
          searchedRef.current = true
          runSearch('', 'auto', 'recommended', 1)
        }
      }, [runSearch])

      useEffect(() => {
        if (!selected) {
          return undefined
        }
        let alive = true
        setDetailBusy(true)
        setDetail(null)
        getJson('api/booth-search/item?id=' + encodeURIComponent(selected.id))
          .then(payload => { if (alive) setDetail(payload.item || null) })
          .catch(err => { if (alive) setError(err && err.message ? err.message : String(err)) })
          .finally(() => { if (alive) setDetailBusy(false) })
        return () => { alive = false }
      }, [selected])

      const onSubmit = event => {
        event.preventDefault()
        runSearch(query, kind, sort, 1)
      }

      const flip = delta => {
        if (busy) {
          return
        }
        const next = page + delta
        if (next < 1) {
          return
        }
        runSearch(query, kind, sort, next)
      }

      return h('div', { style: Object.assign({}, s.root, { padding: 0, flex: 1 }) },
        h('form', { style: s.toolbar, onSubmit },
          h('input', {
            style: s.input,
            value: query,
            placeholder: '中文关键词（留空 + 选分类 = 按分类搜；都留空 = 热销榜）',
            onChange: e => setQuery(e.target.value),
            'aria-label': 'BOOTH 关键词',
          }),
          h('select', {
            style: s.select,
            value: kind,
            onChange: e => { setKind(e.target.value); runSearch(query, e.target.value, sort, 1) },
            'aria-label': '分类',
          },
            KIND_OPTIONS.map(([value, label]) => h('option', { key: value, value }, label))
          ),
          h('select', { style: s.select, value: sort, onChange: e => setSort(e.target.value), 'aria-label': '排序' },
            SORT_OPTIONS.map(([value, label]) => h('option', { key: value, value }, label))
          ),
          h('button', { type: 'submit', style: s.button, disabled: busy }, busy ? '搜索中…' : '搜索'),
          mode === 'search' || query !== '' || kind !== 'auto' || sort !== 'recommended'
            ? h('button', { type: 'button', style: s.clear, onClick: () => { setQuery(''); setKind('auto'); setSort('recommended'); runSearch('', 'auto', 'recommended', 1) } }, '回热销榜')
            : null,
        ),
        h('div', { style: s.status },
          error
            ? h('span', { style: s.error }, error)
            : (total > 0
                ? (mode === 'ranking'
                    ? 'BOOTH 热销榜 · 第 ' + page + ' 页 · 显示 ' + items.length + ' 件'
                    : (query === ''
                        ? '分类「' + (KIND_OPTIONS.find(([value]) => value === kind) || ['', ''])[1] + '」 · 第 ' + page + ' 页 · 显示 ' + items.length + ' 件'
                        : '第 ' + page + ' 页 · 显示 ' + items.length + ' 件' + (total > items.length ? '（本页共 ' + total + ' 件）' : '') + (translated ? '（中文关键词已自动转日文检索）' : '')))
                : (busy ? '加载中…' : '输入中文关键词后回车搜索，或直接翻看热销榜')),
          items.length > 0 ? h('span', { style: s.count }, '封面来自 BOOTH 商品页') : null,
        ),
        h('div', { style: s.body, flex: 1 },
          items.length === 0
            ? h('div', { style: s.hint },
                h('div', { style: { fontSize: 15, fontWeight: 600, color: COLORS.text } }, '在 BOOTH 里找 Avatar 素材'),
                h('div', null, '直接打中文就行，比如：水手服 ｜ 女仆装 ｜ 猫耳 ｜ 着色器 ｜ 素体'),
              )
            : h('div', { style: s.grid },
                items.map(item => h(Card, { key: item.id, item, active: selected && selected.id === item.id, onSelect: setSelected }))
              ),
          selected ? h(Detail, { item: selected, detail, loading: detailBusy, onClose: () => { setSelected(null); setDetail(null) } }) : null,
        ),
        h(Pager, { page, busy, canNext: items.length > 0, onFlip: flip }),
      )
    }

    // ---------------------------------------------------------------- 选购台
    const WIZARD_STEPS = ['性别', '风格', '素体', '衣服', '饰品', '汇总']

    function WizardPanel() {
      const [step, setStep] = useState(0)
      const [meta, setMeta] = useState(null)
      const [metaError, setMetaError] = useState('')
      const [gender, setGender] = useState('')
      const [styles, setStyles] = useState([])
      const style = styles.join(',')
      const [detailItem, setDetailItem] = useState(null)
      const [detailData, setDetailData] = useState(null)
      const [detailBusy, setDetailBusy] = useState(false)
      const [accKind, setAccKind] = useState('accessory')
      const [sort, setSort] = useState('popular')
      const [page, setPage] = useState(1)
      const [items, setItems] = useState([])
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      // 多选：每个分类各自一份，选中的是完整商品对象，汇总页直接复用。
      const [picks, setPicks] = useState({ base_model: [], clothing: [], accessory: [], prop: [] })

      const kind = step === 2 ? 'base_model' : step === 3 ? 'clothing' : step === 4 ? accKind : ''

      useEffect(() => {
        let alive = true
        getJson('api/booth-search/meta')
          .then(payload => { if (alive) setMeta(payload) })
          .catch(err => { if (alive) setMetaError(err && err.message ? err.message : String(err)) })
        return () => { alive = false }
      }, [])

      const load = useCallback(async (targetStep, targetKind, targetPage) => {
        setBusy(true)
        setError('')
        try {
          const params = new URLSearchParams({ page: String(targetPage), limit: String(PAGE_SIZE), sort })
          if (targetKind) {
            params.set('kind', targetKind)
          }
          if (gender) {
            params.set('gender', gender)
          }
          if (style) {
            params.set('style', style)
          }
          const payload = await getJson('api/booth-search/search?' + params.toString())
          setItems(Array.isArray(payload.results) ? payload.results : [])
          setPage(targetPage)
        } catch (err) {
          setError(err && err.message ? err.message : String(err))
          setItems([])
        } finally {
          setBusy(false)
        }
      }, [gender, style, sort])

      useEffect(() => {
        if (step >= 2 && step <= 4) {
          load(step, kind, page)
        }
      }, [step, kind, page, load])

      const goStep = next => {
        setStep(next)
        setPage(1)
        setItems([])
      }

      const dropKind = item => {
        if (!item || !item.__kind) return item
        const copy = Object.assign({}, item)
        delete copy.__kind
        return copy
      }

      const toggle = item => {
        // 用商品自己所属的大类，而不是「当前在哪一步」——侧栏可能停在上一类的商品上。
        const owner = (item && item.__kind) || kind
        setPicks(prev => {
          const list = prev[owner] || []
          const exists = list.some(x => x.id === item.id)
          // 素体只允许一个：再点一个就替换掉上一个；其余分类都是多选。
          if (owner === 'base_model') {
            return Object.assign({}, prev, { base_model: exists ? [] : [dropKind(item)] })
          }
          return Object.assign({}, prev, { [owner]: exists ? list.filter(x => x.id !== item.id) : list.concat([dropKind(item)]) })
        })
      }

      const fetchDetail = (item, baseItem) => {
        setDetailData(null)
        setDetailBusy(true)
        const base = baseItem !== undefined ? baseItem : (picks.base_model[0] || null)
        const params = new URLSearchParams({ id: item.id })
        if (base) {
          params.set('avatarId', base.id)
          params.set('avatar', base.title || '')
        }
        getJson('api/booth-search/item?' + params.toString())
          .then(payload => setDetailData(payload))
          .catch(() => setDetailData(null))
          .finally(() => setDetailBusy(false))
      }

      const openDetail = item => {
        setDetailItem(Object.assign({}, item, { __kind: kind }))
        fetchDetail(item)
      }

      const openExternal = item => {
        getJson('api/booth-search/open?url=' + encodeURIComponent(item.url)).catch(() => {})
      }

      const counts = ['base_model', 'clothing', 'accessory', 'prop'].map(k => (picks[k] || []).length)
      const pickedTotal = counts.reduce((a, b) => a + b, 0)

      const styleLabels = (() => {
        if (!meta || styles.length === 0) {
          return []
        }
        const out = []
        for (const id of styles) {
          for (const group of meta.styles || []) {
            const hit = group.items.find(x => x.id === id)
            if (hit) {
              out.push(group.label + '：' + hit.label)
              break
            }
          }
        }
        return out
      })()
      const styleLabel = styleLabels.join(' / ')

      const genderLabel = (() => {
        const hit = meta && (meta.genders || []).find(x => x.id === gender)
        return hit ? hit.label : ''
      })()

      const stepBar = h('div', { style: s.steps },
        WIZARD_STEPS.map((label, index) => h('span', {
          key: label,
          style: index === step ? s.stepChipOn : (index < step ? s.stepChipDone : s.stepChip),
        }, (index + 1) + ' ' + label)),
        pickedTotal > 0 ? h('span', { style: s.pickedChip }, '已选 ' + pickedTotal + ' 件') : null,
      )

      if (step === 0) {
        const genders = (meta && meta.genders) || []
        return h('div', { style: Object.assign({}, s.root, { padding: 0, flex: 1, gap: 12 }) },
          stepBar,
          h('div', { style: s.navBar },
            h('button', { type: 'button', style: s.navBtnOn, onClick: () => goStep(1) }, '跳过 →'),
          ),
          h('p', { style: s.question }, '① 先定性别'),
          h('p', { style: s.questionSub }, '它决定后面所有商品的检索范围（BOOTH 没有性别筛选，这里换成日文的「女性/男性アバター」词一起搜）。'),
          metaError ? h('div', { style: s.error }, metaError) : null,
          h('div', { style: s.bigOpts },
            genders.map(g => h('button', {
              key: g.id,
              type: 'button',
              style: gender === g.id ? s.bigOptOn : s.bigOpt,
              onClick: () => { setGender(g.id); goStep(1) },
            },
              h('span', { style: s.bigTitle }, g.label),
              g.id === 'female' ? h('span', { style: s.bigNote }, '素体/衣服池最大') : null,
            )),
            genders.length === 0 ? h('div', { style: s.hint }, metaError ? '选项加载失败' : '加载中…') : null,
          ),
        )
      }

      if (step === 1) {
        const toggleStyle = id => setStyles(prev => (prev.includes(id) ? prev.filter(x => x !== id) : prev.concat([id])))
        return h('div', { style: Object.assign({}, s.root, { padding: 0, flex: 1, gap: 10 }) },
          stepBar,
          h('div', { style: s.navBar },
            h('button', { type: 'button', style: s.navBtn, onClick: () => goStep(0) }, '← 上一步'),
            h('button', { type: 'button', style: s.navBtn, onClick: () => { setStyles([]); goStep(2) } }, '清空并继续 →'),
            h('button', { type: 'button', style: s.navBtnOn, onClick: () => goStep(2) }, '下一步 →'),
          ),
          h('p', { style: s.question }, '② 想要哪种气质 / 题材？'),
          h('p', { style: s.questionSub }, '可多选。衣服/饰品会先按第一个「风格词 + 性别」精确搜一轮，其余词在标题里做优先；素体只做标题优先。'),
          (meta ? meta.styles : []).map(group => h('div', { key: group.id },
            h('div', { style: s.groupTitle }, group.label),
            h('div', { style: s.chips },
              group.items.map(item => h('button', {
                key: item.id,
                type: 'button',
                style: styles.includes(item.id) ? s.chipOn : s.chip,
                onClick: () => toggleStyle(item.id),
              }, item.label)),
            ),
          )),
          !meta && !metaError ? h('div', { style: s.hint }, '加载风格表…') : null,
        )
      }

      if (step >= 2 && step <= 4) {
        const title = step === 2 ? '③ 挑素体' : step === 3 ? '④ 挑衣服' : '⑤ 挑饰品 / 小道具'
        const picked = picks[kind] || []
        const contextLine = [
          '排序：' + ((WIZARD_SORTS_HINT[sort]) || sort),
        ].join(' ｜ ')
        const remindBar = h('div', { style: s.remind },
          h('span', { style: s.remindLabel }, '风格提醒'),
          h('span', { style: s.remindChip }, '性别：' + (genderLabel || '不限')),
          styleLabels.length === 0
            ? h('span', { style: s.remindChip }, '风格：未设')
            : styleLabels.map(label => h('span', { key: label, style: s.remindChip }, label)),
          step >= 3 ? h('span', { style: s.remindChip }, '素体：' + ((picks.base_model || [])[0] ? picks.base_model[0].title.slice(0, 14) : '未选')) : null,
          h('button', { type: 'button', style: s.remindBtn, onClick: () => goStep(1) }, '改风格'),
        )
        return h('div', { style: Object.assign({}, s.root, { padding: 0, flex: 1, gap: 8 }) },
          stepBar,
          h('div', { style: s.navBar },
            h('button', { type: 'button', style: s.navBtn, onClick: () => goStep(step - 1) }, '← 上一步'),
            h('button', { type: 'button', style: s.navBtnOn, onClick: () => goStep(step + 1) }, '下一步 →'),
          ),
          remindBar,
          h('div', { style: s.stepRow },
            h('div', { style: s.stepMain },
              h('p', { style: s.question }, title),
              h('p', { style: s.questionSub }, step === 2
                ? '单选。默认按站内「人气」排（BOOTH 不公开销量，这是它的排序，不等于销量）。'
                : (step === 3
                    ? '可多选。点卡片看详情：右侧会核对这件衣服是否适配你选的素体。'
                    : '可多选。配饰和小道具分开搜，各自选中互不影响。')),
              h('div', { style: s.toolbar },
                h('span', { style: { fontSize: 12, color: COLORS.sub } }, contextLine),
                step === 4
                  ? h('div', { style: { display: 'flex', gap: 6 } },
                      h('button', { type: 'button', style: accKind === 'accessory' ? s.chipOn : s.chip, onClick: () => { setAccKind('accessory'); setPage(1) } }, '配饰'),
                      h('button', { type: 'button', style: accKind === 'prop' ? s.chipOn : s.chip, onClick: () => { setAccKind('prop'); setPage(1) } }, '小道具'),
                    )
                  : null,
                h('select', { style: Object.assign({}, s.select, { marginLeft: 'auto' }), value: sort, onChange: e => { setSort(e.target.value); setPage(1) } },
                  (meta ? meta.sorts : [{ id: 'popular', label: '热销' }]).map(x => h('option', { key: x.id, value: x.id }, x.label)),
                ),
                h('span', { style: s.pickedChip }, '本类已选 ' + picked.length + ' 件'),
              ),
              error ? h('div', { style: s.error }, error) : null,
              h('div', { style: Object.assign({}, s.body, { flex: 1 }) },
                items.length === 0
                  ? h('div', { style: s.hint }, busy ? '加载中…' : '这一页没有结果，换一页或换个风格试试。')
                  : h('div', { style: s.grid },
                      items.map(item => h(PickCard, {
                        key: item.id,
                        item,
                        picked: picked.some(x => x.id === item.id),
                        onOpen: openDetail,
                        onOpenExternal: openExternal,
                      })),
                    ),
              ),
              h(Pager, {
                page,
                busy,
                canNext: items.length > 0,
                onFlip: delta => {
                  const next = page + delta
                  if (next >= 1 && !busy) {
                    setPage(next)
                  }
                },
              }),
            ),
            detailItem
              ? h(WizardDrawer, {
                  item: detailItem,
                  data: detailData,
                  loading: detailBusy,
                  picked: (picks[detailItem.__kind || kind] || []).some(x => x.id === detailItem.id),
                  avatarName: (picks.base_model[0] || {}).title || '',
                  checkSupport: (detailItem.__kind || kind) !== 'base_model',
                  onAdd: item => {
                    const owner = item.__kind || kind
                    const willAdd = !((picks[owner] || []).some(x => x.id === item.id))
                    toggle(item)
                    // 在衣服/饰品页把素体定下来时，顺手用新素体重新核对一次当前这件。
                    if (owner === 'base_model' && (detailItem.__kind || kind) !== 'base_model') {
                      fetchDetail(detailItem, willAdd ? item : null)
                    }
                  },
                  onOpenExternal: openExternal,
                  onClose: () => { setDetailItem(null); setDetailData(null) },
                })
              : null,
          ),
        )
      }

      // 汇总：把三步选中的商品图全铺出来，不算总价。
      const groups = [
        ['base_model', '素体'],
        ['clothing', '衣服'],
        ['accessory', '饰品'],
        ['prop', '小道具'],
      ]
      const captured = groups.map(([key, label]) => ({ key, label, list: picks[key] || [] })).filter(g => g.list.length > 0)
      return h('div', { style: Object.assign({}, s.root, { padding: 0, flex: 1, gap: 10 }) },
        stepBar,
        h('div', { style: s.navBar },
          h('button', { type: 'button', style: s.navBtn, onClick: () => goStep(4) }, '← 上一步'),
          h('button', {
            type: 'button',
            style: s.navBtn,
            onClick: async () => {
              const lines = ['【BOOTH 选购单】', '性别：' + (genderLabel || '不限') + (styleLabel ? ' ｜ 风格：' + styleLabel : '')]
              captured.forEach(group => {
                lines.push('', group.label + '：')
                group.list.forEach(item => lines.push('- ' + (item.title || '') + '  ' + (item.priceLabel || '') + '  ' + item.url))
              })
              try {
                await navigator.clipboard.writeText(lines.join('\n'))
              } catch {
                // 剪贴板被拒时不影响继续用页面。
              }
            },
          }, '复制清单'),
          h('button', {
            type: 'button',
            style: s.navBtnOn,
            onClick: () => {
              setPicks({ base_model: [], clothing: [], accessory: [], prop: [] })
              setGender('')
              setStyles([])
              setDetailItem(null)
              goStep(0)
            },
          }, '重新开始'),
        ),
        h('p', { style: s.question }, '⑥ 这一套'),
        pickedTotal === 0 ? h('div', { style: s.hint }, '还没选东西，回上一步挑。') : null,
        captured.map(group => h('div', { key: group.key },
          h('div', { style: s.groupTitle }, group.label + ' · ' + group.list.length + ' 件'),
          h('div', { style: s.sumGrid },
            group.list.map(item => h('div', {
              key: item.id,
              style: Object.assign({}, s.sumCard, { cursor: 'pointer' }),
              onClick: () => openExternal(item),
              title: '在浏览器打开 ' + (item.title || ''),
            },
              item.image ? h('img', { style: s.cover, src: imageProxy(item.image), alt: '', loading: 'lazy' }) : h('div', { style: s.cover }),
              h('div', { style: s.cardTitle }, item.title || '(无标题)'),
              h('div', { style: s.shop }, item.shop || '未知店铺'),
            )),
          ),
        )),
      )
    }

    const WIZARD_SORTS_HINT = { popular: '人气（BOOTH 站内排序）', recommended: '相关度', newest: '最新上架', price_asc: '价格从低到高', price_desc: '价格从高到低' }

    // ---------------------------------------------------------------- 视图壳
    function BoothView() {
      const [tab, setTab] = useState('search')
      const rootRef = useRef(null)

      // 像画廊那样占满：本视图挂载期间隐藏会话输入框（composer），切走时恢复。
      useEffect(() => {
        const root = rootRef.current
        if (!root || typeof document === 'undefined') {
          return undefined
        }
        const host = root.closest('[data-conversation-scroll]') || document.querySelector('[data-conversation-scroll]')
        if (!host) {
          return undefined
        }
        const STYLE_ID = 'booth-search-hide-composer'
        if (document.getElementById(STYLE_ID) === null) {
          const style = document.createElement('style')
          style.id = STYLE_ID
          style.textContent = '[data-booth-view="on"] [data-composer-seat]{display:none!important}'
          document.head.appendChild(style)
        }
        host.setAttribute('data-booth-view', 'on')
        return () => {
          host.removeAttribute('data-booth-view')
          document.getElementById(STYLE_ID)?.remove()
        }
      }, [])

      const pane = active => ({ display: active ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0, gap: 10 })

      return h('div', { ref: rootRef, style: s.root, 'data-booth-root': 'on' },
        h('div', { style: s.tabs },
          h('button', { type: 'button', style: tab === 'search' ? s.tabOn : s.tab, onClick: () => setTab('search') }, '搜索'),
          h('button', { type: 'button', style: tab === 'wizard' ? s.tabOn : s.tab, onClick: () => setTab('wizard') }, '选购台'),
        ),
        h('div', { style: pane(tab === 'search') }, h(SearchPanel)),
        h('div', { style: pane(tab === 'wizard') }, h(WizardPanel)),
      )
    }

    return {
      name: 'dsh-booth-search',
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.view', () => ctx.slots.register({
          name: 'conversation.view',
          id: 'booth',
          order: 25,
          label: () => 'BOOTH',
        }, BoothView))
      },
    }
  },
})
