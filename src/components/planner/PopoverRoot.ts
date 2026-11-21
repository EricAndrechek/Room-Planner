import { createContext } from 'react';

/**
 * Where popovers (the desktop color picker) are portaled: a node right after the sidebar, so they
 * follow it in reading order instead of landing at the end of `<body>`. Null before it mounts.
 */
export const PopoverRootContext = createContext<HTMLElement | null>(null);
