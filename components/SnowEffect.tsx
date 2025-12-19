import React, { useMemo, useEffect, useState } from 'react';

// --- Improved Firework Component ---
const Firework: React.FC<{ x: number, y: number, color: string }> = ({ x, y, color }) => {
    const particles = useMemo(() => {
        return Array.from({ length: 36 }).map((_, i) => { 
            const angle = (Math.PI * 2 * i) / 36;
            const velocity = 80 + Math.random() * 60; 
            const tx = Math.cos(angle) * velocity;
            const ty = Math.sin(angle) * velocity;
            return { id: i, tx, ty };
        });
    }, []);

    return (
        <div style={{ position: 'absolute', left: x, top: y, pointerEvents: 'none', zIndex: 1 }}>
            {particles.map(p => (
                <div 
                    key={`p-${p.id}`}
                    style={{
                        position: 'absolute',
                        width: '3px', 
                        height: '3px',
                        backgroundColor: color,
                        borderRadius: '50%',
                        left: 0, top: 0,
                        boxShadow: `0 0 6px ${color}, 0 0 10px #fff`, 
                        animation: `explode-${p.id} 2s ease-out forwards`
                    }}
                >
                    <style>{`
                        @keyframes explode-${p.id} {
                            0% { transform: translate(0,0) scale(1); opacity: 1; }
                            40% { opacity: 1; }
                            100% { 
                                transform: translate(${p.tx}px, ${p.ty + 150}px) scale(0);
                                opacity: 0; 
                            }
                        }
                    `}</style>
                </div>
            ))}
        </div>
    );
};

