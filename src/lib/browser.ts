/** Small DOM helpers kept out of components. */

/** Copy text to the clipboard, falling back to execCommand for old/insecure contexts. */
export const copyText = async (text: string): Promise<void> => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-999999px';
  document.body.appendChild(textArea);
  textArea.select();
  try {
    if (!document.execCommand('copy')) throw new Error('copy command failed');
  } finally {
    document.body.removeChild(textArea);
  }
};

/** Trigger a download of `content` as a file. */
export const downloadFile = (
  filename: string,
  content: string,
  type = 'application/json',
): void => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/** "just now", "12s ago", "5m ago", "3h ago", or a date. */
export const formatTimeAgo = (date: Date | null, now: Date = new Date()): string => {
  if (!date) return '';
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString();
};
