/// <reference types="vite/client" />

// Typing for `import.meta.env`. Only the dev-mocking switch in main.tsx
// reads a custom variable today; add fields here as they appear.
interface ImportMetaEnv {
  /** `VITE_MSW=1 pnpm dev` boots the console against src/mocks fixtures. */
  readonly VITE_MSW?: string;
}
