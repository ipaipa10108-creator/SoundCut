import { useRef } from 'react';
import { useAudioStore } from '../store/useAudioStore';
import { Upload } from 'lucide-react';

export default function FileUploader() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { initAudioContext, setOriginalFileName, updateMainTrack, setLoading, resetApp } = useAudioStore();

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    initAudioContext();
    const ctx = useAudioStore.getState().audioContext; // Get latest immediately
    if (!ctx) return;

    resetApp();
    setOriginalFileName(file.name);
    setLoading(true, '正在讀取檔案...');

    if (file.size > 300 * 1024 * 1024) {
      alert('警告：檔案過大，瀏覽器可能崩潰。');
    }

    try {
      const arrayBuffer = await file.arrayBuffer();
      setLoading(true, '正在解碼音訊...');
      const decodedBuffer = await ctx.decodeAudioData(arrayBuffer);
      
      updateMainTrack({ 
        buffer: decodedBuffer,
        viewStartTime: 0,
        viewEndTime: decodedBuffer.duration,
        selectionStart: 0,
        selectionEnd: decodedBuffer.duration
      });

      setLoading(false, '解碼完成！請在主音軌上拖曳以選取範圍。');
    } catch (error) {
      setLoading(false, `錯誤：無法解碼此檔案。`);
      console.error('解碼錯誤:', error);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-12 border-2 border-dashed border-gray-300 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer" onClick={() => fileInputRef.current?.click()}>
      <input 
        type="file" 
        ref={fileInputRef}
        onChange={handleFileSelect}
        accept="audio/*,video/mp4,audio/flac,audio/m4a,audio/aac"
        className="hidden"
      />
      <div className="w-16 h-16 bg-primary/10 text-primary rounded-full flex items-center justify-center mb-4">
        <Upload size={32} />
      </div>
      <h3 className="text-xl font-medium text-gray-700 mb-2">點擊選擇音訊檔案</h3>
      <p className="text-gray-500 text-sm">支援 MP3, WAV, AAC, MP4 (音訊) 等格式</p>
    </div>
  );
}
