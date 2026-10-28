import { startPanel } from '@/lib/surface/panelPage';

const root = document.getElementById('app');
if (root !== null) startPanel(root);

if (import.meta.env.WXT_E2E === '1') {
  import('@/lib/surface/e2eOpenPanelButton')
    .then((module) => module.mountOpenPanelButton(document.body))
    .catch((error: unknown) => console.error('The open panel test button failed', error));
}
