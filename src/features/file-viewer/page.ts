import { browser } from 'wxt/browser';
import { createViewerNonce } from './channel';
import { fileTarget, normalizeTabs, normalizeWidth, openFile, plainClick } from './model';
import type { ToolsSettings } from '../../shared/settings/tools';

export async function startViewer(): Promise<void> {
  if (document.getElementById('tools-file-viewer')) return;
  const context = (await browser.runtime.sendMessage({ type: 'weekrow:page-context' })) as
    { tools: ToolsSettings } | undefined;
  if (!context?.tools.fileViewer) return;
  let tabs = normalizeTabs(await browser.runtime.sendMessage({ type: 'viewer:tabs-get' }));
  let width = normalizeWidth(context.tools.fileViewerWidth, innerWidth);
  let host: HTMLDivElement | undefined;
  let port: MessagePort | undefined;
  let padding = '';
  let priority = '';
  const layout = () => {
    if (!host) return;
    host.style.width = innerWidth < 900 ? '100vw' : `${normalizeWidth(width, innerWidth)}px`;
    if (innerWidth < 900) {
      document.documentElement.style.setProperty('padding-right', padding, priority);
    } else {
      document.documentElement.style.setProperty('padding-right', host.style.width, 'important');
    }
  };
  const send = (courseId?: string) => {
    if (tabs.active)
      port?.postMessage({
        type: 'open-file',
        nonce,
        fileId: tabs.active,
        ...(courseId ? { courseId } : {}),
      });
  };
  let nonce = '';
  let removeHello: (() => void) | undefined;
  const close = () => {
    removeHello?.();
    removeHello = undefined;
    host?.remove();
    host = undefined;
    port?.close();
    port = undefined;
    document.documentElement.style.setProperty('padding-right', padding, priority);
    tabs = { ids: [], active: null };
    void browser.runtime.sendMessage({ type: 'viewer:tabs-set', tabs });
  };
  const show = (courseId?: string) => {
    if (host) {
      send(courseId);
      return;
    }
    padding = document.documentElement.style.getPropertyValue('padding-right');
    priority = document.documentElement.style.getPropertyPriority('padding-right');
    nonce = createViewerNonce();
    host = document.createElement('div');
    host.id = 'tools-file-viewer';
    host.style.cssText = 'position:fixed;right:0;top:0;height:100vh;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host{color-scheme:light dark}section{box-sizing:border-box;height:100%;background:light-dark(#fff,#262626);border-left:1px solid light-dark(#c7cdd1,#6a6f73);display:flex;flex-direction:column;font-family:Lato,Arial,sans-serif}
      header{height:56px;display:flex;justify-content:flex-end;align-items:center;padding:0 12px;border-bottom:1px solid light-dark(#c7cdd1,#6a6f73)}
      button{width:38px;height:38px;border:0;border-radius:4px;background:transparent;color:inherit;font-size:28px;cursor:pointer}button:hover{background:light-dark(#f2f3f4,#394047)}button:focus-visible{outline:2px solid #0374b5;outline-offset:2px}
      iframe{border:0;width:100%;flex:1;min-height:0} .handle{position:absolute;left:-4px;top:0;width:8px;height:100%;cursor:ew-resize;touch-action:none}.handle:hover,.handle:focus-visible{background:#0374b5} @media(max-width:899px){.handle{display:none}}
      </style><section aria-label="File viewer"><div class="handle" role="separator" aria-label="Resize file viewer" aria-orientation="vertical" tabindex="0"></div><header><button aria-label="Close file viewer" title="Close">×</button></header></section>`;
    const frame = document.createElement('iframe');
    frame.title = 'File viewer';
    frame.src = browser.runtime.getURL('/viewer.html') + `#${nonce}`;
    // The pane page says hello first, so the port goes to the origin the frame really has.
    // Chromium can load a web-accessible page under a dynamic address that differs from getURL.
    const hello = (event: MessageEvent) => {
      if (!host || event.source !== frame.contentWindow) return;
      const data = event.data as { type?: unknown; nonce?: unknown } | null;
      if (data?.type !== 'viewer-hello' || data.nonce !== nonce) return;
      port?.close();
      const channel = new MessageChannel();
      port = channel.port1;
      port.onmessage = (message) => {
        if (message.data?.type === 'close' && message.data.nonce === nonce) close();
      };
      frame.contentWindow?.postMessage({ type: 'viewer-connect', nonce }, event.origin, [
        channel.port2,
      ]);
      send(courseId);
    };
    window.addEventListener('message', hello);
    removeHello = () => window.removeEventListener('message', hello);
    root.querySelector('section')!.append(frame);
    root.querySelector('button')!.addEventListener('click', close);
    root.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Escape') close();
    });
    const handle = root.querySelector<HTMLElement>('.handle')!;
    const save = async () => {
      const latest = (await browser.runtime.sendMessage({ type: 'weekrow:page-context' })) as {
        tools: ToolsSettings;
      };
      await browser.runtime.sendMessage({
        type: 'weekrow:save-tools',
        tools: { ...latest.tools, fileViewerWidth: width },
      });
    };
    handle.addEventListener('pointerdown', (event) => {
      handle.setPointerCapture(event.pointerId);
      const move = (event: PointerEvent) => {
        width = normalizeWidth(innerWidth - event.clientX, innerWidth);
        layout();
      };
      const end = () => {
        handle.removeEventListener('pointermove', move);
        void save();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', end, { once: true });
    });
    handle.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      width = normalizeWidth(width + (event.key === 'ArrowLeft' ? 20 : -20), innerWidth);
      layout();
      void save();
    });
    document.body.append(host);
    layout();
  };
  window.addEventListener('resize', layout);
  document.addEventListener(
    'click',
    (event) => {
      if (!plainClick(event) || !(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLElement>(
        'a[href],button[data-file-id],button[data-url]',
      );
      if (!link || link.hasAttribute('download')) return;
      const module = link.closest('[data-module-id],.context_module');
      const moduleId =
        module?.getAttribute('data-module-id') ?? module?.id.replace('context_module_', '');
      const target = fileTarget(
        link.getAttribute('href') ??
          link.dataset['url'] ??
          `/files/${link.dataset['fileId'] ?? ''}`,
        location.origin,
        moduleId,
      );
      if (!target) return;
      if (
        'itemId' in target &&
        !link.closest('.attachment,.file,[data-type="File"],[data-module-type="File"]')
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void (async () => {
        const file =
          'fileId' in target
            ? target
            : ((await browser.runtime.sendMessage({ type: 'viewer:module-item', ...target })) as
                { fileId: string } | undefined);
        if (!file) return;
        tabs = openFile(tabs, file.fileId);
        await browser.runtime.sendMessage({ type: 'viewer:tabs-set', tabs });
        show('courseId' in target ? target.courseId : undefined);
      })().catch(() => undefined);
    },
    true,
  );
  if (tabs.active) show();
}
