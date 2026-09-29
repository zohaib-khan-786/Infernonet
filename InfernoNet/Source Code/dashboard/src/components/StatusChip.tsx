/**
 * Status chip: shape + word + tone, never colour alone.
 *
 * The label comes from the backend. `humaniseLabel` only removes underscores
 * and fixes the case; it does not choose a different verdict, and the raw token
 * is always available as a title.
 */
import { memo } from 'react';
import type { StatusBlock } from '../api/types';
import { statusPresentation } from '../lib/status';
import { Mark } from './Mark';

export interface StatusChipProps {
  readonly status: StatusBlock;
}

export const StatusChip = memo(function StatusChip({ status }: StatusChipProps) {
  const presentation = statusPresentation(status);
  return (
    <span className="chip" data-tone={presentation.tone} title={`Reported by the device as ${presentation.token}`}>
      <Mark shape={presentation.shape} className="mark--sm" />
      {presentation.label}
    </span>
  );
});
