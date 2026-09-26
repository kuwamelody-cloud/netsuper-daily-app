// Set this to the permanent HTTPS notification backend before production release.
// Keeping it empty leaves business records fully usable while server notifications stay unavailable.
globalThis.NS_ASSIST_CONFIG = Object.freeze({
  apiBase: "",
  version: 1
});
