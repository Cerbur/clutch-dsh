import { createElement, type ComponentType } from 'react';

export interface DshIconProps {
  readonly size?: number;
  readonly className?: string;
}

type IconComponent = ComponentType<DshIconProps>;
type PrimitiveExports = Readonly<Record<string, unknown>>;

/** Resolve a legacy size-named export or the equivalent DSH 1.7 weighted export. */
export function createDshIconAlias(
  exports: PrimitiveExports,
  legacyName: string,
  currentName: string,
): IconComponent {
  return function DshIconAlias(props) {
    const candidate = exports[legacyName] ?? exports[currentName];
    if (typeof candidate !== 'function') {
      throw new Error(`Missing DSH icon export: ${legacyName} or ${currentName}`);
    }
    return createElement(candidate as IconComponent, props);
  };
}
