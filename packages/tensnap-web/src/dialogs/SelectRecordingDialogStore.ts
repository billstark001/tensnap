import { createDialogStore } from '@/utils/zustand';
import { SelectRecordingDialog, type SelectRecordingDialogProps } from './SelectRecordingDialog';
export const [useSelectRecordingStore, SelectRecordingDialogAnchor] = createDialogStore<
  SelectRecordingDialogProps,
  string | null
>(SelectRecordingDialog, (resolve) => ({ onSelect: resolve }), null);
