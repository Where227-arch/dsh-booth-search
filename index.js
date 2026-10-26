// dsh-booth-search — BOOTH 商品搜索工具
// 目标：给 VRChat Avatar 作者用。按关键词搜 BOOTH，返回商品编号、价格、店铺、
// 简介、封面图（作为会话附件内联显示）和可点击的直达链接。
// 无第三方依赖：HTML 解析用正则，HTTP 走全局 fetch；需要走代理时用 CONNECT 隧道。

import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { connect as tlsConnect } from 'node:tls'
import { spawn } from 'node:child_process'

const BOOTH = 'https://booth.pm'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const ACCEPT_LANGUAGE = 'ja,en-US;q=0.8,zh-CN;q=0.7'
const MAX_BODY_BYTES = 8 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_MAX_COVERS = 6
const MAX_COVERS_HARD_LIMIT = 9

// BOOTH 的「热销榜」= 全站商品列表按 popular 排序，列表页 /{lang}/items?sort=popular&page=N。
const RANKING_SORT = 'popular'

const SORT_PARAMS = {
    newest: 'new',
    price_asc: 'price_asc',
    price_desc: 'price_desc',
}

// 「选购台」用：性别 / 风格 → BOOTH 日文检索词。翻译只发生在宿主侧，日文串不回传前端。
// 实测：「女の子 アバター」比「女性アバター」更接近真人 VRChat 素体池（后者会捞到大量服装）。
// 性别词只用在素体检索上：衣装/饰品标题基本不写性别，硬拼进去只会把结果饿死。
const GENDER_TERMS = {
    female: '女の子 アバター',
    male: '男の子 アバター',
    any: '',
}

const STYLE_GROUPS = [
    {
        id: 'mood', label: '气质',
        items: [
            { id: 'cool', label: '帅气', term: 'かっこいい' },
            { id: 'cute', label: '可爱', term: 'かわいい' },
            { id: 'shy', label: '腼腆', term: '内気' },
            { id: 'calm', label: '冷淡', term: 'クール' },
            { id: 'wild', label: '疯批', term: 'ヤンデレ' },
            { id: 'elegant', label: '优雅', term: 'エレガント' },
            { id: 'genki', label: '元气', term: '元気' },
            { id: 'gentle', label: '温柔', term: '優しい' },
            { id: 'intellectual', label: '知性', term: '知的' },
            { id: 'tsundere', label: '傲娇', term: 'ツンデレ' },
        ],
    },
    {
        id: 'theme', label: '题材',
        items: [
            { id: 'military', label: '军装', term: '軍服' },
            { id: 'uniform', label: '制服', term: '制服' },
            { id: 'gothic', label: '哥特', term: 'ゴシック' },
            { id: 'japanese', label: '和风', term: '和風' },
            { id: 'cyber', label: '机能', term: 'サイバー' },
            { id: 'fantasy', label: '幻想', term: 'ファンタジー' },
            { id: 'casual', label: '日常', term: '私服' },
            { id: 'classic', label: '古典', term: 'クラシック' },
            { id: 'wasteland', label: '废土', term: 'ポストアポカリプス' },
            { id: 'academy', label: '学院', term: 'ブレザー' },
            { id: 'religion', label: '宗教', term: '修道服' },
            { id: 'chinese', label: '中式', term: 'チャイナ' },
        ],
    },
    {
        id: 'element', label: '元素',
        items: [
            { id: 'star', label: '星星', term: '星' },
            { id: 'lace', label: '蕾丝', term: 'レース' },
            { id: 'butterfly', label: '蝴蝶', term: '蝶' },
            { id: 'skull', label: '骷髅', term: '骸骨' },
            { id: 'angel', label: '天使', term: '天使' },
            { id: 'demon', label: '恶魔', term: '悪魔' },
            { id: 'mecha', label: '机械', term: 'メカ' },
            { id: 'flower', label: '花', term: '花' },
            { id: 'ribbon', label: '缎带', term: 'リボン' },
        ],
    },
    {
        id: 'body', label: '体型',
        items: [
            { id: 'petite', label: '娇小', term: '小柄' },
            { id: 'standard', label: '标准', term: '標準' },
            { id: 'tall', label: '高挑', term: '長身' },
            { id: 'glam', label: '御姐', term: 'お姉さん' },
            { id: 'loli', label: '幼态', term: 'ロリ' },
        ],
    },
]

const STYLE_INDEX = new Map()
for (const group of STYLE_GROUPS) {
    for (const item of group.items) {
        STYLE_INDEX.set(item.id, item)
    }
}

const WIZARD_KINDS = [
    { id: 'base_model', label: '素体' },
    { id: 'clothing', label: '衣服' },
    { id: 'accessory', label: '饰品' },
    { id: 'prop', label: '小道具' },
]

const WIZARD_SORTS = [
    { id: 'popular', label: '人气（BOOTH 站内排序）' },
    { id: 'recommended', label: '相关度' },
    { id: 'newest', label: '最新上架' },
    { id: 'price_asc', label: '价格从低到高' },
    { id: 'price_desc', label: '价格从高到低' },
]

/** 风格 id → 日文检索片段。 */
function styleTerm(styleId) {
    const id = String(styleId ?? '').trim()
    if (id === '') {
        return ''
    }
    const item = STYLE_INDEX.get(id)
    return item === undefined ? '' : item.term
}

