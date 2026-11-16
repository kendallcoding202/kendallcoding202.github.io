// The only place that knows the game may be running inside the iOS app. The
// app's shell puts a bridge object in the page before any of the game's code
// runs; in a browser it is not there, and everything here quietly does
// nothing. So the same files run as a web page and as the app, and the page
// still carries no code but its own.
const bridge = () => (typeof window !== 'undefined' ? window.Capacitor : undefined);

export function isNative() {
  const cap = bridge();
  return !!cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform() && typeof cap.nativePromise === 'function';
}

/**
 * Asks the app's native side to do something: `plugin` and `method` name it,
 * `options` are passed across. Resolves with its answer, or with null in a
 * browser, where there is no native side to ask.
 */
export function native(plugin, method, options = {}) {
  return isNative() ? bridge().nativePromise(plugin, method, options) : Promise.resolve(null);
}
