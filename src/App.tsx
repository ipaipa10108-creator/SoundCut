import { useEffect, useState } from 'react';
import { useAudioStore } from './store/useAudioStore';
import MainEditor from './components/MainEditor';
import ClipsPanel from './components/ClipsPanel';
import Header from './components/Header';
import SettingsModal from './components/SettingsModal';
import ClipEditorModal from './components/ClipEditorModal';
import FileUploader from './components/FileUploader';

function App() {
  const { 
    mainTrack, 
    isLoading, 
    statusMessage,
    updateMainTrack, 
    settings, 
    setPlaybackSpeed, 
    activePlaybackNodes, 
    isPlayingMixed,
    toggleMainPlayback,
    undo,
    redo,
    showClipsModal,
    setShowClipsModal
  } = useAudioStore();
  
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    const handleGlobalKeydown = (e: KeyboardEvent) => {
      // 避免在輸入框觸發
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      const key = e.key.toLowerCase();
      const s = settings.shortcuts;

      // Undo / Redo
      if (e.ctrlKey && key === 'z') { e.preventDefault(); undo(); return; }
      if (e.ctrlKey && key === 'y') { e.preventDefault(); redo(); return; }
      // Play toggle (Space)
      if (key === s.play) { e.preventDefault(); toggleMainPlayback(); return; }
      // Toggle Clips Panel (Default 'x')
      if (key === (s.toggleClips || 'x')) { e.preventDefault(); setShowClipsModal(!useAudioStore.getState().showClipsModal); return; }

      // Arrow keys (Seek when paused)
      if (activePlaybackNodes.length === 0 && !isPlayingMixed && mainTrack.buffer) {
        if (key === 'arrowleft' || key === 'arrowright') {
          e.preventDefault();
          let seekTime = mainTrack.selectionStart;
          if (key === 'arrowleft') seekTime -= settings.seekStep;
          if (key === 'arrowright') seekTime += settings.seekStep;
          seekTime = Math.max(0, Math.min(seekTime, mainTrack.buffer.duration));
          
          updateMainTrack({
            selectionStart: seekTime,
            selectionEnd: seekTime
          });
          return;
        }
      }

      // Speed shortcuts
      if (key === s.speed1) { e.preventDefault(); setPlaybackSpeed(1.0); }
      if (key === s.speed15) { e.preventDefault(); setPlaybackSpeed(1.5); }
      if (key === s.speed2) { e.preventDefault(); setPlaybackSpeed(2.0); }
      
      // Feature shortcuts handled within components mostly, but speed & arrows are very global.
    };
    window.addEventListener('keydown', handleGlobalKeydown);
    return () => window.removeEventListener('keydown', handleGlobalKeydown);
  }, [settings, activePlaybackNodes.length, isPlayingMixed, mainTrack.buffer, mainTrack.selectionStart, setPlaybackSpeed, updateMainTrack, toggleMainPlayback, undo, redo]);

  return (
    <div className="min-h-screen relative p-4 md:p-6 lg:p-8">
      {/* Background/Base layout */}
      <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
        
        {/* Editor Panel */}
        <div className={`flex flex-col bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-gray-100 relative transition-all duration-300 ease-in-out w-full`}>
          <Header onOpenSettings={() => setShowSettings(true)} />
          
          <div className="mt-8">
            {!mainTrack.buffer && <FileUploader />}

            {isLoading && (
              <div className="flex flex-col items-center justify-center my-8">
                <div className="w-10 h-10 border-4 border-gray-100 border-t-primary rounded-full animate-spin"></div>
                <p className="mt-4 text-gray-500 italic">{statusMessage}</p>
              </div>
            )}

            {!isLoading && statusMessage && (
              <p className="text-gray-500 italic text-center mt-4 min-h-[24px]">{statusMessage}</p>
            )}

            {/* Main Workspace */}
            {mainTrack.buffer && (
              <div className="mt-6 flex flex-col gap-8 animate-fade-in">
                <MainEditor />
              </div>
            )}
          </div>
        </div>
      </div>

      {showClipsModal && (
        <div className="fixed inset-0 bg-black/60 z-[900] flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setShowClipsModal(false)}>
           <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl h-[80vh] flex flex-col p-6 animate-scale-in" onClick={e => e.stopPropagation()}>
             <ClipsPanel />
           </div>
        </div>
      )}

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      <ClipEditorModal />
    </div>
  );
}

export default App;
