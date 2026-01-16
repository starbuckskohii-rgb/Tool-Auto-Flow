import React, { useEffect, useRef } from 'react';

// --- FALLING FLOWERS LOGIC (CANVAS) ---
const FlowerCanvas: React.FC = () => {
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

    // Fewer particles for better performance
    const particles: Particle[] = [];
    const maxParticles = 40; 

    class Particle {
      x: number;
      y: number;
      size: number;
      speedY: number;
      speedX: number;
      rotation: number;
      rotationSpeed: number;
      color: string;
      type: 'circle' | 'petal';

      constructor() {
        this.x = Math.random() * width;
        this.y = Math.random() * height - height; // Start above
        this.size = Math.random() * 5 + 3;
        this.speedY = Math.random() * 1 + 0.5; // Slow fall
        this.speedX = Math.random() * 0.5 - 0.25; // Gentle drift
        this.rotation = Math.random() * 360;
        this.rotationSpeed = Math.random() * 2 - 1;
        
        // Randomly Mai (Yellow) or Dao (Pink)
        const isMai = Math.random() > 0.5;
        this.color = isMai ? '#fbbf24' : '#f472b6'; // Amber-400 or Pink-400
        this.type = Math.random() > 0.3 ? 'petal' : 'circle';
      }

      update() {
        this.y += this.speedY;
        this.x += this.speedX + Math.sin(this.y / 50) * 0.2;
        this.rotation += this.rotationSpeed;

        if (this.y > height) {
          this.y = -20;
          this.x = Math.random() * width;
        }
      }

      draw() {
        if (!ctx) return;
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);
        ctx.fillStyle = this.color;
        
        if (this.type === 'petal') {
            // Draw simple petal shape
            ctx.beginPath();
            ctx.ellipse(0, 0, this.size, this.size / 2, 0, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.beginPath();
            ctx.arc(0, 0, this.size / 2, 0, Math.PI * 2);
            ctx.fill();
        }
        
        ctx.restore();
      }
    }

    for (let i = 0; i < maxParticles; i++) {
      particles.push(new Particle());
    }

    let animationFrameId: number;

    function loop() {
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);

      particles.forEach((p) => {
        p.update();
        p.draw();
      });

      animationFrameId = requestAnimationFrame(loop);
    }

    loop();

    const handleResize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
    };

    window.addEventListener('resize', handleResize);
    return () => {
        window.removeEventListener('resize', handleResize);
        cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none z-0 opacity-60" />;
};


// --- MAIN COMPONENT ---
export const TetEffect: React.FC = () => {
  return (
    // REMOVED 'z-0' class here to allow children z-index to break out relative to siblings of this container
    <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
      <FlowerCanvas />
      
      <style>{`
        /* Hanging Ornament Animation */
        @keyframes swing {
          0% { transform: rotate(3deg); }
          100% { transform: rotate(-3deg); }
        }

        .ornament-container {
          position: fixed;
          top: -10px; /* Hide top of string */
          z-index: 9999; /* UPDATED: Maximum z-index to stay on top of EVERYTHING */
          display: flex;
          flex-direction: column;
          align-items: center;
          transform-origin: top center;
          animation: swing 4s infinite ease-in-out alternate;
          filter: drop-shadow(0 5px 10px rgba(0,0,0,0.3));
          pointer-events: none;
        }

        .ornament-string {
            width: 2px;
            height: 100px; /* Hang lower to overlap header nicely */
            background: #b45309; /* Dark Gold/Brown */
        }

        .ornament-diamond {
            width: 80px;
            height: 80px;
            background: #991b1b; /* Deep Red */
            border: 3px solid #fbbf24; /* Gold */
            transform: rotate(45deg);
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
            box-shadow: inset 0 0 10px rgba(0,0,0,0.3);
        }
        
        /* Inner decorative border */
        .ornament-diamond::before {
            content: '';
            position: absolute;
            top: 4px; left: 4px; right: 4px; bottom: 4px;
            border: 1px dashed #fbbf24;
        }

        .ornament-text {
            transform: rotate(-45deg);
            font-family: 'Charm', cursive;
            color: #fbbf24;
            font-size: 36px;
            font-weight: 700;
            text-shadow: 1px 1px 0 #450a0a;
            margin-top: 5px; /* Optical adjustment */
        }

        /* Tassel (Tua rua) */
        .tassel-connection {
            width: 4px;
            height: 20px;
            background: #fbbf24;
            margin-top: -15px; /* Connect to bottom corner of diamond */
            z-index: -1;
        }
        
        .tassel {
            width: 20px;
            height: 60px;
            background: #ef4444; /* Red tassel */
            border-radius: 4px 4px 10px 10px;
            position: relative;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
        }
        /* Cap of tassel */
        .tassel::before {
            content: '';
            position: absolute;
            top: 0; left: 0; right: 0;
            height: 10px;
            background: #fbbf24; /* Gold cap */
            border-radius: 4px 4px 0 0;
        }

        .ornament-left { left: 40px; animation-delay: 0s; }
        .ornament-right { right: 40px; animation-delay: 1.5s; }

        /* Marquee Text Animation */
        @keyframes scroll-text {
          0% { transform: translateX(100vw); }
          100% { transform: translateX(-100%); }
        }
        .marquee-container {
            position: fixed;
            top: 64px; /* UPDATED: Directly under the header (h-16 = 64px) */
            left: 0;
            width: 100%;
            height: 32px; /* UPDATED: Narrower height */
            z-index: 40; 
            white-space: nowrap;
            overflow: hidden;
            pointer-events: none;
            /* UPDATED: Darker gradient, more compact */
            background: linear-gradient(90deg, transparent 0%, rgba(69, 10, 10, 0.6) 20%, rgba(69, 10, 10, 0.6) 80%, transparent 100%);
            display: flex;
            align-items: center;
        }
        .marquee-content {
            display: inline-block;
            animation: scroll-text 80s linear infinite; 
            padding-left: 100vw; 
        }
        .festive-text {
            font-family: 'Charm', cursive;
            font-weight: 700;
            font-size: 1.25rem; /* UPDATED: Smaller font size */
            display: inline-flex;
            align-items: center;
            gap: 1rem;
            text-shadow: 1px 1px 0px #7f1d1d;
        }
        .text-tet-msg {
             color: #fbbf24;
             margin-right: 40vw; 
        }
        .text-year {
             color: #fbbf24; 
        }
      `}</style>

      {/* LEFT ORNAMENT - PHÚC */}
      <div className="ornament-container ornament-left">
        <div className="ornament-string"></div>
        <div className="ornament-diamond">
            <span className="ornament-text">Phúc</span>
        </div>
        <div className="tassel-connection"></div>
        <div className="tassel"></div>
      </div>

      {/* RIGHT ORNAMENT - LỘC */}
      <div className="ornament-container ornament-right">
        <div className="ornament-string"></div>
        <div className="ornament-diamond">
            <span className="ornament-text">Lộc</span>
        </div>
        <div className="tassel-connection"></div>
        <div className="tassel"></div>
      </div>

      {/* SCROLLING TEXT */}
      <div className="marquee-container">
          <div className="marquee-content">
              <span className="festive-text text-tet-msg">
                  🌸 CHÚC MỪNG NĂM MỚI - VẠN SỰ NHƯ Ý 🌸
              </span>
              <span className="festive-text text-year">
                  💰 TẤN TÀI TẤN LỘC - AN KHANG THỊNH VƯỢNG 💰
              </span>
          </div>
      </div>

    </div>
  );
};