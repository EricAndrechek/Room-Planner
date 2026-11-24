/** Wrangler (and Vitest, through vitest.config.ts) import `.html` files as text. */
declare module '*.html' {
  const text: string;
  export default text;
}
