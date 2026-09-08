/* global window, document */
const en = {
  title: 'Desktop Plugins',
  refresh: 'Refresh',
  description:
    'Install extra plugins in this Desktop profile. Built-in packages stay managed by Desktop.',
  personal:
    'For the author and friends only. An experiment with no ongoing iteration or long-term compatibility commitment.',
  packageLabel: 'npm package or absolute local path',
  install: 'Install',
  directory: 'Choose directory',
  archive: 'Choose .tgz',
  localHint:
    'Build local packages first. Directory installs are snapshots; rebuilding the source does not update an installed plugin. Reinstall to update.',
  runtimeTitle: 'Runtime',
  runtimeHint:
    'Changes restart the runtime without closing Desktop. Finish active conversations first.',
  restart: 'Restart runtime',
  installed: 'Installed plugins',
  empty: 'No extra plugins installed.',
  remove: 'Remove',
  cancel: 'Cancel',
  confirm: 'Remove and restart',
  confirmText: 'Remove {name}? The runtime will restart.',
  busy: 'Working… The main view may briefly disconnect.',
  done: 'Done.',
  loading: 'Loading plugins…',
  local: 'Local snapshot',
  npm: 'npm',
  unavailable: 'Desktop management bridge is unavailable. Rebuild the app with desktop-packager.',
};
const zh = {
  title: '桌面插件管理',
  refresh: '刷新',
  description: '管理当前 Desktop profile 的额外插件。原生包由 Desktop 管理，不在此列表中。',
  personal: '供自己和朋友自用的实验功能，不作为持续迭代功能，不承诺长期兼容。',
  packageLabel: 'npm 包名或本地绝对路径',
  install: '安装',
  directory: '选择目录',
  archive: '选择 .tgz',
  localHint:
    '本地包请先构建。目录安装会保存快照，修改或重新构建原目录不会更新已安装插件；需要再次安装。',
  runtimeTitle: 'Runtime',
  runtimeHint: '变更会重启 runtime，Desktop 保持打开。请先等待正在进行的对话结束。',
  restart: '重启 runtime',
  installed: '已安装插件',
  empty: '尚未安装额外插件。',
  remove: '删除',
  cancel: '取消',
  confirm: '删除并重启',
  confirmText: '删除 {name}？这将重启 runtime。',
  busy: '正在处理…主界面可能短暂断开连接。',
  done: '已完成。',
  loading: '正在加载插件…',
  local: '本地快照',
  npm: 'npm',
  unavailable: 'Desktop 管理桥接不可用，请通过 desktop-packager 重新构建应用。',
};
async function main() {
  const locale = await window.clutchExtension.locale();
  const messages = locale.id.startsWith('zh') ? zh : en;
  const api = window.clutchExtension;
  const $ = (id) => document.getElementById(id);
  document.documentElement.lang = locale.id;
  document.title = messages.title;
  for (const [id, key] of Object.entries({
    title: 'title',
    refresh: 'refresh',
    description: 'description',
    personal: 'personal',
    'package-label': 'packageLabel',
    install: 'install',
    directory: 'directory',
    archive: 'archive',
    'local-hint': 'localHint',
    'runtime-title': 'runtimeTitle',
    'runtime-hint': 'runtimeHint',
    restart: 'restart',
    'installed-heading': 'installed',
    empty: 'empty',
    cancel: 'cancel',
    'confirm-remove': 'confirm',
  }))
    $(id).textContent = messages[key];
  $('package-spec').placeholder = '@scope/plugin@1.2.3 / /absolute/path';
  let busy = false;
  let removing;
  function status(message, error = false) {
    $('status').textContent = message;
    $('status').classList.toggle('error', error);
  }
  async function render() {
    const plugins = await api.list();
    $('plugins').replaceChildren(
      ...plugins.map((plugin) => {
        const item = document.createElement('li');
        const identity = document.createElement('span');
        identity.className = 'identity';
        const name = document.createElement('strong');
        name.textContent = plugin.name;
        const metadata = document.createElement('span');
        metadata.className = 'metadata';
        metadata.textContent = plugin.version + ' · ' + (messages[plugin.source] ?? plugin.source);
        identity.append(name, metadata);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = messages.remove;
        remove.addEventListener('click', () => {
          if (busy) return;
          removing = plugin.name;
          $('confirm-text').textContent = messages.confirmText.replace('{name}', plugin.name);
          $('confirm').hidden = false;
          $('confirm-remove').focus();
        });
        item.append(identity, remove);
        return item;
      }),
    );
    $('empty').hidden = plugins.length !== 0;
  }
  async function run(operation, reload = true) {
    if (busy) return;
    busy = true;
    for (const control of document.querySelectorAll('button,input')) control.disabled = true;
    status(messages.busy);
    try {
      await operation();
      if (reload) await render();
      status(messages.done);
    } catch (error) {
      status(error instanceof Error ? error.message : String(error), true);
    } finally {
      busy = false;
      for (const control of document.querySelectorAll('button,input')) control.disabled = false;
    }
  }
  if (!api || api.version !== 1) {
    status(messages.unavailable, true);
    return;
  }
  $('install-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const spec = $('package-spec').value.trim();
    if (spec)
      void run(async () => {
        await api.install(spec);
        $('package-spec').value = '';
      });
  });
  for (const kind of ['directory', 'archive'])
    $(kind).addEventListener(
      'click',
      () =>
        void run(async () => {
          const path = await api.chooseLocal(kind);
          if (path) $('package-spec').value = path;
        }, false),
    );
  $('refresh').addEventListener('click', () => void run(async () => {}));
  $('restart').addEventListener('click', () => void run(() => api.restart()));
  $('cancel').addEventListener('click', () => {
    removing = undefined;
    $('confirm').hidden = true;
  });
  $('confirm-remove').addEventListener(
    'click',
    () =>
      void run(async () => {
        if (!removing) return;
        await api.remove(removing);
        removing = undefined;
        $('confirm').hidden = true;
      }),
  );
  await run(async () => {});
}
void main().catch((error) => {
  document.getElementById('status').textContent = String(error);
  document.getElementById('status').classList.add('error');
});
