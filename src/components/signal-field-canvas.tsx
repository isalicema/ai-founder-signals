'use client';

import { useEffect, useRef } from 'react';

type Particle = {
  alpha: number;
  drift: number;
  glyph: string;
  size: number;
  sway: number;
  swaySpeed: number;
  x: number;
  y: number;
};

const GLYPHS = [...'afs01<>{}≈∷·+×#$%&'];

export function SignalFieldCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let animationFrame = 0;
    let active = false;
    let width = 0;
    let height = 0;
    let particles: Particle[] = [];

    const seed = () => {
      const count = Math.round((width * height) / 26_000);
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        size: 9 + Math.random() * 8,
        alpha: 0.06 + Math.random() * 0.11,
        drift: 0.08 + Math.random() * 0.22,
        sway: Math.random() * Math.PI * 2,
        swaySpeed: 0.002 + Math.random() * 0.004,
        glyph: GLYPHS[Math.floor(Math.random() * GLYPHS.length)] ?? 'a',
      }));
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    };

    const draw = () => {
      context.clearRect(0, 0, width, height);
      context.textAlign = 'center';
      context.textBaseline = 'middle';

      for (const particle of particles) {
        particle.y -= particle.drift;
        particle.sway += particle.swaySpeed;
        const x = particle.x + Math.sin(particle.sway) * 14;
        if (particle.y < -20) {
          particle.y = height + 20;
          particle.x = Math.random() * width;
        }
        context.font = `500 ${particle.size}px "IBM Plex Mono", ui-monospace, monospace`;
        context.fillStyle = `rgba(51, 64, 200, ${particle.alpha})`;
        context.fillText(particle.glyph, x, particle.y);
      }
    };

    const loop = () => {
      if (!active || reduceMotion.matches) return;
      draw();
      animationFrame = window.requestAnimationFrame(loop);
    };

    const syncSkin = () => {
      const shouldRun = document.documentElement.dataset.skin === 'aurora';
      window.cancelAnimationFrame(animationFrame);
      active = shouldRun;
      if (!shouldRun) {
        context.clearRect(0, 0, width, height);
        return;
      }
      resize();
      if (reduceMotion.matches) draw();
      else loop();
    };

    const handleResize = () => {
      if (!active) return;
      resize();
      if (reduceMotion.matches) draw();
    };

    window.addEventListener('afs-skin-change', syncSkin);
    window.addEventListener('resize', handleResize, { passive: true });
    reduceMotion.addEventListener('change', syncSkin);
    syncSkin();

    return () => {
      active = false;
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener('afs-skin-change', syncSkin);
      window.removeEventListener('resize', handleResize);
      reduceMotion.removeEventListener('change', syncSkin);
    };
  }, []);

  return <canvas ref={canvasRef} id="field" aria-hidden="true" />;
}
