import { applyTabIntent, type TabIntent, type Tabs } from './model';

/** A tab store for page tests; the background router tests cover request validation and ordering. */
export function tabIntentReply(message: { type: string; [key: string]: unknown }, current: Tabs) {
  const action = message.type.slice('viewer:tabs-'.length);
  const tabs = applyTabIntent(current, { ...message, action } as TabIntent);
  return {
    ...tabs,
    token: message.token,
    added: action === 'open' && !current.ids.includes(String(message.fileId)),
    evictedIndex: action === 'open' ? current.ids.findIndex((id) => !tabs.ids.includes(id)) : -1,
    evicted: action === 'open' ? (current.ids.find((id) => !tabs.ids.includes(id)) ?? null) : null,
  };
}
