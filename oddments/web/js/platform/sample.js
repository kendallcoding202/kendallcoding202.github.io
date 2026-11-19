// Whether this copy of the game is the free sample (see core/sample.js).
//
// The app is never the sample: not a numbered build (which is what goes into
// the app), not a page the app's shell is carrying, and not a page at the
// app's own kind of address. Each of the three is enough by itself, so that
// no one mistake can sell somebody two places for the price of twelve.
//
// Otherwise it is the sample when it is a page on the web, served from a real
// host: which is the published copy. A copy on your own machine is the whole
// game, as the tests need it to be, unless it is asked for the sample
// (`?sample`, which like every switch exists only outside the app).
import { BUILD } from './build.js';
import { isNative } from './native.js';
import { switches } from './switches.js';

const OWN_MACHINE = ['localhost', '127.0.0.1', '[::1]', ''];

/** Whether a copy is the sample: { build, native, protocol, hostname, asked }. */
export function sampleFor({ build, native, protocol, hostname, asked }) {
  if (build !== 'dev' || native === true) return false;
  if (protocol !== 'https:' && protocol !== 'http:') return false;
  if (asked === true) return true;
  return typeof hostname === 'string' && !OWN_MACHINE.includes(hostname);
}

const here = typeof location === 'object' && location ? location : { protocol: '', hostname: '' };

/** Whether this page is the sample. */
export const SAMPLE_HERE = sampleFor({ build: BUILD, native: isNative(), protocol: here.protocol, hostname: here.hostname, asked: switches.has('sample') });
