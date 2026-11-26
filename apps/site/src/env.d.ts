/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** Where the contact form POSTs its JSON. Unset means the form is not switched on. */
  readonly PUBLIC_CONTACT_ENDPOINT?: string;
  /** "1" adds noindex to every page and makes robots.txt disallow everything (staging). */
  readonly PUBLIC_NOINDEX?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
