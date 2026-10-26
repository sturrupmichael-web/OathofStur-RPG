import * as THREE from 'three';
import { CHARACTER_STYLES, animateCharacter, buildCharacter, playCharacter, withGear, type CharacterRig } from './render/character';
import { animateCreature, buildCreature, playCreature, type CreatureKind, type CreatureRig } from './render/creatures';

/**
 * Development page (npm run dev, then /gallery.html): every character look
 * and creature in a row, lit like the game, for checking models and
 * animations up close. Not part of the build.
 *
 * Query: ?set=people|monsters|gear&only=a,b&anim=idle|walk|fight|chop|...&shot=slash&yaw=0.4&zoom=1
 */
const params = new URLSearchParams(location.search);
const set = params.get('set') ?? 'people';
let anim = params.get('anim') ?? 'idle';
const yaw0 = Number(params.get('yaw') ?? 0.35);
const zoom = Number(params.get('zoom') ?? 1);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b2430);
scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a4030, 0.85));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.1);
sun.position.set(-30, 26, 14);
sun.castShadow = true;
sun.shadow.bias = -0.0008; // as in the game
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 120 });
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 20).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x5f8a3e }));
ground.receiveShadow = true;
scene.add(ground);

type Entry = { name: string; root: THREE.Object3D; human?: CharacterRig; creature?: CreatureRig };
const entries: Entry[] = [];
const GEAR = [
  { weapon: 'bronze_sword' },
  { weapon: 'iron_dagger', shield: 'iron_shield', helmet: 'iron_helm' },
  { weapon: 'steel_sword', shield: 'steel_shield', helmet: 'steel_helm', body: 'steel_chainbody', legs: 'steel_platelegs' },
  { weapon: 'cinder_blade', shield: 'drakescale_shield' },
  { weapon: 'shortbow' },
  { weapon: 'yew_longbow', helmet: 'iron_helm' },
];
if (set === 'monsters') {
  for (const kind of ['goblin', 'skeleton', 'cow', 'desert_lizard', 'scorpion', 'cave_creeper', 'crimson_swift', 'wailing_spirit', 'cinder_drake']) {
    if (CHARACTER_STYLES[kind]) {
      const rig = buildCharacter(kind, entries.length);
      entries.push({ name: kind, root: rig.root, human: rig });
    } else {
      const rig = buildCreature(kind as CreatureKind, entries.length);
      entries.push({ name: kind, root: rig.root, creature: rig });
    }
  }
} else if (set === 'gear') {
  GEAR.forEach((gear, i) => {
    const rig = buildCharacter(withGear(CHARACTER_STYLES.player, gear), i, true);
    entries.push({ name: Object.values(gear).join(', '), root: rig.root, human: rig });
  });
} else {
  for (const key of Object.keys(CHARACTER_STYLES)) {
    if (['goblin', 'skeleton', 'wailing_spirit'].includes(key)) continue;
    const rig = buildCharacter(key, entries.length, key === 'player');
    entries.push({ name: key, root: rig.root, human: rig });
  }
}

// ?only=player,guard narrows the row down, for close-ups.
const only = params.get('only')?.split(',');
if (only) entries.splice(0, entries.length, ...entries.filter((e) => only.includes(e.name)));
const spacing = set === 'monsters' ? 2.2 : 0.9;
entries.forEach((e, i) => {
  e.root.position.x = (i - (entries.length - 1) / 2) * spacing;
  e.root.rotation.y = yaw0;
  scene.add(e.root);
});
document.getElementById('names')!.textContent = entries.map((e) => e.name).join(' · ');

const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
const span = entries.length * spacing;
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  const tan = Math.tan((camera.fov * Math.PI) / 360);
  const dist = Math.max(span / 2 / tan / camera.aspect, 0.85 / tan) / zoom;
  camera.position.set(0, 0.65 + dist * 0.25, dist);
  camera.lookAt(0, 0.62, 0);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const bar = document.getElementById('bar')!;
for (const name of ['idle', 'walk', 'fight', 'aim', 'chop', 'mine', 'smith', 'net', 'rod', 'cook', 'smelt', 'fletch', 'dead']) {
  const b = document.createElement('button');
  b.textContent = name;
  b.className = name === anim ? 'on' : '';
  b.onclick = () => {
    anim = name;
    for (const x of bar.querySelectorAll('button')) x.classList.toggle('on', x === b);
  };
  bar.appendChild(b);
}
for (const shot of ['punch', 'stab', 'slash', 'shoot', 'swing', 'block', 'talk', 'eat', 'bite', 'breath', 'sting', 'butt', 'peck', 'wail']) {
  const b = document.createElement('button');
  b.textContent = `▶ ${shot}`;
  b.onclick = () => play(shot);
  bar.appendChild(b);
}
function play(shot: string) {
  const now = performance.now();
  for (const e of entries) {
    if (e.human) playCharacter(e.human, shot, now);
    if (e.creature) playCreature(e.creature, shot, now);
  }
}
if (params.get('shot')) setTimeout(() => play(params.get('shot')!), 600);

let spin = 0;
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (params.has('spin')) spin += dt * 0.6;
  const moving = anim === 'walk';
  for (const e of entries) {
    e.root.rotation.y = yaw0 + spin;
    const activity = ['chop', 'mine', 'smith', 'net', 'rod', 'cook', 'smelt', 'fletch', 'fight', 'aim'].includes(anim) ? anim : null;
    if (e.human) animateCharacter(e.human, dt, now, moving, 1, activity, anim === 'dead');
    if (e.creature) animateCreature(e.creature, dt, now, moving, 1, anim === 'fight', anim === 'dead');
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
Object.assign(window, { __gallery: { entries, play, setAnim: (a: string) => (anim = a) } });
