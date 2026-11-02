import { render, h } from 'preact';
import { CloseIcon } from '../../shared/ui/icons';
import { browser } from 'wxt/browser';
import { createViewerNonce } from './channel';
import {
  courseOfLink,
  fileTarget,
  normalizeTabs,
  normalizeWidth,
  openFile,
  plainClick,
} from './model';
import type { ToolsSettings } from '../../shared/settings/tools';
import { detectPageTheme } from '../../shared/ui/pageTheme';
import { inpageTheme, type ThemeChoice } from '../../shared/ui/theme';

export function listenViewerHello(
  sourceWindow: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  frame: HTMLIFrameElement,
  nonce: string,
  connect: (origin: string) => void,
): () => void {
  const hello = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow) return;
    const data = event.data as { type?: unknown; nonce?: unknown } | null;
    if (data?.type === 'viewer-hello' && data.nonce === nonce) connect(event.origin);
  };
  sourceWindow.addEventListener('message', hello);
  return () => sourceWindow.removeEventListener('message', hello);
}

export async function startViewer(): Promise<void> {
  if (document.getElementById('tools-file-viewer')) return;
  const readContext = () =>
    browser.runtime.sendMessage({ type: 'weekrow:page-context' }) as Promise<
      { tools: ToolsSettings; settings?: { theme?: ThemeChoice } } | undefined
    >;
  const readTabs = async () =>
    normalizeTabs(await browser.runtime.sendMessage({ type: 'viewer:tabs-get' }));
  const context = await readContext();
  if (!context?.tools.fileViewer) return;
  let tabs = await readTabs();
  // The pane follows the Theme setting, and with Automatic it follows this Canvas page (decision 19).
  let themeChoice: ThemeChoice = context.settings?.theme ?? 'auto';
  const resolveTheme = () => inpageTheme(themeChoice, () => detectPageTheme(document));
  const applyTheme = () => {
    const theme = resolveTheme();
    host?.setAttribute('data-theme', theme);
    port?.postMessage({ type: 'theme', nonce, theme });
  };
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
  // The course the student opened each file from, for the "Open in Canvas" link.
  const courses = new Map<string, string>();
  // Sends the active file. The pane changes the tabs too, so the stored tabs are read again.
  const send = async () => {
    const [latest, stored] = await Promise.all([
      readContext().catch(() => undefined),
      readTabs().catch(() => tabs),
    ]);
    if (latest?.settings?.theme) themeChoice = latest.settings.theme;
    tabs = stored;
    applyTheme();
    const courseId = tabs.active === null ? undefined : courses.get(tabs.active);
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
  const show = () => {
    if (host) {
      void send();
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
      :host{--bg:#fff;--text:#273540;--line:#e8eaec;--edge:#c7cdd1;--hover:#f2f4f4;--focus:#0374b5;color:var(--text)}
      :host([data-theme='dark']){--bg:#1b2330;--text:#fff;--line:#2e3e4e;--edge:#4a5b68;--hover:#253443;--focus:#5a9fd4}
      section{box-sizing:border-box;height:100%;background:var(--bg);border-left:1px solid var(--edge);display:flex;flex-direction:column;font-family:Lato,Arial,sans-serif}
      header{flex:none;height:56px;display:flex;justify-content:flex-end;align-items:center;padding:0 12px;border-bottom:1px solid var(--line)}
      button{width:38px;height:38px;border:0;border-radius:4px;background:transparent;color:inherit;font-size:18px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}button:hover{background:var(--hover)}button:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
      iframe{border:0;width:100%;flex:1;min-height:0;background:transparent} .handle{position:absolute;left:-4px;top:0;width:8px;height:100%;cursor:ew-resize;touch-action:none}.handle:hover,.handle:focus-visible{background:var(--focus)} @media(max-width:899px){.handle{display:none}}
      </style><section aria-label="File viewer"><div class="handle" role="separator" aria-label="Resize file viewer" aria-orientation="vertical" tabindex="0"></div><header><button aria-label="Close file viewer" title="Close"></button></header></section>`;
    const frame = document.createElement('iframe');
    frame.title = 'File viewer';
    frame.src = browser.runtime.getURL('/viewer.html') + `#${nonce}`;
    // The pane page says hello first, so the port goes to the origin the frame really has.
    // Chromium can load a web-accessible page under a dynamic address that differs from getURL.
    removeHello = listenViewerHello(window, frame, nonce, (origin) => {
      port?.close();
      const channel = new MessageChannel();
      port = channel.port1;
      port.onmessage = (message) => {
        if (message.data?.type === 'close' && message.data.nonce === nonce) close();
      };
      frame.contentWindow?.postMessage({ type: 'viewer-connect', nonce }, origin, [channel.port2]);
      applyTheme();
      void send();
    });
    render(h(CloseIcon, {}), root.querySelector('button')!);
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
    applyTheme();
    layout();
  };
  window.addEventListener('resize', layout);
  // The background says when a setting changed, so the pane follows the Theme setting at once.
  browser.runtime.onMessage.addListener((message: unknown) => {
    if ((message as { type?: unknown } | null)?.type !== 'weekrow:changed') return;
    void readContext().then(
      (latest) => {
        const choice = latest?.settings?.theme;
        if (choice && choice !== themeChoice) {
          themeChoice = choice;
          applyTheme();
        }
      },
      () => undefined,
    );
  });
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
      const href =
        link.getAttribute('href') ??
        link.dataset['url'] ??
        `/files/${link.dataset['fileId'] ?? ''}`;
      const target = fileTarget(href, location.origin, moduleId);
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
        const courseId =
          'courseId' in target ? target.courseId : courseOfLink(href, location.origin);
        if (courseId) courses.set(file.fileId, courseId);
        if (host && port) {
          // The pane is open and owns the tabs, so it opens the file and saves the tabs itself.
          port.postMessage({
            type: 'open-file',
            nonce,
            fileId: file.fileId,
            ...(courseId ? { courseId } : {}),
          });
          return;
        }
        tabs = openFile(await readTabs(), file.fileId);
        await browser.runtime.sendMessage({ type: 'viewer:tabs-set', tabs });
        show();
      })().catch(() => undefined);
    },
    true,
  );
  if (tabs.active) show();
}
