import * as THREE from 'three';
import { ITEMS } from '@rpg/shared';
import { buildGroundItem } from './render/itemModels';
import { itemIcon } from './ui/itemIcons';

/**
 * Development page (npm run dev, then /items.html): every item's pack icon,
 * or with ?ground, every item lying on grass as the game camera sees it.
 * Not part of the build. ?only=a,b narrows it; ?big shows icons larger.
 */
const params = new URLSearchParams(location.search);
const only = params.get('only')?.split(',');
const ids = Object.keys(ITEMS).filter((id) => !only || only.includes(id));
const grid = document.getElementById('grid')!;

if (params.has('ground')) {
  grid.remove();
  const cols = Math.ceil(Math.sqrt(ids.length * 1.6));
  const rows = Math.ceil(ids.length / cols);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b2430);
  scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a4030, 0.85));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.1);
  sun.position.set(-30, 26, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 120 });
  scene.add(sun);
  for (let i = 0; i < ids.length; i++) {
    const x = i % cols;
    const z = Math.floor(i / cols);
    const tile = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.96).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: (x + z) % 2 ? 0x5f8a3e : 0x58823a }));
    tile.position.set(x, 0, z);
    tile.receiveShadow = true;
    const item = buildGroundItem(ids[i]);
    item.position.set(x, 0, z);
    item.rotation.y = (i * 2.4) % (Math.PI * 2);
    scene.add(tile, item);
  }
  // The game's camera: 45 degrees round, tilted 0.9 down.
  const zoom = Number(params.get('zoom') ?? 1);
  const span = (Math.max(cols, rows) * 0.75) / zoom;
  const aspect = innerWidth / innerHeight;
  const camera = new THREE.OrthographicCamera(-span * aspect, span * aspect, span, -span, 0.1, 200);
  const centre = new THREE.Vector3((cols - 1) / 2, 0, (rows - 1) / 2);
  const pitch = 0.9;
  camera.position.copy(centre).add(new THREE.Vector3(Math.sin(Math.PI / 4) * Math.cos(pitch), Math.sin(pitch), Math.cos(Math.PI / 4) * Math.cos(pitch)).multiplyScalar(60));
  camera.lookAt(centre);
  renderer.render(scene, camera);
} else {
  for (const id of ids) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.innerHTML = `<div class="slot${params.has('big') ? ' big' : ''}">${itemIcon(id)}</div><div class="name">${id}</div>`;
    grid.appendChild(cell);
  }
}
