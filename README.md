# dsh-booth-search

给 DSH 用的 BOOTH 商品搜索插件：做 VRChat 造型/Avatar 时直接搜衣服、改模、着色器、素体、道具，返回**商品编号 + 标题 + 店铺 + 价格 + 分类 + 封面图 + 可点链接**。

关键词写中文即可（水手服 / 女仆装 / 着色器 / 素体…），插件在宿主侧转成日文再查 BOOTH，接口响应与工具输出都不会带出日文串。英文关键词原样使用。

## 安装

```bash
dsh plugin add file:D:/DS/plugins/booth-search
```

本地目录安装后，在 DSH 左下角点「热重启 DSH」让宿主路由生效；之后刷新页面即可看到「BOOTH」标签页。

## 工具

### `booth_search`

| 参数 | 说明 |
| --- | --- |
| `query` | 关键词（必填），中文即可，例：`水手服`、`猫耳 配饰` |
| `kind` | 偏向分类：`auto`(默认) / `clothing` 衣装 / `shader` 着色器 / `base_model` 素体 / `accessory` 配饰 / `texture` 贴图 / `animation` 动画 / `prop` 小物 |
| `sort` | `recommended`(默认) / `newest` / `price_asc` / `price_desc` |
| `minPrice` / `maxPrice` | 价格区间（日元，整数） |
| `page` | 第几页，从 1 开始 |
| `limit` | 返回条数 1–12，默认 6 |
| `includeCover` | 是否附封面图，默认 true（最多 6 张/次） |

结果自带封面图（图片附件）与直达链接；`kind` 只是附加日文词偏向搜索，不做硬过滤。

### `booth_item`

按商品编号取完整信息：标题、价格区间、店铺、简介摘录、封面图、链接。参数为纯数字编号或商品链接。

## BOOTH 独立页

包内 `client.js` 在会话标题栏的视图排（对话 / 轨迹 / 上下文 / BOOTH / 画廊 / 编队）注册一个独立页面：

- 打开即热销榜（BOOTH 全站 `sort=popular` 列表），底部翻页，每页 24 件；翻页停在热销榜还是关键词结果，取决于当前搜索状态。
- 搜索框 + 分类/排序筛选，回车即搜，结果同样可翻页；「回热销榜」按钮清空关键词并回到榜单首页。
- 分类可以单独用：搜索框留空、只选分类时，切分类即按该分类词搜索（例如分类选「衣装」= 搜「衣装」），不用先输关键词。
- 点卡片在右侧出详情栏（sticky 吸顶，列表滚动时保持可见）：封面、价格区间、商品编号、简介、直达 BOOTH 的链接。
- 页面数据走宿主同源接口 `/api/booth-search/search|item|image`；封面由宿主代理转发（绕开防盗链，只允许 `booth.pximg.net` 与 `booth.pm`）。
- 挂载期间隐藏会话输入框（composer），切走即恢复。

## 配置

在 profile 的 `cordis.patch.yml` 覆盖同名条目（不改也能用）：

```yaml
- id: dsh-booth-search
  config:
    proxy: http://127.0.0.1:10090   # 走代理；留空=直连
    timeoutMs: 20000
    lang: ja                         # BOOTH 站点语言（ja / en）
    maxCovers: 6                     # 每次最多附带几张封面
```

环境变量 `BOOTH_PROXY` 可作为 proxy 的兜底。

## 注意

- 实时抓取 BOOTH 公开页面，不登录、不下载付费内容。
- 价格是抓取时的页面价，可能只是区间下限（`booth_item` 给完整区间）。
- 封面图依赖宿主 `attachments` 服务；没有该服务时仍返回纯文字结果。

## 结构

```
index.js            宿主侧：booth_search / booth_item 两个工具 + /api/booth-search 的 search/item/image 路由
client.js           客户端：注册到 conversation.view 的「BOOTH」独立页
cordis.patch.yml    bundle patch（insert dsh-booth-search）
locale/*.json       中英文案
icon.svg            图标
```

## 生效方式

改宿主侧 `index.js` 后重启一次宿主（左下角「热重启 DSH」）让新路由接管；只改 `client.js` 刷新页面即可。

## License

MIT。非 BOOTH 官方插件；仅抓取公开页面，请遵守 BOOTH 使用条款并控制请求频率。
