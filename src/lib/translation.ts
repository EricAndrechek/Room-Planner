import { track } from './analytics';
import { installTranslationGuard } from './translationGuard';

/** sessionStorage key: `translation_detected` was sent in this session. */
const SENT_KEY = 'rp:translation-detected';

/** A language tag fit to send (`es`, `pt-BR`), else `unknown`: never free text. */
export const languageTag = (value: string | null | undefined): string => {
  const tag = (value ?? '').trim();
  return /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(tag) ? tag : 'unknown';
};

/** Whether the page carries a translator's mark (Chrome / Google Translate class on `<html>`). */
export const isTranslatedClass = (className: string): boolean =>
  /\btranslated-(ltr|rtl)\b/.test(className);

let sent = false;
/** `translation_detected` once per session: the language the page was translated into. */
function report(via: 'class' | 'dom'): void {
  if (sent) return;
  sent = true;
  try {
    if (sessionStorage.getItem(SENT_KEY)) return;
    sessionStorage.setItem(SENT_KEY, '1');
  } catch {
    /* storage blocked: once per page load instead */
  }
  track('translation_detected', { lang: languageTag(document.documentElement.lang), via });
}

/**
 * Let the planner work under browser page translation: the DOM guard (translationGuard.ts) before
 * React mounts, and a note (once a session) when a page is translated, so we know how often it
 * happens. No page content is sent: only the target language tag. Call once, in the browser.
 */
export function startTranslationSupport(): void {
  installTranslationGuard(Node.prototype as never, () => report('dom'));
  const html = document.documentElement;
  if (isTranslatedClass(html.className)) {
    report('class');
    return;
  }
  if (typeof MutationObserver !== 'function') return;
  const observer = new MutationObserver(() => {
    if (!isTranslatedClass(html.className)) return;
    observer.disconnect();
    report('class');
  });
  observer.observe(html, { attributes: true, attributeFilter: ['class'] });
}
