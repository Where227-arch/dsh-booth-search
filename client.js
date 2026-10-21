// @local/booth-search — 客户端视图
// 在会话标题栏的「对话 / 轨迹 / 上下文 / 画廊 / BOOTH / 编队」这一排里注册一个 BOOTH 视图。
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
      cover: { width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 6, background: COLORS.layer2, display: 'block' },
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

    function BoothView() {
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

      // 像画廊那样占满：本视图挂载期间隐藏会话输入框（composer），切走时恢复。
      const rootRef = useRef(null)
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

      return h('div', { ref: rootRef, style: s.root, 'data-booth-root': 'on' },
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
        h('div', { style: s.body },
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
        h('div', { style: s.pager },
          page > 1
            ? h('button', { type: 'button', style: s.pageBtn, onClick: () => flip(-1), disabled: busy }, '← 上一页')
            : h('button', { type: 'button', style: s.pageBtnOff, disabled: true }, '← 上一页'),
          h('span', { style: s.pageLabel }, '第 ' + page + ' 页'),
          h('button', { type: 'button', style: s.pageBtn, onClick: () => flip(1), disabled: busy || items.length === 0 }, '下一页 →'),
        ),
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
