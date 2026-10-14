import { useRef } from 'react';
import { useAudioStore } from '../store/useAudioStore';
import { Upload, Wrench } from 'lucide-react';
import { autoDecodeWithRepair } from '../utils/audioDiagnostics';

interface FileUploaderProps {
  onOpenRepairModal?: () => void;
}

export default function FileUploader({ onOpenRepairModal }: FileUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { initAudioContext, setOriginalFileName, updateMainTrack, setLoading, resetApp } = useAudioStore();

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    initAudioContext();
    const ctx = useAudioStore.getState().audioContext;
    if (!ctx) return;

    resetApp();
    setOriginalFileName(file.name);
    setLoading(true, `正在讀取檔案 (${file.name})...`);

    if (file.size > 300 * 1024 * 1024) {
      alert('警告：檔案過大，瀏覽器可能崩潰。');
    }

    try {
      const arrayBuffer = await file.arrayBuffer();
      setLoading(true, '正在分析並解碼音訊...');

      // Auto-decode with automated diagnosis and repair
      const { audioBuffer, report } = await autoDecodeWithRepair(arrayBuffer, file.name, ctx);
      
      updateMainTrack({ 
        buffer: audioBuffer,
        viewStartTime: 0,
        viewEndTime: audioBuffer.duration,
        selectionStart: 0,
        selectionEnd: audioBuffer.duration
      });

      const hasRepairs = report.repairLogs.length > 0;
      const successMsg = hasRepairs
        ? `解碼完成！(${report.repairLogs.join('；')})`
        : '解碼完成！請在主音軌上拖曳以選取範圍。';

      setLoading(false, successMsg);
    } catch (error: any) {
      setLoading(false, `錯誤：無法解碼此檔案。${error.message || ''}`);
      console.error('解碼錯誤:', error);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div 
        className="flex flex-col items-center justify-center p-10 md:p-14 border-2 border-dashed border-gray-300 rounded-2xl bg-gray-50/70 hover:bg-gray-100/80 transition-all cursor-pointer group shadow-sm hover:shadow"
        onClick={() => fileInputRef.current?.click()}
      >
        <input 
          type="file" 
          ref={fileInputRef}
          onChange={handleFileSelect}
          accept="audio/*,video/mp4,audio/flac,audio/m4a,audio/aac,.amr,.arm"
          className="hidden"
        />
        <div className="w-16 h-16 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mb-4 group-hover:scale-105 transition-transform">
          <Upload size={32} />
        </div>
        <h3 className="text-xl font-bold text-gray-800 mb-2">點擊選擇或拖放音訊檔案</h3>
        <p className="text-gray-500 text-sm mb-1">
          支援 <span className="font-semibold text-primary">.arm, .amr</span>, MP3, WAV, AAC, M4A, FLAC 等格式
        </p>
        <span className="text-xs text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full font-medium mt-1">
          ✓ 內建 AMR 專屬解碼引擎與損壞標頭自動修復
        </span>
      </div>

      {onOpenRepairModal && (
        <div className="flex justify-center">
          <button
            type="button"
            className="text-xs text-gray-600 hover:text-primary flex items-center gap-1.5 py-1.5 px-3 rounded-lg hover:bg-gray-100 transition-colors"
            onClick={onOpenRepairModal}
          >
            <Wrench size={13} className="text-primary" />
            <span>檔案損壞無法開啟？開啟「音檔檢查與修復工具」</span>
          </button>
        </div>
      )}
    </div>
  );
}