// 风格词的「标题命中表」：BOOTH 没有风格筛选，只能用关键词往标题上靠。
// 用法不是拼进检索式（那会把结果饿死到个位数），而是给宽结果做一个稳定加权：
// 命中的排前面，其余保持 BOOTH 的热销序（即销量）。
const STYLE_KEYWORDS = {
    cool: ['かっこいい', 'カッコいい', 'クール'],
    cute: ['かわいい', 'カワイイ', 'キュート'],
    shy: ['内気', 'シャイ', 'はにかみ'],
    calm: ['クール', '冷静', 'シック'],
    wild: ['ヤンデレ', '狂気', 'メンヘラ', '病み'],
    elegant: ['エレガント', '上品', '大人', 'レディース'],
    genki: ['元気', '明るい', 'スポーティ', 'アクティブ'],
    gentle: ['優しい', 'やさしい', 'ふんわり', '柔らか'],
    intellectual: ['知的', '委員長', 'メガネ', '眼鏡'],
    tsundere: ['ツンデレ', '不機嫌', '生意気'],
    military: ['軍服', 'ミリタリー', '軍装', '制服'],
    uniform: ['制服', 'セーラー', 'ブレザー', '学園'],
    gothic: ['ゴシック', 'ゴス', '中世'],
    japanese: ['和風', '着物', '浴衣', '和装'],
    cyber: ['サイバー', 'メカ', '近未来', 'テック'],
    fantasy: ['ファンタジー', '剣', '魔法', '騎士'],
    casual: ['私服', 'カジュアル', '普段着', 'リラックス'],
    classic: ['クラシック', 'ヴィクトリアン', '貴族', '正装'],
    wasteland: ['ポストアポカリプス', '廃墟', 'サバイバル', '終末'],
    academy: ['ブレザー', '通学', 'スクール', '制服'],
    religion: ['修道服', 'シスター', '聖職', '司祭'],
    chinese: ['チャイナ', '中華', '旗袍'],
    star: ['星', 'スター', 'スターモチーフ'],
    lace: ['レース', 'フリル'],
    butterfly: ['蝶', 'チョウ', 'バタフライ'],
    skull: ['骸骨', 'ドクロ', 'スカル'],
    angel: ['天使', '羽', 'エンジェル'],
    demon: ['悪魔', 'デビル', '角'],
    mecha: ['メカ', '機械', 'メカニカル'],
    flower: ['花', 'フラワー', 'ローズ'],
    ribbon: ['リボン', '蝶結び'],
    petite: ['小柄', 'ちび', 'ミニ'],
    standard: ['標準', '平均'],
    tall: ['長身', '高身長', 'モデル'],
    glam: ['お姉さん', '大人', '色気', 'レディース'],
    loli: ['ロリ', '幼'],
}

/** 多选风格 → 去重后的日文检索词数组。 */
function styleTerms(styleIds) {
    const out = []
    for (const id of Array.isArray(styleIds) ? styleIds : [styleIds]) {
        const term = styleTerm(id)
        if (term !== '' && !out.includes(term)) {
            out.push(term)
        }
    }
    return out
}

/** 稳定加权：标题命中风格词的排前面，其余顺序不变。支持多选风格叠加。 */
function boostByStyle(results, styleIds) {
    const ids = Array.isArray(styleIds) ? styleIds : [styleIds]
    const keys = []
    for (const id of ids) {
        const list = STYLE_KEYWORDS[id]
        if (Array.isArray(list)) {
            for (const key of list) {
                if (!keys.includes(key)) {
                    keys.push(key)
                }
            }
        }
    }
    if (keys.length === 0) {
        return results
    }
    const hit = []
    const rest = []
    for (const item of results) {
        const title = String(item?.title ?? '')
        if (keys.some(key => title.includes(key))) {
            hit.push(item)
        } else {
            rest.push(item)
        }
    }
    return hit.concat(rest)
}

// ── 大类框选 ───────────────────────────────────────────────────────────
// BOOTH 每张商品卡都自带官方分类（item-card__category-anchor）。这是最硬的一道闸：
// 素体只认 3Dキャラクター、衣服只认 3D衣装…… 之前「素体里混进衣服、衣服里混进着色器/工具」
// 的根因就是只靠标题关键词去猜，现在改成按分类框死。
const KIND_CATEGORIES = {
    base_model: ['3Dキャラクター'],
    clothing: ['3D衣装'],
    accessory: ['3D装飾品'],
    prop: ['3D装飾品'],
}

// 标题里的性别标记：只用来剔除「明确是另一个性别」的商品，没标记的一律保留，
// 免得把整页清空。真正的性别判断在分类框选之后结合检索词已收敛得比较准。
const FEMALE_SIGNAL = /女性|少女|女の子|女子|ガール|お姉さん|レディース|女性向け/i
const MALE_SIGNAL = /男性|少年|男の子|男子|メンズ|男性向け|イケメン|男子向け|ボーイ/i

function inKindCategory(item, kind) {
    const allowed = KIND_CATEGORIES[kind]
    if (!Array.isArray(allowed)) {
        return true
    }
    const category = String(item?.category ?? '').trim()
    if (category === '') {
        return true
    }
    return allowed.some(one => category.includes(one))
}

function matchesGender(item, genderId) {
    if (genderId !== 'female' && genderId !== 'male') {
        return true
    }
    const text = `${item?.title ?? ''} ${item?.shop ?? ''}`
    const female = FEMALE_SIGNAL.test(text)
    const male = MALE_SIGNAL.test(text)
    if (female === male) {
        return true
    }
    return female ? genderId === 'female' : genderId === 'male'
}

function dropMismatched(results, kind, genderId) {
    return results.filter(item => inKindCategory(item, kind) && matchesGender(item, genderId))
}

