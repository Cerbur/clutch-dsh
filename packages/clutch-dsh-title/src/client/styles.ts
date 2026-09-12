/** Scoped styles travel inside the browser closure and inherit DSH theme tokens. */
export const templateStyles = `
.clutch-title {
  --ctm-text: var(--dsw-alias-label-primary, #25272d);
  --ctm-muted: var(--dsw-alias-label-tertiary, #777b86);
  --ctm-line: var(--dsw-alias-border-l4, #e7e8ec);
  --ctm-surface: var(--dsw-alias-bg-layer-1, #f7f8fa);
  --ctm-accent: var(--dsw-alias-brand-primary, #4d6bfe);
  --ctm-error: var(--dsw-alias-state-error-primary, #c44141);
  width: 100%;
  max-width: 720px;
  min-width: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 16px;
  color: var(--ctm-text);
  font-size: 13px;
  line-height: 1.55;
}
.clutch-title *,
.clutch-title *::before,
.clutch-title *::after {
  box-sizing: border-box;
}
.clutch-title h2,
.clutch-title h3,
.clutch-title p,
.clutch-title pre {
  margin: 0;
}
.clutch-title-heading h2 {
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
}
.clutch-title-heading p {
  color: var(--ctm-muted);
  margin-top: 5px;
  font-size: 13px;
}
.clutch-title-preference {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  border: 1px solid var(--ctm-line);
  border-radius: 12px;
}
.clutch-title-preference-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding-top: 14px;
  border-top: 1px solid var(--ctm-line);
}
.clutch-title-preference-copy label {
  font-weight: 550;
  cursor: pointer;
}
.clutch-title-preference-copy p {
  color: var(--ctm-muted);
  font-size: 12px;
  margin-top: 4px;
}
.clutch-title-switch {
  appearance: none;
  position: relative;
  flex: none;
  width: 34px;
  height: 20px;
  margin: 0;
  border: 0;
  border-radius: 20px;
  background: var(--dsw-alias-border-l3, #c5c8d0);
  cursor: pointer;
  transition: background 150ms;
}
.clutch-title-switch::after {
  content: "";
  position: absolute;
  width: 16px;
  height: 16px;
  top: 2px;
  left: 2px;
  border-radius: 50%;
  background: var(--dsw-alias-label-primary-foreground, #fff);
  box-shadow: 0 1px 3px #0002;
  transition: transform 150ms;
}
.clutch-title-switch:checked {
  background: var(--ctm-accent);
}
.clutch-title-switch:checked::after {
  transform: translateX(14px);
}
.clutch-title-switch:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.clutch-title :is(button, input, textarea):focus-visible {
  outline: 2px solid var(--ctm-accent);
  outline-offset: 3px;
}
.clutch-title-current {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.clutch-title-current-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.clutch-title-current-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ctm-text);
  line-height: 1.4;
}
.clutch-title-current-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--ctm-text);
  overflow-wrap: anywhere;
  line-height: 1.4;
}
.clutch-title-current .clutch-title-preview {
  margin-top: 0 !important;
}
.clutch-title-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--ctm-muted);
}
.clutch-title-status-dot[data-enabled="true"] {
  background: var(--ctm-accent);
}
.clutch-title-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
}
.clutch-title-toolbar h3 {
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}
.clutch-title-count {
  font-size: 11px;
  font-weight: 400;
  color: var(--ctm-muted);
  background: var(--ctm-surface);
  padding: 1px 6px;
  border-radius: 5px;
}
.clutch-title-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.clutch-title-list {
  display: grid;
  gap: 8px;
}
.clutch-title-card {
  min-width: 0;
  border: 1px solid var(--ctm-line);
  border-radius: 12px;
  overflow: hidden;
}
.clutch-title-card[data-current="true"] {
  border-color: color-mix(in srgb, var(--ctm-accent) 30%, var(--ctm-line));
}
.clutch-title-card[data-editing="true"] {
  border-color: color-mix(in srgb, var(--ctm-accent) 45%, var(--ctm-line));
}
.clutch-title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
}
.clutch-title-template-icon {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  background: var(--ctm-surface);
  border-radius: 8px;
  color: var(--ctm-muted);
  font:
    12px ui-monospace,
    monospace;
}
.clutch-title-card[data-current="true"] .clutch-title-template-icon {
  color: var(--ctm-accent);
  background: color-mix(in srgb, var(--ctm-accent) 8%, transparent);
}
.clutch-title-identity {
  flex: 1;
  min-width: 0;
}
.clutch-title-name {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
}
.clutch-title-name strong {
  font-size: 13px;
  font-weight: 550;
  overflow-wrap: anywhere;
}
.clutch-title-badge {
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  line-height: 18px;
  padding: 0 6px;
  border-radius: 4px;
  white-space: nowrap;
}
.clutch-title-badge[data-tone="active"] {
  background: color-mix(in srgb, var(--ctm-accent) 8%, transparent);
  color: var(--ctm-accent);
}
.clutch-title-badge[data-tone="error"] {
  background: color-mix(in srgb, var(--ctm-error) 8%, transparent);
  color: var(--ctm-error);
}
.clutch-title-row-caption {
  color: var(--ctm-muted);
  font-size: 11px;
  margin-top: 2px !important;
}
.clutch-title-preview {
  color: var(--ctm-muted);
  font-size: 11px;
  margin-top: 5px !important;
  overflow-wrap: anywhere;
}
.clutch-title-preview code {
  color: var(--ctm-text);
  white-space: pre-wrap;
}
.clutch-title-delete:not(:disabled):hover {
  color: var(--ctm-error);
  background: color-mix(in srgb, var(--ctm-error) 7%, transparent);
}
.clutch-title-row-error,
.clutch-title-alert {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--ctm-error);
  background: color-mix(in srgb, var(--ctm-error) 5%, transparent);
  font:
    11px/1.7 ui-monospace,
    monospace;
}
.clutch-title-row-error {
  padding: 10px 14px;
  border-top: 1px solid color-mix(in srgb, var(--ctm-error) 10%, transparent);
}
.clutch-title-error-details {
  border-top: 1px solid var(--ctm-line);
}
.clutch-title-error-details summary {
  padding: 7px 14px;
  font-size: 11px;
  color: var(--ctm-error);
  cursor: pointer;
}
.clutch-title-error-details summary:focus-visible {
  outline: 2px solid var(--ctm-accent);
  outline-offset: -3px;
}
.clutch-title-alert {
  border-radius: 8px;
  padding: 10px 12px;
}
.clutch-title-new-heading {
  padding: 14px 16px;
  font-weight: 600;
}
.clutch-title-editor {
  display: grid;
  gap: 12px;
  border-top: 1px solid var(--ctm-line);
  padding: 16px;
  background: color-mix(in srgb, var(--ctm-surface) 50%, transparent);
}
.clutch-title-field {
  display: grid;
  gap: 7px;
  font-size: 12px;
  font-weight: 500;
}
.clutch-title-field > span:last-child {
  width: 100%;
  max-width: 360px;
}
.clutch-title-code {
  overflow: hidden;
  border: 1px solid var(--ctm-line);
  border-radius: 8px;
  background: var(--dsw-alias-bg-base, transparent);
}
.clutch-title-code:focus-within {
  border-color: color-mix(in srgb, var(--ctm-accent) 60%, var(--ctm-line));
}
.clutch-title-codebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 12px;
  border-bottom: 1px solid var(--ctm-line);
  background: var(--ctm-surface);
  color: var(--ctm-muted);
  font-size: 11px;
}
.clutch-title-language {
  font:
    10px ui-monospace,
    monospace;
  letter-spacing: 0.04em;
}
.clutch-title-code textarea {
  display: block;
  width: 100%;
  resize: vertical;
  min-height: 140px;
  max-height: 480px;
  border: 0;
  border-radius: 0;
  padding: 12px 14px;
  color: var(--ctm-text);
  background: transparent;
  font:
    12px/1.75 ui-monospace,
    SFMono-Regular,
    Menlo,
    Consolas,
    monospace;
  tab-size: 2;
}
.clutch-title-code textarea:focus-visible {
  outline: none;
}
.clutch-title-muted {
  color: var(--ctm-muted);
}
.clutch-title-help {
  font-size: 11px;
  line-height: 1.65;
}
.clutch-title-editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
.clutch-title-validation,
.clutch-title-saved {
  font-size: 11px;
  color: var(--dsw-alias-state-success-primary, #39835a);
}
.clutch-title-confirm {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-top: 1px solid var(--ctm-line);
  background: var(--ctm-surface);
  font-size: 12px;
}
.clutch-title-footer {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  border-top: 1px solid var(--ctm-line);
  padding-top: 14px;
  font-size: 11px;
  color: var(--ctm-muted);
}
.clutch-title-saved {
  flex: none;
}
@media (max-width: 600px) {
  .clutch-title-row {
    flex-wrap: wrap;
    gap: 10px;
  }
  .clutch-title-row-actions {
    width: 100%;
    justify-content: flex-end;
  }
  .clutch-title-identity {
    flex-basis: calc(100% - 46px);
  }
  .clutch-title-editor {
    padding: 12px;
  }
  .clutch-title-toolbar {
    flex-wrap: wrap;
  }
}

.clutch-title-stats-card {
  min-width: 0;
  border: 1px solid var(--ctm-line);
  border-radius: 12px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--ctm-surface);
}
.clutch-title-stats-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.clutch-title-stats-header h3 {
  font-size: 13px;
  font-weight: 600;
  color: var(--ctm-text);
}
.clutch-title-stats-header p {
  color: var(--ctm-muted);
  font-size: 12px;
  margin-top: 3px;
}
.clutch-title-stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.clutch-title-stat-item {
  background: var(--dsw-alias-bg-base, #fff);
  border: 1px solid var(--ctm-line);
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.clutch-title-stat-label {
  font-size: 11px;
  color: var(--ctm-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.clutch-title-stat-value {
  font-size: 15px;
  font-weight: 600;
  color: var(--ctm-text);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
  line-height: 1.25;
}
.clutch-title-stats-recent {
  font-size: 12px;
  color: var(--ctm-muted);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 8px;
  margin-top: 3px;
  line-height: 1.4;
}
.clutch-title-stats-recent-time {
  font-variant-numeric: tabular-nums;
}
.clutch-title-stats-empty {
  font-size: 12px;
  color: var(--ctm-muted);
  margin-top: 3px;
  line-height: 1.4;
}
@media (max-width: 600px) {
  .clutch-title-stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (prefers-reduced-motion: reduce) {
  .clutch-title-switch,
  .clutch-title-switch::after {
    transition: none;
  }
}
`;
