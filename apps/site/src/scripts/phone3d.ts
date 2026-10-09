// A modelled phone (iPhone or Android) rendered with three.js, with a recording playing on its screen. Everything is
// built from geometry here, so there are no model files to load or license. The <video> stays in the page as the
// texture's source and keeps its place in the sync logic; this only draws it.
import {
  ACESFilmicToneMapping,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  VideoTexture,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export type PhoneKind = "iphone" | "android";

interface Spec {
  width: number;
  height: number;
  depth: number;
  radius: number;
  screenWidth: number;
  screenRadius: number;
  /** A margin of the app's own background around the recording, so a recording with its status bar right at the
   *  edge (the Android emulator's) clears the screen's rounded corners. Without it the recording fills the screen. */
  margin?: { color: string; top: number; side: number; bottom: number };
  body: { color: string; metalness: number; roughness: number };
}

// Proportions in metres/10 from the real devices: iPhone 17 Pro (71.9 × 150 × 8.75 mm, natural titanium-like dark
// finish) and a Pixel 9 class phone (72 × 152 × 8.5 mm, matte aluminium frame). Screen widths keep the recordings'
// aspect ratios (1206 × 2622 and 1080 × 2400).
const SPECS: Record<PhoneKind, Spec & { screenAspect: number }> = {
  iphone: {
    width: 0.719,
    height: 1.5,
    depth: 0.0875,
    radius: 0.118,
    screenWidth: 0.655,
    screenRadius: 0.092,
    screenAspect: 2622 / 1206,
    body: { color: "#2c2f36", metalness: 1, roughness: 0.32 },
  },
  // An even 0.026 glass border, display corners that follow the body's curve, and the recording set into a margin of
  // the app's background (#121b27, sampled from the recording) so the emulator's edge-to-edge status bar isn't clipped.
  android: {
    width: 0.72,
    height: (0.668 - 0.036) * (2400 / 1080) + 0.03 + 0.01 + 0.052,
    depth: 0.085,
    radius: 0.1,
    screenWidth: 0.668,
    screenRadius: 0.074,
    margin: { color: "#121b27", top: 0.03, side: 0.018, bottom: 0.01 },
    screenAspect: 2400 / 1080,
    body: { color: "#26282c", metalness: 0.85, roughness: 0.45 },
  },
};

function roundedRect(width: number, height: number, radius: number): Shape {
  const x = -width / 2;
  const y = -height / 2;
  const shape = new Shape();
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.absarc(x + width - radius, y + radius, radius, -Math.PI / 2, 0, false);
  shape.lineTo(x + width, y + height - radius);
  shape.absarc(x + width - radius, y + height - radius, radius, 0, Math.PI / 2, false);
  shape.lineTo(x + radius, y + height);
  shape.absarc(x + radius, y + height - radius, radius, Math.PI / 2, Math.PI, false);
  shape.lineTo(x, y + radius);
  shape.absarc(x + radius, y + radius, radius, Math.PI, Math.PI * 1.5, false);
  return shape;
}

// A flat rounded rectangle whose UVs run 0..1 across it, so a video maps edge to edge.
function screenGeometry(width: number, height: number, radius: number): BufferGeometry {
  const geometry = new ShapeGeometry(roundedRect(width, height, radius), 24);
  const position = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < position.count; i++) uv.setXY(i, position.getX(i) / width + 0.5, position.getY(i) / height + 0.5);
  uv.needsUpdate = true;
  return geometry;
}

