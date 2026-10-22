import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  MAX_CUSTOM_ANIMATIONS,
  MAX_SCRIPT_BYTES,
  parseAnimation,
  type AnimationPreferences,
} from '../animation.js';
import {
  ANIMATION_GENERATION_PROMPT,
  animationTemplates,
  selectedAnimation,
} from './animation-templates.js';
import type { FireworksController } from './fireworks-controller.js';
import type { AnimationStore } from './animation-store.js';
import styles from './animation-settings.css';

function download(name: string, source: string) {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AnimationSettings({
  store,
  playback,
}: {
  readonly store: AnimationStore;
  readonly playback: Pick<FireworksController, 'previewAnimation'>;
}) {
  const saved = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [draft, setDraft] = useState<AnimationPreferences>(saved.preferences);
  const [revision, setRevision] = useState(saved.revision);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const stopPreview = useRef<() => void>();
  const [validated, setValidated] = useState<string>();
  const [previewStatus, setPreviewStatus] = useState('选择模板后点击预览');
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => () => stopPreview.current?.(), []);
  useEffect(() => {
    void store.load();
  }, [store]);
  useEffect(() => {
    if (!dirty) {
      setDraft(saved.preferences);
      setRevision(saved.revision);
    }
  }, [saved.preferences, saved.revision, dirty]);
  const selected = useMemo(() => selectedAnimation(draft), [draft]);
  const cancelPreview = () => {
    stopPreview.current?.();
    stopPreview.current = undefined;
    setPreviewing(false);
  };
  const select = (id: string) => {
    setDraft({ ...draft, active: id });
    setDirty(true);
    setNotice('');
    setError('');
    cancelPreview();
    setValidated(undefined);
    setPreviewStatus('选择模板后点击预览');
  };
  const startPreview = () => {
    cancelPreview();
    setPreviewing(true);
    setValidated(undefined);
    setPreviewStatus('正在载入动画…');
    setError('');
    let active = true;
    const cancel = playback.previewAnimation(selected, (status, message) => {
      if (!active) return;
      if (status === 'ready') setPreviewStatus('正在全屏播放 · 验证中');
      else {
        setPreviewing(false);
        if (status === 'done') {
          setValidated(selected.id);
          setPreviewStatus('播放完成 · 脚本验证通过');
        } else {
          setValidated(undefined);
          setPreviewStatus(status === 'cancelled' ? '预览已取消' : '脚本验证失败');
          if (status === 'error') setError(message ?? '动画脚本出错');
          else if (message) setNotice(message);
        }
      }
    });
    stopPreview.current = () => {
      active = false;
      cancel();
    };
  };
  const importFile = async (value: File) => {
    try {
      if (value.size > MAX_SCRIPT_BYTES) throw new Error('动画脚本不能超过 64 KiB');
      if (Object.keys(draft.scripts).length >= MAX_CUSTOM_ANIMATIONS)
        throw new Error('最多保存 8 个自定义动画，请先移除一个');
      const source = await value.text();
      const id = 'custom-' + crypto.randomUUID();
      parseAnimation(source, id);
      setDraft({ active: id, scripts: { ...draft.scripts, [id]: source } });
      setDirty(true);
      setNotice('脚本已导入草稿，请先预览验证，再保存。');
      setError('');
      setValidated(undefined);
      cancelPreview();
      setPreviewStatus('导入后需先预览验证');
    } catch (reason) {
      setError(String(reason));
    }
  };
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await store.save(draft, revision);
      setDirty(false);
      setNotice('已保存，下次庆祝将使用所选动画。');
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={styles.settings} aria-label="烟花动画设置">
      <div className={styles.heading}>
        <div>
          <h2>烟花动画</h2>
          <p>为每次任务完成选择庆祝画面。通知和会话跳转始终由插件管理。</p>
        </div>
        <span className={styles.badge}>Animation Studio</span>
      </div>
      {saved.error && (
        <div role="alert" className={styles.error}>
          {saved.error}
          <button
            type="button"
            onClick={() => {
              void store.load();
            }}
          >
            重试读取
          </button>
        </div>
      )}
      <div className={styles.layout}>
        <div>
          <div className={styles.templates} role="radiogroup" aria-label="动画模板">
            {animationTemplates(draft).map((template) => (
              <button
                key={template.id}
                type="button"
                role="radio"
                aria-checked={template.id === draft.active}
                className={styles.template}
                disabled={busy || saved.revision === undefined}
                onClick={() => select(template.id)}
              >
                <span className={styles.templateIcon}>
                  {template.id === 'emoji'
                    ? '🎉'
                    : template.id === 'classic'
                      ? '✦'
                      : template.id === 'rings'
                        ? '◎'
                        : '✧'}
                </span>
                <span>
                  <strong>{template.name}</strong>
                  <small>
                    {template.id.startsWith('custom-') ? '自定义脚本' : '内置模板'} ·{' '}
                    {(template.durationMs / 1000).toFixed(1)} 秒
                  </small>
                </span>
                <span aria-hidden="true">{template.id === draft.active ? '●' : '○'}</span>
              </button>
            ))}
          </div>
          <div className={styles.actions}>
            <input
              ref={file}
              type="file"
              accept=".js,text/javascript"
              aria-label="导入动画脚本文件"
              className={styles.fileInput}
              onChange={(event) => {
                const value = event.target.files?.[0];
                if (value) void importFile(value);
                event.target.value = '';
              }}
            />
            <button
              type="button"
              disabled={busy || !saved.writable}
              onClick={() => file.current?.click()}
            >
              ＋ 导入 .js 动画
            </button>
            <button type="button" onClick={() => download(selected.id + '.js', selected.source)}>
              下载所选脚本
            </button>
            {selected.id.startsWith('custom-') && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  const scripts = { ...draft.scripts };
                  delete scripts[selected.id];
                  setDraft({ active: 'emoji', scripts });
                  setDirty(true);
                  cancelPreview();
                  setValidated(undefined);
                  setPreviewStatus('选择模板后点击预览');
                  setError('');
                  setNotice('已从草稿移除，保存后生效。');
                }}
              >
                移除自定义动画
              </button>
            )}
          </div>
          <p className={styles.hint}>
            导入带 clutch_fireworks 脚本头的 JavaScript 文件。最多 8 个，每个 64 KiB，时长 0.5–8
            秒。
          </p>
        </div>
        <div className={styles.previewControls}>
          <span role="status">{previewStatus}</span>
          <div className={styles.actions}>
            <button type="button" onClick={startPreview}>
              ▶ 预览动画
            </button>
            {previewing && (
              <button
                type="button"
                onClick={() => {
                  cancelPreview();
                  setValidated(undefined);
                  setPreviewStatus('预览已停止');
                }}
              >
                停止预览
              </button>
            )}
          </div>
        </div>
        <p className={styles.hint}>
          预览直接在整个 DSH 窗口播放当前草稿，不触发通知，也不会保存设置。
        </p>
      </div>
      <details className={styles.prompt}>
        <summary>用 AI 生成自己的动画</summary>
        <p>复制提示词，描述想要的效果，让 AI 输出 .js 文件，然后导入并预览。</p>
        <textarea
          aria-label="动画脚本生成提示词"
          readOnly
          value={ANIMATION_GENERATION_PROMPT}
          rows={10}
        />
        <button
          type="button"
          onClick={() => {
            if (!navigator.clipboard?.writeText) {
              setError('复制不可用，请从文本框手动复制。');
              return;
            }
            void navigator.clipboard
              .writeText(ANIMATION_GENERATION_PROMPT)
              .then(() => setNotice('生成提示词已复制。'))
              .catch(() => setError('复制失败，请从文本框手动复制。'));
          }}
        >
          复制生成提示词
        </button>
      </details>
      <div className={styles.footer}>
        <span role="status">
          {notice || (dirty ? '有尚未保存的修改' : '所选动画用于下一次全局庆祝')}
        </span>
        <div className={styles.actions}>
          <button
            type="button"
            disabled={!dirty || busy}
            onClick={() => {
              setDirty(false);
              cancelPreview();
              setValidated(undefined);
              setPreviewStatus('选择模板后点击预览');
              setError('');
              setNotice('已放弃修改。');
            }}
          >
            放弃修改
          </button>
          <button
            className={styles.primary}
            type="button"
            disabled={
              !dirty ||
              revision === undefined ||
              busy ||
              !saved.writable ||
              (selected.id.startsWith('custom-') && validated !== selected.id)
            }
            onClick={() => {
              void save();
            }}
          >
            {busy ? '保存中…' : '保存动画设置'}
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </section>
  );
}
