import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  MAX_CUSTOM_ANIMATIONS,
  customAnimationCount,
  type AnimationMetadata,
  MAX_SCRIPT_BYTES,
  parseAnimation,
  type AnimationPreferences,
  type AnimationTemplate,
} from '../animation.js';
import { animationTemplates } from './animation-templates.js';
import { animationGenerationPrompt } from './animation-generation-prompt.js';
import {
  animationPromptLocales,
  promptLanguage,
  subscribePromptLanguage,
} from './animation-prompt-locales.js';
import type { FireworksController } from './fireworks-controller.js';
import type { AnimationStore } from './animation-store.js';
import styles from './animation-settings.css';
import { validateAnimation } from './animation-validation.js';

function download(template: AnimationTemplate) {
  const url = URL.createObjectURL(
    new Blob([template.source], { type: 'text/javascript;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = template.id + '.js';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type AnimationCard = Pick<AnimationTemplate, 'id' | 'name'> & {
  readonly durationMs?: number;
  readonly source?: string;
  readonly broken?: boolean;
};

function previewContent(template: AnimationTemplate, playing: boolean, ready: boolean) {
  if (!playing) return '预览';
  return (
    <span
      className={styles.previewProgress}
      role="progressbar"
      aria-label="动画预览进度"
      aria-valuetext={ready ? '正在播放，点击停止' : '正在加载'}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle className={styles.progressTrack} cx="12" cy="12" r="9" />
        <circle
          className={styles.progressValue}
          data-running={ready}
          cx="12"
          cy="12"
          r="9"
          pathLength="1"
          style={{ animationDuration: `${template.durationMs}ms` }}
        />
        <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" />
      </svg>
    </span>
  );
}

function cardDetails(template: AnimationCard, current = false) {
  return (
    <>
      <span className={styles.templateIcon} aria-hidden="true">
        {template.id === 'emoji'
          ? '🎉'
          : template.id === 'classic'
            ? '✦'
            : template.id === 'rings'
              ? '◎'
              : '✧'}
      </span>
      <span className={styles.templateBody}>
        <strong className={styles.templateName} title={template.name}>
          {template.name}
        </strong>
        <span
          className={template.broken ? styles.brokenTag : current ? styles.currentTag : styles.tag}
        >
          {template.broken
            ? '本地文件损坏'
            : current
              ? '当前使用'
              : template.id.startsWith('custom-')
                ? '自定义'
                : '内置模板'}
        </span>
        <span className={styles.duration}>
          {template.durationMs === undefined
            ? '时长不可用'
            : `${(template.durationMs / 1000).toFixed(1)} 秒`}
        </span>
      </span>
    </>
  );
}

export function AnimationSettings({
  store,
  playback,
  validate = validateAnimation,
}: {
  readonly store: AnimationStore;
  readonly playback: Pick<FireworksController, 'previewAnimation'>;
  readonly validate?: typeof validateAnimation;
}) {
  const language = useSyncExternalStore(subscribePromptLanguage, promptLanguage);
  const promptText = animationPromptLocales[language];
  const generationPrompt = animationGenerationPrompt(promptText.creativeBrief);
  const saved = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const templates = useMemo<AnimationCard[]>(
    () => [
      ...animationTemplates(saved.preferences),
      ...Object.entries(saved.preferences.unavailable ?? {}).map(([id, metadata]) => ({
        id,
        ...metadata,
        broken: true,
      })),
    ],
    [saved.preferences],
  );
  const [busy, setBusy] = useState(false);
  const updating = useRef(false);
  const [validating, setValidating] = useState(false);
  const validation = useRef<AbortController>();
  const [pendingImport, setPendingImport] = useState<AnimationTemplate>();
  const [importError, setImportError] = useState('');
  const [previewFailed, setPreviewFailed] = useState(false);
  const [deletingId, setDeletingId] = useState<string>();
  const dialog = useRef<HTMLDialogElement>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [previewId, setPreviewId] = useState<string>();
  const [previewReady, setPreviewReady] = useState(false);
  const stopPreview = useRef<() => void>();
  const previewRequest = useRef(0);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const refresh = () => {
      if (!updating.current && !validation.current && document.visibilityState !== 'hidden')
        void store.load();
    };
    refresh();
    const timer = setInterval(refresh, 2000);
    window.addEventListener?.('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener?.('focus', refresh);
    };
  }, [store]);
  useEffect(() => {
    if (
      saved.preferences.active === 'emoji' &&
      Object.keys(saved.preferences.unavailable ?? {}).length
    )
      setNotice('');
    if (previewId && saved.preferences.unavailable?.[previewId]) {
      stopPreview.current?.();
      stopPreview.current = undefined;
      setPreviewId(undefined);
      setPreviewReady(false);
    }
  }, [saved.preferences, previewId]);
  useEffect(
    () => () => {
      previewRequest.current++;
      validation.current?.abort();
      stopPreview.current?.();
    },
    [],
  );
  useEffect(() => {
    if (pendingImport || importError) dialog.current?.showModal();
  }, [pendingImport, importError]);
  const cancelPreview = () => {
    previewRequest.current++;
    stopPreview.current?.();
    stopPreview.current = undefined;
    setPreviewId(undefined);
  };
  const editable =
    saved.loaded && saved.writable && saved.revision !== undefined && !busy && !validating;
  const update = async (
    change: (current: AnimationPreferences) => AnimationPreferences | Promise<AnimationPreferences>,
    message: string,
  ) => {
    if (updating.current) return false;
    updating.current = true;
    setBusy(true);
    setError('');
    setNotice('正在更新…');
    try {
      const current = store.getSnapshot();
      await store.save(await change(current.preferences), current.revision);
      setNotice(message);
      return true;
    } catch (reason) {
      setError(String(reason));
      setNotice('');
      await store.load();
      return false;
    } finally {
      updating.current = false;
      setBusy(false);
    }
  };
  const select = (id: string) => {
    setDeletingId(undefined);
    if (id === saved.preferences.active) return;
    cancelPreview();
    setPreviewReady(false);
    void update((current) => ({ ...current, active: id }), '已切换，下次庆祝立即使用。');
  };
  const closeImport = () => {
    if (updating.current) return;
    cancelPreview();
    setPreviewReady(false);
    setPendingImport(undefined);
    setImportError('');
    setPreviewFailed(false);
    setError('');
  };
  const importFile = async (value: File) => {
    if (updating.current || validation.current) return;
    const controller = new AbortController();
    validation.current = controller;
    setValidating(true);
    setPreviewFailed(false);
    cancelPreview();
    setPreviewReady(false);
    setError('');
    setNotice('');
    setDeletingId(undefined);
    try {
      if (!/\.js$/i.test(value.name)) throw new Error('请选择 .js 动画脚本');
      if (value.size > MAX_SCRIPT_BYTES) throw new Error('动画脚本不能超过 64 KiB');
      if (customAnimationCount(store.getSnapshot().preferences) >= MAX_CUSTOM_ANIMATIONS)
        throw new Error('最多导入 8 个自定义动画，请先删除一个');
      const source = await value.text();
      if (controller.signal.aborted) return;
      const template = parseAnimation(source, 'custom-' + crypto.randomUUID());
      await validate(template, controller.signal);
      if (!controller.signal.aborted) setPendingImport(template);
    } catch (reason) {
      if (!controller.signal.aborted) setImportError(String(reason));
    } finally {
      if (!controller.signal.aborted) setValidating(false);
      if (validation.current === controller) validation.current = undefined;
    }
  };
  const confirmImport = async () => {
    if (!pendingImport) return;
    const template = pendingImport;
    cancelPreview();
    const success = await update((current) => {
      if (customAnimationCount(current) >= MAX_CUSTOM_ANIMATIONS)
        throw new Error('最多导入 8 个自定义动画，请先删除一个');
      return {
        ...current,
        active: template.id,
        scripts: { ...current.scripts, [template.id]: template.source },
      };
    }, '已导入并设为当前使用。');
    if (success) {
      setPendingImport(undefined);
      setPreviewReady(false);
    }
  };
  const remove = async (id: string) => {
    cancelPreview();
    setPreviewReady(false);
    const success = await update((current) => {
      const scripts = { ...current.scripts };
      const unavailable: Record<string, AnimationMetadata> = { ...current.unavailable };
      delete scripts[id];
      delete unavailable[id];
      return {
        active: current.active === id ? 'emoji' : current.active,
        scripts,
        ...(Object.keys(unavailable).length ? { unavailable } : {}),
      };
    }, '已删除动画及未被引用的脚本文件。');
    if (success) setDeletingId(undefined);
  };
  const preview = async (template: AnimationTemplate) => {
    cancelPreview();
    const request = previewRequest.current;
    setError('');
    // Refresh cached disk availability before previewing a persisted animation.
    if (template.id !== pendingImport?.id) {
      await store.load();
      if (request !== previewRequest.current) return;
      const latest = store.getSnapshot().preferences;
      if (latest.unavailable?.[template.id]) return;
      if (template.id.startsWith('custom-') && latest.scripts[template.id] !== template.source)
        return;
    }
    setPreviewId(template.id);
    setPreviewReady(false);
    let active = true;
    const cancel = playback.previewAnimation(template, (status, message) => {
      if (!active) return;
      if (status === 'ready') setPreviewReady(true);
      else {
        setPreviewId(undefined);
        setPreviewReady(false);
        if (template.id === pendingImport?.id) {
          if (status === 'error') setPreviewFailed(true);
          else if (status === 'done') setPreviewFailed(false);
        }
        if (status === 'error') setError(message ?? '动画脚本出错');
      }
    });
    stopPreview.current = () => {
      active = false;
      cancel();
    };
  };
  const confirmDeleteText = document.documentElement?.lang?.startsWith('en')
    ? 'Confirm delete?'
    : '确定删除？';
  return (
    <section className={styles.settings} aria-label="烟花动画设置" aria-busy={busy || validating}>
      <div className={styles.heading}>
        <div>
          <h2>烟花动画</h2>
          <p>选择你的庆祝画面，切换后立即生效。</p>
        </div>
        <button
          type="button"
          className={styles.importButton}
          disabled={!editable}
          onClick={() => file.current?.click()}
        >
          {validating ? '正在校验…' : '＋ 导入 js 动画'}
        </button>
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
      </div>
      {saved.error && (
        <div role="alert" className={styles.error}>
          {saved.error}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void store.load();
            }}
          >
            重试读取
          </button>
        </div>
      )}
      <div className={styles.templates} role="radiogroup" aria-label="动画模板">
        {templates.map((template) => {
          const custom = template.id.startsWith('custom-');
          const current = template.id === saved.preferences.active;
          const playing = previewId === template.id;
          return (
            <article
              key={template.id}
              className={styles.card}
              aria-label={template.name}
              data-active={current}
              data-deleting={deletingId === template.id}
              data-broken={!!template.broken}
            >
              <button
                type="button"
                role="radio"
                aria-checked={current}
                aria-label={template.name}
                className={styles.template}
                disabled={!editable || template.broken}
                onClick={() => select(template.id)}
              >
                {cardDetails(template, current)}
              </button>
              <div className={styles.cardActions}>
                {deletingId === template.id ? (
                  <>
                    <span className={styles.deleteQuestion}>{confirmDeleteText}</span>
                    <button
                      type="button"
                      className={styles.dangerButton}
                      disabled={!editable}
                      aria-label={`确认删除 ${template.name}`}
                      onClick={() => void remove(template.id)}
                    >
                      删除
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`取消删除 ${template.name}`}
                      onClick={() => setDeletingId(undefined)}
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <>
                    {!template.broken && (
                      <>
                        <button
                          type="button"
                          className={styles.previewButton}
                          aria-label={`${playing ? '停止预览' : '预览'} ${template.name}`}
                          onClick={() => {
                            if (playing) {
                              cancelPreview();
                              setPreviewReady(false);
                            } else void preview(template as AnimationTemplate);
                          }}
                        >
                          {previewContent(template as AnimationTemplate, playing, previewReady)}
                        </button>
                        <button
                          type="button"
                          aria-label={`导出 ${template.name}`}
                          onClick={() => download(template as AnimationTemplate)}
                        >
                          导出
                        </button>
                      </>
                    )}
                    {custom && (
                      <button
                        type="button"
                        className={styles.deleteButton}
                        disabled={!editable}
                        aria-label={`删除 ${template.name}`}
                        aria-expanded={false}
                        onClick={() => {
                          cancelPreview();
                          setDeletingId(template.id);
                        }}
                      >
                        删除
                      </button>
                    )}
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {notice && (
        <p role="status" className={styles.hint}>
          {notice}
        </p>
      )}
      {error && !pendingImport && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {(pendingImport || importError) && (
        <dialog
          ref={dialog}
          className={styles.dialog}
          aria-labelledby="fireworks-import-title"
          onCancel={(event) => {
            event.preventDefault();
            closeImport();
          }}
        >
          <h3 id="fireworks-import-title">{importError ? '动画文件无效' : '确认添加动画'}</h3>
          {importError ? (
            <p role="alert" className={styles.error}>
              {importError}
            </p>
          ) : (
            pendingImport && (
              <>
                <article className={styles.card} aria-label={`待添加 ${pendingImport.name}`}>
                  <div className={styles.template}>{cardDetails(pendingImport)}</div>
                  <div className={styles.cardActions}>
                    <button
                      type="button"
                      disabled={busy}
                      className={styles.previewButton}
                      aria-label={`${previewId === pendingImport.id ? '停止预览' : '预览'} ${pendingImport.name}`}
                      onClick={() => {
                        if (previewId === pendingImport.id) {
                          cancelPreview();
                          setPreviewReady(false);
                        } else preview(pendingImport);
                      }}
                    >
                      {previewContent(pendingImport, previewId === pendingImport.id, previewReady)}
                    </button>
                  </div>
                </article>
                <p className={styles.hint}>
                  已通过脚本头、语法和首帧校验。可预览完整效果，确认后才会保存并设为当前使用。
                </p>
                {error && (
                  <p role="alert" className={styles.error}>
                    {error}
                  </p>
                )}
              </>
            )
          )}
          <div className={styles.dialogActions}>
            {importError ? (
              <button type="button" autoFocus onClick={closeImport}>
                知道了
              </button>
            ) : (
              <>
                <button type="button" autoFocus disabled={busy} onClick={closeImport}>
                  取消添加
                </button>
                <button
                  type="button"
                  className={styles.primaryButton}
                  disabled={!editable || previewFailed}
                  onClick={() => void confirmImport()}
                >
                  {busy ? '添加中…' : '确认添加'}
                </button>
              </>
            )}
          </div>
        </dialog>
      )}
      <details className={styles.prompt}>
        <summary>{promptText.title}</summary>
        <p>{promptText.guide}</p>
        <textarea aria-label={promptText.label} readOnly value={generationPrompt} rows={10} />
        <button
          type="button"
          onClick={() => {
            if (!navigator.clipboard?.writeText) {
              setNotice('');
              setError(promptText.unavailable);
              return;
            }
            setError('');
            setNotice('');
            void navigator.clipboard
              .writeText(generationPrompt)
              .then(() => setNotice(promptText.copied))
              .catch(() => setError(promptText.failed));
          }}
        >
          {promptText.copy}
        </button>
      </details>
    </section>
  );
}
