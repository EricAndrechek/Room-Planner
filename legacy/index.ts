/** Entry point of the legacy Worker; everything lives in ./lib.ts (see the overview there). */
import { handle, type Env } from './lib';

export default {
  fetch: handle,
} satisfies ExportedHandler<Env>;
