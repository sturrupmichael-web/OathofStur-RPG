import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Loads a GLB, decoding an inlined one (a data: address) here rather than
 * fetching it: the play-test page's security policy refuses fetches of data:
 * addresses, which would quietly leave the built-in models in place.
 */
export function loadGlb(url: string): Promise<GLTF> {
  const loader = new GLTFLoader();
  if (!url.startsWith('data:')) return loader.loadAsync(url);
  const text = atob(url.slice(url.indexOf(',') + 1));
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return loader.parseAsync(bytes.buffer, '');
}
