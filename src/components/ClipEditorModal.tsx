import { useEffect, useRef } from 'react';
import { useAudioStore } from '../store/useAudioStore';
import { drawWaveform, formatRulerTime } from '../utils/waveformDraw';
import { Play, Pause, Scissors, Volume2, Target, Check, X } from 'lucide-react';
import { amplifyBufferRegion, cutoutBufferRegion, sliceAudioBuffer } from '../utils/audioOperations';

export default function ClipEditorModal() {
  const { 
    modalTrack, 
    updateModalTrack, 
    audioContext,
    clips,
    setClips,
    placedClips,
    setPlacedClips,
    setLoading,
    activePlaybackNodes,
    setActivePlaybackNodes,
    currentPlaybackSpeed
  } = useAudioStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);

  const { editingClipId, buffer, viewStartTime, viewEndTime, selectionStart, selectionEnd, sourceNode } = modalTrack;

  // Draw waveform
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas || !buffer) return;

    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          canvas.width = width;
          canvas.height = height;
          drawWaveform({
            canvas,
            buffer: buffer,
            viewStartTime: viewStartTime,
            viewEndTime: viewEndTime,
            isMain: false,
            rulerHeight: 0
          });
        }
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [buffer, viewStartTime, viewEndTime]);

  // Update selection overlay
  useEffect(() => {
    if (overlayRef.current && buffer) {
      const viewDuration = viewEndTime - viewStartTime;
      if (viewDuration > 0) {
        const left = Math.max(0, (selectionStart - viewStartTime) / viewDuration * 100);
        const right = Math.min(100, (selectionEnd - viewStartTime) / viewDuration * 100);
        const width = Math.max(0, right - left);
        
        if (width <= 0 || left >= 100 || right <= 0) {
           overlayRef.current.style.display = 'none';
        } else {
           overlayRef.current.style.display = 'block';
           overlayRef.current.style.left = `${left}%`;
           overlayRef.current.style.width = `${width}%`;
        }
      }
    }
  }, [selectionStart, selectionEnd, viewStartTime, viewEndTime, buffer]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!buffer || !canvasRef.current || !containerRef.current) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    let dragStart = viewStartTime + (x / rect.width) * (viewEndTime - viewStartTime);
    
    updateModalTrack({
      isDragging: true,
      dragStartSeconds: Math.max(0, dragStart),
      selectionStart: Math.max(0, dragStart),
      selectionEnd: Math.max(0, dragStart)
    });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!buffer || !canvasRef.current || !modalTrack.isDragging) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    let currentSeconds = viewStartTime + (x / rect.width) * (viewEndTime - viewStartTime);
    currentSeconds = Math.max(0, Math.min(buffer.duration, currentSeconds));
    
    const dragStart = modalTrack.dragStartSeconds;
    updateModalTrack({
      selectionStart: Math.min(dragStart, currentSeconds),
      selectionEnd: Math.max(dragStart, currentSeconds)
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    (e.target as Element).releasePointerCapture(e.pointerId);
    if (modalTrack.isDragging) {
      updateModalTrack({ isDragging: false });
    }
  };

  const pan = (direction: -1 | 1) => {
    if (!buffer) return;
    const panAmount = (viewEndTime - viewStartTime) * 0.25 * direction;
    let newStart = viewStartTime + panAmount;
    let newEnd = viewEndTime + panAmount;
    if (newStart < 0) { newEnd -= newStart; newStart = 0; }
    if (newEnd > buffer.duration) { newStart -= (newEnd - buffer.duration); newEnd = buffer.duration; }
    updateModalTrack({ viewStartTime: newStart, viewEndTime: newEnd });
  };

  const zoom = (factor: number) => {
    if (!buffer) return;
    const currentDuration = viewEndTime - viewStartTime;
    const center = viewStartTime + currentDuration / 2;
    let newDuration = currentDuration * factor;
    updateModalTrack({
      viewStartTime: Math.max(0, center - newDuration / 2),
      viewEndTime: Math.min(buffer.duration, center + newDuration / 2)
    });
  };

  const stopPlayback = () => {
    activePlaybackNodes.forEach(node => { try { node.stop(); } catch (e) {} node.disconnect(); });
    setActivePlaybackNodes([]);
    updateModalTrack({ sourceNode: null });
  };

  const playSelection = () => {
    if (!audioContext || !buffer) return;
    
    if (sourceNode || activePlaybackNodes.length > 0) {
      stopPlayback();
      return;
    }

    let duration = selectionEnd - selectionStart;
    if (duration <= 0.001) duration = buffer.duration - selectionStart;
    if (duration <= 0) return;

    const newSource = audioContext.createBufferSource();
    newSource.buffer = buffer;
    newSource.connect(audioContext.destination);
    newSource.onended = () => {
      // Small timeout to prevent immediate state override if stopped manually
      setTimeout(() => updateModalTrack({ sourceNode: null }), 10);
      setActivePlaybackNodes([]);
    };
    
    updateModalTrack({
      sourceNode: newSource,
      playbackStartTime: audioContext.currentTime,
      playbackOffset: selectionStart
    });
    
    newSource.playbackRate.value = currentPlaybackSpeed;
    newSource.start(0, selectionStart, duration);
    setActivePlaybackNodes([newSource]);
  };

  // Playhead animation
  useEffect(() => {
    let animationFrameId: number;
    const updatePlayhead = () => {
      if (modalTrack.sourceNode && audioContext) {
        const now = audioContext.currentTime;
        const currentPlayTime = modalTrack.playbackOffset + (now - modalTrack.playbackStartTime) * currentPlaybackSpeed;
        const progress = (currentPlayTime - modalTrack.viewStartTime) / (modalTrack.viewEndTime - modalTrack.viewStartTime);
        
        if (playheadRef.current) {
          if (progress >= 0 && progress <= 1) {
            playheadRef.current.style.left = `${progress * 100}%`;
            playheadRef.current.style.display = 'block';
          } else {
            playheadRef.current.style.display = 'none';
          }
        }
      } else {
        if (playheadRef.current) playheadRef.current.style.display = 'none';
      }
      animationFrameId = requestAnimationFrame(updatePlayhead);
    };
    
    if (modalTrack.sourceNode) {
      animationFrameId = requestAnimationFrame(updatePlayhead);
    } else {
      if (playheadRef.current) playheadRef.current.style.display = 'none';
    }
    
    return () => cancelAnimationFrame(animationFrameId);
  }, [modalTrack.sourceNode, modalTrack.playbackOffset, modalTrack.playbackStartTime, modalTrack.viewStartTime, modalTrack.viewEndTime, audioContext, currentPlaybackSpeed]);

  const handleAction = async (action: 'amplify' | 'cutout' | 'keep') => {
    if (!audioContext || !buffer) return;
    
    if (selectionEnd - selectionStart < 0.001) {
      alert("請先選取有效範圍！");
      return;
    }

    try {
      if (action === 'amplify') {
        const gainValue = prompt("請輸入音量放大倍率 (例如: 1.5 代表放大50%)", "1.5");
        if (!gainValue || isNaN(parseFloat(gainValue))) return;
        setLoading(true, "正在增強音量...");
        const newBuf = await amplifyBufferRegion(audioContext, buffer, selectionStart, selectionEnd, parseFloat(gainValue));
        updateModalTrack({ buffer: newBuf, selectionStart: 0, selectionEnd: newBuf.duration, viewStartTime: 0, viewEndTime: newBuf.duration });
        setLoading(false, "");
      }
      else if (action === 'cutout') {
        if (!confirm("確定要永久剪除選取區段嗎？")) return;
        setLoading(true, "正在剪除選區...");
        const newBuf = await cutoutBufferRegion(audioContext, buffer, selectionStart, selectionEnd);
        updateModalTrack({ buffer: newBuf, selectionStart: 0, selectionEnd: newBuf.duration, viewStartTime: 0, viewEndTime: newBuf.duration });
        setLoading(false, "");
      }
      else if (action === 'keep') {
        if (!confirm("確定要保留選取區段，並捨棄其餘部分嗎？")) return;
        setLoading(true, "正在保留選區...");
        const newBuf = sliceAudioBuffer(audioContext, buffer, selectionStart, selectionEnd);
        updateModalTrack({ buffer: newBuf, selectionStart: 0, selectionEnd: newBuf.duration, viewStartTime: 0, viewEndTime: newBuf.duration });
        setLoading(false, "");
      }
    } catch (e) {
      console.error(e);
      setLoading(false, `操作失敗: ${e}`);
    }
  };

  const handleSave = () => {
    if (!buffer || !editingClipId) return;
    setLoading(true, "正在套用變更...");
    
    // Update clips list
    setClips(clips.map(c => c.id === editingClipId ? { ...c, buffer } : c));
    
    // Update placed clips on mixer track
    setPlacedClips(placedClips.map(pc => pc.sourceClipId === editingClipId ? { ...pc, buffer } : pc));
    
    updateModalTrack({ editingClipId: null, buffer: null });
    setLoading(false, "變更已套用！");
  };

  const handleCancel = () => {
    stopPlayback();
    updateModalTrack({ editingClipId: null, buffer: null });
  };

  if (!editingClipId || !buffer) return null;

  const isSelected = selectionEnd - selectionStart > 0.001;

  return (
    <div className="fixed inset-0 bg-black/60 z-[1000] flex flex-col items-center justify-center p-4 backdrop-blur-sm transition-opacity">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl p-6 relative flex flex-col max-h-[90vh] animate-scale-in">
        <button onClick={handleCancel} className="absolute top-4 right-4 text-gray-400 hover:text-gray-800 transition-colors">
          <X size={24} />
        </button>
        <h3 className="text-xl font-bold mb-2 border-b pb-4 text-gray-800 flex justify-between items-center">
          編輯片段
          <span className="text-sm font-normal text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
             [{formatRulerTime(viewStartTime)} - {formatRulerTime(viewEndTime)}]
          </span>
        </h3>
        
        <div className="flex-grow overflow-auto py-4 flex flex-col gap-6">
          <div 
            className="waveform-container" 
            ref={containerRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          >
            <div ref={playheadRef} className="absolute w-[2px] h-full bg-danger top-0 left-0 pointer-events-none z-10 hidden" />
            <canvas ref={canvasRef} className="block w-full h-full" />
            <div ref={overlayRef} className="absolute top-0 h-full bg-primary/20 border-x-2 border-primary pointer-events-none box-border hidden" />
          </div>

          <div className="flex justify-center items-center gap-3">
            <button className="btn btn-default !py-1 text-sm" onClick={() => pan(-1)}>◀</button>
            <button className="btn btn-default !py-1 text-sm" onClick={() => zoom(2.0)}>-</button>
            <button className="btn btn-default !py-1 text-sm" onClick={() => zoom(0.5)}>+</button>
            <button className="btn btn-default !py-1 text-sm" onClick={() => pan(1)}>▶</button>
          </div>

          <div className="flex justify-center gap-6">
            <div className="flex flex-col">
              <label className="text-xs text-gray-500 mb-1">開始時間</label>
              <input type="number" step="0.001" min="0" className="border rounded px-3 py-1 text-right w-28 focus:outline-none focus:border-primary"
                value={selectionStart.toFixed(3)} onChange={(e) => updateModalTrack({ selectionStart: Math.max(0, parseFloat(e.target.value) || 0) })} />
            </div>
            <div className="flex flex-col">
              <label className="text-xs text-gray-500 mb-1">結束時間</label>
              <input type="number" step="0.001" min="0" className="border rounded px-3 py-1 text-right w-28 focus:outline-none focus:border-primary"
                value={selectionEnd.toFixed(3)} onChange={(e) => updateModalTrack({ selectionEnd: Math.max(0, parseFloat(e.target.value) || 0) })} />
            </div>
          </div>

          <div className="card !p-4 bg-gray-50/50">
            <h4 className="font-semibold text-gray-700 mb-3 text-sm">操作選區 (此處操作會修改片段本身)</h4>
            <div className="flex flex-wrap justify-center gap-3">
              <button disabled={!isSelected} className="btn btn-warning flex-1 max-w-[120px]" onClick={() => handleAction('amplify')}>
                <Volume2 size={16}/> 增強
              </button>
              <button disabled={!isSelected} className="btn btn-danger flex-1 max-w-[120px]" onClick={() => handleAction('cutout')}>
                <Scissors size={16}/> 剪除
              </button>
              <button disabled={!isSelected} className="btn btn-primary flex-1 max-w-[120px]" onClick={() => handleAction('keep')}>
                <Target size={16}/> 保留
              </button>
            </div>
          </div>
        </div>

        <div className="flex justify-between items-center pt-4 border-t mt-auto">
          <button className={`btn ${sourceNode ? 'btn-danger' : 'btn-default'}`} onClick={playSelection}>
            {sourceNode ? <Pause size={18}/> : <Play size={18}/>}
            {sourceNode ? '暫停' : '播放片段'}
          </button>
          <div className="flex gap-3">
            <button className="btn btn-default" onClick={handleCancel}>
              <X size={18} /> 取消
            </button>
            <button className="btn btn-primary" onClick={handleSave}>
              <Check size={18} /> 套用至列表
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
