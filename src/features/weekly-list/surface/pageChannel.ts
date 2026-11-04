/**
 * How the in-page script learns what it needs, with no access to the extension's storage.
 * See docs/design.md, decisions 5, 11 and 20.
 *
 * The settings, the notes and the saved address are trusted items (trustedStorage.ts): Chrome and
 * Edge lock `storage.local` against content scripts, and Firefox keeps these items in the
 * IndexedDB of the extension, which content scripts cannot open. So the in-page script never
 * reads or writes them. It asks the background through checked messages, which answer only the
 * page of the saved Canvas:
 * - `weekrow:page-context` gives the settings, and tells that the page is the saved Canvas;
 * - `weekrow:save-settings` and `weekrow:mark-note-seen` write what the student changes in place;
 * - `weekrow:changed` comes back from the background with `tabs.sendMessage` after any change of
 *   the data, the settings, the notes or the saved address, and the script asks again.
 */
import {
  DEFAULT_TOOLS_SETTINGS,
  isToolsSettings,
  type ToolsSettings,
} from '../../../shared/settings/tools';
import { isSettings } from '../model/settings';
import { DEFAULT_SETTINGS, type Settings } from '../model/types';
import {
  isPageChangedMessage,
  type DataMessage,
  type PageContextReply,
  type SeenNote,
} from '../data/protocol';
import type { PageChoices } from '../inpage/start';

/** What the page needs to decide what it shows. */
interface PageContext {
  /** The page origin when it is the saved Canvas, otherwise `null`. */
  origin: string | null;
  settings: Settings;
  tools: ToolsSettings;
}

export interface PageChannel {
  choices: PageChoices;
  /** The settings shown in place: read, save, and follow the changes of other surfaces. */
  settings: {
    getValue(): Promise<Settings>;
    setValue(settings: Settings): Promise<void>;
    watch(listener: (settings: Settings) => void): () => void;
  };
  /** The switches of the small tools: read, save, and follow the changes of other surfaces. */
  tools: {
    getValue(): Promise<ToolsSettings>;
    setValue(tools: ToolsSettings): Promise<void>;
    watch(listener: (tools: ToolsSettings) => void): () => void;
  };
  /** Asks the background, for the fixes of the dashboard. The reply is not checked here. */
  send(message: DataMessage): Promise<unknown>;
  /** Calls the listener when the background says that data, settings or notes changed. */
  watchChanges(listener: () => void): () => void;
  markNoteSeen(note: SeenNote): Promise<void>;
  /** Stops listening for the background. */
  stop(): void;
}

export interface PageChannelDeps {
  /** Sends a message to the background, and resolves with its reply. */
  send(message: DataMessage): Promise<unknown>;
  /** The origin of the page. */
  pageOrigin: string;
  /**
   * Calls the handler for each message that the background sent to this page. Returns a remover.
   * The implementation passes only messages from the extension itself, not from a page.
   */
  listen(handler: (message: unknown) => void): () => void;
}

function defaultSettings(): Settings {
  return structuredClone(DEFAULT_SETTINGS);
}