// ── 素体适配校验 ────────────────────────────────────────────────────────
// 衣装/发型/饰品的简介里常列「対応アバター：しなの、キプフェル…」。
// 拿当前选中素体的名字去简介里找：命中=明确支持；没命中但简介里有「対応アバター」类字样=明确不支持；
// 两样都没有=没标注（不硬判，交给用户在详情页自己看）。
function normalizeForMatch(value) {
    return String(value ?? '')
        .toLowerCase()
        .replace(/[\s\u3000]+/g, '')
        .replace(/[「」『』【】\[\]()（）<>＜＞\/／|｜–—\-_:：・.,，。、*＊#＃]/g, '')
}

const GENERIC_TOKENS = /^(オリジナル|オリジナル3dモデル|3dモデル|vrchat|vrchat向け|モデル|アバター|対応|販売|衣装|髪型|アクセサリ|セット|商品|unity|booth|vrchat向けオリジナル3dモデル)$/i

/** 素体标题 → 可用的名字别名，例如「ラプウィング Lapwing / オリジナル3Dモデル」→ [ラプウィング, Lapwing]。 */
function avatarAliases(title) {
    const cleaned = String(title ?? '')
        .replace(/【[^】]*】/g, ' ')
        .replace(/[「」『』]/g, ' ')
    const out = []
    for (const raw of cleaned.split(/[\/／|｜–—\s\u3000]+/)) {
        const token = raw.trim().replace(/^[-–—]+|[-–—]+$/g, '')
        if (token.length < 2 || GENERIC_TOKENS.test(token)) {
            continue
        }
        if (/^(ver|v)\.?\d/i.test(token) || /^\d/.test(token)) {
            continue
        }
        if (!out.includes(token)) {
            out.push(token)
        }
    }
    return out.slice(0, 4)
}

const SUPPORT_MARK = /対応アバター|対応素体|対応モデル|対応：|対応:|対応アバター一覧|Supported Avatars/i

const SUPPORT_URL_RE = /(?:https?:\/\/booth\.pm)?(?:\/[-a-z]{2,5})?\/items\/(\d{4,8})/

/** 去标签但保留换行：対応アバター 名单是「名字一行、链接一行」的排版，换行不能丢。 */
function stripTagsKeepLines(html) {
    return decodeEntities(String(html ?? '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|h2|h3|section|ul|ol)>/gi, '\n')
        .replace(/<[^>]*>/g, ''))
        .replace(/[ \t\u00a0]+/g, ' ')
        .replace(/\n{2,}/g, '\n')
        .trim()
}

/** 从商品页 HTML 里抠「対応アバター」那一段正文（ld+json 里通常没有这一段）。 */
function extractSupportSection(html) {
    const source = String(html ?? '')
    const anchor = source.search(/(対応アバター|対応素体|対応モデル)\s*</)
    if (anchor < 0) {
        return ''
    }
    return stripTagsKeepLines(source.slice(anchor, anchor + 9000))
}

/**
 * 从商品简介里抽出「対応アバター」名单。
 * BOOTH 商家普遍写成「名字一行、链接一行」，所以拿链接里的商品号当锚点，名字取它上面最近的一行。
 * 链接里的商品号就是素体自己的 BOOTH 商品号，比名字匹配精确得多。
 */
function parseSupportedAvatars(description) {
    const text = String(description ?? '')
    if (!SUPPORT_MARK.test(text)) {
        return []
    }
    const lines = text.split(/\r?\n/).map(line => line.trim())
    const out = []
    const seen = new Set()
    for (let index = 0; index < lines.length; index += 1) {
        const match = SUPPORT_URL_RE.exec(lines[index])
        if (match === null) {
            continue
        }
        const id = match[1]
        if (seen.has(id)) {
            continue
        }
        let name = ''
        for (let back = index - 1; back >= 0 && back >= index - 3; back -= 1) {
            const prev = lines[back]
            if (prev === '' || SUPPORT_URL_RE.test(prev)) {
                continue
            }
            name = prev.replace(/^[\s\u3000　]+/, '').slice(0, 48)
            break
        }
        seen.add(id)
        out.push({ id, name })
        if (out.length >= 80) {
            break
        }
    }
    return out
}

function checkAvatarSupport(description, avatarTitle) {
    const aliases = avatarAliases(avatarTitle)
    if (aliases.length === 0) {
        return { support: 'unknown', avatarName: '' }
    }
    const name = aliases[0]
    const text = normalizeForMatch(description)
    if (text.includes('全アバター対応') || text.includes('全てのアバター') || text.includes('全対応')) {
        return { support: 'yes', avatarName: name }
    }
    for (const alias of aliases) {
        const needle = normalizeForMatch(alias)
        if (needle.length >= 2 && text.includes(needle)) {
            return { support: 'yes', avatarName: alias }
        }
    }
    if (SUPPORT_MARK.test(String(description ?? ''))) {
        return { support: 'no', avatarName: name }
    }
    return { support: 'unknown', avatarName: name }
}

const KIND_TERMS = {
    clothing: '衣装',
    shader: 'シェーダー',
    base_model: '素体',
    accessory: 'アクセサリー',
    texture: 'テクスチャ',
    animation: 'アニメーション',
    prop: '小物',
}

// 中文 → 日文检索词表：用户只用中文输入，翻译只发生在宿主侧，日文串不回传前端。
const ZH2JA = new Map(Object.entries({
    // 服装 / 穿搭
    水手服: 'セーラー服',
    女仆装: 'メイド服',
    女仆: 'メイド',
    兔女郎: 'バニー',
    泳装: '水着',
    泳衣: '水着',
    和服: '着物',
    浴衣: '浴衣',
    校服: '制服',
    制服: '制服',
    连衣裙: 'ワンピース',
    裙子: 'スカート',
    裤子: 'ズボン',
    短裤: 'ショートパンツ',
    外套: 'コート',
    大衣: 'コート',
    夹克: 'ジャケット',
    卫衣: 'パーカー',
    衬衫: 'シャツ',
    上衣: 'トップス',
    内衣: '下着',
    长袜: 'ニーソ',
    过膝袜: 'ニーソックス',
    袜子: '靴下',
    靴子: 'ブーツ',
    鞋子: '靴',
    围巾: 'マフラー',
    手套: '手袋',
    帽子: '帽子',
    // 配饰
    配饰: 'アクセサリー',
    首饰: 'アクセサリー',
    发饰: 'ヘアアクセ',
    项链: 'ネックレス',
    耳环: 'イヤリング',
    戒指: '指輪',
    眼镜: 'メガネ',
    面具: 'マスク',
    头盔: 'ヘルメット',
    翅膀: '羽',
    尾巴: 'しっぽ',
    猫耳: '猫耳',
    狐狸耳: '狐耳',
    兔耳: 'うさ耳',
    角: 'ツノ',
    纹身: 'タトゥー',
    // 身体 / 素体相关
    素体: '素体',
    模型: 'モデル',
    身体: 'ボディ',
    脸部: '顔',
    脸: '顔',
    头部: '頭',
    发型: 'ヘアスタイル',
    头发: '髪',
    短发: 'ショートヘア',
    长发: 'ロングヘア',
    双马尾: 'ツインテール',
    马尾: 'ポニーテール',
    眼睛: '目',
    瞳: '瞳',
    睫毛: 'まつ毛',
    表情: '表情',
    皮肤: '肌',
    材质: 'マテリアル',
    贴图: 'テクスチャ',
    纹理: 'テクスチャ',
    颜色: 'カラー',
    换色: '色変更',
    变色: '色変更',
    // 技术 / 玩法
    着色器: 'シェーダー',
    动画: 'アニメーション',
    动作: 'モーション',
    舞蹈: 'ダンス',
    插件: 'ギミック',
    组件: 'コンポーネント',
    工具: 'ツール',
    系统: 'システム',
    脚本: 'スクリプト',
    预设: 'プリセット',
    特效: 'エフェクト',
    粒子: 'パーティクル',
    灯光: 'ライト',
    阴影: '影',
    // 状态 / 修饰
    支持: '対応',
    兼容: '対応',
    适配: '対応',
    对应: '対応',
    可用: '対応',
    改造: '改変',
    修改: '改変',
    可调: '調整可能',
    免费: '無料',
    有偿: '有料',
    人気: '人気',
    新作: '新作',
    // 常见素体名
    玛娜卡: 'マヌカ',
    马努卡: 'マヌカ',
    塞莱斯蒂亚: 'セレスティア',
    莉莉卡: 'リリカ',
    希冯: 'シフォン',
    玛雅: 'マヤ',
    瑞希: 'ミズキ',
    拉姆内: 'ラムネ',
    玛丽: 'マリー',
    // 颜色
    黑色: '黒',
    白色: '白',
    红色: '赤',
    蓝色: '青',
    绿色: '緑',
    粉色: 'ピンク',
    紫色: '紫',
    黄色: '黄',
    灰色: 'グレー',
    金色: '金',
    银色: '銀',
}))
const ZH2JA_KEYS = [...ZH2JA.keys()].sort((a, b) => b.length - a.length)
const HAN_PATTERN = /[\u4e00-\u9fff]/

/**
 * 把中文检索词换成日文（BOOTH 的日文站检索效果好得多）。
 * 返回的 text 只用于拼搜索 URL，不写进接口响应、不写进工具输出，用户永远看不到日文。
 */
function toJapaneseQuery(query) {
    const raw = String(query ?? '').trim()
    if (raw === '' || !HAN_PATTERN.test(raw)) {
        return { text: raw, translated: false, hits: 0 }
    }
    let text = raw
    let hits = 0
    for (const zh of ZH2JA_KEYS) {
        if (!text.includes(zh)) {
            continue
        }
        text = text.split(zh).join(` ${ZH2JA.get(zh)} `)
        hits += 1
    }
    text = text.replace(/\s+/g, ' ').trim()
    return { text: hits === 0 ? raw : text, translated: hits > 0, hits }
}

const MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

export const inject = ['tools', 'attachments', 'webServer']

export function apply(ctx, config) {
    const options = resolveConfig(config)
    const disposers = [
        ctx.tools.register(searchToolDefinition(ctx, options)),
        ctx.tools.register(itemToolDefinition(ctx, options)),
    ]
    // 前端 BOOTH 页（client.js 注册进 conversation.view）走这组同源 JSON 接口。
    const unregisterApi = registerWebApi(ctx, options)
    if (typeof unregisterApi === 'function') {
        disposers.push(unregisterApi)
    }
    return () => {
        for (const dispose of disposers) {
            dispose()
        }
    }
}

// ---------------------------------------------------------------- config

function resolveConfig(config) {
    const raw = config !== null && typeof config === 'object' && !Array.isArray(config) ? config : {}
    const proxy = firstString(raw.proxy, process.env.BOOTH_PROXY)
    const lang = firstString(raw.lang) === 'en' ? 'en' : 'ja'
    const timeoutMs = clampInt(raw.timeoutMs, DEFAULT_TIMEOUT_MS, 3_000, 60_000)
    const maxCovers = clampInt(raw.maxCovers, DEFAULT_MAX_COVERS, 0, MAX_COVERS_HARD_LIMIT)
    return { proxy, lang, timeoutMs, maxCovers }
}

function firstString(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim() !== '') {
            return value.trim()
        }
    }
    return ''
}

function clampInt(value, fallback, min, max) {
    // 网页接口传进来的都是字符串（page=2），不能像旧实现那样一律退回 fallback，否则永远停在第 1 页。
    const numeric = typeof value === 'number'
        ? value
        : (typeof value === 'string' && value.trim() !== '' ? Number(value) : Number(fallback))
    const n = Math.trunc(numeric)
    if (!Number.isFinite(n)) {
        return fallback
    }
    return Math.min(max, Math.max(min, n))
}

/** 价格参数可能来自工具参数（数字）或 URL 查询串（字符串），空串/缺省一律当作「不筛选」。 */
function toPrice(value) {
    if (value === undefined || value === null || String(value).trim() === '') {
        return undefined
    }
    const n = Number(value)
    return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : undefined
}

/** 从「5485641」或「https://booth.pm/ja/items/5485641」里取出商品编号。 */
function parseItemId(value) {
    return /(\d{3,})/.exec(String(value ?? '').trim())?.[1]
}

/** 详情行统一用「 ｜ 」拼接，空值自动略过。 */
function metaLine(parts) {
    return parts.filter(part => typeof part === 'string' && part !== '').join(' ｜ ')
}

// ---------------------------------------------------------------- http

async function fetchText(url, options) {
    const response = await fetchBuffer(url, options)
    return response.body.toString('utf8')
}

async function fetchBuffer(url, options) {
    const headers = {
        'user-agent': USER_AGENT,
        'accept-language': ACCEPT_LANGUAGE,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    }
    if (options.proxy !== '') {
        return proxyGet(url, options.proxy, options.timeoutMs, headers)
    }
    const response = await fetch(url, {
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(options.timeoutMs),
    })
    const body = Buffer.from(await response.arrayBuffer())
    if (!response.ok) {
        throw new Error(`BOOTH 返回 HTTP ${String(response.status)}：${url}`)
    }
    if (body.length > MAX_BODY_BYTES) {
        throw new Error(`BOOTH 响应超过 ${String(MAX_BODY_BYTES)} 字节：${url}`)
    }
    return { status: response.status, contentType: response.headers.get('content-type') ?? '', body }
}

function proxyGet(url, proxyUrl, timeoutMs, headers) {
    const target = new URL(url)
    const proxy = new URL(proxyUrl)
    const targetPort = target.port === '' ? '443' : target.port
    return new Promise((resolve, reject) => {
        let settled = false
        const fail = error => {
            if (settled) {
                return
            }
            settled = true
            clearTimeout(timer)
            reject(error instanceof Error ? error : new Error(String(error)))
        }
        const done = value => {
            if (settled) {
                return
            }
            settled = true
            clearTimeout(timer)
            resolve(value)
        }
        const timer = setTimeout(() => {
            fail(new Error(`BOOTH 请求超时（${String(timeoutMs)}ms）：${url}`))
        }, timeoutMs)
        const connectRequest = httpRequest({
            hostname: proxy.hostname,
            port: Number(proxy.port === '' ? '80' : proxy.port),
            method: 'CONNECT',
            path: `${target.hostname}:${targetPort}`,
            headers: { host: `${target.hostname}:${targetPort}` },
        })
        connectRequest.once('connect', (response, socket) => {
            if (response.statusCode !== 200) {
                socket.destroy()
                fail(new Error(`代理 CONNECT 失败：HTTP ${String(response.statusCode ?? 0)}`))
                return
            }
            const secureSocket = tlsConnect({ socket, servername: target.hostname })
            const inner = httpsRequest({
                hostname: target.hostname,
                port: Number(targetPort),
                path: `${target.pathname}${target.search}`,
                method: 'GET',
                headers: { ...headers, host: target.hostname, connection: 'close' },
                createConnection: () => secureSocket,
            }, response2 => {
                const chunks = []
                let size = 0
                response2.on('data', chunk => {
                    size += chunk.length
                    if (size > MAX_BODY_BYTES) {
                        inner.destroy(new Error('BOOTH 响应过大'))
                        return
                    }
                    chunks.push(chunk)
                })
                response2.once('end', () => {
                    const status = response2.statusCode ?? 0
                    if (status < 200 || status >= 300) {
                        fail(new Error(`BOOTH 返回 HTTP ${String(status)}：${url}`))
                        return
                    }
                    done({ status, contentType: response2.headers['content-type'] ?? '', body: Buffer.concat(chunks) })
                })
                response2.once('error', fail)
            })
            inner.once('error', fail)
            inner.end()
        })
        connectRequest.once('error', fail)
        connectRequest.end()
    })
}

// ---------------------------------------------------------------- html parsing

function decodeEntities(text) {
    return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, code) => {
        if (code.startsWith('#x') || code.startsWith('#X')) {
            return String.fromCodePoint(Number.parseInt(code.slice(2), 16))
        }
        if (code.startsWith('#')) {
            return String.fromCodePoint(Number.parseInt(code.slice(1), 10))
        }
        switch (code.toLowerCase()) {
            case 'amp': return '&'
            case 'lt': return '<'
            case 'gt': return '>'
            case 'quot': return '"'
            case 'apos': return "'"
            case 'nbsp': return ' '
            default: return match
        }
    })
}

