import { useEffect, useRef } from "react";

interface FloatingItem {
  kind: "die" | "pawn" | "star";
  x: number;
  y: number;
  vx: number;
  vy: number;
  baseVx: number;
  baseVy: number;
  size: number;
  baseSize: number;
  angle: number;
  vAngle: number;
  color: string;
  value: number; // 1-6 for die
  alpha: number;
  depth: number; // 0.6 to 1.2
}

interface BurstParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  radius: number;
  alpha: number;
  life: number;
}

const PLAYER_COLORS = ["#ef4444", "#3b82f6", "#10b981", "#f59e0b"];

export function KineticBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let animId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const mouse = { x: -9999, y: -9999, targetX: -9999, targetY: -9999 };
    const bursts: BurstParticle[] = [];

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };

    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
      mouse.targetX = clientX;
      mouse.targetY = clientY;
    };

    const handlePointerLeave = () => {
      mouse.targetX = -9999;
      mouse.targetY = -9999;
    };

    const handleClick = (e: MouseEvent | TouchEvent) => {
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;

      // Spawn burst particles
      for (let i = 0; i < 14; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 4 + 2;
        bursts.push({
          x: clientX,
          y: clientY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color:
            PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)],
          radius: Math.random() * 3 + 2,
          alpha: 1,
          life: 1,
        });
      }

      // Repel nearby items violently (shockwave)
      for (const item of items) {
        const dx = item.x - clientX;
        const dy = item.y - clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 260 && dist > 0) {
          const force = ((260 - dist) / 260) * 8;
          item.vx += (dx / dist) * force;
          item.vy += (dy / dist) * force;
          item.vAngle += (Math.random() - 0.5) * 0.3;
          item.size = item.baseSize * 1.35;
        }
      }
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("touchmove", handlePointerMove, { passive: true });
    window.addEventListener("click", handleClick);
    document.addEventListener("mouseleave", handlePointerLeave);

    // Populate floating items (dice, pawns, stars)
    const isMobile = width < 768;
    const count = isMobile ? 12 : 22;
    const items: FloatingItem[] = [];

    for (let i = 0; i < count; i++) {
      const kindRoll = Math.random();
      const kind: FloatingItem["kind"] =
        kindRoll < 0.38 ? "die" : kindRoll < 0.72 ? "pawn" : "star";
      const color = PLAYER_COLORS[i % PLAYER_COLORS.length];
      const depth = Math.random() * 0.6 + 0.6; // 0.6 to 1.2
      const baseSize =
        kind === "die"
          ? (Math.random() * 8 + 24) * depth
          : kind === "pawn"
            ? (Math.random() * 10 + 26) * depth
            : (Math.random() * 4 + 6) * depth;

      const baseVx = (Math.random() - 0.5) * 0.35 * depth;
      const baseVy = (Math.random() - 0.5) * 0.35 * depth;

      items.push({
        kind,
        x: Math.random() * width,
        y: Math.random() * height,
        vx: baseVx,
        vy: baseVy,
        baseVx,
        baseVy,
        size: baseSize,
        baseSize,
        angle: Math.random() * Math.PI * 2,
        vAngle: (Math.random() - 0.5) * 0.015,
        color,
        value: Math.floor(Math.random() * 6) + 1,
        alpha: Math.random() * 0.3 + 0.35,
        depth,
      });
    }

    let lastTime = performance.now();

    const drawDie = (
      dieX: number,
      dieY: number,
      size: number,
      angle: number,
      value: number,
      color: string,
      alpha: number,
      isDark: boolean,
    ) => {
      ctx.save();
      ctx.translate(dieX, dieY);
      ctx.rotate(angle);
      ctx.globalAlpha = alpha;

      const half = size / 2;
      const r = size * 0.22;

      // Soft shadow
      ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 4;

      // Body gradient
      const grad = ctx.createLinearGradient(-half, -half, half, half);
      if (isDark) {
        grad.addColorStop(0, "rgba(42, 46, 57, 0.95)");
        grad.addColorStop(1, "rgba(22, 25, 33, 0.95)");
      } else {
        grad.addColorStop(0, "rgba(255, 255, 255, 0.98)");
        grad.addColorStop(1, "rgba(230, 233, 240, 0.98)");
      }

      ctx.beginPath();
      ctx.roundRect(-half, -half, size, size, r);
      ctx.fillStyle = grad;
      ctx.fill();

      // Border with player color accent
      ctx.shadowColor = "transparent";
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = color;
      ctx.stroke();

      // Gloss sheen
      ctx.beginPath();
      ctx.roundRect(-half + 2, -half + 2, size - 4, (size - 4) * 0.42, [
        r,
        r,
        0,
        0,
      ]);
      ctx.fillStyle = isDark
        ? "rgba(255, 255, 255, 0.08)"
        : "rgba(255, 255, 255, 0.6)";
      ctx.fill();

      // Pips
      const dotR = size * 0.092;
      const off = size * 0.26;
      ctx.fillStyle = value === 1 ? color : isDark ? "#ffffff" : "#1e293b";

      const pips: Record<number, [number, number][]> = {
        1: [[0, 0]],
        2: [
          [-off, -off],
          [off, off],
        ],
        3: [
          [-off, -off],
          [0, 0],
          [off, off],
        ],
        4: [
          [-off, -off],
          [off, -off],
          [-off, off],
          [off, off],
        ],
        5: [
          [-off, -off],
          [off, -off],
          [0, 0],
          [-off, off],
          [off, off],
        ],
        6: [
          [-off, -off],
          [off, -off],
          [-off, 0],
          [off, 0],
          [-off, off],
          [off, off],
        ],
      };

      const coords = pips[value] ?? pips[1];
      for (const [px, py] of coords) {
        ctx.beginPath();
        ctx.arc(px, py, dotR, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    };

    const drawPawn = (
      pawnX: number,
      pawnY: number,
      size: number,
      angle: number,
      color: string,
      alpha: number,
    ) => {
      ctx.save();
      ctx.translate(pawnX, pawnY);
      ctx.rotate(angle * 0.4); // Subtle rotation for pawns
      ctx.globalAlpha = alpha;

      const half = size / 2;

      // Shadow
      ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 4;

      // Base
      ctx.beginPath();
      ctx.ellipse(0, half * 0.45, half * 0.72, half * 0.28, 0, 0, Math.PI * 2);
      const baseGrad = ctx.createLinearGradient(0, 0, 0, half * 0.7);
      baseGrad.addColorStop(0, color);
      baseGrad.addColorStop(1, "rgba(0,0,0,0.5)");
      ctx.fillStyle = baseGrad;
      ctx.fill();

      // Head sphere
      ctx.beginPath();
      ctx.arc(0, -half * 0.2, half * 0.48, 0, Math.PI * 2);
      const sphereGrad = ctx.createRadialGradient(
        -half * 0.15,
        -half * 0.35,
        half * 0.05,
        0,
        -half * 0.2,
        half * 0.48,
      );
      sphereGrad.addColorStop(0, "#ffffff");
      sphereGrad.addColorStop(0.3, color);
      sphereGrad.addColorStop(1, "rgba(0,0,0,0.55)");
      ctx.fillStyle = sphereGrad;
      ctx.fill();

      // Gleam highlight
      ctx.shadowColor = "transparent";
      ctx.beginPath();
      ctx.arc(-half * 0.16, -half * 0.36, half * 0.12, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
      ctx.fill();

      ctx.restore();
    };

    const drawStar = (
      starX: number,
      starY: number,
      size: number,
      color: string,
      alpha: number,
    ) => {
      ctx.save();
      ctx.translate(starX, starY);
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.shadowBlur = 14;
      ctx.shadowColor = color;
      ctx.fill();
      ctx.restore();
    };

    const render = (now: number) => {
      animId = requestAnimationFrame(render);
      if (document.hidden) return;

      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      // Smooth mouse
      mouse.x += (mouse.targetX - mouse.x) * 0.12;
      mouse.y += (mouse.targetY - mouse.y) * 0.12;

      ctx.clearRect(0, 0, width, height);

      const isDark =
        document.documentElement.dataset.theme === "dark" ||
        (!document.documentElement.dataset.theme &&
          window.matchMedia("(prefers-color-scheme: dark)").matches);

      // Draw subtle energy connection lines between nearby items
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const dx = items[i].x - items[j].x;
          const dy = items[i].y - items[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const maxDist = 120;

          if (dist < maxDist) {
            const lineAlpha = (1 - dist / maxDist) * 0.12;
            ctx.beginPath();
            ctx.strokeStyle = `rgba(245, 158, 11, ${lineAlpha})`;
            ctx.lineWidth = 1;
            ctx.moveTo(items[i].x, items[i].y);
            ctx.lineTo(items[j].x, items[j].y);
            ctx.stroke();
          }
        }
      }

      // Update & render floating items
      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        // Motion drift
        item.x += item.vx * 60 * dt;
        item.y += item.vy * 60 * dt;
        item.angle += item.vAngle * 60 * dt;

        // Damping towards base speed
        item.vx += (item.baseVx - item.vx) * 0.03;
        item.vy += (item.baseVy - item.vy) * 0.03;
        item.size += (item.baseSize - item.size) * 0.08;

        // Bounce off screen boundaries smoothly
        if (item.x < -item.size) item.x = width + item.size;
        else if (item.x > width + item.size) item.x = -item.size;
        if (item.y < -item.size) item.y = height + item.size;
        else if (item.y > height + item.size) item.y = -item.size;

        // Interactive mouse bounce & spin
        const mdx = item.x - mouse.x;
        const mdy = item.y - mouse.y;
        const mDist = Math.sqrt(mdx * mdx + mdy * mdy);
        const repelRadius = 130;

        if (mDist < repelRadius && mDist > 0) {
          const force = ((repelRadius - mDist) / repelRadius) * 4.5;
          item.vx += (mdx / mDist) * force;
          item.vy += (mdy / mDist) * force;
          item.vAngle += (Math.random() - 0.5) * 0.05;
          item.size = item.baseSize * (1 + force * 0.08);
        }

        // Render according to kind
        if (item.kind === "die") {
          drawDie(
            item.x,
            item.y,
            item.size,
            item.angle,
            item.value,
            item.color,
            item.alpha,
            isDark,
          );
        } else if (item.kind === "pawn") {
          drawPawn(
            item.x,
            item.y,
            item.size,
            item.angle,
            item.color,
            item.alpha,
          );
        } else {
          drawStar(item.x, item.y, item.size, item.color, item.alpha);
        }
      }

      // Update & render click burst particles
      for (let i = bursts.length - 1; i >= 0; i--) {
        const b = bursts[i];
        b.x += b.vx;
        b.y += b.vy;
        b.vx *= 0.95;
        b.vy *= 0.95;
        b.life -= 0.035;

        if (b.life <= 0) {
          bursts.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius * b.life, 0, Math.PI * 2);
        ctx.fillStyle = b.color;
        ctx.globalAlpha = b.life * 0.9;
        ctx.shadowBlur = 10;
        ctx.shadowColor = b.color;
        ctx.fill();
        ctx.restore();
      }
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("touchmove", handlePointerMove);
      window.removeEventListener("click", handleClick);
      document.removeEventListener("mouseleave", handlePointerLeave);
    };
  }, []);

  return (
    <canvas ref={canvasRef} className="kinetic-canvas-bg" aria-hidden="true" />
  );
}
