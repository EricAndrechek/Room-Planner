/** Base-aware internal URLs (works when the site is served from a sub-path). */
export const withBase = (path: string): string => {
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '');
  return `${base}/${path.replace(/^\/+/, '')}`;
};

export const HELP_PATH = withBase('help/');
export const HOME_PATH = withBase('');