function stripTags(text) {
    return decodeEntities(text.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function parseSearchPage(html, lang) {
    const results = []
    const seen = new Set()
    const parts = html.split('<li class="item-card')
    for (let index = 1; index < parts.length; index += 1) {
        const part = parts[index]
        const close = part.indexOf('</li>')
        const card = close >= 0 ? part.slice(0, close) : part.slice(0, 6_000)
        const id = (/\bdata-product-id="(\d+)"/.exec(card) ?? /\/items\/(\d+)/.exec(card))?.[1]
        if (id === undefined || seen.has(id)) {
            continue
        }
        seen.add(id)
        const titleMatch = /item-card__title-anchor[^>]*>([\s\S]*?)<\/a>/.exec(card)
        const title = titleMatch ? stripTags(titleMatch[1]) : stripTags(/data-product-name="([^"]*)"/.exec(card)?.[1] ?? '')
        const shop = stripTags(/item-card__shop-name">([^<]*)</.exec(card)?.[1] ?? '')
        const category = stripTags(/item-card__category-anchor[^>]*>([^<]*)</.exec(card)?.[1] ?? '')
        const priceRaw = Number(/data-product-price="(\d+)"/.exec(card)?.[1] ?? '0')
        const priceLabel = stripTags(/class="price[^"]*">([^<]*)</.exec(card)?.[1] ?? '')
        const image = /data-original="([^"]+)"/.exec(card)?.[1] ?? ''
        results.push({
            id,
            title,
            shop,
            category,
            price: Number.isFinite(priceRaw) ? priceRaw : 0,
            priceLabel,
            url: `${BOOTH}/${lang}/items/${id}`,
            image,
        })
    }
    return results
}

