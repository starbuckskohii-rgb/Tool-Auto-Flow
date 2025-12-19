import React, { useMemo, useEffect, useRef } from 'react';

// --- FIREWORKS LOGIC (CANVAS) ---
const FireworksCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = window.innerWidth;
    let height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;

    const particles: Particle[] = [];
    const fireworks: Firework[] = [];

    class Firework {
      x: number;
      y: number;
      sx: number;
      sy: number;
      hue: number;
      brightness: number;
      
      constructor() {
        this.x = Math.random() * width;
        this.y = height;
        this.sx = Math.random() * 3 - 1.5;
        this.sy = Math.random() * -3 - 4;
        this.hue = Math.random() * 360;
        this.brightness = Math.random() * 50 + 50;
      }

      update(index: number) {
        this.x += this.sx;
        this.y += this.sy;
        this.sy += 0.05; // gravity

        // Explode when it reaches peak or slows down
        if (this.sy >= -1) {
          createParticles(this.x, this.y, this.hue);
          fireworks.splice(index, 1);
        }
      }

      draw() {
        if(!ctx) return;
        ctx.beginPath();
        ctx.arc(this.x, this.y, 2, 0, Math.PI * 2);
        ctx.fillStyle = `hsl(${this.hue}, 100%, ${this.brightness}%)`;
        ctx.fill();
      }
    }

    class Particle {
      x: number;
      y: number;
      vx: number;
      vy: number;
      alpha: number;
      hue: number;
      decay: number;

      constructor(x: number, y: number, hue: number) {
        this.x = x;
        this.y = y;
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 3 + 1;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.alpha = 1;
        this.hue = hue;
        this.decay = Math.random() * 0.015 + 0.01;
      }

      update(index: number) {
        this.x += this.vx;
        this.y += this.vy;
        this.vy += 0.05; // gravity
        this.alpha -= this.decay;

        if (this.alpha <= 0) {
          particles.splice(index, 1);
        }
      }

      draw() {
        if(!ctx) return;
        ctx.globalAlpha = this.alpha;
        ctx.fillStyle = `hsl(${this.hue}, 100%, 60%)`;
        ctx.beginPath();
        ctx.arc(this.x, this.y, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    function createParticles(x: number, y: number, hue: number) {
      for (let i = 0; i < 40; i++) {
        particles.push(new Particle(x, y, hue));
      }
    }

    function loop() {
      if(!ctx) return;
      // Trail effect
      ctx.fillStyle = 'rgba(0, 0, 0, 0.1)'; 
      // Note: We clear with transparent black to leave a slight trail, 
      // but since the app background is handled by CSS, we use clearRect with alpha mostly
      ctx.clearRect(0, 0, width, height);

      // Randomly spawn fireworks
      if (Math.random() < 0.03) {
        fireworks.push(new Firework());
      }

      fireworks.forEach((fw, i) => {
        fw.update(i);
        fw.draw();
      });

      particles.forEach((p, i) => {
        p.update(i);
        p.draw();
      });

      requestAnimationFrame(loop);
    }

    loop();

    const handleResize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none z-0 opacity-80" />;
};


// --- MAIN COMPONENT ---
export const SnowEffect: React.FC = () => {
  // 1. Snowflakes Logic
  const snowflakes = useMemo(() => {
    return Array.from({ length: 60 }).map((_, i) => ({
      id: i,
      left: Math.random() * 100 + '%',
      animationDuration: Math.random() * 5 + 8 + 's',
      animationDelay: Math.random() * 5 + 's',
      fontSize: Math.random() * 14 + 12 + 'px',
      opacity: Math.random() * 0.4 + 0.6
    }));
  }, []);

  // 2. LED Lights Logic (Left & Right)
  const bulbs = useMemo(() => Array.from({ length: 18 }), []);

  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden" aria-hidden="true">
      <FireworksCanvas />
      
      <style>{`
        /* Snow Animation */
        @keyframes snowfall {
          0% { transform: translateY(-10vh) translateX(0) rotate(0deg); }
          100% { transform: translateY(110vh) translateX(20px) rotate(360deg); }
        }
        .snowflake {
          position: absolute;
          top: -30px;
          color: white;
          text-shadow: 0 0 6px rgba(255,255,255,0.9);
          animation-name: snowfall;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
          filter: drop-shadow(0 0 2px rgba(255,255,255,0.5));
        }

        /* LED Animation */
        @keyframes glow-flash { 
          0%, 100% { opacity: 1; filter: brightness(1.5); box-shadow: 0 0 15px 3px currentColor; } 
          50% { opacity: 0.5; filter: brightness(0.8); box-shadow: 0 0 5px 1px currentColor; } 
        }

        .led-string {
          position: fixed;
          top: -20px;
          bottom: -20px;
          width: 40px;
          display: flex;
          flex-direction: column;
          justify-content: space-around;
          align-items: center;
          z-index: 40;
          padding: 10px 0;
        }
        
        /* Wire Style */
        .led-string::before {
            content: '';
            position: absolute;
            top: 0;
            bottom: 0;
            width: 4px;
            background: #2d3748; /* Dark wire color */
            border-radius: 2px;
            z-index: -1;
            box-shadow: inset 1px 1px 2px rgba(0,0,0,0.5);
        }

        .led-left { left: 10px; }
        .led-right { right: 10px; }

        .bulb-container {
            position: relative;
            display: flex;
            flex-direction: column;
            align-items: center;
        }

        /* The black socket base of the bulb */
        .socket {
            width: 12px;
            height: 10px;
            background: #1a202c;
            border-radius: 2px;
            margin-bottom: -4px; /* overlap with bulb */
            z-index: 1;
            box-shadow: inset 0 0 2px rgba(0,0,0,0.8);
        }

        .bulb {
          width: 16px;
          height: 24px;
          background-color: currentColor;
          border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%; /* Teardropish shape */
          position: relative;
          z-index: 2;
        }

        /* Highlight on the bulb for glass effect */
        .bulb::after {
            content: '';
            position: absolute;
            top: 4px;
            right: 4px;
            width: 4px;
            height: 4px;
            background: rgba(255,255,255,0.6);
            border-radius: 50%;
        }

        /* Marquee Text Animation */
        @keyframes scroll-text {
          0% { transform: translateX(100vw); }
          100% { transform: translateX(-100%); }
        }
        .marquee-container {
            position: fixed;
            top: 70px; /* Below header */
            left: 0;
            width: 100%;
            z-index: 30;
            white-space: nowrap;
            overflow: hidden;
            pointer-events: none;
        }
        .marquee-content {
            display: inline-block;
            animation: scroll-text 35s linear infinite;
            padding-left: 100vw; /* Start off-screen */
        }
        .festive-text {
            font-family: 'Mountains of Christmas', cursive;
            font-weight: 700;
            font-size: 2.5rem;
            display: inline-flex;
            align-items: center;
            gap: 1rem;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }
        .text-xmas {
             color: #ef4444; /* Red */
             -webkit-text-stroke: 1px #fff;
             margin-right: 20vw; /* Space between phrases */
        }
        .text-newyear {
             color: #fbbf24; /* Amber/Gold */
             -webkit-text-stroke: 1px #fff;
             text-shadow: 0 0 10px rgba(251, 191, 36, 0.5);
        }
      `}</style>

      {/* --- SNOW --- */}
      {snowflakes.map((flake) => (
        <div
          key={flake.id}
          className="snowflake"
          style={{
            left: flake.left,
            animationDuration: flake.animationDuration,
            animationDelay: flake.animationDelay,
            fontSize: flake.fontSize,
            opacity: flake.opacity
          }}
        >
          {Math.random() > 0.6 ? '❄' : '❅'}
        </div>
      ))}

      {/* --- LED LIGHTS (LEFT) --- */}
      <div className="led-string led-left">
        {bulbs.map((_, i) => {
            const colors = ['#ff0000', '#00ff00', '#ffd700', '#00ffff', '#ff00ff']; // Vibrant Neon Colors
            const color = colors[i % colors.length];
            return (
                <div key={`l-${i}`} className="bulb-container">
                    <div className="socket"></div>
                    <div 
                        className="bulb" 
                        style={{ 
                            color, 
                            animation: `glow-flash ${1.5 + Math.random()}s infinite ease-in-out alternate` 
                        }} 
                    />
                </div>
            );
        })}
      </div>

      {/* --- LED LIGHTS (RIGHT) --- */}
      <div className="led-string led-right">
        {bulbs.map((_, i) => {
            const colors = ['#ff0000', '#00ff00', '#ffd700', '#00ffff', '#ff00ff'];
            const color = colors[(i + 2) % colors.length];
            return (
                <div key={`r-${i}`} className="bulb-container">
                    <div className="socket"></div>
                    <div 
                        className="bulb" 
                        style={{ 
                            color, 
                            animation: `glow-flash ${1.5 + Math.random()}s infinite ease-in-out alternate-reverse` 
                        }} 
                    />
                </div>
            );
        })}
      </div>

      {/* --- SCROLLING TEXT --- */}
      <div className="marquee-container">
          <div className="marquee-content">
              <span className="festive-text text-xmas">
                  🎄 MERRY CHRISTMAS 🎄
              </span>
              <span className="festive-text text-newyear">
                  🎆 HAPPY NEW YEAR 2026 🎆
              </span>
          </div>
      </div>

    </div>
  );
};