import { startWelcome } from '@/features/weekly-list/surface/welcomePage';

const root = document.getElementById('app');
if (root !== null) startWelcome(root);