function parseItemPage(html, id, lang) {
    const ldMatch = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)
    let ld = null
    if (ldMatch !== null) {
        try {
            ld = JSON.parse(ldMatch[1])
        } catch {
            ld = null
        }
    }
    const ogTitle = /<meta property="og:title" content="([^"]*)"/.exec(html)?.[1] ?? ''
    const ogDescription = /<meta property="og:description" content="([^"]*)"/.exec(html)?.[1] ?? ''
    const ogImage = /<meta property="og:image" content="([^"]*)"/.exec(html)?.[1] ?? ''
    const title = (ld !== null && typeof ld.name === 'string' && ld.name.trim() !== '' ? ld.name : decodeEntities(ogTitle))
        .replace(/\s+-\s+BOOTH\s*$/i, '')
        .trim()
    const rawDescription = String((ld !== null && typeof ld.description === 'string' && ld.description.trim() !== '') ? ld.description : decodeEntities(ogDescription))
    const description = stripTags(rawDescription)
    const offers = ld !== null && ld.offers !== null && typeof ld.offers === 'object' ? ld.offers : {}
    const lowPrice = Number(offers.lowPrice ?? offers.price ?? 0)
    const highPrice = Number(offers.highPrice ?? offers.lowPrice ?? offers.price ?? 0)
    const priceLabel = Number.isFinite(lowPrice) && lowPrice > 0
        ? (Number.isFinite(highPrice) && highPrice > lowPrice
            ? `¥ ${formatNumber(lowPrice)} ~ ¥ ${formatNumber(highPrice)}`
            : `¥ ${formatNumber(lowPrice)}`)
        : ''
    const imageValue = ld !== null && ld.image !== undefined ? ld.image : ogImage
    const image = Array.isArray(imageValue) ? String(imageValue[0] ?? '') : String(imageValue ?? '')
    const shop = ld !== null && ld.brand !== null && typeof ld.brand === 'object' && typeof ld.brand.name === 'string'
        ? ld.brand.name
        : stripTags(/shop-name[^>]*>([^<]+)</.exec(html)?.[1] ?? '')
    return {
        id,
        title,
        shop,
        description: description.length > 360 ? `${description.slice(0, 360)}…` : description,
        descriptionFull: description.length > 12_000 ? description.slice(0, 12_000) : description,
        supported: parseSupportedAvatars(extractSupportSection(html)),
        priceLabel,
        price: Number.isFinite(lowPrice) ? lowPrice : 0,
        url: `${BOOTH}/${lang}/items/${id}`,
        image,
    }
}

function formatNumber(value) {
    return Math.trunc(value).toLocaleString('en-US')
}

// ---------------------------------------------------------------- covers

async function attachCover(ctx, imageUrl, options, name) {
    if (imageUrl === '' || ctx === undefined || ctx.attachments === undefined) {
        return undefined
    }
    const limits = ctx.attachments.imageLimits
    try {
        const response = await fetchBuffer(imageUrl, options)
        const mediaType = normalizeMediaType(response.contentType)
        if (mediaType === undefined || !limits.mediaTypes.includes(mediaType)) {
            return undefined
        }
        if (response.body.length > limits.maxImageBytes) {
            return undefined
        }
        return await ctx.attachments.saveImage({
            data: new Uint8Array(response.body),
            mediaType,
            name,
        })
    } catch {
        return undefined
    }
}

