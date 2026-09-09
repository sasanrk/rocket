/**
 * The one place the product is named. Everything user-facing reads from here,
 * so a rename is a one-line change; internal identifiers (IPC channels,
 * `window.reclaim`, the package name) deliberately stay as they are.
 */
export const BRAND = {
  name: 'Rocket',
  tagline: 'Free the space. Unleash the CPU.',
  /** Fits under the name in the sidebar without truncating. */
  short: 'PC tune-up kit',
  /** The one-sentence answer to "what is this?" */
  positioning:
    'A tune-up kit for Windows PCs and laptops: it finds the gigabytes your projects and apps are sitting on, empties what they can rebuild, and makes the processor run at the speed it was sold at.',
  version: '1.2.0'
} as const;
