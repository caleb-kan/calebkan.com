export const DOCUMENT_POLICIES: ReadonlyMap<string, string> = new Map([
  [
    "/index.html",
    "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data: https://*.scdn.co; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'",
  ],
  [
    "/callback.html",
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'",
  ],
]);
