/**
 * The app's own question before an assistant replaces the whole plan (docs/design/plan-format.md,
 * section 8: the browser API has no confirmed way to ask the user). A native modal <dialog>: it
 * traps focus, Escape answers no, and it lives in the lazy WebMCP chunk with the tools.
 */

/** Ask; resolves true for "Replace", false for "Keep my plan", Escape, or `signal` aborting. */
export function confirmReplace(message: string, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    const el = <K extends keyof HTMLElementTagNameMap>(
      tag: K,
      className: string,
      text?: string,
    ): HTMLElementTagNameMap[K] => {
      const e = document.createElement(tag);
      e.className = className;
      if (text) e.textContent = text;
      return e;
    };
    const dialog = el(
      'dialog',
      'm-auto w-[calc(100%-2rem)] max-w-md rounded-xl bg-white p-0 text-slate-800 shadow-2xl backdrop:bg-slate-900/50 backdrop:backdrop-blur-xs',
    );
    dialog.dataset.testid = 'assistant-confirm';
    const titleId = `assistant-confirm-${Math.random().toString(36).slice(2)}`;
    dialog.setAttribute('aria-labelledby', titleId);
    const form = el('form', 'p-6 space-y-4');
    form.method = 'dialog';
    const title = el('h2', 'font-bold text-slate-800', message);
    title.id = titleId;
    const body = el(
      'p',
      'text-sm text-slate-600',
      'An assistant in your browser wants to replace the whole plan. Undo brings this one back.',
    );
    const row = el('div', 'flex justify-end gap-2 pt-2');
    const keep = el(
      'button',
      'px-4 py-2 rounded-lg font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-indigo-500',
      'Keep my plan',
    );
    keep.value = 'keep';
    keep.autofocus = true;
    const replace = el(
      'button',
      'px-4 py-2 rounded-lg font-medium bg-indigo-600 text-white hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500',
      'Replace',
    );
    replace.value = 'replace';
    row.append(keep, replace);
    form.append(title, body, row);
    dialog.append(form);

    const onAbort = () => dialog.close();
    dialog.addEventListener(
      'close',
      () => {
        signal?.removeEventListener('abort', onAbort);
        dialog.remove();
        resolve(dialog.returnValue === 'replace' && !signal?.aborted);
      },
      { once: true },
    );
    signal?.addEventListener('abort', onAbort, { once: true });
    document.body.append(dialog);
    dialog.showModal();
  });
}
