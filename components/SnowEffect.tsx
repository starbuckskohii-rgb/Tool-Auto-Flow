import React, { useMemo } from 'react';

export const SnowEffect: React.FC = () => {
  const snowflakes = useMemo(() => {
    return Array.from({ length: 50 }).map((_, i) => ({
      id: i,
      left: Math.random() * 100 + '%',
      animationDuration: Math.random() * 3 + 10 + 's', // 10-13s
      animationDelay: Math.random() * 5 + 's',
      fontSize: Math.random() * 10 + 10 + 'px',
      opacity: Math.random() * 0.5 + 0.3
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
          top: -20px;
          color: white;
          text-shadow: 0 0 5px rgba(255,255,255,0.8);
          animation-name: snowfall;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
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
          {Math.random() > 0.5 ? '❄' : '❅'}
        </div>
      ))}
    </div>
  );
};