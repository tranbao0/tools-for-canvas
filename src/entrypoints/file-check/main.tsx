import { logFailure } from '@/shared/platform/log';
import { startFileCheckPage } from '@/features/file-check/ui/startPage';

const root = document.getElementById('app');
if (root !== null) {
  startFileCheckPage(root).catch((error: unknown) => logFailure('file access check', error));
}
