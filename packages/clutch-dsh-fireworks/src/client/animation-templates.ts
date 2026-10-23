import emoji from '../../assets/animations/emoji.js?raw';
import classic from '../../assets/animations/classic.js?raw';
import rings from '../../assets/animations/rings.js?raw';
import { parseAnimation, type AnimationPreferences, type AnimationTemplate } from '../animation.js';

export const BUILTIN_ANIMATIONS = [
  parseAnimation(emoji, 'emoji'),
  parseAnimation(classic, 'classic'),
  parseAnimation(rings, 'rings'),
];
export function animationTemplates(preferences: AnimationPreferences): AnimationTemplate[] {
  return [
    ...BUILTIN_ANIMATIONS,
    ...Object.entries(preferences.scripts).map(([id, source]) => parseAnimation(source, id)),
  ];
}
export function selectedAnimation(preferences: AnimationPreferences): AnimationTemplate {
  return (
    animationTemplates(preferences).find((template) => template.id === preferences.active) ??
    BUILTIN_ANIMATIONS[0]
  );
}
