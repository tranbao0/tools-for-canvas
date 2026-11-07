import { browser } from 'wxt/browser';

/** Checks the owner while a pane holds student content, even when the pane is covered. */
export function watchPaneIdentity(lost: () => void): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
  };
  // The token binds every pane, including a covered pane, to the confirmed student and reset round.
  const check = async () => {
    try {
      const reply = (await browser.runtime.sendMessage({ type: 'viewer:tabs-get' })) as
        { token?: string } | undefined;
      if (!reply?.token) throw new Error('No confirmed student');
      const token = reply.token;
      const verify = async () => {
        try {
          const allowed = await browser.runtime.sendMessage({
            type: 'viewer:fetch-allowed',
            token,
          });
          if (allowed !== true) throw new Error('No confirmed student');
          if (!stopped) timer = setTimeout(() => void verify(), 1000);
        } catch {
          if (!stopped) lost();
        }
      };
      if (!stopped) await verify();
    } catch {
      if (!stopped) lost();
    }
  };
  void check();
  return stop;
}
