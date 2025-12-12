import React, { useMemo } from 'react';

export const SnowEffect: React.FC = () => {
  const snowflakes = useMemo(() => {
    return Array.from({ length: 60 }).map((_, i) => ({
      id: i,
      left: Math.random() * 100 + '%',
      animationDuration: Math.random() * 5 + 8 + 's', // 8-13s (Slightly faster fall)
      animationDelay: Math.random() * 5 + 's',
      fontSize: Math.random() * 14 + 12 + 'px', // Bigger: 12px - 26px
      opacity: Math.random() * 0.4 + 0.6 // More visible: 0.6 - 1.0
    }));
  }, []);

  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden" aria-hidden="true">
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
  );
};