const FireworksDisplay: React.FC = () => {
    const [fireworks, setFireworks] = useState<{id: number, x: number, y: number, color: string}[]>([]);

    useEffect(() => {
        const colors = ['#ff0055', '#00ffaa', '#ffff00', '#00ccff', '#ff00ff', '#ffffff', '#ff9900'];
        const interval = setInterval(() => {
            const count = Math.random() > 0.7 ? 2 : 1;
            for (let i = 0; i < count; i++) {
                const id = Date.now() + i;
                const x = Math.random() * window.innerWidth;
                const y = Math.random() * (window.innerHeight * 0.6); 
                const color = colors[Math.floor(Math.random() * colors.length)];
                setFireworks(prev => [...prev, { id, x, y, color }]);
                setTimeout(() => {
                    setFireworks(prev => prev.filter(f => f.id !== id));
                }, 2100);
            }
        }, 1500);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="fixed inset-0 pointer-events-none z-[2] overflow-hidden">
            {fireworks.map(fw => (
                <Firework key={fw.id} x={fw.x} y={fw.y} color={fw.color} />
            ))}
        </div>
    );
};

// --- Draped Christmas Lights (Tree/Swag Style) ---
const ChristmasLights: React.FC = () => {
    const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });

    useEffect(() => {
        const handleResize = () => setDimensions({ width: window.innerWidth, height: window.innerHeight });
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const colors = ['#ef4444', '#fbbf24', '#22c55e', '#3b82f6', '#a855f7']; // Red, Gold, Green, Blue, Purple

    // Helper to generate a draped wire path and bulb positions
    const generateDrapedStrand = (length: number, isVertical: boolean) => {
        const segmentLength = 120; // Distance between "hooks"
        const sag = 25; // How deep the wire hangs
        const bulbCountPerSegment = 3; // Bulbs per drape
        
        const segments = Math.ceil(length / segmentLength);
        let pathD = `M 0,0`;
        const bulbs: {x: number, y: number, color: string, delay: number}[] = [];

        for (let i = 0; i < segments; i++) {
            const startX = i * segmentLength;
            const endX = (i + 1) * segmentLength;
            const midX = startX + (segmentLength / 2);
            
            // Draw curve: Quadratic Bezier (Start -> Control Point -> End)
            pathD += ` Q ${midX},${sag * 2} ${endX},0`;

            // Place bulbs along the theoretical curve
            for (let b = 1; b <= bulbCountPerSegment; b++) {
                const t = b / (bulbCountPerSegment + 1); // 0.25, 0.5, 0.75
                
                const bx = (1-t)*(1-t)*startX + 2*(1-t)*t*midX + t*t*endX;
                const by = (1-t)*(1-t)*0 + 2*(1-t)*t*(sag * 2) + t*t*0;

                bulbs.push({
                    x: bx,
                    y: by,
                    color: colors[Math.floor(Math.random() * colors.length)],
                    delay: Math.random() * 2 // Random blink delay
                });
            }
        }

        return { pathD, bulbs };
    };

    const { width, height } = dimensions;
    // Removed Top Strand to prevent covering text
    const bottomStrand = useMemo(() => generateDrapedStrand(width, false), [width]);
    const leftStrand = useMemo(() => generateDrapedStrand(height, true), [height]); 
    const rightStrand = useMemo(() => generateDrapedStrand(height, true), [height]);

    const BulbGroup = ({ bulbs }: { bulbs: any[] }) => (
        <>
            {bulbs.map((b, i) => (
                <g key={i} transform={`translate(${b.x}, ${b.y})`}>
                    {/* Socket */}
                    <rect x="-3" y="-6" width="6" height="6" fill="#333" rx="1" />
                    {/* Bulb */}
                    <circle 
                        cx="0" cy="4" r="5" 
                        fill={b.color} 
                        style={{
                            animation: `bulb-flash 1.5s infinite alternate ease-in-out`,
                            animationDelay: `${b.delay}s`,
                            filter: `drop-shadow(0 0 4px ${b.color})`
                        }}
                    />
                    {/* Highlight */}
                    <circle cx="-1.5" cy="2.5" r="1.5" fill="rgba(255,255,255,0.6)" />
                </g>
            ))}
        </>
    );

    // Z-index 40 places lights below the Header (z-50) but above standard content (z-10/0)
    // This allows lights to be visible on the sides but tucked behind the top header bar if they were to overlap (which they won't since Top is removed)
    return (
        <div className="fixed inset-0 z-[40] pointer-events-none">
            <style>{`
                @keyframes bulb-flash {
                    0% { opacity: 0.5; transform: scale(0.9); }
                    100% { opacity: 1; transform: scale(1.1); filter: drop-shadow(0 0 8px currentColor); }
                }
            `}</style>

            {/* Bottom Border */}
            <div className="absolute bottom-0 left-0 w-full h-[60px] overflow-hidden transform scale-y-[-1]">
                <svg width="100%" height="100%" preserveAspectRatio="none">
                    <path d={bottomStrand.pathD} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
                    <BulbGroup bulbs={bottomStrand.bulbs} />
                </svg>
            </div>

            {/* Left Border */}
            <div className="absolute top-0 left-0 h-full w-[60px] overflow-hidden">
                <svg width="100%" height="100%" style={{ overflow: 'visible' }}>
                    <g transform="rotate(90) scale(1, -1)"> 
                        <path d={leftStrand.pathD} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
                        <BulbGroup bulbs={leftStrand.bulbs} />
                    </g>
                </svg>
            </div>

            {/* Right Border */}
            <div className="absolute top-0 right-0 h-full w-[60px] overflow-hidden">
                <svg width="100%" height="100%" style={{ overflow: 'visible' }}>
                    <g transform={`translate(60, 0) rotate(90)`}>
                        <path d={rightStrand.pathD} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
                        <BulbGroup bulbs={rightStrand.bulbs} />
                    </g>
                </svg>
            </div>
        </div>
    );
};

export const SnowEffect: React.FC = () => {
  const snowflakes = useMemo(() => {
    return Array.from({ length: 30 }).map((_, i) => ({
      id: i,
      left: Math.random() * 100 + '%',
      animationDuration: Math.random() * 5 + 10 + 's', 
      animationDelay: Math.random() * 5 + 's',
      fontSize: Math.random() * 10 + 10 + 'px', 
      opacity: Math.random() * 0.3 + 0.3
    }));
  }, []);

  return (
    <>
        <div className="fixed inset-0 pointer-events-none z-[1] overflow-hidden" aria-hidden="true">
        <style>{`
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
        `}</style>
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
        </div>
        
        {/* Decorations */}
        <ChristmasLights />
        <FireworksDisplay />
    </>
  );
};