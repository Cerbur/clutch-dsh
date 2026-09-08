import { RiskConfirmation } from '@deepseek-ai/dsh-client-ui-primitives';
import type { WorktreeSurfaceProps } from '../types.js';
import type { useSurfaceSources } from '../state/useSurfaceSources.js';

type Input = {
  source: Pick<
    ReturnType<typeof useSurfaceSources>,
    'fullAccessConfirmationSnapshot' | 'fullAccessAcknowledged' | 'setFullAccessAcknowledged'
  >;
  props: Pick<WorktreeSurfaceProps, 't' | 'fullAccessConfirmation'>;
};

export function AccessConfirmation({ source, props }: Input) {
  const { fullAccessConfirmationSnapshot, fullAccessAcknowledged, setFullAccessAcknowledged } =
    source;
  const { t, fullAccessConfirmation } = props;

  return (
    <>
      <RiskConfirmation
        open={fullAccessConfirmationSnapshot !== undefined}
        title={t('permission.fullAccessTitle')}
        description={
          fullAccessConfirmationSnapshot === undefined
            ? ''
            : t('permission.fullAccessDescription', {
                cwd: fullAccessConfirmationSnapshot.cwd,
              })
        }
        acknowledgeLabel={t('permission.fullAccessAcknowledge')}
        cancelLabel={t('dialog.cancel')}
        closeLabel={t('dialog.close')}
        confirmLabel={t('permission.fullAccessEnable')}
        acknowledged={fullAccessAcknowledged}
        onAcknowledgedChange={setFullAccessAcknowledged}
        onCancel={() => {
          setFullAccessAcknowledged(false);
          fullAccessConfirmation?.resolve(false);
        }}
        onConfirm={() => {
          setFullAccessAcknowledged(false);
          fullAccessConfirmation?.resolve(true);
        }}
      />
    </>
  );
}
