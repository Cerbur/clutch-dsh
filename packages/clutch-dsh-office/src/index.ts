export const name = 'clutch-dsh-office';

// Pure UI plugin: this Host entry gives DSH ownership of Client activation.
// Workspace and Session facts come from native Client controllers, without a Remote.
export function apply(): void {}

export { projectOffices } from './office/project.js';
export { planAction, advancePosition } from './office/actions.js';
export type * from './office/types.js';