function normalizeMediaType(value) {
    const mediaType = String(value ?? '').split(';')[0].trim().toLowerCase()
    return MEDIA_TYPES.has(mediaType) ? mediaType : undefined
}

function sleep(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms)
    })
}

// ---------------------------------------------------------------- search

function kindTerm(kind) {
    return KIND_TERMS[kind] ?? ''
}

/** 关键词为空但选了分类时，就用分类词自己搜（例如分类=衣装 → 搜「衣装」）。 */
function buildSearchUrl(query, kind, options) {
    const fullQuery = `${query} ${kindTerm(kind)}`.trim()
    if (fullQuery === '') {
        // 既没关键词也没分类 = 首页热销榜。
        const url = new URL(`${BOOTH}/${options.lang}/items`)
        url.searchParams.set('sort', RANKING_SORT)
        return url
    }
    return new URL(`${BOOTH}/${options.lang}/search/${encodeURIComponent(fullQuery)}`)
}

/**
 * 工具与网页接口共用的搜索：拼 URL、抓 HTML、解析成列表。
 * 调用方自己用 clampInt 决定 page/limit 的上下限（工具 12 条、网页一页 24 条）。
 */
async function collectSearch(options, args) {
    const query = String(args.query ?? '').trim()
    const kind = String(args.kind ?? 'auto')
    const hasRaw = typeof args.rawQuery === 'string' && args.rawQuery.trim() !== ''
    const ranking = query === '' && kindTerm(kind) === '' && !hasRaw
    const sort = String(args.sort ?? 'recommended')
    // 中文关键词先在宿主侧转成日文再搜；日文串不回传，对外只见到用户自己输入的中文。
    const translated = hasRaw
        ? { text: String(args.rawQuery).trim(), translated: false, hits: 0 }
        : toJapaneseQuery(query)
    const url = buildSearchUrl(translated.text, kind, options)
    url.searchParams.set('page', String(args.page))
    if (!ranking) {
        if (SORT_PARAMS[sort] !== undefined) {
            url.searchParams.set('sort', SORT_PARAMS[sort])
        }
        const minPrice = toPrice(args.minPrice)
        const maxPrice = toPrice(args.maxPrice)
        if (minPrice !== undefined) {
            url.searchParams.set('price_min', String(minPrice))
        }
        if (maxPrice !== undefined) {
            url.searchParams.set('price_max', String(maxPrice))
        }
    }
    const html = await fetchText(url.href, options)
    const results = parseSearchPage(html, options.lang)
    return {
        limit: args.limit,
        results,
        payload: {
            mode: ranking ? 'ranking' : 'search',
            query,
            kind,
            sort,
            page: args.page,
            queryTranslated: translated.translated,
            searchUrl: ranking || translated.translated ? undefined : url.href,
            totalOnPage: results.length,
        },
    }
}

/** 给前 N 条结果挂封面附件（受 maxCovers 限制，逐张稍作间隔避免打太快）。 */
async function attachCovers(ctx, items, options, include) {
    if (!include) {
        return items
    }
    const budget = Math.min(options.maxCovers, items.length)
    for (let index = 0; index < budget; index += 1) {
        const item = items[index]
        item.attachment = await attachCover(ctx, item.image, options, `booth-${item.id}`)
        if (index + 1 < budget) {
            await sleep(120)
        }
    }
    return items
}

async function runSearch(ctx, options, args) {
    if (String(args?.query ?? '').trim() === '') {
        throw new Error('booth_search 需要一个非空的关键词（query）。')
    }
    const { payload, results, limit } = await collectSearch(options, {
        ...args,
        page: clampInt(args?.page, 1, 1, 100),
        limit: clampInt(args?.limit, 6, 1, 12),
    })
    await attachCovers(ctx, results.slice(0, limit), options, args?.includeCover !== false)
    return { ...payload, results: results.slice(0, limit) }
}

function searchToolDefinition(ctx, options) {
    return {
        name: 'booth_search',
        description: [
            'Search BOOTH (booth.pm) for VRChat avatar assets: clothing, shaders, base models, textures, animations and props.',
            'Returns each item’s BOOTH item id, price, shop, category, cover image (inline attachment) and a clickable item URL.',
            'Use kind to bias the search (clothing/shader/base_model/accessory/texture/animation/prop), sort to order results, and minPrice/maxPrice to filter by yen.',
            '中文：在 BOOTH 搜索 VRChat 用的服装、着色器、素体、配饰、贴图、动画、小物；返回商品编号、价格、店铺、分类、封面图与直达链接。',
            '中文关键词可以直接用：插件会在宿主侧转成日文再检索，返回结果里不会出现转译后的日文串。',
            'BOOTH 页面可能因地区网络不可达；需要代理时在插件配置 proxy 填 http://127.0.0.1:10090 之类地址。',
        ].join(' '),
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '中文关键词即可（例如「水手服」「猫耳 配饰」），宿主会自动转成日文检索，界面上不会出现日文。英文关键词原样使用。' },
                kind: {
                    type: 'string',
                    enum: ['auto', 'clothing', 'shader', 'base_model', 'accessory', 'texture', 'animation', 'prop'],
                    description: 'Bias the search toward an asset kind by appending its Japanese term. auto (default) adds nothing.',
                },
                sort: {
                    type: 'string',
                    enum: ['recommended', 'newest', 'price_asc', 'price_desc'],
                    description: 'recommended (default, BOOTH best match), newest, price_asc, price_desc.',
                },
                minPrice: { type: 'integer', description: 'Minimum price in JPY.' },
                maxPrice: { type: 'integer', description: 'Maximum price in JPY.' },
                page: { type: 'integer', description: '1-based result page. Default 1.' },
                limit: { type: 'integer', description: 'How many items to return (1-12, default 6).' },
                includeCover: { type: 'boolean', description: 'Attach cover images for the first few results (default true).' },
            },
            required: ['query'],
            additionalProperties: false,
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: true,
                properties: {
                    query: { type: 'string' },
                    page: { type: 'integer' },
                    searchUrl: { type: 'string' },
                    totalOnPage: { type: 'integer' },
                    results: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: true,
                            properties: {
                                id: { type: 'string' },
                                title: { type: 'string' },
                                shop: { type: 'string' },
                                category: { type: 'string' },
                                price: { type: 'number' },
                                priceLabel: { type: 'string' },
                                url: { type: 'string' },
                                image: { type: 'string' },
                                attachment: { type: 'object', additionalProperties: true },
                            },
                        },
                    },
                },
            },
            render(_args, value) {
                const results = Array.isArray(value?.results) ? value.results : []
                if (results.length === 0) {
                    return [{ type: 'text', text: `BOOTH 上没搜到「${String(value?.query ?? '')}」的结果，换关键词或去掉筛选条件试试。` }]
                }
                const blocks = [{
                    type: 'text',
                    text: value.queryTranslated === true
                        ? `BOOTH 搜索「${String(value.query ?? '')}」第 ${String(value.page ?? 1)} 页，返回 ${String(results.length)} 条（中文关键词已在后台转为日文检索）：`
                        : `BOOTH 搜索「${String(value.query ?? '')}」第 ${String(value.page ?? 1)} 页，返回 ${String(results.length)} 条：
${value.searchUrl}`,
                }]
                results.forEach((item, index) => {
                    const meta = metaLine([item.priceLabel, item.shop, item.category])
                    const lines = [
                        `**${String(index + 1)}. ${String(item.title || '(无标题)')}**`,
                        meta,
                        `商品编号：${String(item.id)} ｜ [打开 BOOTH 页面](${String(item.url)})`,
                    ].filter(line => line !== '')
                    blocks.push({ type: 'text', text: lines.join('\n') })
                    if (item.attachment !== undefined && item.attachment !== null) {
                        blocks.push({ type: 'image', attachment: item.attachment })
                    }
                })
                return blocks
            },
        },
        async execute(args) {
            return runSearch(ctx, options, args)
        },
    }
}

