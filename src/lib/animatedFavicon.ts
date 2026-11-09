/**
 * Animated Browser Tab Favicon Controller
 * Renders a high-resolution 3D bouncy die directly into the browser's tab icon,
 * animating rolling and settling on the rolled dice value.
 */

const PIPS_MAP: Record<number, [number, number][]> = {
  // Coordinates normalized [0, 1] relative to inner die face
  1: [[0.5, 0.5]],
  2: [
    [0.26, 0.26],
    [0.74, 0.74],
  ],
  3: [
    [0.25, 0.25],
    [0.5, 0.5],
    [0.75, 0.75],
  ],
  4: [
    [0.26, 0.26],
    [0.74, 0.26],
    [0.26, 0.74],
    [0.74, 0.74],
  ],
  5: [
    [0.26, 0.26],
    [0.74, 0.26],
    [0.5, 0.5],
    [0.26, 0.74],
    [0.74, 0.74],
  ],
  6: [
    [0.26, 0.22],
    [0.74, 0.22],
    [0.26, 0.5],
    [0.74, 0.5],
    [0.26, 0.78],
    [0.74, 0.78],
  ],
};

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let currentAnimationId: number | null = null;
let isInitialized = false;

function getFaviconLink(): HTMLLinkElement {
  let link = document.querySelector<HTMLLinkElement>("link[rel*='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  return link;
}

function initCanvas() {
  if (!canvas && typeof document !== "undefined") {
    canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    ctx = canvas.getContext("2d");
  }
}

/**
 * Draws a die on canvas with position, scale, rotation and pip dots
 */
function drawDie(
  value: number,
  x: number,
  y: number,
  size: number,
  rotation: number,
  scaleX = 1,
  scaleY = 1,
  bgColor = "#f59e0b",
  pipColor = "#ffffff",
) {
  if (!ctx || !canvas) return;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(scaleX, scaleY);

  const half = size / 2;
  const radius = size * 0.24;

  // Shadow under the die
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 3;

  // Die Body with rounded squircle
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.roundRect(-half, -half, size, size, radius);
  ctx.fill();
  ctx.restore();

  // Subtle outer border
  ctx.strokeStyle = "rgba(0, 0, 0, 0.25)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(-half, -half, size, size, radius);
  ctx.stroke();

  // Top specular highlight gradient
  const grad = ctx.createLinearGradient(-half, -half, half, half);
  grad.addColorStop(0, "rgba(255, 255, 255, 0.45)");
  grad.addColorStop(0.5, "rgba(255, 255, 255, 0)");
  grad.addColorStop(1, "rgba(0, 0, 0, 0.2)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(-half, -half, size, size, radius);
  ctx.fill();

  // Draw Pips
  const pips = PIPS_MAP[value] || PIPS_MAP[1];
  const pipRadius = size * 0.088;

  ctx.fillStyle = pipColor;
  for (const [px, py] of pips) {
    const pipX = -half + px * size;
    const pipY = -half + py * size;

    ctx.beginPath();
    ctx.arc(pipX, pipY, pipRadius, 0, Math.PI * 2);
    ctx.fill();

    // Subtle pip inner depth
    ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Animate the favicon with a playful bouncy roll and land on the final value
 */
export function animateFaviconRoll(
  finalValue: number,
  color = "#f59e0b",
  durationMs = 550,
) {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  initCanvas();
  if (!ctx || !canvas) return;

  // Respect reduced motion
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    ctx.clearRect(0, 0, 64, 64);
    drawDie(finalValue, 32, 32, 44, 0, 1, 1, color, "#ffffff");
    getFaviconLink().href = canvas.toDataURL("image/png");
    return;
  }

  if (currentAnimationId) {
    cancelAnimationFrame(currentAnimationId);
    currentAnimationId = null;
  }

  const startTime = performance.now();
  const link = getFaviconLink();

  function step(now: number) {
    if (!ctx || !canvas) return;

    const elapsed = now - startTime;
    const progress = Math.min(elapsed / durationMs, 1);

    ctx.clearRect(0, 0, 64, 64);

    if (progress < 1) {
      // Physics: Leap up, tumble, squash on landing
      let bounceY: number;
      let rot: number;
      let scaleX: number;
      let scaleY: number;
      let interimVal: number;

      if (progress < 0.7) {
        // Airborne jump & tumble
        const jumpProgress = progress / 0.7;
        bounceY = -Math.sin(jumpProgress * Math.PI) * 14;
        rot = (progress / 0.7) * Math.PI * 1.5;
        scaleX = 1 + Math.sin(jumpProgress * Math.PI) * 0.15;
        scaleY = scaleX;
        interimVal = Math.floor(Math.random() * 6) + 1;
      } else if (progress < 0.85) {
        // Landing squash
        const landProgress = (progress - 0.7) / 0.15;
        scaleY = 1 - Math.sin(landProgress * Math.PI) * 0.25;
        scaleX = 1 + Math.sin(landProgress * Math.PI) * 0.2;
        bounceY = Math.sin(landProgress * Math.PI) * 2;
        rot = (1 - landProgress) * 0.2;
        interimVal = finalValue;
      } else {
        // Settle spring
        const settleProgress = (progress - 0.85) / 0.15;
        scaleY = 1 + Math.sin(settleProgress * Math.PI) * 0.08;
        scaleX = 1 - Math.sin(settleProgress * Math.PI) * 0.08;
        bounceY = 0;
        rot = 0;
        interimVal = finalValue;
      }

      drawDie(
        interimVal,
        32,
        32 + bounceY,
        44,
        rot,
        scaleX,
        scaleY,
        color,
        "#ffffff",
      );
      link.href = canvas.toDataURL("image/png");

      currentAnimationId = requestAnimationFrame(step);
    } else {
      // Settled final frame
      drawDie(finalValue, 32, 32, 44, 0, 1, 1, color, "#ffffff");
      link.href = canvas.toDataURL("image/png");
      currentAnimationId = null;
    }
  }

  currentAnimationId = requestAnimationFrame(step);
}

/**
 * Initializes listeners so that any dice roll in the app automatically animates the tab icon
 */
export function initFaviconSync() {
  if (isInitialized || typeof window === "undefined") return;
  isInitialized = true;

  window.addEventListener("ludo:dice-roll", (e: Event) => {
    const customEvent = e as CustomEvent<{ value: number; color?: string }>;
    const val = customEvent.detail?.value ?? Math.floor(Math.random() * 6) + 1;
    const clr = customEvent.detail?.color || "#f59e0b";
    animateFaviconRoll(val, clr);
  });
}
