import { useState } from 'react';
import { useAudioStore } from '../store/useAudioStore';
import { Play, Edit2, Download, Trash2, Layers, XCircle } from 'lucide-react';
import { formatRulerTime } from '../utils/waveformDraw';
import { bufferToWav, bufferToMp3 } from '../utils/audioExport';

export default function ClipsPanel() {
  const { 
    clips, 
    setClips, 
    activeInsertClipId, 
    setActiveInsertClipId,
    setPlacedClips,
    audioContext,
    setLoading,
    updateModalTrack,
    mainTrack
  } = useAudioStore();

  const [selectedForCombine, setSelectedForCombine] = useState<number[]>([]);

  const handleToggleCombine = (id: number) => {
    setSelectedForCombine(prev => 
      prev.includes(id) ? prev.filter(cId => cId !== id) : [...prev, id]
    );
  };

  const handleCombineClips = async () => {
    if (selectedForCombine.length < 2 || !audioContext) {
      alert('請至少勾選兩個片段進行合併。');
      return;
    }

    const clipsToCombine = selectedForCombine.map(id => clips.find(c => c.id === id)).filter(Boolean) as typeof clips;
    if (clipsToCombine.length < 2) return;

    setLoading(true, "正在合併片段...");
    await new Promise(r => setTimeout(r, 50));

    try {
      const totalLength = clipsToCombine.reduce((sum, clip) => sum + clip.buffer.length, 0);
      const numChannels = clipsToCombine[0].buffer.numberOfChannels;
      const sampleRate = clipsToCombine[0].buffer.sampleRate;
      const combinedBuffer = audioContext.createBuffer(numChannels, totalLength, sampleRate);
      
      let offset = 0;
      for (const clip of clipsToCombine) {
        for (let i = 0; i < numChannels; i++) {
          combinedBuffer.getChannelData(i).set(clip.buffer.getChannelData(i), offset);
        }
        offset += clip.buffer.length;
      }

      const combinedCount = clips.filter(c => c.name.startsWith('合併')).length;
      const newClip = { 
        id: Date.now(), 
        name: `合併片段 ${combinedCount + 1}`, 
        buffer: combinedBuffer 
      };

      setClips([...clips, newClip]);
      setSelectedForCombine([]);
      setLoading(false, "片段合併成功！");
    } catch (e) {
      console.error(e);
      setLoading(false, "合併出錯");
    }
  };

  const playClip = (buffer: AudioBuffer) => {
    if (!audioContext) return;
    const sourceNode = audioContext.createBufferSource();
    sourceNode.buffer = buffer;
    sourceNode.connect(audioContext.destination);
    sourceNode.start(0);
  };

  const renameClip = (id: number, oldName: string) => {
    const newName = prompt('新名稱：', oldName);
    if (newName) {
      setClips(clips.map(c => c.id === id ? { ...c, name: newName } : c));
    }
  };

  const deleteClip = (id: number) => {
    if (confirm('確定刪除此片段？')) {
      setClips(clips.filter(c => c.id !== id));
      if (activeInsertClipId === id) setActiveInsertClipId(null);
      
      // Also remove from placed clips
      setPlacedClips((prev) => prev.filter(pc => pc.sourceClipId !== id));
      setSelectedForCombine((prev) => prev.filter(cId => cId !== id));
    }
  };

  const downloadClip = (clip: typeof clips[0]) => {
    const format = prompt("請選擇下載格式：輸入 'mp3' 或 'wav'", "mp3")?.toLowerCase();
    if (!format || (format !== 'mp3' && format !== 'wav')) return;

    setLoading(true, `正在編碼為 ${format.toUpperCase()}...`);
    setTimeout(() => {
      try {
        let blob, extension;
        if (format === 'mp3') {
          blob = bufferToMp3(clip.buffer);
          extension = 'mp3';
        } else {
          blob = bufferToWav(clip.buffer);
          extension = 'wav';
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = `${clip.name.replace(/[\s/\\?%*:|"<>]/g, '_')}.${extension}`;
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
        setLoading(false, `下載已開始！`);
      } catch (error) {
        setLoading(false, `編碼或下載時發生錯誤。`);
        console.error(error);
      }
    }, 50);
  };

  const clearClips = () => {
    if (confirm('確定要清空所有片段嗎？此操作無法復原。')) {
      setClips([]);
      setPlacedClips([]);
      setSelectedForCombine([]);
      setActiveInsertClipId(null);
    }
  };

  const editClip = (clip: typeof clips[0]) => {
    if (!audioContext) return;
    
    // Create new buffer instance to edit
    const newBuffer = audioContext.createBuffer(clip.buffer.numberOfChannels, clip.buffer.length, clip.buffer.sampleRate);
    for (let i = 0; i < clip.buffer.numberOfChannels; i++) {
      newBuffer.getChannelData(i).set(clip.buffer.getChannelData(i));
    }

    updateModalTrack({
      editingClipId: clip.id,
      buffer: newBuffer,
      viewStartTime: 0,
      viewEndTime: newBuffer.duration,
      selectionStart: 0,
      selectionEnd: newBuffer.duration,
    });
  };

  if (!mainTrack.buffer) return null;

  return (
    <div className="flex flex-col h-full opacity-100 transition-opacity duration-300">
      <div className="flex justify-between items-center mb-2 border-b pb-2 shrink-0">
        <h2 className="text-xl font-bold text-gray-800">剪輯片段列表</h2>
      </div>
      <p className="text-xs text-gray-500 mb-4 shrink-0">多選以合併，單選以安插至混音軌</p>
      
      <div className="flex-grow overflow-y-auto space-y-3 pr-2 mb-4 scrollbar-thin">
        {clips.length === 0 ? (
          <div className="text-center text-gray-400 py-8 border-2 border-dashed border-gray-100 rounded-lg">
            尚無片段。<br/>請從主音軌提取或剪裁。
          </div>
        ) : (
          clips.map(clip => (
            <div key={clip.id} className={`p-3 rounded-lg border flex flex-col gap-2 transition-colors ${activeInsertClipId === clip.id ? 'bg-primary/5 border-primary shadow-sm' : 'bg-white border-gray-200 hover:border-gray-300'}`}>
              <div className="flex items-start gap-3">
                <div className="flex flex-col gap-3 mt-1 shrink-0">
                  <input 
                    type="checkbox" 
                    title="勾選以用於合併"
                    className="w-4 h-4 text-primary rounded focus:ring-primary cursor-pointer"
                    checked={selectedForCombine.includes(clip.id)}
                    onChange={() => handleToggleCombine(clip.id)}
                  />
                  <input 
                    type="radio" 
                    title="選取以安插"
                    name="clip-insert-select"
                    className="w-4 h-4 text-primary focus:ring-primary cursor-pointer"
                    checked={activeInsertClipId === clip.id}
                    onChange={() => setActiveInsertClipId(clip.id)}
                  />
                </div>
                
                <div className="flex-grow overflow-hidden">
                  <div 
                    className="font-bold text-gray-800 cursor-pointer hover:text-primary truncate" 
                    onClick={() => renameClip(clip.id, clip.name)}
                    title="點擊以重新命名"
                  >
                    {clip.name}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    長度: {formatRulerTime(clip.buffer.duration)}
                  </div>
                </div>
              </div>
              
              <div className="flex justify-end gap-1 mt-1">
                <button onClick={() => playClip(clip.buffer)} className="p-1.5 text-gray-600 hover:bg-gray-100 rounded" title="播放"><Play size={16} fill="currentColor" /></button>
                <button onClick={() => editClip(clip)} className="p-1.5 text-gray-600 hover:bg-gray-100 rounded" title="編輯"><Edit2 size={16} /></button>
                <button onClick={() => downloadClip(clip)} className="p-1.5 text-gray-600 hover:bg-gray-100 rounded" title="下載"><Download size={16} /></button>
                <button onClick={() => deleteClip(clip.id)} className="p-1.5 text-danger hover:bg-danger-light rounded" title="刪除"><Trash2 size={16} /></button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="shrink-0 flex gap-2 pt-3 border-t">
        <button 
          className="btn btn-primary flex-1 !text-sm whitespace-nowrap"
          disabled={selectedForCombine.length < 2}
          onClick={handleCombineClips}
        >
          <Layers size={16} />序列合併
        </button>
        <button 
          className="btn btn-default !text-danger hover:!bg-danger-light border-gray-200"
          disabled={clips.length === 0}
          onClick={clearClips}
        >
          <XCircle size={16} />清空
        </button>
      </div>
    </div>
  );
}