// ---------------------------------------------------------------- item detail

function itemToolDefinition(ctx, options) {
    return {
        name: 'booth_item',
        description: [
            'Fetch one BOOTH item by its numeric id and return title, shop, price range, description excerpt, cover image and the canonical URL.',
            '中文：按商品编号抓取单个 BOOTH 商品，返回标题、店铺、价格、简介、封面与直达链接。',
        ].join(' '),
        parameters: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'BOOTH item id, e.g. "5485641" or a booth.pm/items/5485641 URL.' },
                includeCover: { type: 'boolean', description: 'Attach the cover image (default true).' },
            },
            required: ['id'],
            additionalProperties: false,
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: true,
                properties: {
                    id: { type: 'string' },
                    title: { type: 'string' },
                    shop: { type: 'string' },
                    priceLabel: { type: 'string' },
                    description: { type: 'string' },
                    url: { type: 'string' },
                    attachment: { type: 'object', additionalProperties: true },
                },
            },
            render(_args, value) {
                const lines = [
                    `**${String(value?.title || '(无标题)')}**`,
                    metaLine([value?.priceLabel, value?.shop]),
                    `商品编号：${String(value?.id ?? '')} ｜ [打开 BOOTH 页面](${String(value?.url ?? '')})`,
                ].filter(line => line !== '')
                if (typeof value?.description === 'string' && value.description !== '') {
                    lines.push(`简介：${value.description}`)
                }
                const blocks = [{ type: 'text', text: lines.join('\n') }]
                if (value?.attachment !== undefined && value.attachment !== null) {
                    blocks.push({ type: 'image', attachment: value.attachment })
                }
                return blocks
            },
        },
        async execute(args) {
            const id = parseItemId(args?.id)
            if (id === undefined) {
                throw new Error('booth_item 需要 BOOTH 商品编号（纯数字或商品链接）。')
            }
            const item = await fetchBoothItem(options, id)
            const includeCover = args?.includeCover !== false
            if (includeCover) {
                item.attachment = await attachCover(ctx, item.image, options, `booth-${id}`)
            }
            // 适配名单只给网页选购台用，别塞进工具返回里撑爆上下文。
            delete item.supported
            return item
        },
    }
}

async function fetchBoothItem(options, id) {
    const url = `${BOOTH}/${options.lang}/items/${id}`
    const html = await fetchText(url, options)
    return parseItemPage(html, id, options.lang)
}

// ---------------------------------------------------------------- web api
// 给 client.js 的 BOOTH 页用：同源 JSON 接口 + 封面代理（绕开防盗链）。

const API_PREFIX = '/api/booth-search'

function registerWebApi(ctx, options) {
    const server = ctx !== null && typeof ctx === 'object' ? ctx.webServer : undefined
    if (server === undefined || server === null || typeof server.register !== 'function') {
        return () => {}
    }
    try {
        return server.register({
            kind: 'prefix',
            path: API_PREFIX,
            handler: (req, res) => {
                void handleApiRequest(req, res, options)
            },
        })
    } catch (error) {
        // 热重载时旧实例的同名前缀还可能挂着，重复注册会让整个插件起不来；
        // 先让工具照常可用，等宿主重启后新路由自然接管。
        ctx?.logger?.warn?.(`[booth-search] API 路由注册失败：${error instanceof Error ? error.message : String(error)}`)
        return () => {}
    }
}

async function handleApiRequest(req, res, options) {
    try {
        const url = new URL(req.url, `http://${req.headers.host === undefined ? 'localhost' : req.headers.host}`)
        const pathname = url.pathname.replace(/\/+$/, '')
        if (req.method !== 'GET') {
            return sendJson(res, 405, { ok: false, error: '只支持 GET' })
        }
        if (pathname === `${API_PREFIX}/search`) {
            return await handleSearchApi(res, url, options)
        }
        if (pathname === `${API_PREFIX}/item`) {
            return await handleItemApi(res, url, options)
        }
        if (pathname === `${API_PREFIX}/open`) {
            return handleOpenApi(res, url)
        }
        if (pathname === `${API_PREFIX}/image`) {
            return await handleImageApi(res, url, options)
        }
        if (pathname === `${API_PREFIX}/meta`) {
            return sendJson(res, 200, { ok: true, ...wizardMeta() })
        }
        return sendJson(res, 404, { ok: false, error: `未知接口：${pathname}` })
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        sendJson(res, 502, { ok: false, error: message })
    }
}

