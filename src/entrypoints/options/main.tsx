import { logFailure } from '@/shared/platform/log';
import { startOptions } from '@/features/weekly-list/surface/optionsPage';

const root = document.getElementById('app');
if (root !== null) startOptions(root).catch((error: unknown) => logFailure('settings page', error));
