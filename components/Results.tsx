import React from 'react';
import { Scene } from '../types';

interface SceneCardProps {
  scene: Scene;
}

const SceneCard: React.FC<SceneCardProps> = ({ scene }) => {
  const formattedText = scene.prompt_text
    .replace(/(\[SCENE_START\])/g, '$1')
    .replace(/(SCENE_HEADING:|CHARACTER:|CINEMATOGRAPHY:|LIGHTING:|ENVIRONMENT:|ACTION_EMOTION:|STYLE:)/g, '\n<strong class="text-indigo-300">$&</strong>');

  return (
    <div className="scene-card glass-card rounded-lg p-5 border border-white/20 transition-transform transform hover:-translate-y-1 hover:shadow-2xl flex flex-col justify-between">
      <div>
        <h3 className="font-bold text-lg text-indigo-100">🎬 Scene {scene.scene_number}: {scene.scene_title}</h3>
        <p 
          className="text-white mt-2 text-sm bg-black/20 p-3 rounded-md font-mono break-words whitespace-pre-wrap"
          dangerouslySetInnerHTML={{ __html: formattedText }}
        />
      </div>
    </div>
  );
};

interface ResultsProps {
  scenes: Scene[];
}

const Results: React.FC<ResultsProps> = ({ scenes }) => {
  if (!scenes || scenes.length === 0) {
    return null;
  }

  return (
    <div className="mt-10">
      <h2 className="text-2xl font-bold text-center mb-6">Kịch Bản Prompt Của Bạn</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {scenes.map(s => (
          <SceneCard 
            key={s.scene_number} 
            scene={s}
          />
        ))}
      </div>
    </div>
  );
};

export default Results;