async function handleSearchApi(res, url, options) {
    const kind = url.searchParams.get('kind') ?? 'auto'
    const genderId = String(url.searchParams.get('gender') ?? '').trim()
    const styleIds = String(url.searchParams.get('style') ?? '')
        .split(',')
        .map(part => part.trim())
        .filter(part => part !== '')
    const userQuery = String(url.searchParams.get('q') ?? '').trim()
    const sort = url.searchParams.get('sort') ?? 'recommended'
    const page = clampInt(url.searchParams.get('page'), 1, 1, 50)
    const limit = clampInt(url.searchParams.get('limit'), 24, 1, 60)
    const genderJa = kind === 'base_model' ? (GENDER_TERMS[genderId] ?? '') : ''
    const styleJaList = styleTerms(styleIds)

    // 宽检索：只带「性别 + 用户关键词」，让 BOOTH 把这一类按所选排序（默认热销）铺满。
    // 风格词刻意不拼进检索式——实测拼进去会把结果饿死到个位数（4~10 条）。
    // 素体额外带一个 VRChat：实测能把「服装/贴图」混入压到 24 条里 3 条左右。
    const userJa = toJapaneseQuery(userQuery).text
    const broadRaw = [
        kind === 'base_model' && userJa === '' ? 'VRChat' : '',
        genderJa,
        userJa,
    ].filter(part => part !== '').join(' ')
    const broad = await collectSearch(options, {
        query: userQuery,
        rawQuery: broadRaw === '' ? undefined : broadRaw,
        kind,
        sort,
        page,
        limit,
        minPrice: url.searchParams.get('minPrice'),
        maxPrice: url.searchParams.get('maxPrice'),
    })

    let results = broad.results

    // 衣服/饰品/小道具：风格词本身就是商品词（軍服、ゴシック、和風…），
    // 第一页补一次「风格词 + 性别」的精确检索，命中项顶到最前，再用宽结果补满。
    // 素体不走这条路：风格词配「素体」实测会把衣服混进来，只保留下面的标题加权。
    if (styleJaList.length > 0 && page === 1 && kind !== 'base_model') {
        // 多选风格：每个风格词各搜 4 条，按选择顺序依次顶到前面。
        const narrowHits = []
        for (const term of styleJaList.slice(0, 3)) {
            try {
                const narrow = await collectSearch(options, {
                    query: '',
                    rawQuery: [term, genderJa].filter(part => part !== '').join(' '),
                    kind,
                    sort: 'popular',
                    page: 1,
                    limit: 4,
                    minPrice: null,
                    maxPrice: null,
                })
                narrowHits.push(...narrow.results)
            } catch {
                // 单个风格词检索失败就当没有
            }
        }
        const seen = new Set()
        results = narrowHits.concat(results).filter(item => {
            const key = String(item.id ?? '')
            if (key === '' || seen.has(key)) {
                return false
            }
            seen.add(key)
            return true
        })
    }

    // 先框选大类（按 BOOTH 官方分类），再按性别标记剔一次，最后做风格加权。
    results = boostByStyle(dropMismatched(results, kind, genderId), styleIds)

    return sendJson(res, 200, {
        ok: true,
        ...broad.payload,
        gender: genderId,
        style: styleIds.join(','),
        results: results.slice(0, limit),
    })
}

/** 选购台的选项表：性别 / 风格分组 / 分类 / 排序 / 参考图。 */
function wizardMeta() {
    return {
        genders: [
            { id: 'female', label: '女性' },
            { id: 'male', label: '男性' },
            { id: 'any', label: '不限' },
        ],
        styles: STYLE_GROUPS.map(group => ({
            id: group.id,
            label: group.label,
            items: group.items.map(item => ({ id: item.id, label: item.label })),
        })),
        kinds: WIZARD_KINDS,
        sorts: WIZARD_SORTS,
    }
}

async function handleItemApi(res, url, options) {
    const id = parseItemId(url.searchParams.get('id'))
    if (id === undefined) {
        return sendJson(res, 400, { ok: false, error: '缺少商品编号 id' })
    }
    const item = await fetchBoothItem(options, id)
    const avatar = String(url.searchParams.get('avatar') ?? '').trim()
    const avatarId = parseItemId(url.searchParams.get('avatarId'))
    const list = Array.isArray(item.supported) ? item.supported : []
    let verdict = { support: 'unknown', avatarName: '', source: 'none' }
    if (avatarId !== undefined && list.length > 0) {
        // 精确判定：名单里的商品号就是素体自己的商品号。
        const hit = list.find(entry => entry.id === avatarId)
        verdict = {
            support: hit === undefined ? 'no' : 'yes',
            avatarName: hit === undefined ? avatar : (hit.name === '' ? avatar : hit.name),
            source: 'id',
        }
    } else if (avatar !== '') {
        // 没有名单时退回名字匹配。
        const byName = checkAvatarSupport(item.descriptionFull ?? item.description ?? '', avatar)
        verdict = { support: byName.support, avatarName: byName.avatarName, source: 'name' }
    }
    return sendJson(res, 200, {
        ok: true,
        item,
        support: verdict.support,
        avatarName: verdict.avatarName,
        supportSource: verdict.source,
        supported: list.slice(0, 60),
    })
}

/** 用系统默认浏览器打开 booth.pm 商品页（插件内不开内嵌浏览器）。 */
function handleOpenApi(res, url) {
    const target = String(url.searchParams.get('url') ?? '').trim()
    let parsed
    try {
        parsed = new URL(target)
    } catch {
        return sendJson(res, 400, { ok: false, error: 'url 不合法' })
    }
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'booth.pm') {
        return sendJson(res, 400, { ok: false, error: '只允许打开 booth.pm 的链接' })
    }
    try {
        spawn('cmd', ['/c', 'start', '', parsed.href], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    } catch (error) {
        return sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
    return sendJson(res, 200, { ok: true })
}

async function handleImageApi(res, url, options) {
    const src = String(url.searchParams.get('src') ?? '').trim()
    let target
    try {
        target = new URL(src)
    } catch {
        return sendJson(res, 400, { ok: false, error: 'src 不是合法 URL' })
    }
    if (target.protocol !== 'https:' || !isBoothImageHost(target.hostname)) {
        return sendJson(res, 400, { ok: false, error: '只代理 BOOTH 的图片地址' })
    }
    const response = await fetchBuffer(target.href, options)
    res.writeHead(200, {
        'content-type': response.contentType === '' ? 'image/jpeg' : response.contentType,
        'content-length': String(response.body.length),
        'cache-control': 'public, max-age=86400',
    })
    res.end(response.body)
}

function isBoothImageHost(hostname) {
    const host = hostname.toLowerCase()
    return host === 'booth.pm' || host === 'booth.pximg.net' || host.endsWith('.booth.pximg.net')
}

function sendJson(res, status, payload) {
    const body = Buffer.from(JSON.stringify(payload), 'utf8')
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': String(body.length),
        'cache-control': 'no-store',
    })
    res.end(body)
}