export function createPageChannel(deps: PageChannelDeps): PageChannel {
  const changeListeners = new Set<() => void>();
  const originListeners = new Set<(origin: string | null) => void>();
  const settingsListeners = new Set<(settings: Settings) => void>();
  const toolsListeners = new Set<(tools: ToolsSettings) => void>();
  let last: PageContext | null = null;

  /** Asks the background. A refusal or a missing background means that the page is not saved. */
  async function read(): Promise<PageContext> {
    let reply: unknown;
    try {
      reply = await deps.send({ type: 'weekrow:page-context' });
    } catch {
      reply = undefined;
    }
    const fields = reply as Partial<PageContextReply> | undefined;
    const { settings, tools } = fields ?? {};
    if (!isSettings(settings)) {
      return {
        origin: null,
        settings: last?.settings ?? defaultSettings(),
        tools: last?.tools ?? structuredClone(DEFAULT_TOOLS_SETTINGS),
      };
    }
    return {
      origin: deps.pageOrigin,
      settings,
      // A reply of an older background has no tools. The defaults then apply.
      tools: isToolsSettings(tools) ? tools : structuredClone(DEFAULT_TOOLS_SETTINGS),
    };
  }

  /** The numbers of the reads that started and of the newest one whose answer was kept. */
  let started = 0;
  let kept = 0;
  /**
   * What the page was told last, field by field: by a read that a caller waited for, or by a
   * watcher call. A field the page did not ask for takes the kept answer before a newer one.
   */
  const told: Partial<PageContext> = {};
  /** The reads that a caller waits for, and the task that will tell the watchers. */
  let waiting = 0;
  let announcing: ReturnType<typeof setTimeout> | null = null;

  /**
   * Tells the watchers of each field where the newest answer differs from what the page knows.
   * It runs on a task of its own, and only while no caller waits for a read. So every caller
   * applies its own answer first (a start reads the address, the switches and the settings at
   * once), and the event then brings the newest value over it.
   */
  function scheduleAnnounce(): void {
    if (announcing !== null) return;
    announcing = setTimeout(() => {
      announcing = null;
      if (waiting === 0) announce();
    }, 0);
  }

  function announce(): void {
    if (last === null) return;
    if (told.origin !== undefined && told.origin !== last.origin) {
      told.origin = last.origin;
      for (const l of [...originListeners]) l(last.origin);
    }
    if (
      told.settings !== undefined &&
      JSON.stringify(told.settings) !== JSON.stringify(last.settings)
    ) {
      told.settings = last.settings;
      for (const l of [...settingsListeners]) l(last.settings);
    }
    if (told.tools !== undefined && JSON.stringify(told.tools) !== JSON.stringify(last.tools)) {
      told.tools = last.tools;
      for (const l of [...toolsListeners]) l(last.tools);
    }
  }

  /**
   * Reads again and keeps the answer only when no newer read has been kept. A caller that waits
   * for a field (`wanted`) gets the answer of its own read, and the watchers then hear of any
   * newer answer that differs from it, after the caller has applied it, so a change during the
   * first read is not lost.
   */
  async function refresh(wanted?: keyof PageContext): Promise<PageContext> {
    const number = ++started;
    if (wanted !== undefined) waiting += 1;
    const next = await read();
    if (number > kept) {
      kept = number;
      if (last !== null) {
        if (told.origin === undefined) told.origin = last.origin;
        if (told.settings === undefined) told.settings = last.settings;
        if (told.tools === undefined) told.tools = last.tools;
      }
      last = next;
    }
    if (wanted !== undefined) {
      Object.assign(told, { [wanted]: next[wanted] });
      waiting -= 1;
    }
    scheduleAnnounce();
    return next;
  }

  const stopListening = deps.listen((message) => {
    if (!isPageChangedMessage(message)) return;
    for (const listener of [...changeListeners]) listener();
    // A change can be of the address or the settings, which the page flow follows.
    refresh().catch(() => undefined);
  });

  function subscribe<T>(set: Set<T>, listener: T): () => void {
    set.add(listener);
    return () => set.delete(listener);
  }

  const settings: PageChannel['settings'] = {
    getValue: async () => (await refresh('settings')).settings,
    async setValue(next) {
      await deps.send({ type: 'weekrow:save-settings', settings: next });
    },
    watch: (listener) => subscribe(settingsListeners, listener),
  };

  const tools: PageChannel['tools'] = {
    getValue: async () => (await refresh('tools')).tools,
    async setValue(next) {
      await deps.send({ type: 'weekrow:save-tools', tools: next });
    },
    watch: (listener) => subscribe(toolsListeners, listener),
  };

  return {
    tools,
    send: deps.send,
    choices: {
      origin: {
        getValue: async () => (await refresh('origin')).origin,
        watch: (listener) => subscribe(originListeners, listener),
      },
    },
    settings,
    watchChanges: (listener) => subscribe(changeListeners, listener),
    async markNoteSeen(note) {
      await deps.send({ type: 'weekrow:mark-note-seen', note });
    },
    stop() {
      stopListening();
      if (announcing !== null) clearTimeout(announcing);
      announcing = null;
    },
  };
}
