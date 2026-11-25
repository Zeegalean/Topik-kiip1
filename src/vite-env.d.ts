// Ambient Vite client and static asset type declarations.
// Kept self-contained instead of relying on compilerOptions.types entries
// ('vite/client', 'vite-plugin-pwa/client') to prevent TS2688 errors across
// TypeScript versions and CI/production build environments.

interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly SSR: boolean;
  readonly [key: string]: string | boolean | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
  readonly url: string;
}

declare module '*.css' {}
declare module '*.svg' {
  const src: string;
  export default src;
}
declare module '*.png' {
  const src: string;
  export default src;
}
declare module '*.jpg' {
  const src: string;
  export default src;
}
declare module '*.jpeg' {
  const src: string;
  export default src;
}
declare module '*.webp' {
  const src: string;
  export default src;
}
declare module '*.pdf' {
  const src: string;
  export default src;
}
declare module '*?url' {
  const src: string;
  export default src;
}
declare module '*?raw' {
  const src: string;
  export default src;
}
declare module '*?inline' {
  const src: string;
  export default src;
}
declare module '*?worker' {
  const workerConstructor: {
    new (options?: { name?: string }): Worker;
  };
  export default workerConstructor;
}
