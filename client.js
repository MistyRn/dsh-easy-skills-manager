/**
 * dsh-easy-skills-manager — 浏览器半侧。
 * - 左侧栏「技能」面板：已安装（全局生效）/ 工作区技能，分类、编辑、删除、预览、拖拽归类
 * - 会话视图「技能」：本会话全部技能开关
 * - UI 走 @deepseek-ai/dsh-client-ui-primitives 的原生控件与设计令牌
 */
window.__ModuleLoader__.load({
  id: 'dsh-easy-skills-manager',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var ReactDOM = require('react-dom')
    var h = React.createElement

    var prim = null
    try { prim = require('@deepseek-ai/dsh-client-ui-primitives') } catch (e) { prim = null }
    var NativeButton = prim && prim.Button ? prim.Button : null
    var NativeSwitch = prim && prim.Switch ? prim.Switch : null
    var NativeToast = prim && prim.Toast ? prim.Toast : null

    var NS = 'dsh-easy-skills-manager'
    var ROUTE = '/plugins/dsh-easy-skills-manager'
    var PANEL_ID = 'dsh-easy-skills-manager'
    var VIEW_ID = 'skills'
    var STYLE_ID = NS + '-style'
    var KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
    var MAX_FILE_BYTES = 512 * 1024
    var DRAG_STATE = null

    var zh = {
      navLabel: '技能', title: '技能', subtitle: '本机技能目录',
      statSkills: '技能', statEnabled: '已启用', statCategories: '分类',
      globalSection: '已安装', globalHint: '这里启用的技能对所有会话生效',
      workspaceSection: '工作区技能', workspaceHint: '仅当前工作区生效',
      workspaceNone: '暂无可选工作区',
      uncategorized: '未分类', newCategory: '分类', newSkill: '新建技能',
      loading: '加载中…', retry: '重试', importSkill: '导入技能',
      empty: '暂无技能', emptyHint: '拖入 .md 或点「新建技能」',
      dropHere: '把 .md 拖到这里，导入为已安装技能', dropOver: '松开即可导入',
      invalidName: '非 kebab-case，DSH 不会加载', noDescription: '（无描述）',
      importTitle: '导入技能', importNameLabel: '技能名（kebab-case）', importNameHint: '作为目录名与 frontmatter 的 name',
      scopeLabel: '导入到', scopeGlobal: '已安装（全局生效）', scopeWorkspace: '工作区技能（仅当前工作区）',
      confirm: '确定', cancel: '取消', importing: '导入中…', importDone: '已导入', save: '保存', saving: '保存中…',
      saved: '已保存', deleted: '已删除', deleteTitle: '删除技能', deleteConfirm: '确定删除「{name}」吗？',
      deleteHint: '目录会被移入该技能根的 .trash，可手动恢复。',
      editTitle: '编辑技能', nameLabel: '技能名（kebab-case）', descLabel: '描述', bodyLabel: '正文（Markdown）',
      categoryLabel: '分类',
      catTitle: '新建分类', catRenameTitle: '重命名分类', catNameLabel: '分类名称',
      catHint: '分类是逻辑分组，成员仍平铺在技能根下（DSH 只扫描一层）',
      catDeleteTitle: '删除分类', catDeleteConfirm: '删除分类「{name}」？成员会回到未分类，技能本身不受影响。',
      catCreated: '已创建分类', catSaved: '分类已更新', catDeleted: '分类已删除',
      nameInvalid: '技能名必须是 kebab-case', toggleFailed: '操作失败', refresh: '刷新',
      modeOff: '停用（不在目录中显示）', modeAvailable: '按需（仅在目录中，可被调用）', modePinned: '常驻（每轮注入系统提示）',
      modeOffLabel: '停用', modeOffHint: '不显示', modeAvailableLabel: '按需', modeAvailableHint: '仅可调用', modePinnedLabel: '常驻', modePinnedHint: '每轮生效',
      enableAll: '全部启用', disableAll: '全部停用',
      modeOffToast: '已停用', modeAvailableToast: '已设为按需', modePinnedToast: '已设为常驻',
      movedToGlobal: '已移入「已安装」', movedToWorkspace: '已移入「工作区技能」', movedCategory: '已移动到「{name}」',
      copiedToGlobal: '已复制到「已安装」', copiedToWorkspace: '已复制到「工作区技能」',
      dragHint: '拖动这里可归类或移到另一分区',
      viewTitle: '技能', viewSubtitle: '本会话可用的全部技能 · 开关即时生效',
      viewSearch: '搜索技能…', viewNoMatch: '没有匹配的技能', viewScopeWs: '工作区', viewScopeGlobal: '已安装',
      viewShadowed: '被工作区同名技能覆盖',
      sessionSkills: '本会话技能', sessionHint: '只对本会话生效，不改全局设置',
      heroPreset: '技能', heroPresetTitle: '新会话技能',
      heroPresetHint: '先在这里选好，发出第一条消息即生效。只影响这一个新会话，不改全局设置。',
      heroPresetDone: '已设定', heroPresetClear: '清除预置', heroPresetCleared: '预置已清除',
      heroPresetEmpty: '预置为空，新会话将沿用总面板状态',
      heroPresetBind: '仅对工作区生效：',
      noSession: '当前会话尚未就绪',
      globalAlreadyOn: '该技能已在全局开启，无需重复加入本会话',
      dropToWorkspace: '把下面的技能拖到这里，仅在本工作区生效',
      dropSkillHere: '把下面的技能拖到这里，仅在本会话生效', pinnedRemoved: '已移出本会话',
      preview: '预览', collapse: '折叠', expand: '展开',
      searchSkills: '搜索技能…', storage: '存储位置', storageTitle: '技能存储位置', storageHint: '全局技能会读写这里。修改后不会移动已有文件；只有设为「常驻」的技能能脱离默认目录生效。',
      storageDefault: '恢复默认', storageSaved: '存储位置已更新', storageInvalid: '请填写绝对路径',
      restore: '还原到原分区', linked: '链接', unlinkHint: '仅移除链接，源技能保留在原来的位置。',
      trash: '回收站', trashTitle: '回收站', trashHint: '删除的技能会留在对应的 .trash 里，可随时还原。',
      trashEmpty: '回收站是空的', trashRestored: '已还原', trashRestore: '还原', trashWhen: '删除于',
    }

    var en = {
      navLabel: 'Skills', title: 'Skills', subtitle: 'Local skill directory',
      statSkills: 'Skills', statEnabled: 'Enabled', statCategories: 'Categories',
      globalSection: 'Installed', globalHint: 'Skills enabled here apply to every conversation',
      workspaceSection: 'Workspace skills', workspaceHint: 'Only applies to the current workspace',
      workspaceNone: 'No workspace available',
      uncategorized: 'Uncategorized', newCategory: 'Category', newSkill: 'New skill',
      loading: 'Loading…', retry: 'Retry', importSkill: 'Import skill',
      empty: 'No skills', emptyHint: 'Drop a .md file or click New skill',
      dropHere: 'Drop .md files here to install', dropOver: 'Release to import',
      invalidName: 'Not kebab-case; DSH will not load it', noDescription: '(no description)',
      importTitle: 'Import skill', importNameLabel: 'Skill name (kebab-case)', importNameHint: 'Folder name and frontmatter name',
      scopeLabel: 'Install to', scopeGlobal: 'Installed (global)', scopeWorkspace: 'Workspace skills (this workspace)',
      confirm: 'OK', cancel: 'Cancel', importing: 'Importing…', importDone: 'Imported', save: 'Save', saving: 'Saving…',
      saved: 'Saved', deleted: 'Deleted', deleteTitle: 'Delete skill', deleteConfirm: 'Delete "{name}"?',
      deleteHint: 'The folder moves into .trash of that skill root; restore manually if needed.',
      editTitle: 'Edit skill', nameLabel: 'Skill name (kebab-case)', descLabel: 'Description', bodyLabel: 'Body (Markdown)',
      categoryLabel: 'Category',
      catTitle: 'New category', catRenameTitle: 'Rename category', catNameLabel: 'Category name',
      catHint: 'Categories are logical groups; members stay flat in the root (DSH scans one level)',
      catDeleteTitle: 'Delete category', catDeleteConfirm: 'Delete category "{name}"? Members return to Uncategorized.',
      catCreated: 'Category created', catSaved: 'Category updated', catDeleted: 'Category deleted',
      nameInvalid: 'Skill name must be kebab-case', toggleFailed: 'Action failed', refresh: 'Refresh',
      modeOff: 'Off (hidden from catalog)', modeAvailable: 'On demand (catalog only)', modePinned: 'Pinned (injected every turn)',
      modeOffLabel: 'Off', modeOffHint: 'hidden', modeAvailableLabel: 'On demand', modeAvailableHint: 'callable only', modePinnedLabel: 'Pinned', modePinnedHint: 'every turn',
      enableAll: 'Enable all', disableAll: 'Disable all',
      modeOffToast: 'Turned off', modeAvailableToast: 'Set to on demand', modePinnedToast: 'Pinned',
      movedToGlobal: 'Moved into Installed', movedToWorkspace: 'Moved into Workspace skills', movedCategory: 'Moved to "{name}"',
      copiedToGlobal: 'Copied into Installed', copiedToWorkspace: 'Copied into Workspace skills',
      dragHint: 'Drag to group or move between sections',
      viewTitle: 'Skills', viewSubtitle: 'Every skill available in this conversation · toggles apply instantly',
      viewSearch: 'Search skills…', viewNoMatch: 'No matching skills', viewScopeWs: 'Workspace', viewScopeGlobal: 'Installed',
      viewShadowed: 'Overridden by a workspace skill of the same name',
      sessionSkills: 'Session skills', sessionHint: 'Applies to this conversation only',
      heroPreset: 'Skills', heroPresetTitle: 'Skills for the new conversation',
      heroPresetHint: 'Choose here first; it takes effect once you send the first message. Affects this new conversation only.',
      heroPresetDone: 'Saved', heroPresetClear: 'Clear preset', heroPresetCleared: 'Preset cleared',
      heroPresetEmpty: 'No preset; the new conversation follows the panel state',
      heroPresetBind: 'Applies only in workspace:',
      noSession: 'This conversation is not ready yet',
      globalAlreadyOn: 'This skill is already enabled globally; no need to add it here',
      dropToWorkspace: 'Drag a skill here to use it in this workspace only',
      dropSkillHere: 'Drag a skill here to use it in this conversation only', pinnedRemoved: 'Removed from this session',
      preview: 'Preview', collapse: 'Collapse', expand: 'Expand',
      searchSkills: 'Search skills…', storage: 'Storage', storageTitle: 'Skill storage location', storageHint: 'Global skills are read from here. Existing files are not moved; only pinned skills take effect outside the default directory.',
      storageDefault: 'Reset', storageSaved: 'Storage location updated', storageInvalid: 'Enter an absolute path',
      restore: 'Restore to section', linked: 'Link', unlinkHint: 'Removes the link only; the source skill stays where it is.',
      trash: 'Trash', trashTitle: 'Trash', trashHint: 'Deleted skills stay in .trash and can be restored anytime.',
      trashEmpty: 'Trash is empty', trashRestored: 'Restored', trashRestore: 'Restore', trashWhen: 'Deleted',
    }

    var CSS = [
      '.dsq{font-family:inherit;color:var(--dsw-alias-label-primary);font-size:13px}',
      '.dsq-panel{box-sizing:border-box;height:100%;min-height:0;overflow-y:auto;overflow-x:hidden;padding:20px clamp(16px,3vw,34px) 44px;display:flex;flex-direction:column;gap:12px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2) transparent;scrollbar-gutter:stable}',
      '.dsq-head-search{display:flex;gap:8px;align-items:center;width:100%}',
      'html[data-dsq-skills-view] [data-composer-seat]{display:none!important}',
      'html[data-dsq-skills-view] [data-conversation-region="composer"]{display:none!important}',
      '.dsq-card-body{overflow:visible}',
      '.dsq-list-scroll{overflow-x:hidden;min-height:0;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2) transparent;overscroll-behavior:contain}',
      '.dsq-list-scroll.is-capped{overflow-y:auto;max-height:330px}',
      '.dsq-list-scroll.is-free{overflow:visible;max-height:none}',
      '.dsq-list-scroll::-webkit-scrollbar{width:10px}',
      '.dsq-list-scroll::-webkit-scrollbar-track{background:transparent}',
      '.dsq-list-scroll::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2);border-radius:6px;border:2px solid transparent;background-clip:padding-box}',
      '.dsq-card-body::-webkit-scrollbar{width:10px}',
      '.dsq-card-body::-webkit-scrollbar-track{background:transparent}',
      '.dsq-card-body::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2);border-radius:6px;border:2px solid transparent;background-clip:padding-box}',
      '.dsq-panel::-webkit-scrollbar,.dsq-view-body::-webkit-scrollbar,.dsq-modal::-webkit-scrollbar{width:10px;height:10px}',
      '.dsq-panel::-webkit-scrollbar-track,.dsq-view-body::-webkit-scrollbar-track,.dsq-modal::-webkit-scrollbar-track{background:transparent}',
      '.dsq-panel::-webkit-scrollbar-thumb,.dsq-view-body::-webkit-scrollbar-thumb,.dsq-modal::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2);border-radius:6px;border:2px solid transparent;background-clip:padding-box}',
      '.dsq-panel::-webkit-scrollbar-thumb:hover,.dsq-view-body::-webkit-scrollbar-thumb:hover,.dsq-modal::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-label-tertiary);background-clip:padding-box}',
      '.dsq-view-body{scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2) transparent}',
      '.dsq-panel>*{width:100%;max-width:1040px;margin:0 auto;flex:0 0 auto}',
      '.dsq-head{display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap;padding:2px 2px 0}',
      '.dsq-head-main{flex:1;min-width:0}',
      '.dsq-h-title{font-size:19px;font-weight:600;line-height:1.25;letter-spacing:.2px}',
      '.dsq-h-sub{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:4px}',
      '.dsq-head-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;align-items:center}',
      '.dsq-search{flex:1;min-width:0;max-width:420px}',

      '.dsq-stats{box-sizing:border-box;display:flex;align-items:center;flex-wrap:nowrap;gap:18px;padding:10px 16px;border-radius:10px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);overflow:hidden}',
      '.dsq-stat{display:flex;align-items:baseline;gap:6px;min-width:0;flex:none}',
      '.dsq-stat+.dsq-stat{padding-left:18px;border-left:1px solid var(--dsw-alias-border-l1)}',
      '.dsq-stat-k{font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.dsq-stat-v{font-size:18px;font-weight:600;line-height:1.15}',

      '.dsq-card{box-sizing:border-box;border-radius:10px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);overflow:hidden;transition:border-color .15s ease,background .15s ease}',
      '.dsq-card.is-drop{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-bg-layer-2)}',
      '.dsq-card-head{display:flex;align-items:center;gap:8px;row-gap:6px;flex-wrap:wrap;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.dsq-card-title{font-size:13px;font-weight:600;white-space:nowrap}',
      '.dsq-card-hint{font-size:11.5px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
      '.dsq-card-count{font-size:11px;color:var(--dsw-alias-label-tertiary);flex:none}',
      '.dsq-card-actions{display:flex;align-items:center;gap:8px;margin-left:auto;flex:none;min-width:0}',
      '.dsq-card-body{padding:10px 12px;display:flex;flex-direction:column;gap:8px}',

      '.dsq-drop{box-sizing:border-box;display:flex;align-items:center;gap:10px;padding:11px 14px;border-radius:10px;border:1.5px dashed var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary);font-size:12.5px}',
      '.dsq-drop.is-over{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}',
      '.dsq-drop-text{flex:1;min-width:0}',

      '.dsq-cat{display:flex;align-items:center;gap:6px;padding:5px 6px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);transition:background .15s ease,box-shadow .15s ease}',
      '.dsq-cat.is-drop{box-shadow:inset 0 0 0 1.5px var(--dsw-alias-state-business-primary)}',
      '.dsq-cat-zone{border-radius:8px}',
      '.dsq-cat-zone.is-hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dsq-cat-name{font-size:12.5px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsq-cat-count{font-size:11px;color:var(--dsw-alias-label-tertiary);flex:none}',
      '.dsq-chev{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;flex:none;border:none;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:transform .15s ease}',
      '.dsq-chev:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dsq-chev.is-open{transform:rotate(90deg)}',
      '.dsq-chev:disabled{opacity:.35;cursor:default}',

      '.dsq-item{display:flex;flex-direction:column}',
      '.dsq-row{display:flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:7px 8px 7px 10px;background:var(--dsw-alias-bg-layer-1);transition:background .12s ease,border-color .12s ease}',
      '.dsq-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsq-row.is-open{border-bottom-left-radius:0;border-bottom-right-radius:0;border-bottom-color:transparent}',
      '.dsq-row.is-dragging{opacity:.5}',
      '.dsq-row-main{flex:1;min-width:0}',
      '.dsq-row-name{font-size:13px;display:flex;align-items:center;gap:6px}',
      '.dsq-row-name.is-invalid{color:var(--dsw-alias-state-warn-primary)}',
      '.dsq-row-desc{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsq-badge{font-size:10px;line-height:15px;padding:0 6px;border-radius:8px;flex:none;background:var(--dsw-alias-state-warn-primary);color:#fff}',
      '.dsq-chip{font-size:10px;line-height:15px;padding:0 7px;border-radius:8px;flex:none;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary)}',
      '.dsq-preview{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);border-top:none;border-radius:0 0 8px 8px;background:var(--dsw-alias-bg-layer-2);padding:10px 12px;max-height:300px;overflow:auto}',
      '.dsq-preview pre{margin:0;font-family:ui-monospace,Consolas,monospace;font-size:11.5px;line-height:1.6;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-secondary)}',
      '.dsq-preview-meta{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-bottom:6px}',

      '.dsq-empty{font-size:12.5px;color:var(--dsw-alias-label-tertiary);padding:18px 6px;text-align:center}',
      '.dsq-group{display:flex;flex-direction:column;gap:6px}',
      '.dsq-toggle-wrap{display:inline-flex;flex:none}',
      '.dsq-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:6px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none;padding:0;transition:background .12s ease,color .12s ease}',
      '.dsq-iconbtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dsq-iconbtn:disabled{opacity:.4;cursor:not-allowed}',
      '.dsq-drag{cursor:grab;color:var(--dsw-alias-label-tertiary)}',
      '.dsq-drag:active{cursor:grabbing}',
      '.dsq-drag:hover{color:var(--dsw-alias-label-primary)}',
      '.dsq-fallback-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:5px;height:28px;padding:0 10px;border-radius:8px;font-size:12.5px;line-height:1;cursor:pointer;white-space:nowrap;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit}',
      '.dsq-fallback-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsq-fallback-btn:disabled{opacity:.45;cursor:not-allowed}',
      '.dsq-fallback-btn.is-primary{background:var(--dsw-alias-state-business-primary);border-color:transparent;color:#fff}',
      '.dsq-fallback-switch{position:relative;width:32px;height:18px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);cursor:pointer;flex:none;padding:0}',
      '.dsq-fallback-switch.is-on{background:var(--dsw-alias-state-business-primary);border-color:transparent}',
      '.dsq-fallback-switch:disabled{opacity:.45;cursor:not-allowed}',
      '.dsq-fallback-knob{position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#fff;transition:left .15s ease}',
      '.dsq-fallback-switch.is-on .dsq-fallback-knob{left:16px}',
      '.dsq-select,.dsq-input,.dsq-textarea{box-sizing:border-box;width:100%;padding:0 10px;height:28px;border-radius:8px;font-size:12.5px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);outline:none;font-family:inherit}',
      '.dsq-select:focus,.dsq-input:focus,.dsq-textarea:focus{border-color:var(--dsw-alias-state-business-primary)}',
      '.dsq-select{width:auto;max-width:100%;padding-right:6px;line-height:26px}',
      '.dsq-textarea{height:auto;resize:vertical;min-height:170px;padding:8px 10px;line-height:1.55;font-family:ui-monospace,Consolas,monospace}',
      '.dsq-overlay{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:22px;background:rgba(0,0,0,.48)}',
      '.dsq-modal{box-sizing:border-box;width:min(660px,94vw);max-height:88vh;overflow:auto;padding:18px 20px;border-radius:12px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);box-shadow:0 16px 48px rgba(0,0,0,.35)}',
      '.dsq-modal-title{font-size:14px;font-weight:600;margin-bottom:12px}',
      '.dsq-field{margin-bottom:10px}',
      '.dsq-label{display:block;font-size:12px;color:var(--dsw-alias-label-secondary);margin-bottom:4px}',
      '.dsq-hint{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:4px}',
      '.dsq-err{color:var(--dsw-alias-state-error-primary)}',
      '.dsq-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}',
      '.dsq-toast{position:sticky;bottom:0;align-self:center;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 12px;font-size:12px}',

      '.dsq-folders{display:flex;flex-wrap:wrap;gap:6px;padding-bottom:2px}',
      '.dsq-folder{display:inline-flex;align-items:center;gap:6px;max-width:280px;padding:5px 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;transition:background .12s ease,border-color .12s ease,color .12s ease}',
      '.dsq-folder:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dsq-folder.is-active{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);box-shadow:inset 0 0 0 1px var(--dsw-alias-state-business-primary)}',
      '.dsq-folder.is-drop{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}',
      '.dsq-folder-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsq-tri{position:relative;display:inline-flex;flex:none;width:78px;height:22px;padding:1px;border-radius:11px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);transition:opacity .15s ease}',
      '.dsq-tri.is-disabled{opacity:.45}',
      '.dsq-tri-thumb{position:absolute;top:1px;left:1px;width:calc((100% - 2px) / 3);height:calc(100% - 2px);border-radius:9px;background:var(--dsw-alias-state-business-primary);transition:transform .16s ease;pointer-events:none}',
      '.dsq-tri[data-mode="off"] .dsq-tri-thumb{background:var(--dsw-alias-label-tertiary)}',
      '.dsq-tri[data-mode="available"] .dsq-tri-thumb{background:var(--dsw-alias-state-warn-primary, #8a8f9e)}',
      '.dsq-tri-dot{position:absolute;top:50%;width:3px;height:3px;margin-top:-1.5px;border-radius:50%;background:var(--dsw-alias-label-primary);opacity:.28;pointer-events:none;z-index:0}',
      '.dsq-tri-thumb{z-index:1}',
      '.dsq-tri-seg{position:relative;z-index:2;flex:1;min-width:0;padding:0;border:none;border-radius:9px;background:transparent;cursor:pointer;color:var(--dsw-alias-label-tertiary);font-family:inherit;font-size:9px;line-height:1;letter-spacing:.2px}',
      '.dsq-tri-seg:disabled{cursor:not-allowed}',
      '.dsq-tri-seg.is-on{color:#fff}',
      '.dsq-toolbar-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-bottom:2px}',
      '.dsq-legend{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
      '.dsq-legend b{font-weight:600;color:var(--dsw-alias-label-secondary)}',
      '.dsq-view{box-sizing:border-box;height:100%;display:flex;flex-direction:column;overflow:hidden}',
      '.dsq-view-head{display:flex;align-items:center;gap:12px;padding:14px clamp(16px,3vw,28px);border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}',
      '.dsq-view-head-main{flex:1;min-width:0}',
      '.dsq-view-search{width:200px;flex:none}',
      '.dsq-view-body{flex:1;min-height:0;overflow-y:auto;padding:14px clamp(16px,3vw,28px) 32px;display:flex;flex-direction:column;gap:14px}',
      '.dsq-view-body>*{width:100%;max-width:900px;margin:0 auto}',
      '.dsq-view-sec-title{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600;margin-bottom:6px}',
      '.dsq-session-zone{box-sizing:border-box;width:100%;border:1.5px dashed var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;transition:border-color .15s ease,background .15s ease}',
      '.dsq-session-zone.is-drop{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-bg-layer-2)}',
      '.dsq-view-sec{box-sizing:border-box;width:100%;border-radius:10px;padding:10px 12px;border:1.5px dashed var(--dsw-alias-border-l2);transition:border-color .15s ease,background .15s ease}',
      '.dsq-view-list{overflow-y:auto;overflow-x:hidden;max-height:330px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2) transparent;padding-right:2px}',
      '.dsq-view-list::-webkit-scrollbar{width:10px}',
      '.dsq-view-list::-webkit-scrollbar-track{background:transparent}',
      '.dsq-view-list::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2);border-radius:6px;border:2px solid transparent;background-clip:padding-box}',
      '.dsq-view-sec.is-drop{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-bg-layer-2)}',
      '.dsq-hero{position:relative;display:inline-flex;align-items:center;flex:none}',
      '.dsq-hero-toast{position:absolute;top:calc(100% + 6px);right:0;z-index:5;white-space:nowrap;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:4px 8px;font-size:11px;color:var(--dsw-alias-label-secondary)}',
    ].join('')

    function ensureStyle() {
      if (typeof document === 'undefined' || !document.head) return
      if (document.getElementById(STYLE_ID)) return
      var el = document.createElement('style')
      el.id = STYLE_ID
      el.textContent = CSS
      document.head.appendChild(el)
    }

    var messageOf = function (e) { return e && typeof e.message === 'string' && e.message ? e.message : String(e) }

    async function readResponse(response) {
      var text = await response.text()
      var value = null
      if (text !== '') { try { value = JSON.parse(text) } catch (_) { value = null } }
      if (!response.ok) throw new Error((value && (value.error || value.message)) || ('HTTP ' + response.status))
      return value || {}
    }
    function getJson(url) { return fetch(url, { credentials: 'same-origin', cache: 'no-store' }).then(readResponse) }
    function postJson(path, body) {
      return fetch(ROUTE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }).then(readResponse)
    }

    var STAR = 'M0,-1 Q0.14,-0.14 1,0 Q0.14,0.14 0,1 Q-0.14,0.14 -1,0 Q-0.14,-0.14 0,-1 Z'

    function StarMark(props) {
      var size = props && typeof props.size === 'number' ? props.size : 16
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16',
        fill: 'none', stroke: 'currentColor', strokeLinejoin: 'round', strokeLinecap: 'round',
        'aria-hidden': 'true', focusable: 'false',
      },
        h('path', { d: STAR, transform: 'translate(5.0,5.0) scale(4.3)', strokeWidth: 1.05 / 4.3 }),
        h('path', { d: STAR, transform: 'translate(11.9,9.0) scale(2.45)', strokeWidth: 1.05 / 2.45 }),
        h('path', { d: STAR, transform: 'translate(4.4,12.7) scale(1.55)', strokeWidth: 1.05 / 1.55 }),
      )
    }

    function PathIcon(props) {
      return h('svg', {
        width: props.size || 13, height: props.size || 13, viewBox: '0 0 16 16',
        fill: props.stroke ? 'none' : 'currentColor',
        stroke: props.stroke ? 'currentColor' : undefined,
        strokeWidth: props.stroke ? 1.5 : undefined,
        strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', focusable: 'false',
      }, h('path', { d: props.d }))
    }

    var P = {
      plus: 'M8 2.6a.9.9 0 0 1 .9.9v3.6h3.6a.9.9 0 1 1 0 1.8H8.9v3.6a.9.9 0 1 1-1.8 0V8.9H3.5a.9.9 0 1 1 0-1.8h3.6V3.5a.9.9 0 0 1 .9-.9Z',
      pencil: 'M11.7 2.3a1.6 1.6 0 0 1 2.3 2.3l-7.4 7.4-2.9.6.6-2.9 7.4-7.4Z',
      trash: 'M6 2.5h4l.5 1h2.5v1.3H3V3.5h2.5l.5-1ZM4 6h8l-.6 7.2a1.2 1.2 0 0 1-1.2 1.1H5.8a1.2 1.2 0 0 1-1.2-1.1L4 6Z',
      folder: 'M2.5 4.4A1.4 1.4 0 0 1 3.9 3h2.2c.37 0 .72.15.98.41l.6.6h4.4A1.4 1.4 0 0 1 13.5 5.4v6.2A1.4 1.4 0 0 1 12.1 13H3.9a1.4 1.4 0 0 1-1.4-1.4V4.4Z',
      refresh: 'M13.3 7.4A5.3 5.3 0 1 0 8 13.3c1.6 0 3-.7 4-1.9M13.3 2.9v3.2a.6.6 0 0 1-.6.6H9.5',
      chevronRight: 'M6.2 3.6 10.6 8l-4.4 4.4',
      upload: 'M8 11.2V3.4M8 3.4 4.8 6.6M8 3.4l3.2 3.2M3 12.2v.8c0 .6.5 1.1 1.1 1.1h7.8c.6 0 1.1-.5 1.1-1.1v-.8',
      drag: 'M3 4.5h10M3 8h10M3 11.5h10',
      restore: 'M6 4.5 3.2 7.2 6 9.9M3.4 7.2h5.2a3.9 3.9 0 1 1 0 7.8H6.4',
    }

    function Btn(props) {
      if (NativeButton) {
        return h(NativeButton, {
          size: props.size || 'sm',
          variant: props.variant || 'ghost',
          className: props.className,
          disabled: props.disabled,
          title: props.title,
          onClick: props.onClick,
          icon: props.icon,
        }, props.children)
      }
      return h('button', {
        type: 'button',
        className: 'dsq-fallback-btn' + (props.variant === 'primary' ? ' is-primary' : '') + (props.className ? ' ' + props.className : ''),
        disabled: props.disabled, title: props.title, onClick: props.onClick,
      }, props.icon, props.children)
    }

    function Toggle(props) {
      if (NativeSwitch) {
        return h('span', { className: 'dsq-toggle-wrap' }, h(NativeSwitch, {
          checked: !!props.on, onChange: props.onToggle, label: props.label || props.title, title: props.title, disabled: props.disabled,
        }))
      }
      return h('button', {
        type: 'button', className: 'dsq-fallback-switch' + (props.on ? ' is-on' : ''),
        role: 'switch', 'aria-checked': !!props.on, disabled: props.disabled,
        onClick: function (e) { e.stopPropagation(); props.onToggle() }, title: props.title,
      }, h('span', { className: 'dsq-fallback-knob' }))
    }

    /** 三挡滑动开关：停用 / 按需 / 常驻。 */
    function TriSwitch(props) {
      var order = ['off', 'available', 'pinned']
      var idx = props.mode === 'pinned' ? 2 : props.mode === 'off' ? 0 : 1
      var labels = props.labels || {}
      return h('div', {
        className: 'dsq-tri' + (props.disabled ? ' is-disabled' : ''),
        'data-mode': props.mode || 'available',
        role: 'group',
        'aria-label': props.label || '模式',
      },
        h('i', { className: 'dsq-tri-dot', style: { left: '16.6%' } }),
        h('i', { className: 'dsq-tri-dot', style: { left: '50%' } }),
        h('i', { className: 'dsq-tri-dot', style: { left: '83.4%' } }),
        h('span', { className: 'dsq-tri-thumb', style: { transform: 'translateX(' + (idx * 100) + '%)' } }),
        order.map(function (m) {
          var on = props.mode === m || (m === 'available' && (props.mode === 'available' || props.mode == null))
          return h('button', {
            key: m, type: 'button',
            className: 'dsq-tri-seg' + (on ? ' is-on' : ''),
            title: labels[m] || m,
            'aria-pressed': on,
            disabled: props.disabled,
            onClick: function (e) { e.stopPropagation(); if (props.mode !== m) props.onChange(m) },
          })
        }),
      )
    }

    function Chevron(props) {
      return h('button', {
        type: 'button', className: 'dsq-chev' + (props.open ? ' is-open' : ''),
        title: props.title, 'aria-label': props.title, 'aria-expanded': !!props.open,
        disabled: props.disabled,
        onClick: function (e) { e.stopPropagation(); props.onClick() },
      }, h(PathIcon, { d: P.chevronRight, size: 12, stroke: true }))
    }

    function IconButton(props) {
      return h('button', {
        type: 'button', className: 'dsq-iconbtn' + (props.className ? ' ' + props.className : ''),
        title: props.title, 'aria-label': props.title, disabled: props.disabled,
        draggable: props.draggable === true,
        onDragStart: props.onDragStart,
        onDragEnd: props.onDragEnd,
        onClick: function (e) { e.stopPropagation(); if (props.onClick) props.onClick() },
      }, h(PathIcon, { d: props.d, size: props.iconSize || 13, stroke: props.stroke }))
    }

    function SkillRow(props) {
      var s = props.skill || {}
      var invalid = !KEBAB.test(String(s.name || ''))
      var open = !!props.expanded
      var pv = props.preview || null

      var preview = null
      if (open) {
        preview = h('div', { className: 'dsq-preview' },
          h('div', { className: 'dsq-preview-meta' }, s.scope === 'workspace' ? props.t('workspaceSection') : props.t('globalSection'), ' · ', s.description || props.t('noDescription')),
          pv && pv.loading ? h('div', { className: 'dsq-empty' }, props.t('loading'))
            : pv && pv.error ? h('div', { className: 'dsq-empty dsq-err' }, pv.error)
            : h('pre', null, (pv && pv.text) || ''),
        )
      }

      return h('div', { className: 'dsq-item' },
        h('div', { className: 'dsq-row' + (open ? ' is-open' : '') + (props.dragging ? ' is-dragging' : '') },
          h('div', { className: 'dsq-row-main' },
            h('div', { className: 'dsq-row-name' + (invalid ? ' is-invalid' : '') },
              h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, s.name || s.dirName),
              invalid ? h('span', { className: 'dsq-badge', title: props.t('invalidName') }, '!') : null,
              props.showScope ? h('span', { className: 'dsq-chip' }, s.scope === 'workspace' ? props.t('viewScopeWs') : props.t('viewScopeGlobal')) : null,
              s.linked ? h('span', { className: 'dsq-chip', title: props.t('unlinkHint') }, props.t('linked')) : null,
              props.shadowed ? h('span', { className: 'dsq-chip', title: props.t('viewShadowed') }, '×') : null,
            ),
            h('div', { className: 'dsq-row-desc', title: s.description }, s.description || props.t('noDescription')),
          ),
          props.onMode ? h(TriSwitch, {
            mode: s.mode, disabled: props.busy, label: s.name,
            labels: { off: props.t('modeOff'), available: props.t('modeAvailable'), pinned: props.t('modePinned') },
            onChange: function (m) { props.onMode(s, m) },
          }) : null,
          props.onEdit ? h(IconButton, { d: P.pencil, title: props.t('editTitle'), disabled: props.busy, onClick: function () { props.onEdit(s) } }) : null,
          props.onDelete ? h(IconButton, { d: P.trash, title: props.t('deleteTitle'), disabled: props.busy, onClick: function () { props.onDelete(s) } }) : null,
          props.onPreview ? h(Chevron, { open: open, title: props.t('preview'), disabled: props.busy, onClick: function () { props.onPreview(s) } }) : null,

          props.onDragStart ? h('span', {
            role: 'button', tabIndex: 0,
            className: 'dsq-iconbtn dsq-drag',
            title: props.t('dragHint'), 'aria-label': props.t('dragHint'),
            draggable: true,
            onDragStart: function (e) { props.onDragStart(e, s) },
            onDragEnd: props.onDragEnd,
          }, h(PathIcon, { d: P.drag, size: 14, stroke: true })) : null,
        ),
        preview,
      )
    }

    function FlatList(props) {
      var skills = props.skills || []
      if (!skills.length) return h('div', { className: 'dsq-empty' }, props.t('empty'))
      return h('div', { className: 'dsq-group' }, skills.map(function (s) {
        return h(SkillRow, {
          key: s.dirName, skill: s, t: props.t, busy: props.busy,
          expanded: !!props.expanded[s.scope + ':' + s.dirName],
          preview: props.previews[s.scope + ':' + s.dirName],
          dragging: props.draggingKey === (s.scope + ':' + s.dirName),
          onMode: props.onMode, onEdit: props.onEdit, onDelete: props.onDelete, onPreview: props.onPreview,
          onDragStart: props.onDragStart, onDragEnd: props.onDragEnd,
        })
      }))
    }

    function SkillGroups(props) {
      var groupKey = props.groupKey || ''
      var skills = props.skills || []
      var categories = props.categories || []
      if (!skills.length) return h('div', { className: 'dsq-empty' }, props.t('empty'))

      var byCat = {}
      var uncat = []
      skills.forEach(function (s) {
        if (s.categoryId) (byCat[s.categoryId] = byCat[s.categoryId] || []).push(s)
        else uncat.push(s)
      })

      function rows(list) {
        return list.map(function (s) {
          return h(SkillRow, {
            key: s.dirName, skill: s, t: props.t, busy: props.busy,
            expanded: !!props.expanded[s.scope + ':' + s.dirName],
            preview: props.previews[s.scope + ':' + s.dirName],
            dragging: props.draggingKey === (s.scope + ':' + s.dirName),
            onMode: props.onMode, onEdit: props.onEdit, onDelete: props.onDelete, onPreview: props.onPreview,
            onDragStart: props.onDragStart, onDragEnd: props.onDragEnd,
          })
        })
      }

      function dropZone(key, onDrop) {
        return {
          onDragOver: function (e) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; props.onDragOverZone(key) },
          onDragLeave: function () { if (props.dropZone === key) props.onDragOverZone(null) },
          onDrop: function (e) {
            e.preventDefault(); e.stopPropagation()
            props.onDragOverZone(null)
            var payload = props.readDragPayload(e)
            if (payload) onDrop(payload)
          },
        }
      }

      var blocks = []
      if (uncat.length) {
        var noneKey = groupKey + ':__uncat'
        var noneZone = dropZone(groupKey + ':cat:none', function (payload) { props.onDropToCategory(payload, null) })
        var noneCollapsed = !!props.collapsed[noneKey]
        blocks.push(h('div', Object.assign({ key: 'cat-none', className: 'dsq-group dsq-cat-zone' }, noneZone),
          h('div', { className: 'dsq-cat' + (props.dropZone === groupKey + ':cat:none' ? ' is-drop' : '') },
            h(Chevron, {
              open: !noneCollapsed,
              title: noneCollapsed ? props.t('expand') : props.t('collapse'),
              onClick: function () { props.onCollapseToggle(noneKey) },
            }),
            h('span', { className: 'dsq-cat-name' }, props.t('uncategorized')),
            h('span', { className: 'dsq-cat-count' }, uncat.length + ' ' + props.t('statSkills')),
          ),
          noneCollapsed ? null : rows(uncat),
        ))
      }
      categories.forEach(function (cat) {
        var members = byCat[cat.id] || []
        var allOn = members.length > 0 && members.every(function (m) { return m.enabled })
        var ck = groupKey + ':' + cat.id
        var isCollapsed = !!props.collapsed[ck]
        var zone = dropZone(groupKey + ':cat:' + cat.id, function (payload) { props.onDropToCategory(payload, cat) })
        blocks.push(h('div', Object.assign({ key: 'cat-' + cat.id, className: 'dsq-group dsq-cat-zone' }, zone),
          h('div', { className: 'dsq-cat' + (props.dropZone === groupKey + ':cat:' + cat.id ? ' is-drop' : '') },
            h(Chevron, {
              open: !isCollapsed,
              title: isCollapsed ? props.t('expand') : props.t('collapse'),
              onClick: function () { props.onCollapseToggle(ck) },
            }),
            h('span', { className: 'dsq-cat-name', title: cat.name }, cat.name),
            h('span', { className: 'dsq-cat-count' }, members.length + ' ' + props.t('statSkills')),
            h(Toggle, { on: allOn, disabled: !members.length || props.busy, title: cat.name, onToggle: function () { props.onCategoryToggle(cat, !allOn) }, label: cat.name }),
            h(IconButton, { d: P.pencil, title: props.t('catRenameTitle'), disabled: props.busy, onClick: function () { props.onCategoryRename(cat) } }),
            h(IconButton, { d: P.trash, title: props.t('catDeleteTitle'), disabled: props.busy, onClick: function () { props.onCategoryDelete(cat) } }),
          ),
          isCollapsed ? null : (members.length ? rows(members) : h('div', { className: 'dsq-empty' }, props.t('empty'))),
        ))
      })

      return h('div', { className: 'dsq-group' }, blocks)
    }

    function Overlay(props) {
      return ReactDOM.createPortal(
        h('div', { className: 'dsq-overlay', onMouseDown: function (e) { if (e.target === e.currentTarget && !props.busy) props.onClose() } },
          h('div', { className: 'dsq-modal' }, props.children)),
        document.body)
    }

    function ImportModal(props) {
      var st = React.useState(props.initialName || ''); var name = st[0]; var setName = st[1]
      var sc = React.useState(props.initialScope || 'global'); var scope = sc[0]; var setScope = sc[1]
      var er = React.useState(''); var err = er[0]; var setErr = er[1]
      var invalid = !KEBAB.test(name)
      async function ok() {
        if (invalid) return
        props.setBusy(true); setErr('')
        try { await props.onSubmit(name.trim(), scope); props.onClose() }
        catch (e) { setErr(messageOf(e)) }
        finally { props.setBusy(false) }
      }
      return h(Overlay, { busy: props.busy, onClose: props.onClose },
        h('div', { className: 'dsq-modal-title' }, props.t('importTitle')),
        h('div', { className: 'dsq-hint', style: { marginBottom: 8 } }, props.total > 1 ? (props.index + 1) + ' / ' + props.total + ' —— ' + props.fileName : (props.fileName || '')),
        h('div', { className: 'dsq-field' },
          h('label', { className: 'dsq-label' }, props.t('importNameLabel')),
          h('input', {
            className: 'dsq-input', value: name, spellCheck: false, autoFocus: true, placeholder: 'my-skill',
            onChange: function (e) { setName(e.target.value); setErr('') },
            onKeyDown: function (e) { if (e.key === 'Enter' && !invalid) ok() },
            disabled: props.busy,
          }),
          h('div', { className: 'dsq-hint' }, props.t('importNameHint')),
        ),
        h('div', { className: 'dsq-field' },
          h('label', { className: 'dsq-label' }, props.t('scopeLabel')),
          h('select', { className: 'dsq-select', value: scope, onChange: function (e) { setScope(e.target.value) }, disabled: props.busy },
            h('option', { value: 'global' }, props.t('scopeGlobal')),
            h('option', { value: 'workspace', disabled: !props.hasWorkspace }, props.t('scopeWorkspace')),
          ),
        ),
        err ? h('div', { className: 'dsq-hint dsq-err' }, err) : null,
        h('div', { className: 'dsq-actions' },
          h(Btn, { onClick: props.onClose, disabled: props.busy }, props.t('cancel')),
          h(Btn, { variant: 'primary', onClick: ok, disabled: invalid || props.busy },
            props.busy ? props.t('importing') : props.t('confirm')),
        ))
    }

    function EditorModal(props) {
      var st = React.useState(props.initial || {}); var f = st[0]; var setF = st[1]
      var er = React.useState(''); var err = er[0]; var setErr = er[1]
      function set(k, v) { setF(function (c) { var n = Object.assign({}, c); n[k] = v; return n }) }
      var invalid = !KEBAB.test(String(f.name || ''))
      async function save() {
        if (invalid) return
        props.setBusy(true); setErr('')
        try { await props.onSave(f); props.onClose() }
        catch (e) { setErr(messageOf(e)) }
        finally { props.setBusy(false) }
      }
      return h(Overlay, { busy: props.busy, onClose: props.onClose },
        h('div', { className: 'dsq-modal-title' }, props.t(props.mode === 'create' ? 'newSkill' : 'editTitle')),
        h('div', { className: 'dsq-field' },
          h('label', { className: 'dsq-label' }, props.t('nameLabel')),
          h('input', { className: 'dsq-input', value: f.name || '', spellCheck: false, autoFocus: true, placeholder: 'my-skill', onChange: function (e) { set('name', e.target.value); setErr('') }, disabled: props.busy }),
        ),
        h('div', { className: 'dsq-field' },
          h('label', { className: 'dsq-label' }, props.t('descLabel')),
          h('input', { className: 'dsq-input', value: f.description || '', spellCheck: false, onChange: function (e) { set('description', e.target.value) }, disabled: props.busy }),
        ),
        props.categories && props.categories.length ? h('div', { className: 'dsq-field' },
          h('label', { className: 'dsq-label' }, props.t('categoryLabel')),
          h('select', { className: 'dsq-select', value: f.categoryId || '', onChange: function (e) { set('categoryId', e.target.value || null) }, disabled: props.busy },
            h('option', { value: '' }, props.t('uncategorized')),
            props.categories.map(function (c) { return h('option', { key: c.id, value: c.id }, c.name) }),
          ),
        ) : null,
        h('div', { className: 'dsq-field' },
          h('label', { className: 'dsq-label' }, props.t('bodyLabel')),
          h('textarea', { className: 'dsq-textarea', value: f.body || '', onChange: function (e) { set('body', e.target.value) }, disabled: props.busy }),
        ),
        err ? h('div', { className: 'dsq-hint dsq-err' }, err) : null,
        h('div', { className: 'dsq-actions' },
          h(Btn, { onClick: props.onClose, disabled: props.busy }, props.t('cancel')),
          h(Btn, { variant: 'primary', onClick: save, disabled: invalid || props.busy },
            props.busy ? props.t('saving') : props.t('save')),
        ))
    }

    function CategoryModal(props) {
      var st = React.useState(props.initialName || ''); var name = st[0]; var setName = st[1]
      var er = React.useState(''); var err = er[0]; var setErr = er[1]
      async function ok() {
        if (!name.trim()) return
        props.setBusy(true); setErr('')
        try { await props.onSave(name.trim()); props.onClose() }
        catch (e) { setErr(messageOf(e)) }
        finally { props.setBusy(false) }
      }
      return h(Overlay, { busy: props.busy, onClose: props.onClose },
        h('div', { className: 'dsq-modal-title' }, props.t(props.rename ? 'catRenameTitle' : 'catTitle')),
        h('div', { className: 'dsq-field' },
          h('label', { className: 'dsq-label' }, props.t('catNameLabel')),
          h('input', {
            className: 'dsq-input', value: name, autoFocus: true,
            onChange: function (e) { setName(e.target.value); setErr('') },
            onKeyDown: function (e) { if (e.key === 'Enter') ok() },
            disabled: props.busy,
          }),
          h('div', { className: 'dsq-hint' }, props.t('catHint')),
        ),
        err ? h('div', { className: 'dsq-hint dsq-err' }, err) : null,
        h('div', { className: 'dsq-actions' },
          h(Btn, { onClick: props.onClose, disabled: props.busy }, props.t('cancel')),
          h(Btn, { variant: 'primary', onClick: ok, disabled: !name.trim() || props.busy },
            props.busy ? props.t('saving') : props.t('save')),
        ))
    }

    function ConfirmModal(props) {
      return h(Overlay, { busy: props.busy, onClose: props.onClose },
        h('div', { className: 'dsq-modal-title' }, props.title),
        h('div', { style: { fontSize: 13, lineHeight: 1.6 } }, props.message),
        props.hint ? h('div', { className: 'dsq-hint', style: { marginTop: 8 } }, props.hint) : null,
        h('div', { className: 'dsq-actions' },
          h(Btn, { onClick: props.onClose, disabled: props.busy }, props.t('cancel')),
          h(Btn, { variant: 'primary', onClick: props.onConfirm, disabled: props.busy }, props.t('confirm')),
        ))
    }

    function StorageModal(props) {
      var st = React.useState(props.initialPath || ''); var path = st[0]; var setPath = st[1]
      var er = React.useState(''); var err = er[0]; var setErr = er[1]
      async function save(reset) {
        props.setBusy(true); setErr('')
        try { await props.onSave(reset ? '' : path.trim()); props.onClose() }
        catch (e) { setErr(messageOf(e)) }
        finally { props.setBusy(false) }
      }
      return h(Overlay, { busy: props.busy, onClose: props.onClose },
        h('div', { className: 'dsq-modal-title' }, props.t('storageTitle')),
        h('div', { className: 'dsq-field' },
          h('label', { className: 'dsq-label' }, props.t('storage')),
          h('input', {
            className: 'dsq-input', value: path, spellCheck: false, autoFocus: true,
            placeholder: props.defaultPath,
            onChange: function (e) { setPath(e.target.value); setErr('') },
            onKeyDown: function (e) { if (e.key === 'Enter') save(false) },
            disabled: props.busy,
          }),
          h('div', { className: 'dsq-hint' }, props.t('storageHint')),
          h('div', { className: 'dsq-hint' }, '默认：' + (props.defaultPath || '')),
        ),
        err ? h('div', { className: 'dsq-hint dsq-err' }, err) : null,
        h('div', { className: 'dsq-actions' },
          h(Btn, { onClick: function () { save(true) }, disabled: props.busy }, props.t('storageDefault')),
          h(Btn, { onClick: props.onClose, disabled: props.busy }, props.t('cancel')),
          h(Btn, { variant: 'primary', onClick: function () { save(false) }, disabled: !path.trim() || props.busy }, props.t('save')),
        ))
    }

    function TrashModal(props) {
      var ts = React.useState(null); var items = ts[0]; var setItems = ts[1]
      var es = React.useState(''); var err = es[0]; var setErr = es[1]
      React.useEffect(function () {
        props.load().then(setItems).catch(function (e) { setErr(messageOf(e)) })
      }, [])
      async function restore(item) {
        props.setBusy(true); setErr('')
        try {
          await props.onRestore(item)
          setItems(await props.load())
          props.notify()
        } catch (e) { setErr(messageOf(e)) }
        finally { props.setBusy(false) }
      }
      return h(Overlay, { busy: props.busy, onClose: props.onClose },
        h('div', { className: 'dsq-modal-title' }, props.t('trashTitle')),
        h('div', { className: 'dsq-hint', style: { marginBottom: 8 } }, props.t('trashHint')),
        err ? h('div', { className: 'dsq-hint dsq-err' }, err) : null,
        items === null
          ? h('div', { className: 'dsq-empty' }, props.t('loading'))
          : (items.length
            ? h('div', { className: 'dsq-group' }, items.map(function (it) {
                return h('div', { key: it.scope + ':' + it.entry, className: 'dsq-row' },
                  h('div', { className: 'dsq-row-main' },
                    h('div', { className: 'dsq-row-name' },
                      h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, it.dirName),
                      h('span', { className: 'dsq-chip' }, it.scope === 'workspace' ? props.t('viewScopeWs') : props.t('viewScopeGlobal')),
                    ),
                    h('div', { className: 'dsq-row-desc' }, props.t('trashWhen') + ' ' + new Date(it.at).toLocaleString()),
                  ),
                  h(Btn, { onClick: function () { restore(it) }, disabled: props.busy }, props.t('trashRestore')),
                )
              }))
            : h('div', { className: 'dsq-empty' }, props.t('trashEmpty'))),
        h('div', { className: 'dsq-actions' },
          h(Btn, { onClick: props.onClose, disabled: props.busy }, props.t('cancel'))),
      )
    }

    function translator(raw) {
      return function (k) {
        var v = typeof raw === 'function' ? raw(k) : null
        return v && v !== k ? v : (zh[k] || k)
      }
    }

    function SidebarPanel(ownerProps) {
      ensureStyle()
      var t = translator(ownerProps && ownerProps.t)

      var dp = React.useState(null); var data = dp[0]; var setData = dp[1]
      var lp = React.useState(true); var loading = lp[0]; var setLoading = lp[1]
      var ep = React.useState(''); var error = ep[0]; var setError = ep[1]
      var bp = React.useState(false); var busy = bp[0]; var setBusy = bp[1]
      var wp = React.useState(''); var wsPath = wp[0]; var setWsPath = wp[1]
      var gp = React.useState(false); var drag = gp[0]; var setDrag = gp[1]
      var mp = React.useState(null); var modal = mp[0]; var setModal = mp[1]
      var tp = React.useState(''); var toast = tp[0]; var setToast = tp[1]
      var xp = React.useState({}); var expanded = xp[0]; var setExpanded = xp[1]
      var pp = React.useState({}); var previews = pp[0]; var setPreviews = pp[1]
      var cp = React.useState({}); var collapsed = cp[0]; var setCollapsed = cp[1]
      var sq = React.useState(''); var query = sq[0]; var setQuery = sq[1]
      var dz = React.useState(null); var dropZone = dz[0]; var setDropZone = dz[1]
      var dk = React.useState(null); var draggingKey = dk[0]; var setDraggingKey = dk[1]
      var payloadRef = React.useRef(null)
      var queueRef = React.useRef([])
      var fileRef = React.useRef(null)
      var panelRef = React.useRef(null)

      function onPickFiles(e) {
        var picked = e && e.target && e.target.files ? Array.prototype.slice.call(e.target.files) : []
        var mdFiles = picked.filter(function (f) { return /\.md$/i.test(f.name) })
        if (mdFiles.length) enqueueFiles(mdFiles)
        else if (picked.length) setToast(t('dropHere'))
        if (e && e.target) e.target.value = ''
      }



      /** 当前展示数据对应的工作区路径（以服务端回包为准，避免切换瞬间读到旧 state）。 */
      function activeWs() {
        if (data && data.workspace && data.workspace.path) return data.workspace.path
        return wsPath
      }

      async function load(withPath, overridePath) {
        setLoading(true); setError('')
        try {
          var path = overridePath || wsPath
          var q = withPath && path ? 'workspace=' + encodeURIComponent(path) : ''
          var next = await getJson(ROUTE + '/state' + (q ? '?' + q : ''))
          setData(next)
          if (!withPath) setWsPath(next.workspace ? next.workspace.path : '')
        } catch (e) { setError(messageOf(e)) }
        finally { setLoading(false) }
      }

      React.useEffect(function () { load(false) }, [])

      React.useLayoutEffect(function () {
        function fit() {
          var el = panelRef.current
          if (!el || typeof window === 'undefined') return
          var top = el.getBoundingClientRect().top
          el.style.maxHeight = Math.max(220, Math.floor(window.innerHeight - top - 10)) + 'px'
        }
        fit()
        window.addEventListener('resize', fit)
        return function () { window.removeEventListener('resize', fit) }
      }, [])
      React.useEffect(function () {
        if (!toast) return undefined
        var timer = setTimeout(function () { setToast('') }, 2600)
        return function () { clearTimeout(timer) }
      }, [toast])

      async function refresh() { await load(true, activeWs()) }

      async function setSkillMode(s, mode) {
        setBusy(true)
        try {
          await postJson('/mode', { scope: s.scope, dirName: s.dirName, mode: mode, workspacePath: s.scope === 'workspace' ? activeWs() : '' })
          await refresh()
          setToast(mode === 'pinned' ? t('modePinnedToast') : mode === 'off' ? t('modeOffToast') : t('modeAvailableToast'))
        } catch (e) { setToast(t('toggleFailed') + '：' + messageOf(e)) }
        finally { setBusy(false) }
      }

      async function bulkMode(scope, mode) {
        setBusy(true)
        try {
          await postJson('/bulk', { scope: scope, mode: mode, workspacePath: scope === 'workspace' ? activeWs() : '' })
          await refresh()
          setToast(mode === 'off' ? t('disableAll') : t('enableAll'))
        } catch (e) { setToast(messageOf(e)) }
        finally { setBusy(false) }
      }

      async function toggleCategory(scope, cat, enabled) {
        setBusy(true)
        try {
          await postJson('/category', { action: 'toggle', scope: scope, id: cat.id, enabled: enabled, workspacePath: scope === 'workspace' ? activeWs() : '' })
          await refresh()
        } catch (e) { setToast(messageOf(e)) }
        finally { setBusy(false) }
      }

      async function togglePreview(s) {
        var key = s.scope + ':' + s.dirName
        var willOpen = !expanded[key]
        setExpanded(function (c) { var n = Object.assign({}, c); if (willOpen) n[key] = true; else delete n[key]; return n })
        if (!willOpen) return
        if (previews[key] && !previews[key].error) return
        setPreviews(function (c) { var n = Object.assign({}, c); n[key] = { loading: true }; return n })
        try {
          var wpath = s.scope === 'workspace' ? activeWs() : ''
          var doc = await getJson(ROUTE + '/skill?scope=' + s.scope + '&dirName=' + encodeURIComponent(s.dirName) + (wpath ? '&workspace=' + encodeURIComponent(wpath) : ''))
          var text = '---\nname: ' + doc.name + '\ndescription: ' + doc.description + '\n---\n\n' + doc.body
          setPreviews(function (c) { var n = Object.assign({}, c); n[key] = { text: text }; return n })
        } catch (e) {
          setPreviews(function (c) { var n = Object.assign({}, c); n[key] = { error: messageOf(e) }; return n })
        }
      }

      function toggleCollapse(key) {
        setCollapsed(function (c) { var n = Object.assign({}, c); if (n[key]) delete n[key]; else n[key] = true; return n })
      }

      function onDragStart(e, s) {
        var payload = { scope: s.scope, dirName: s.dirName, name: s.name || s.dirName, mode: s.mode || 'available' }
        payloadRef.current = payload
        DRAG_STATE = payload
        setDraggingKey(s.scope + ':' + s.dirName)
        try {
          e.dataTransfer.effectAllowed = 'copyMove'
          e.dataTransfer.setData('text/plain', JSON.stringify(payload))
          e.dataTransfer.setData('application/x-dsh-skill', JSON.stringify(payload))
        } catch (_) { }
      }
      function onDragEnd() {
        setDraggingKey(null); setDropZone(null)
        payloadRef.current = null
        setTimeout(function () { DRAG_STATE = null }, 0)
      }
      function readDragPayload(e) {
        try {
          var dt = e.dataTransfer
          var raw = dt && (dt.getData('application/x-dsh-skill') || dt.getData('text/plain'))
          if (raw) {
            var parsed = JSON.parse(raw)
            if (parsed && parsed.scope && parsed.dirName) return parsed
          }
        } catch (_) { }
        return payloadRef.current || DRAG_STATE
      }
      async function applyCopy(payload, targetScope, categoryId, message, targetWorkspace) {
        setBusy(true)
        try {
          await postJson('/copy', {
            scope: payload.scope, dirName: payload.dirName,
            targetScope: targetScope, categoryId: categoryId || '',
            workspacePath: activeWs(),
            targetWorkspace: targetWorkspace || '',
            mode: payload.mode || 'available',
          })
          await refresh()
          setToast(message)
        } catch (e) { setToast(messageOf(e)) }
        finally { setBusy(false) }
      }
      function onDropToCategory(payload, cat) {
        var targetScope = cat && cat.scope ? cat.scope : payload.scope
        var categoryId = cat ? cat.id : ''
        var message = cat ? t('movedCategory').replace('{name}', cat.name) : t('uncategorized')
        var targetWs = targetScope === 'workspace' ? activeWs() : ''
        applyCopy(payload, targetScope, categoryId, message, targetWs)
      }

      function openEdit(s) {
        var wpath = s.scope === 'workspace' ? activeWs() : ''
        getJson(ROUTE + '/skill?scope=' + s.scope + '&dirName=' + encodeURIComponent(s.dirName) + (wpath ? '&workspace=' + encodeURIComponent(wpath) : ''))
          .then(function (doc) {
            setModal({
              kind: 'edit', scope: s.scope, dirName: s.dirName,
              initial: { name: doc.name, description: doc.description, body: doc.body, categoryId: s.categoryId || null },
              categories: (s.scope === 'global' ? data.global.categories : (data.workspace ? data.workspace.categories : [])) || [],
            })
          })
          .catch(function (e) { setToast(messageOf(e)) })
      }

      function openStorage() { setModal({ kind: 'storage', path: (data && data.globalRoot) || '' }) }

      function loadTrashScope(scope) {
        var wpath = scope === 'workspace' ? activeWs() : ''
        return getJson(ROUTE + '/trash?scope=' + scope + (wpath ? '&workspace=' + encodeURIComponent(wpath) : ''))
          .then(function (r) { return (r.items || []).map(function (x) { return Object.assign({ scope: scope }, x) }) })
          .catch(function () { return [] })
      }
      function loadTrash() {
        var jobs = [loadTrashScope('global')]
        if (activeWs()) jobs.push(loadTrashScope('workspace'))
        return Promise.all(jobs).then(function (parts) { return [].concat.apply([], parts) })
      }
      function openDelete(s) { setModal({ kind: 'delete', scope: s.scope, dirName: s.dirName, name: s.name || s.dirName, linked: !!s.linked }) }
      function openCategory(scope, cat) {
        if (scope === 'workspace' && !wsPath) { setToast(t('workspaceNone')); return }
        setModal({ kind: 'category', scope: scope, cat: cat || null })
      }

      function openCreate() {
        setModal({
          kind: 'create', scope: 'global',
          initial: { name: '', description: '', body: '', categoryId: null },
          categories: (data && data.global ? data.global.categories : []) || [],
        })
      }

      function enqueueFiles(files) {
        var items = files.map(function (f) {
          return { file: f, name: f.name.replace(/\.md$/i, '').replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() }
        })
        queueRef.current = items
        stepQueue(0, items)
      }

      function stepQueue(i, items) {
        if (i >= items.length) { setModal(null); setToast(t('importDone')); refresh(); return }
        var item = items[i]
        setModal({
          kind: 'import', index: i, total: items.length, fileName: item.file.name,
          initialName: item.name, hasWorkspace: !!wsPath, initialScope: 'global',
          onSubmit: async function (name, scope) {
            var content = await item.file.text()
            if (content.length > MAX_FILE_BYTES) throw new Error('文件过大')
            await postJson('/import', { scope: scope, name: name, content: content, workspacePath: activeWs() })
            stepQueue(i + 1, items)
          },
        })
      }

      function onDropFiles(e) {
        e.preventDefault(); setDrag(false)
        var files = []
        var dt = e.dataTransfer
        if (dt && dt.items) {
          for (var i = 0; i < dt.items.length; i++) {
            var f = dt.items[i].getAsFile && dt.items[i].getAsFile()
            if (f && /\.md$/i.test(f.name)) files.push(f)
          }
        } else if (dt && dt.files) {
          for (var j = 0; j < dt.files.length; j++) if (/\.md$/i.test(dt.files[j].name)) files.push(dt.files[j])
        }
        if (files.length) enqueueFiles(files)
        else setToast(t('dropHere'))
      }



      var needle = String(query || '').trim().toLowerCase()
      function hit(s) {
        if (!needle) return true
        return (String(s.name || '') + ' ' + String(s.dirName || '') + ' ' + String(s.description || '')).toLowerCase().indexOf(needle) >= 0
      }

      var globalSkills = (data && data.global ? data.global.skills : [])
        .map(function (s) { return Object.assign({}, s, { scope: 'global' }) })
        .filter(hit)
      var globalCats = (data && data.global ? data.global.categories : []).map(function (c) { return Object.assign({}, c, { scope: 'global' }) })
      var wsSkills = (data && data.workspace ? data.workspace.skills : []).map(function (s) { return Object.assign({}, s, { scope: 'workspace' }) }).filter(hit)
      var wsCats = (data && data.workspace ? data.workspace.categories : []).map(function (c) { return Object.assign({}, c, { scope: 'workspace' }) })

      var totalSkills = globalSkills.length + wsSkills.length
      var totalEnabled = globalSkills.filter(function (s) { return s.enabled }).length + wsSkills.filter(function (s) { return s.enabled }).length
      var totalCats = globalCats.length + wsCats.length

      function sectionDropProps(targetScope, targetWorkspace) {
        var key = 'sec:' + targetScope
        var message = targetScope === 'workspace' ? t('copiedToWorkspace') : t('copiedToGlobal')
        return {
          onDragOver: function (e) {
            e.preventDefault()
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
            setDropZone(key)
          },
          onDragLeave: function (e) {
            if (e.currentTarget && e.currentTarget.contains(e.relatedTarget)) return
            if (dropZone === key) setDropZone(null)
          },
          onDrop: function (e) {
            e.preventDefault(); e.stopPropagation()
            setDropZone(null)
            var payload = readDragPayload(e)
            if (!payload) return
            applyCopy(payload, targetScope, '', message, targetWorkspace)
          },
        }
      }

      function renderWorkspaceFolders(workspaces) {
        if (!workspaces || !workspaces.length) return null
        return h('div', { className: 'dsq-folders' },
          workspaces.map(function (w) {
            var active = w.path === wsPath
            var isFolderDrop = dropZone === 'folder:' + w.path
            return h('div', {
              key: w.path,
              className: 'dsq-folder' + (active ? ' is-active' : '') + (isFolderDrop ? ' is-drop' : ''),
              title: w.path,
              onClick: function () { if (!active) { setWsPath(w.path); load(true, w.path) } },
              onDragOver: function (e) {
                if (!payloadRef.current) return
                e.preventDefault(); e.stopPropagation()
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
                setDropZone('folder:' + w.path)
              },
              onDragLeave: function (e) {
                if (e.currentTarget && e.currentTarget.contains(e.relatedTarget)) return
                if (dropZone === 'folder:' + w.path) setDropZone(null)
              },
              onDrop: function (e) {
                e.preventDefault(); e.stopPropagation()
                setDropZone(null)
                var payload = readDragPayload(e)
                if (!payload) return
                applyCopy(payload, 'workspace', '', t('copiedToWorkspace'), w.path)
              },
            },
              h(PathIcon, { d: P.folder, size: 13 }),
              h('span', { className: 'dsq-folder-name' }, w.title || w.path),
            )
          }),
        )
      }

      function renderSection(scope, title, hint, skills, cats) {
        var isDrop = dropZone === 'sec:' + scope
        var cardDrop = sectionDropProps(scope)
        return h('div', Object.assign({ className: 'dsq-card' + (isDrop ? ' is-drop' : '') }, cardDrop),
          h('div', { className: 'dsq-card-head' },
            h(PathIcon, { d: P.folder, size: 13 }),
            h('span', { className: 'dsq-card-title' }, title),
            h('span', { className: 'dsq-card-hint' }, hint),
            h('div', { className: 'dsq-card-actions' },
              scope === 'global' ? h('span', { className: 'dsq-card-count' }, skills.length + ' ' + t('statSkills')) : null,
              scope === 'global' || wsPath ? h(Btn, {
                icon: h(PathIcon, { d: P.plus, size: 12 }),
                onClick: function () { openCategory(scope, null) },
                disabled: busy,
              }, t('newCategory')) : null,
            ),
          ),
          h('div', { className: 'dsq-card-body' },
            h('div', { className: 'dsq-toolbar-row' },
              h(Btn, { onClick: function () { bulkMode(scope, 'available') }, disabled: busy }, t('enableAll')),
              h(Btn, { onClick: function () { bulkMode(scope, 'off') }, disabled: busy }, t('disableAll')),
              h('span', { className: 'dsq-legend' },
                h('b', null, t('modeOffLabel')), ' ' + t('modeOffHint'), ' · ',
                h('b', null, t('modeAvailableLabel')), ' ' + t('modeAvailableHint'), ' · ',
                h('b', null, t('modePinnedLabel')), ' ' + t('modePinnedHint'),
              ),
            ),
            scope === 'workspace' ? renderWorkspaceFolders((data && data.workspaces) || []) : null,
            scope === 'workspace' && !wsPath
              ? h('div', { className: 'dsq-empty' }, t('workspaceNone'))
              : h('div', { className: 'dsq-list-scroll ' + (scope === 'global' ? 'is-capped' : 'is-free') }, h(SkillGroups, {
                skills: skills, categories: cats, groupKey: scope, t: t, busy: busy,
                expanded: expanded, previews: previews, collapsed: collapsed,
                dropZone: dropZone, draggingKey: draggingKey, readDragPayload: readDragPayload,
                onDragStart: onDragStart, onDragEnd: onDragEnd,
                onDragOverZone: setDropZone,
                onDropToCategory: onDropToCategory,
                onMode: setSkillMode, onEdit: openEdit, onDelete: openDelete, onPreview: togglePreview,
                onCollapseToggle: toggleCollapse,
                onCategoryToggle: function (cat, on) { toggleCategory(scope, cat, on) },
                onCategoryRename: function (cat) { openCategory(scope, cat) },
                onCategoryDelete: function (cat) { setModal({ kind: 'catDelete', scope: scope, cat: cat }) },
              })),
          ),
        )
      }

      var body = null
      if (loading && !data) body = h('div', { className: 'dsq-card' }, h('div', { className: 'dsq-card-body' }, h('div', { className: 'dsq-empty' }, t('loading'))))
      else if (error) body = h('div', { className: 'dsq-card' }, h('div', { className: 'dsq-card-body' },
        h('div', { className: 'dsq-empty' }, error),
        h(Btn, { onClick: function () { load(false) } }, t('retry'))))
      else if (data) body = h(React.Fragment, null,
        renderSection('global', t('globalSection'), t('globalHint'), globalSkills, globalCats),
        renderSection('workspace', t('workspaceSection'), t('workspaceHint'), wsSkills, wsCats),
      )

      var modalView = null
      if (modal) {
        if (modal.kind === 'import') modalView = h(ImportModal, {
          t: t, busy: busy, setBusy: setBusy, onClose: function () { setModal(null) },
          index: modal.index, total: modal.total, fileName: modal.fileName,
          initialName: modal.initialName, initialScope: modal.initialScope,
          hasWorkspace: modal.hasWorkspace, onSubmit: modal.onSubmit,
        })
        else if (modal.kind === 'create') modalView = h(EditorModal, {
          t: t, busy: busy, setBusy: setBusy, mode: 'create', initial: modal.initial, categories: modal.categories,
          onClose: function () { setModal(null) },
          onSave: async function (f) {
            await postJson('/import', { scope: modal.scope, name: f.name, content: '', workspacePath: activeWs() })
            await postJson('/update', { scope: modal.scope, dirName: f.name, name: f.name, description: f.description, body: f.body, workspacePath: activeWs() })
            if (f.categoryId) await postJson('/category', { action: 'assign', scope: modal.scope, dirName: f.name, categoryId: f.categoryId, workspacePath: activeWs() })
            setToast(t('saved')); refresh()
          },
        })
        else if (modal.kind === 'edit') modalView = h(EditorModal, {
          t: t, busy: busy, setBusy: setBusy, mode: 'edit', initial: modal.initial, categories: modal.categories,
          onClose: function () { setModal(null) },
          onSave: async function (f) {
            await postJson('/update', { scope: modal.scope, dirName: modal.dirName, name: f.name, description: f.description, body: f.body, workspacePath: activeWs() })
            await postJson('/category', { action: 'assign', scope: modal.scope, dirName: modal.dirName, categoryId: f.categoryId || '', workspacePath: activeWs() })
            setToast(t('saved'))
            setPreviews(function (c) { var n = Object.assign({}, c); delete n[modal.scope + ':' + modal.dirName]; return n })
            refresh()
          },
        })
        else if (modal.kind === 'category') modalView = h(CategoryModal, {
          t: t, busy: busy, setBusy: setBusy, rename: !!modal.cat, initialName: modal.cat ? modal.cat.name : '',
          onClose: function () { setModal(null) },
          onSave: async function (name) {
            if (modal.cat) await postJson('/category', { action: 'rename', scope: modal.scope, id: modal.cat.id, name: name, workspacePath: activeWs() })
            else await postJson('/category', { action: 'create', scope: modal.scope, name: name, workspacePath: activeWs() })
            setToast(modal.cat ? t('catSaved') : t('catCreated')); refresh()
          },
        })
        else if (modal.kind === 'catDelete') modalView = h(ConfirmModal, {
          t: t, busy: busy, title: t('catDeleteTitle'),
          message: t('catDeleteConfirm').replace('{name}', modal.cat.name),
          onClose: function () { setModal(null) },
          onConfirm: async function () {
            setBusy(true)
            try {
              await postJson('/category', { action: 'delete', scope: modal.scope, id: modal.cat.id, workspacePath: activeWs() })
              setModal(null); setToast(t('catDeleted')); refresh()
            } catch (e) { setToast(messageOf(e)) }
            finally { setBusy(false) }
          },
        })
        else if (modal.kind === 'trash') modalView = h(TrashModal, {
          t: t, busy: busy, setBusy: setBusy, load: loadTrash,
          onClose: function () { setModal(null) },
          notify: function () { setToast(t('trashRestored')); refresh() },
          onRestore: async function (item) {
            await postJson('/trash', {
              scope: item.scope, entry: item.entry, dirName: item.dirName,
              workspacePath: item.scope === 'workspace' ? activeWs() : '',
            })
          },
        })
        else if (modal.kind === 'storage') modalView = h(StorageModal, {
          t: t, busy: busy, setBusy: setBusy,
          initialPath: modal.path, defaultPath: (data && data.defaultGlobalRoot) || '',
          onClose: function () { setModal(null) },
          onSave: async function (next) {
            await postJson('/settings', { globalRoot: next })
            setToast(t('storageSaved')); refresh()
          },
        })
        else if (modal.kind === 'delete') modalView = h(ConfirmModal, {
          t: t, busy: busy, title: t('deleteTitle'),
          message: t('deleteConfirm').replace('{name}', modal.name),
          hint: modal.linked ? t('unlinkHint') : t('deleteHint'),
          onClose: function () { setModal(null) },
          onConfirm: async function () {
            setBusy(true)
            try {
              await postJson('/delete', { scope: modal.scope, dirName: modal.dirName, workspacePath: activeWs() })
              setModal(null); setToast(t('deleted')); refresh()
            } catch (e) { setToast(messageOf(e)) }
            finally { setBusy(false) }
          },
        })
      }

      var toastNode = null
      if (toast) {
        toastNode = NativeToast
          ? ReactDOM.createPortal(h(NativeToast, { text: toast, onDone: function () { setToast('') } }), document.body)
          : h('div', { className: 'dsq-toast' }, toast)
      }

      return h('div', { ref: panelRef, className: 'dsq dsq-panel', onDragEnd: onDragEnd },
        modalView,
        h('div', { className: 'dsq-head' },
          h('div', { className: 'dsq-head-main' },
            h('div', { className: 'dsq-h-title' }, t('title')),
            h('div', { className: 'dsq-h-sub' }, t('subtitle')),
          ),
          h('div', { className: 'dsq-head-actions' },
            h(Btn, { variant: 'primary', icon: h(PathIcon, { d: P.plus, size: 12 }), onClick: openCreate, disabled: busy }, t('newSkill')),
            h(Btn, { icon: h(PathIcon, { d: P.upload, size: 12, stroke: true }), onClick: function () { if (fileRef.current) fileRef.current.click() }, disabled: busy }, t('importSkill')),
            h('input', {
              ref: fileRef, type: 'file', accept: '.md,text/markdown', multiple: true,
              style: { display: 'none' }, onChange: onPickFiles,
            }),
            h(Btn, { icon: h(PathIcon, { d: P.trash, size: 12 }), onClick: function () { setModal({ kind: 'trash' }) }, disabled: busy }, t('trash')),
            h(Btn, { icon: h(PathIcon, { d: P.folder, size: 12 }), onClick: openStorage, disabled: busy }, t('storage')),
            h(Btn, { icon: h(PathIcon, { d: P.refresh, size: 12, stroke: true }), onClick: function () { load(true) }, disabled: loading || busy, title: t('refresh') }),
          ),
        ),
        h('div', { className: 'dsq-head-search' },
          h('input', {
            className: 'dsq-input dsq-search', value: query, placeholder: t('searchSkills'),
            onChange: function (e) { setQuery(e.target.value) },
          }),
        ),
        h('div', {
          className: 'dsq-drop' + (drag ? ' is-over' : ''),
          onDragOver: function (e) {
            if (payloadRef.current) return
            e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; setDrag(true)
          },
          onDragLeave: function () { setDrag(false) },
          onDrop: onDropFiles,
        },
          h(PathIcon, { d: P.upload, size: 16, stroke: true }),
          h('div', { className: 'dsq-drop-text' }, drag ? t('dropOver') : t('dropHere')),
        ),
        body,
        toastNode,
      )
    }

    function SidebarIcon() {
      ensureStyle()
      return h(StarMark, { size: 16 })
    }

    function SkillsView(props) {
      ensureStyle()
      var t = translator(props && props.t)
      var sessionId = props && props.sessionId

      var dp = React.useState(null); var data = dp[0]; var setData = dp[1]
      var lp = React.useState(true); var loading = lp[0]; var setLoading = lp[1]
      var ep = React.useState(''); var error = ep[0]; var setError = ep[1]
      var bp = React.useState(false); var busy = bp[0]; var setBusy = bp[1]
      var qp = React.useState(''); var filter = qp[0]; var setFilter = qp[1]
      var xp = React.useState({}); var expanded = xp[0]; var setExpanded = xp[1]
      var pp = React.useState({}); var previews = pp[0]; var setPreviews = pp[1]

      var nt = React.useState(''); var notice = nt[0]; var setNotice = nt[1]
      React.useEffect(function () {
        if (!notice) return undefined
        var timer = setTimeout(function () { setNotice('') }, 2600)
        return function () { clearTimeout(timer) }
      }, [notice])



      async function setSessionMode(s, mode) {
        if (!sessionId) { setNotice(t('noSession')); return }
        setBusy(true)
        try {
          await postJson('/session', {
            action: 'mode', sessionId: sessionId,
            scope: s.scope || 'global', dirName: s.dirName, mode: mode,
          })
          await load()
        } catch (e) { setNotice(messageOf(e)) }
        finally { setBusy(false) }
      }



      async function load() {
        setLoading(true); setError('')
        try { setData(await getJson(ROUTE + '/state' + (sessionId ? '?sessionId=' + encodeURIComponent(sessionId) : ''))) }
        catch (e) { setError(messageOf(e)) }
        finally { setLoading(false) }
      }

      React.useEffect(function () { load() }, [sessionId])

      React.useEffect(function () {
        var root = document.documentElement
        root.setAttribute('data-dsq-skills-view', '1')
        return function () { root.removeAttribute('data-dsq-skills-view') }
      }, [])



      async function togglePreview(s) {
        var key = s.scope + ':' + s.dirName
        var willOpen = !expanded[key]
        setExpanded(function (c) { var n = Object.assign({}, c); if (willOpen) n[key] = true; else delete n[key]; return n })
        if (!willOpen) return
        if (previews[key] && !previews[key].error) return
        setPreviews(function (c) { var n = Object.assign({}, c); n[key] = { loading: true }; return n })
        try {
          var doc = await getJson(ROUTE + '/skill?scope=' + s.scope + '&dirName=' + encodeURIComponent(s.dirName) + (sessionId ? '&sessionId=' + encodeURIComponent(sessionId) : ''))
          var text = '---\nname: ' + doc.name + '\ndescription: ' + doc.description + '\n---\n\n' + doc.body
          setPreviews(function (c) { var n = Object.assign({}, c); n[key] = { text: text }; return n })
        } catch (e) {
          setPreviews(function (c) { var n = Object.assign({}, c); n[key] = { error: messageOf(e) }; return n })
        }
      }

      var wsSkills = ((data && data.workspace && data.workspace.skills) || []).map(function (s) { return Object.assign({}, s, { scope: 'workspace' }) })
      var globalSkills = ((data && data.global && data.global.skills) || []).map(function (s) { return Object.assign({}, s, { scope: 'global' }) })
      var wsNames = {}
      wsSkills.forEach(function (s) { wsNames[s.dirName] = true; if (s.name) wsNames[s.name] = true })

      function row(s) {
        var key = s.scope + ':' + s.dirName
        // 会话有效挡位：有覆盖用覆盖值，否则沿用总面板（全局）状态
        var view = Object.assign({}, s, { mode: s.sessionOverride ? s.sessionMode : s.mode })
        return h(SkillRow, {
          key: key, skill: view, t: t, busy: busy, showScope: false,
          expanded: !!expanded[key], preview: previews[key],
          onMode: setSessionMode, onPreview: togglePreview,
        })
      }

      var pinnedNames = {}
      ;((data && data.sessionPins) || []).forEach(function (p) {
        if (p.name) pinnedNames[p.name] = true
        if (p.dirName) pinnedNames[p.dirName] = true
      })

      function pool(list) {
        var q = filter.trim().toLowerCase()
        return list.filter(function (s) {
          if (!q) return true
          return String(s.name || '').toLowerCase().indexOf(q) >= 0 ||
            String(s.dirName || '').toLowerCase().indexOf(q) >= 0 ||
            String(s.description || '').toLowerCase().indexOf(q) >= 0
        })
      }

      var wsShown = pool(wsSkills)
      var gShown = pool(globalSkills)

      var body = null
      if (loading && !data) body = h('div', { className: 'dsq-empty' }, t('loading'))
      else if (error) body = h('div', null,
        h('div', { className: 'dsq-empty' }, error),
        h(Btn, { onClick: load }, t('retry')))
      else body = h('div', { className: 'dsq-view-sec' },
        h('div', { className: 'dsq-view-sec-title' },
          h(PathIcon, { d: P.folder, size: 12 }),
          h('span', null, t('globalSection')),
          h('span', { className: 'dsq-card-hint' }, t('sessionHint')),
          h('span', { className: 'dsq-card-count' }, gShown.length + ''),
        ),
        gShown.length
          ? h('div', { className: 'dsq-group dsq-view-list' }, gShown.map(function (s) { return row(s) }))
          : h('div', { className: 'dsq-empty' }, filter.trim() ? t('viewNoMatch') : t('empty')),
      )





      var noticeNode = null
      if (notice) {
        noticeNode = NativeToast
          ? ReactDOM.createPortal(h(NativeToast, { text: notice, onDone: function () { setNotice('') } }), document.body)
          : h('div', { className: 'dsq-toast' }, notice)
      }

      return h('div', { className: 'dsq dsq-view' },
        noticeNode,
        h('div', { className: 'dsq-view-head' },
          h('div', { className: 'dsq-view-head-main' },
            h('div', { className: 'dsq-h-title' }, t('viewTitle')),
            h('div', { className: 'dsq-h-sub' }, t('viewSubtitle')),
          ),
          h('input', {
            className: 'dsq-input dsq-view-search', value: filter, placeholder: t('viewSearch'),
            onChange: function (e) { setFilter(e.target.value) },
          }),
          h(Btn, {
            icon: h(PathIcon, { d: P.refresh, size: 12, stroke: true }),
            onClick: load, disabled: loading || busy, title: t('refresh'),
          }),
        ),
        h('div', { className: 'dsq-view-body' }, body),
      )
    }

    /**
     * 首页入口：空白会话还没有 sessionId，conversation.view 不渲染，
     * 所以挡位先存成 host 侧预置，首个 turn 前再转成本会话覆盖。
     */
    function HeroSkills(props) {
      ensureStyle()
      var t = translator(props && props.t)
      var op = React.useState(false); var open = op[0]; var setOpen = op[1]
      var dp = React.useState(null); var data = dp[0]; var setData = dp[1]
      var pp = React.useState([]); var preset = pp[0]; var setPreset = pp[1]
      var lp = React.useState(false); var loading = lp[0]; var setLoading = lp[1]
      var ep = React.useState(''); var error = ep[0]; var setError = ep[1]
      var bp = React.useState(false); var busy = bp[0]; var setBusy = bp[1]
      var qp = React.useState(''); var filter = qp[0]; var setFilter = qp[1]
      var nt = React.useState(''); var notice = nt[0]; var setNotice = nt[1]
      var wp = React.useState(''); var wsPath = wp[0]; var setWsPath = wp[1]

      React.useEffect(function () {
        if (!notice) return undefined
        var timer = setTimeout(function () { setNotice('') }, 2600)
        return function () { clearTimeout(timer) }
      }, [notice])

      async function load() {
        setLoading(true); setError('')
        try {
          var both = await Promise.all([
            getJson(ROUTE + '/state'),
            getJson(ROUTE + '/preset?workspace='),
          ])
          setData(both[0])
          setPreset((both[1] && both[1].pins) || [])
          setWsPath((both[1] && both[1].workspacePath) || '')
        } catch (e) { setError(messageOf(e)) }
        finally { setLoading(false) }
      }

      React.useEffect(function () { if (open) load() }, [open])

      function presetMode(s) {
        for (var i = 0; i < preset.length; i += 1) {
          if (preset[i].dirName === s.dirName && preset[i].scope === (s.scope || 'global')) return preset[i].mode
        }
        return s.mode
      }

      async function setMode(s, mode) {
        setBusy(true)
        try {
          var res = await postJson('/preset', {
            workspacePath: wsPath, scope: s.scope || 'global', dirName: s.dirName, mode: mode,
          })
          setPreset((res && res.pins) || [])
          setNotice(t('heroPresetDone'))
        } catch (e) { setNotice(messageOf(e)) }
        finally { setBusy(false) }
      }

      async function clearPreset() {
        setBusy(true)
        try {
          await postJson('/preset', { workspacePath: wsPath, clear: true })
          setPreset([])
          setNotice(t('heroPresetCleared'))
        } catch (e) { setNotice(messageOf(e)) }
        finally { setBusy(false) }
      }

      var skills = ((data && data.global && data.global.skills) || []).map(function (s) {
        return Object.assign({}, s, { scope: 'global' })
      })
      var q = filter.trim().toLowerCase()
      var shown = q ? skills.filter(function (s) {
        return String(s.name || '').toLowerCase().indexOf(q) >= 0 ||
          String(s.dirName || '').toLowerCase().indexOf(q) >= 0 ||
          String(s.description || '').toLowerCase().indexOf(q) >= 0
      }) : skills

      var count = preset.length
      var modal = null
      if (open) {
        modal = h(Overlay, { busy: busy, onClose: function () { setOpen(false) } },
          h('div', { className: 'dsq-modal-title' }, t('heroPresetTitle')),
          h('div', { className: 'dsq-hint', style: { marginBottom: 10 } }, t('heroPresetHint')),
          wsPath ? h('div', { className: 'dsq-hint', style: { marginBottom: 8 } }, t('heroPresetBind') + ' ' + wsPath) : null,
          h('input', {
            className: 'dsq-input', value: filter, placeholder: t('viewSearch'),
            onChange: function (e) { setFilter(e.target.value) },
          }),
          error ? h('div', { className: 'dsq-hint dsq-err', style: { marginTop: 8 } }, error) : null,
          loading && !data ? h('div', { className: 'dsq-empty' }, t('loading')) : null,
          h('div', { className: 'dsq-group dsq-view-list', style: { marginTop: 10 } },
            shown.length ? shown.map(function (s) {
              var key = s.scope + ':' + s.dirName
              return h(SkillRow, {
                key: key, skill: Object.assign({}, s, { mode: presetMode(s) }),
                t: t, busy: busy, showScope: false,
                onMode: function (row, mode) { setMode(row, mode) },
              })
            }) : h('div', { className: 'dsq-empty' }, filter.trim() ? t('viewNoMatch') : t('empty'))),
          h('div', { className: 'dsq-hint', style: { marginTop: 8 } },
            count ? t('sessionHint') : t('heroPresetEmpty')),
          h('div', { className: 'dsq-actions' },
            h(Btn, { onClick: clearPreset, disabled: busy || !count }, t('heroPresetClear')),
            h(Btn, { variant: 'primary', onClick: function () { setOpen(false) }, disabled: busy }, t('confirm')),
          ))
      }

      return h('div', { className: 'dsq dsq-hero' },
        h(Btn, {
          onClick: function () { setOpen(true) },
          title: t('heroPreset'),
          icon: h(StarMark, { size: 12 }),
        }, t('heroPreset') + (count ? ' · ' + count : '')),
        modal,
        notice ? h('div', { className: 'dsq-hero-toast' }, notice) : null,
      )
    }

    function apply(ctx) {
      ensureStyle()
      ctx.effect(function () { return ctx.locale.register(NS, { zh: zh, en: en }) }, 'dsh-easy-skills-manager: dictionaries')

      ctx.slots.inject('sidebar.panellist', function () {
        return ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 2,
          label: function () { try { return ctx.locale.bind(NS)('navLabel') } catch (e) { return '技能' } },
          locale: NS,
        }, SidebarIcon)
      })

      ctx.slots.inject('main', function () {
        return ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, SidebarPanel)
      })

      // 该 slot 属首页（空白会话）入口；老版本 DSH 没有它时静默跳过，不影响面板
      try {
        ctx.slots.inject('conversation.hero.options', function () {
          return ctx.slots.register({
            name: 'conversation.hero.options', id: 'skills-preset', order: 30, locale: NS,
            label: function () { try { return ctx.locale.bind(NS)('heroPreset') } catch (e) { return '技能' } },
          }, HeroSkills)
        })
      } catch (e) { /* 无该 slot 即跳过 */ }

      ctx.slots.inject('conversation.view', function () {
        return ctx.slots.register({
          name: 'conversation.view',
          id: VIEW_ID,
          order: 40,
          locale: NS,
          label: function () { try { return ctx.locale.bind(NS)('viewTitle') } catch (e) { return '技能' } },
        }, SkillsView)
      })
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale']
    return module.exports
  },
})
