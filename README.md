# dsh-easy-skills-manager

DSH 技能快捷管理器：把技能放在 DSH 自己的目录里，从左侧栏与会话视图统一开关、分类、编辑和删除；支持拖入 `.md` 导入；并提供 `skill_save` / `skill_list` 两个模型工具，让**任何会话里的 Agent 都能自己装技能**。

## 技能目录

| 作用域 | 位置 |
| --- | --- |
| 全局通用技能 | `<DSH_HOME>/skills/<name>/SKILL.md` |
| 工作区通用技能 | `<工作区>/.dsh/skills/<name>/SKILL.md` |

`<DSH_HOME>` 在本机是 `C:\\Users\\<你>\\AppData\\Roaming\\dsh-desktop\\harness`。

`SKILL.md` 的 frontmatter 里 **name 与 description 都是必填**（DSH 缺一个整条技能就被忽略），`name` 必须是 kebab-case。

## 让 Agent 自己装技能

插件向宿主注册两个工具，并在系统提示里注入编写规范，所以你在**任意对话**里说“帮我装一个 xxx 技能”，Agent 就会直接调用工具写入正确目录，管理器随即识别。

### `skill_save`

| 参数 | 说明 |
| --- | --- |
| `name` | 必填，kebab-case（a-z、0-9、-），2~4 个英文词 |
| `description` | 必填，一句话：做什么 + 什么时候用 |
| `body` | 必填，给模型的完整 Markdown 指令正文（不含 frontmatter） |
| `scope` | `global`（默认）或 `workspace` |
| `overwrite` | 同名已存在时是否覆盖，默认 `false` |

写入后自动生成规范 frontmatter、移除同名的 `.disabled` 残留，并刷新技能缓存。

### `skill_list`

列出全局与当前工作区的技能（名称、描述、是否启用），支持 `query` 过滤与 `scope` 限定，用于安装前查重。

### 注入给 Agent 的规范（节选）

- name 必须 kebab-case、英文语义化，例如 `pdf-table-extract`；中文名无法被加载；
- description 一句话说明「做什么 + 什么时候用」，不换行；
- body 只写指令正文，不要写 `---` frontmatter，也不要重复 name/description；
- 同名先 `skill_list` 查重，再决定是否 `overwrite`；
- 写入后无需重启，面板与 DSH 技能目录会直接识别。

## 功能

### 左侧栏「技能」面板

统计横排（技能 / 已启用 / 分类）、拖入 `.md` 导入（默认全局、需手动命名）、分类与整组开关、技能编辑 / 删除（移入 `.trash`）、行尾 ▾ 就地预览正文。

### 会话视图「技能」

在会话标签行与「对话 / 轨迹 / 上下文 / 编队」并列，列出本会话可用的全部技能并逐项开关；工作区同名技能覆盖全局时标 `×`。

## 开关的实现

开关只重命名 `SKILL.md` ↔ `SKILL.md.disabled`，**从不改动正文**。

> 分类是逻辑分组，成员仍平铺在技能根下——DSH 内置 `skill-filesystem` 只扫描根目录一层，放进子目录会导致技能不被加载。分类归属存于 `<DSH_HOME>/dsh-easy-skills-manager.state.json`。

## 安装

已按 profile 直装方式装入 web profile：

- 目录：`<DSH_HOME>/profiles/web/node_modules/dsh-easy-skills-manager`
- 注册：`profiles/web/package.json` 的 `dependencies` 与 `dsh.profile.bundles`

改完源码后复制到上述目录并**重启 DSH**。

## 接口

| 路由 | 说明 |
| --- | --- |
| `GET /plugins/dsh-easy-skills-manager/state` | 技能与分类 |
| `GET /plugins/dsh-easy-skills-manager/skill` | 单个技能正文 |
| `POST /plugins/dsh-easy-skills-manager/toggle` | 单个技能启停 |
| `POST /plugins/dsh-easy-skills-manager/import` | 导入或新建 |
| `POST /plugins/dsh-easy-skills-manager/update` | 编辑 |
| `POST /plugins/dsh-easy-skills-manager/delete` | 删除到 .trash |
| `POST /plugins/dsh-easy-skills-manager/category` | 分类 create / rename / delete / assign / toggle |
