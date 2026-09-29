"use client";

import React, { useEffect, useRef, useState, type CSSProperties } from "react";

export type GatewayFlowProps = {
  mode?: "dark" | "light" | "auto";
  speed?: number;
  size?: number;
  density?: number;
  strokeWidth?: number;
  opacity?: number;
  hue?: number;
  saturation?: number;
  brightness?: number;
  className?: string;
  style?: CSSProperties;
};

interface Particle {
  t: number;
  speed: number;
}

interface Path {
  isLeft: boolean;
  startY: number;
  particles: Particle[];
}

interface Explosion {
  x: number;
  y: number;
  radius: number;
  life: number;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function getBezierPoint(
  t: number,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number }
) {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;

  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
  };
}

export default function GatewayFlow({
  mode = "dark",
  speed = 1,
  size = 1,
  density = 1,
  strokeWidth = 1.2,
  opacity = 1,
  hue = 0,
  saturation = 1,
  brightness = 1,
  className = "",
  style,
}: GatewayFlowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Read system theme if auto
  const [resolvedMode, setResolvedMode] = useState<"dark" | "light">(() => {
    if (mode !== "auto") return mode;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches) {
      return "light";
    }
    return "dark";
  });

  useEffect(() => {
    if (mode !== "auto") {
      setResolvedMode(mode);
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const handler = (e: MediaQueryListEvent) => setResolvedMode(e.matches ? "light" : "dark");
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, [mode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let animId: number;
    let width = 0;
    let height = 0;
    let isVisible = true;
    let explosions: Explosion[] = [];

    const safeSpeed = clamp(speed, 0.1, 3);
    const safeDensity = clamp(density, 0.2, 2.5);
    const numPaths = Math.max(16, Math.min(120, Math.round(70 * safeDensity)));

    let paths: Path[] = [];

    const initPaths = () => {
      paths = [];
      for (let i = 0; i < numPaths; i++) {
        paths.push({
          isLeft: i % 2 === 0,
          startY: (i / numPaths) * height * 1.4 - height * 0.2,
          particles: [
            {
              t: Math.random(),
              speed: (0.0016 + Math.random() * 0.0022) * safeSpeed,
            },
          ],
        });
      }
    };

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2); // Cap at 2 for performance
      width = rect.width;
      height = rect.height;

      if (width === 0 || height === 0) return;

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);

      initPaths();
    };

    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    // Spawn explosion shockwave on user clicks
    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      explosions.push({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        radius: 0,
        life: 1,
      });
    };
    window.addEventListener("click", handleClick, { passive: true });

    // Pause RAF when out of view or tab hidden
    const io = new IntersectionObserver(
      (entries) => {
        isVisible = entries[0]?.isIntersecting ?? true;
        if (isVisible && !animId) {
          animId = requestAnimationFrame(render);
        }
      },
      { threshold: 0.05 }
    );
    io.observe(container);

    const handleVisibility = () => {
      isVisible = !document.hidden;
      if (isVisible && !animId) {
        animId = requestAnimationFrame(render);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    // Color definitions
    const isLight = resolvedMode === "light";
    const strokeColor = isLight ? "rgba(30, 41, 59, 0.35)" : "rgba(255, 255, 255, 0.30)";
    const particleColor = isLight ? "rgba(30, 41, 59, 0.75)" : "rgba(255, 255, 255, 0.85)";

    const render = () => {
      if (!isVisible) {
        animId = 0;
        return;
      }

      ctx.clearRect(0, 0, width, height);

      const centerX = width * 0.5;
      const centerY = height * 0.5;

      // Update shockwaves
      for (let i = 0; i < explosions.length; i++) {
        explosions[i].radius += 12;
        explosions[i].life -= 0.02;
      }
      explosions = explosions.filter((e) => e.life > 0);

      // Render paths and particles
      const lineWidth = Number((strokeWidth * size).toFixed(2));

      for (let i = 0; i < paths.length; i++) {
        const path = paths[i];
        const p0 = { x: path.isLeft ? 0 : width, y: path.startY };
        const p1 = { x: path.isLeft ? centerX * 0.5 : width - centerX * 0.5, y: path.startY };
        const p2 = { x: path.isLeft ? centerX * 0.8 : width - centerX * 0.8, y: centerY };
        const p3 = { x: centerX, y: centerY };

        // Draw dotted bezier curve
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = lineWidth;
        ctx.setLineDash([1, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw particle along curve
        for (let j = 0; j < path.particles.length; j++) {
          const p = path.particles[j];
          p.t += p.speed;
          if (p.t > 1) {
            p.t = 0;
            path.startY += (Math.random() - 0.5) * 8;
          }

          let pos = getBezierPoint(p.t, p0, p1, p2, p3);

          // Apply shockwave physics
          let dxTotal = 0;
          let dyTotal = 0;
          for (let k = 0; k < explosions.length; k++) {
            const exp = explosions[k];
            const dx = pos.x - exp.x;
            const dy = pos.y - exp.y;
            const dist = Math.hypot(dx, dy);
            if (dist < exp.radius + 100 && dist > exp.radius - 100 && dist > 0.001) {
              const force = (1 - Math.abs(dist - exp.radius) / 100) * exp.life;
              dxTotal += (dx / dist) * force * 50;
              dyTotal += (dy / dist) * force * 50;
            }
          }

          pos.x += dxTotal;
          pos.y += dyTotal;

          ctx.fillStyle = particleColor;
          ctx.fillRect(pos.x - 1.5, pos.y - 1.5, 3, 3);
        }
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      if (animId) cancelAnimationFrame(animId);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("click", handleClick);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [resolvedMode, speed, size, density, strokeWidth]);

  const filterStyle =
    hue === 0 && saturation === 1 && brightness === 1
      ? undefined
      : `hue-rotate(${hue}deg) saturate(${saturation}) brightness(${brightness})`;

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full overflow-hidden pointer-events-none ${className}`}
      style={{
        opacity,
        filter: filterStyle,
        ...style,
      }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full block pointer-events-none" />
    </div>
  );
}

export { GatewayFlow };
