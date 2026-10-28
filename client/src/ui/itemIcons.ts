import * as THREE from 'three';
import { buildItemModel } from '../render/itemModels';
import { disposeModel } from '../render/dispose';

/**
 * Item icons for the pack, bank, shops and recipes: each item's own ground
 * model, photographed once from the game's camera angle and kept as an
 * image, so an item looks the same in the pack as it does lying in the
 * grass.
 */

const SIZE = 96;
/** The game camera's tilt (CameraRig.pitch), so icons are seen as the world is. */
const PITCH = 0.9;
/** Turned so long things run up to the right, as icons usually do. */
const YAW = -Math.PI / 4;

let studio: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.OrthographicCamera; outline: CanvasRenderingContext2D } | null | undefined;
const cache = new Map<string, string>();

function setUp(): typeof studio {
  try {
    const canvas = document.createElement('canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(SIZE, SIZE, false);
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    // Lit like the world, with a little more fill so small things read.
    scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a4030, 1.15));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.0);
    sun.position.set(-3, 6, 4);
    scene.add(sun);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 20);
    camera.position.set(0, Math.sin(PITCH) * 5, Math.cos(PITCH) * 5);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const out = document.createElement('canvas');
    out.width = out.height = SIZE;
    return { renderer, scene, camera, outline: out.getContext('2d')! };
  } catch {
    return null;
  }
}

/** Fits the camera tightly around the model as the camera sees it. */
function frame(camera: THREE.OrthographicCamera, model: THREE.Object3D): void {
  const view = camera.matrixWorldInverse;
  const min = new THREE.Vector2(Infinity, Infinity);
  const max = new THREE.Vector2(-Infinity, -Infinity);
  const p = new THREE.Vector3();
  model.updateMatrixWorld(true);
  model.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.visible) return;
    const pos = o.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).applyMatrix4(view);
      min.min(new THREE.Vector2(p.x, p.y));
      max.max(new THREE.Vector2(p.x, p.y));
    }
  });
  const half = (Math.max(max.x - min.x, max.y - min.y) / 2) * 1.08;
  const cx = (min.x + max.x) / 2;
  const cy = (min.y + max.y) / 2;
  Object.assign(camera, { left: cx - half, right: cx + half, top: cy + half, bottom: cy - half });
  camera.updateProjectionMatrix();
}

/** An image of the item's model, made the first time it's asked for. */
export function itemIconUrl(itemId: string): string | null {
  const hit = cache.get(itemId);
  if (hit) return hit;
  if (studio === undefined) studio = setUp();
  if (!studio) return null;
  const { renderer, scene, camera, outline } = studio;
  const model = buildItemModel(itemId);
  model.rotation.y = YAW;
  scene.add(model);
  frame(camera, model);
  renderer.render(scene, camera);
  scene.remove(model);
  disposeModel(model);
  // A thin dark edge all round, so icons stand out on any slot.
  outline.clearRect(0, 0, SIZE, SIZE);
  outline.globalCompositeOperation = 'source-over';
  for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2], [-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) outline.drawImage(renderer.domElement, dx, dy);
  outline.globalCompositeOperation = 'source-in';
  outline.fillStyle = 'rgba(12, 9, 6, 0.85)';
  outline.fillRect(0, 0, SIZE, SIZE);
  outline.globalCompositeOperation = 'source-over';
  outline.drawImage(renderer.domElement, 0, 0);
  const url = outline.canvas.toDataURL('image/png');
  cache.set(itemId, url);
  return url;
}

export function itemIcon(itemId: string): string {
  const url = itemIconUrl(itemId);
  return url ? `<img class="item-icon" src="${url}" alt="" draggable="false">` : '';
}

/** Makes icons for these items a few at a time while the game is idle, so opening a bank doesn't stall. */
export function warmItemIcons(itemIds: Iterable<string>): void {
  const queue = [...itemIds].filter((id) => !cache.has(id));
  const step = (deadline?: IdleDeadline) => {
    const until = performance.now() + 8;
    while (queue.length && (deadline ? deadline.timeRemaining() > 2 : performance.now() < until)) itemIconUrl(queue.shift()!);
    if (queue.length) idle(step);
  };
  const idle = (fn: (d?: IdleDeadline) => void) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 500 }) : setTimeout(fn, 30));
  if (queue.length) idle(step);
}