function buildPhone(kind: PhoneKind, video: HTMLVideoElement) {
  const spec = SPECS[kind];
  const phone = new Group();
  const bevel = spec.depth * 0.42;

  // Body: an extruded rounded rectangle with a deep bevel, so the edges catch light like a rounded metal frame.
  const body = new ExtrudeGeometry(roundedRect(spec.width - bevel * 0.6, spec.height - bevel * 0.6, spec.radius - bevel * 0.3), {
    depth: spec.depth - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.3,
    bevelSegments: 10,
    curveSegments: 40,
  });
  body.translate(0, 0, -(spec.depth - bevel * 2) / 2);
  phone.add(new Mesh(body, new MeshPhysicalMaterial({ ...spec.body, color: new Color(spec.body.color), clearcoat: 0.6, clearcoatRoughness: 0.25 })));

  const front = spec.depth / 2 + 0.0005;
  // The black glass around the screen.
  const glassShape = roundedRect(spec.width - 0.022, spec.height - 0.022, spec.radius - 0.012);
  const glass = new Mesh(
    new ShapeGeometry(glassShape, 40),
    new MeshPhysicalMaterial({ color: "#050506", roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 }),
  );
  glass.position.z = front;
  phone.add(glass);

  // The screen, playing the recording, set into its margin when there is one.
  const margin = spec.margin;
  const videoWidth = spec.screenWidth - (margin ? margin.side * 2 : 0);
  const videoHeight = videoWidth * spec.screenAspect;
  const screenHeight = videoHeight + (margin ? margin.top + margin.bottom : 0);
  if (margin) {
    const display = new Mesh(
      new ShapeGeometry(roundedRect(spec.screenWidth, screenHeight, spec.screenRadius), 40),
      new MeshBasicMaterial({ color: margin.color, toneMapped: false }),
    );
    display.position.z = front + 0.0004;
    phone.add(display);
  }
  const texture = new VideoTexture(video);
  texture.colorSpace = SRGBColorSpace;
  const screenMaterial = new MeshBasicMaterial({ map: texture, toneMapped: false });
  const screen = new Mesh(screenGeometry(videoWidth, videoHeight, margin ? 0.012 : spec.screenRadius), screenMaterial);
  screen.position.set(0, margin ? (margin.bottom - margin.top) / 2 : 0, front + 0.0008);
  phone.add(screen);

  // A faint reflection across the glass.
  const sheen = new Mesh(
    new ShapeGeometry(glassShape, 40),
    new MeshPhysicalMaterial({ color: "#ffffff", transparent: true, opacity: 0.025, roughness: 0.05, metalness: 0, clearcoat: 1 }),
  );
  sheen.position.z = front + 0.0016;
  phone.add(sheen);

  const black = new MeshBasicMaterial({ color: "#000000" });
  if (kind === "iphone") {
    // The Dynamic Island, centred near the top of the screen (the simulator doesn't record it).
    const island = new Mesh(new ShapeGeometry(roundedRect(0.19, 0.056, 0.028), 24), black);
    island.position.set(0, screenHeight / 2 - 0.058, front + 0.0012);
    phone.add(island);
  } else {
    // The punch-hole front camera.
    const camera = new Mesh(new CircleGeometry(0.017, 32), black);
    camera.position.set(0, screenHeight / 2 - 0.03, front + 0.0012);
    phone.add(camera);
  }

  // Side buttons: power on the right; volume (and the action button on iPhone) on the left.
  const metal = new MeshPhysicalMaterial({ ...spec.body, color: new Color(spec.body.color) });
  const button = (length: number, x: number, y: number) => {
    const mesh = new Mesh(new BoxGeometry(0.012, length, spec.depth * 0.42), metal);
    mesh.position.set(x, y, 0);
    phone.add(mesh);
  };
  const side = spec.width / 2 + 0.003;
  if (kind === "iphone") {
    button(0.17, side, 0.3);
    button(0.06, -side, 0.42);
    button(0.11, -side, 0.27);
    button(0.11, -side, 0.12);
  } else {
    button(0.12, side, 0.36);
    button(0.2, side, 0.12);
  }

  return { phone, texture };
}

export function mountPhone3D({ host, video, kind, tilt }: { host: HTMLElement; video: HTMLVideoElement; kind: PhoneKind; tilt: () => number }) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const canvas = renderer.domElement;
  canvas.className = "phone-canvas";
  canvas.setAttribute("aria-hidden", "true");
  host.append(canvas);

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const { phone, texture } = buildPhone(kind, video);
  scene.add(phone);

  // The canvas is larger than the phone's box (see .phone-canvas), so the turned phone and its edges fit.
  const camera = new PerspectiveCamera(22, 1, 0.1, 50);
  const spec = SPECS[kind];
  const MARGIN = 1.36;
  camera.position.set(0, 0, ((spec.height * MARGIN) / 2 / Math.tan((camera.fov * Math.PI) / 360)) * 1.0);

  const resize = () => {
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  // A slight turn toward the page centre, following the pointer a little.
  const pointer = { x: 0, y: 0 };
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const onPointer = (event: PointerEvent) => {
    pointer.x = event.clientX / innerWidth - 0.5;
    pointer.y = event.clientY / innerHeight - 0.5;
  };
  addEventListener("pointermove", onPointer, { passive: true });

  let frame = 0;
  const render = () => {
    frame = requestAnimationFrame(render);
    const follow = still.matches ? 0 : 1;
    const targetY = tilt() + pointer.x * 0.22 * follow;
    const targetX = 0.05 + pointer.y * 0.12 * follow;
    phone.rotation.y += (targetY - phone.rotation.y) * 0.06;
    phone.rotation.x += (targetX - phone.rotation.x) * 0.06;
    renderer.render(scene, camera);
  };
  phone.rotation.y = tilt();
  render();

  return {
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      removeEventListener("pointermove", onPointer);
      texture.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}

export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}
