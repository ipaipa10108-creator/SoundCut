import { Settings, Layers } from 'lucide-react';
import { useAudioStore } from '../store/useAudioStore';

export default function Header({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { setShowClipsModal, clips } = useAudioStore();
  
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <h1 className="text-3xl font-bold text-primary flex items-center gap-3 justify-center md:justify-start">
          <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center text-primary">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><line x1="20" y1="4" x2="8.12" y2="15.88"></line><line x1="14.47" y1="14.48" x2="20" y2="20"></line><line x1="8.12" y1="8.12" x2="12" y2="12"></line></svg>
          </div>
          SoundCut
        </h1>
        <p className="text-gray-500 mt-2 text-center md:text-left">分析、編輯、剪輯、組合、匯出，您的音訊處理中心。</p>
      </div>

      <div className="flex justify-center md:justify-end items-center gap-3">
        <button 
          className="btn btn-default flex items-center gap-2"
          onClick={() => setShowClipsModal(true)}
          title="開啟片段列表"
        >
          <Layers className="w-4 h-4" />
          <span>片段列表</span>
          {clips.length > 0 && (
            <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded-full text-xs font-bold font-mono">
              {clips.length}
            </span>
          )}
        </button>

        <button 
          className="btn btn-default w-10 h-10 flex items-center justify-center p-0 rounded-full hover:bg-gray-100"
          onClick={onOpenSettings}
          title="設定"
        >
          <Settings className="w-5 h-5 text-gray-600" />
        </button>
      </div>
    </div>
  );
}
