import { useEffect, useRef, useState } from 'react';
import { useAudioStore } from '../store/useAudioStore';
import { drawWaveform, drawSecondaryWaveform, formatRulerTime } from '../utils/waveformDraw';
import { Play, Pause, Scissors, Volume2, Target, Search, Layers, X, AlignLeft, Download } from 'lucide-react';
import { amplifyBufferRegion, cutoutBufferRegion, sliceAudioBuffer, findSegmentsByVolume, findSegmentsByFrequency, estimateFrequencyAtTime } from '../utils/audioOperations';
import { bufferToWav, bufferToMp3 } from '../utils/audioExport';
import type { Segment } from '../types/audio';
import MixerTrack from './MixerTrack';

export default function MainEditor() {
  const { 
    mainTrack, 
    updateMainTrack, 
    audioContext,
    setLoading,
    clips,
    setClips,
    foundSegments,
    currentSegmentIndex,
    setSegmentsState,
    currentPlaybackSpeed,
    speedLastUpdate,
    speedAccumulatedTime,
    globalHoverTime,
    setGlobalHoverTime,
    globalHoverHz,
    setGlobalHoverHz,
    pushHistory,
    undo,
    redo,
    mainTrackHistory,
    mainTrackRedoHistory,
    settings,
    showMixerOnMain,
    setShowMixerOnMain,
    showAllSearchTargets,
    setShowAllSearchTargets,
    placedClips
  } = useAudioStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mixerCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  
  const [searchType, setSearchType] = useState<'volume' | 'frequency'>('volume');
  const [freqBand, setFreqBand] = useState<'low' | 'high'>('low');
  const [threshold, setThreshold] = useState(0.1);
  const [minDur, setMinDur] = useState(0.5);

  const [showMobileOps, setShowMobileOps] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [useMinSec, setUseMinSec] = useState(false); // 時間格式: false=秒, true=分:秒
  const isSelectionActive = (mainTrack.selectionEnd - mainTrack.selectionStart) > 0.001;

  // Drawing waveform
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas || !mainTrack.buffer) return;

    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          canvas.width = width;
          canvas.height = height;
          drawWaveform({
            canvas,
            buffer: mainTrack.buffer!,
            viewStartTime: mainTrack.viewStartTime,
            viewEndTime: mainTrack.viewEndTime,
            isMain: true,
            rulerHeight: 20
          });
          
          if (mixerCanvasRef.current) {
             mixerCanvasRef.current.width = width;
             mixerCanvasRef.current.height = height;
             if (showMixerOnMain) {
                drawSecondaryWaveform(mixerCanvasRef.current, placedClips, mainTrack.viewStartTime, mainTrack.viewEndTime);
             }
          }
        }
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [mainTrack.buffer, mainTrack.viewStartTime, mainTrack.viewEndTime, showMixerOnMain, placedClips]);

  // Redraw secondary waveform when clips or toggle changes
  useEffect(() => {
    if (mixerCanvasRef.current && mainTrack.buffer) {
       if (showMixerOnMain) {
          mixerCanvasRef.current.width = canvasRef.current?.width || 0;
          mixerCanvasRef.current.height = canvasRef.current?.height || 0;
          drawSecondaryWaveform(mixerCanvasRef.current, placedClips, mainTrack.viewStartTime, mainTrack.viewEndTime);
       } else {
          const ctx = mixerCanvasRef.current.getContext('2d');
          if (ctx) ctx.clearRect(0, 0, mixerCanvasRef.current.width, mixerCanvasRef.current.height);
       }
    }
  }, [placedClips, showMixerOnMain, mainTrack.viewStartTime, mainTrack.viewEndTime, mainTrack.buffer]);

  // Update selection overlay & playhead visibility
  useEffect(() => {
    const { selectionStart, selectionEnd, viewStartTime, viewEndTime } = mainTrack;
    if (overlayRef.current) {
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
  }, [mainTrack.selectionStart, mainTrack.selectionEnd, mainTrack.viewStartTime, mainTrack.viewEndTime]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!mainTrack.buffer || !canvasRef.current) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Ignore clicking on the ruler area (top 20px)
    if (y < 20) return;

    let dragStart = mainTrack.viewStartTime + (x / rect.width) * (mainTrack.viewEndTime - mainTrack.viewStartTime);
    dragStart = Math.max(0, dragStart);

    updateMainTrack({
      isDragging: true,
      dragStartSeconds: dragStart,
      selectionStart: dragStart,
      selectionEnd: dragStart
    });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!mainTrack.buffer || !canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    
    let currentSeconds = mainTrack.viewStartTime + (x / rect.width) * (mainTrack.viewEndTime - mainTrack.viewStartTime);
    
    // Hover logic
    if (currentSeconds >= 0 && currentSeconds <= mainTrack.buffer.duration) {
      setGlobalHoverTime(currentSeconds);
      if (settings.showHoverHz) {
        setGlobalHoverHz(estimateFrequencyAtTime(mainTrack.buffer, currentSeconds));
      } else {
        setGlobalHoverHz(null);
      }
    } else {
      setGlobalHoverTime(null);
      setGlobalHoverHz(null);
    }

    // Drag logic
    if (mainTrack.isDragging) {
      currentSeconds = Math.max(0, Math.min(mainTrack.buffer.duration, currentSeconds));
      const dragStart = mainTrack.dragStartSeconds;
      
      updateMainTrack({
        selectionStart: Math.min(dragStart, currentSeconds),
        selectionEnd: Math.max(dragStart, currentSeconds)
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    (e.target as Element).releasePointerCapture(e.pointerId);
    if (mainTrack.isDragging) {
      updateMainTrack({ isDragging: false });
      const duration = mainTrack.selectionEnd - mainTrack.selectionStart;
      if (settings.mobileModalMode && duration > 0.001) {
        setShowMobileOps(true);
      }
    }
  };

  const pan = (direction: -1 | 1) => {
    if (!mainTrack.buffer) return;
    const panAmount = (mainTrack.viewEndTime - mainTrack.viewStartTime) * 0.25 * direction;
    let newStart = mainTrack.viewStartTime + panAmount;
    let newEnd = mainTrack.viewEndTime + panAmount;
    
    if (newStart < 0) {
      newEnd -= newStart;
      newStart = 0;
    }
    if (newEnd > mainTrack.buffer.duration) {
      newStart -= (newEnd - mainTrack.buffer.duration);
      newEnd = mainTrack.buffer.duration;
    }
    updateMainTrack({ viewStartTime: newStart, viewEndTime: newEnd });
  };

  const zoom = (factor: number) => {
    if (!mainTrack.buffer) return;
    const currentDuration = mainTrack.viewEndTime - mainTrack.viewStartTime;
    // 如果有選取範圍，以選取範圍中心為基準縮放；否則以視圖中心
    const selActive = isSelectionActive;
    const center = selActive
      ? (mainTrack.selectionStart + mainTrack.selectionEnd) / 2
      : mainTrack.viewStartTime + currentDuration / 2;
    let newDuration = currentDuration * factor;
    newDuration = Math.max(0.01, Math.min(newDuration, mainTrack.buffer.duration));
    
    updateMainTrack({
      viewStartTime: Math.max(0, center - newDuration / 2),
      viewEndTime: Math.min(mainTrack.buffer.duration, center + newDuration / 2)
    });
  };

  // 全選整個主音軌
  const selectAll = () => {
    if (!mainTrack.buffer) return;
    updateMainTrack({
      selectionStart: 0,
      selectionEnd: mainTrack.buffer.duration,
    });
  };

  // 匯出選取範圍（如有選取）或整個主音軌
  const handleExportMain = async () => {
    if (!mainTrack.buffer || !audioContext) return;
    const format = prompt("請選擇匯出格式：'mp3' 或 'wav'", "mp3")?.toLowerCase();
    if (!format || (format !== 'mp3' && format !== 'wav')) return;

    const hasSelection = isSelectionActive;
    const label = hasSelection ? '選取範圍' : '整個音軌';
    setLoading(true, `正在匯出 ${label} 為 ${format.toUpperCase()}...`);
    await new Promise(r => setTimeout(r, 50));
    try {
      const exportBuffer = hasSelection
        ? sliceAudioBuffer(audioContext, mainTrack.buffer, mainTrack.selectionStart, mainTrack.selectionEnd)
        : mainTrack.buffer;
      const blob = format === 'mp3' ? bufferToMp3(exportBuffer) : bufferToWav(exportBuffer);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `SoundCut_${hasSelection ? 'selection' : 'full'}_${Date.now()}.${format}`;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
      setLoading(false, `${label}匯出成功！`);
    } catch (e) {
      console.error(e);
      setLoading(false, '匯出時發生錯誤。');
    }
  };

  // 將秒數轉換為分:秒格式字串
  const secondsToMinSec = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = (s - m * 60).toFixed(2).padStart(5, '0');
    return `${m}:${sec}`;
  };

  // 將分:秒格式字串轉換為秒數
  const minSecToSeconds = (str: string): number => {
    const parts = str.split(':');
    if (parts.length === 2) {
      const m = parseFloat(parts[0]) || 0;
      const sec = parseFloat(parts[1]) || 0;
      return m * 60 + sec;
    }
    return parseFloat(str) || 0;
  };

  const playSelection = () => {
    useAudioStore.getState().toggleMainPlayback();
  };

  // Playhead animation frame requires a separate flow or direct ref modification for performance
  useEffect(() => {
    let animationFrameId: number;
    const updatePlayhead = () => {
      if (mainTrack.sourceNode && audioContext) {
        const now = audioContext.currentTime;
        const bufferDuration = speedAccumulatedTime + (now - speedLastUpdate) * currentPlaybackSpeed;
        const currentPlayTime = mainTrack.playbackOffset + bufferDuration;
        
        const { viewStartTime, viewEndTime } = mainTrack;
        const progress = (currentPlayTime - viewStartTime) / (viewEndTime - viewStartTime);
        
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
    
    if (mainTrack.sourceNode) {
      animationFrameId = requestAnimationFrame(updatePlayhead);
    } else {
      if (playheadRef.current) playheadRef.current.style.display = 'none';
    }
    
    return () => cancelAnimationFrame(animationFrameId);
  }, [mainTrack.sourceNode, mainTrack.playbackOffset, mainTrack.viewStartTime, mainTrack.viewEndTime, audioContext, currentPlaybackSpeed, speedAccumulatedTime, speedLastUpdate]);

  const handleAction = async (action: 'extract' | 'amplify' | 'cutout' | 'keep') => {
    if (!audioContext || !mainTrack.buffer) return;
    
    const { selectionStart, selectionEnd } = mainTrack;
    if (selectionEnd - selectionStart < 0.001 && action !== 'extract') {
      alert("請先選取有效範圍！");
      return;
    }

    try {
      if (action === 'extract') {
        setLoading(true, "正在提取片段...");
        const sliced = sliceAudioBuffer(audioContext, mainTrack.buffer, selectionStart, selectionEnd);
        setClips([...clips, { id: Date.now(), name: `片段 ${clips.length + 1}`, buffer: sliced }]);
        setLoading(false, '片段已成功提取至列表！');
      } 
      else if (action === 'amplify') {
        const gainValue = prompt("請輸入音量放大倍率 (例如: 1.5 代表放大50%)", "1.5");
        if (!gainValue || isNaN(parseFloat(gainValue))) return;
        pushHistory(mainTrack.buffer);
        setLoading(true, "正在增強音量...");
        const newBuf = await amplifyBufferRegion(audioContext, mainTrack.buffer, selectionStart, selectionEnd, parseFloat(gainValue));
        updateMainTrack({ buffer: newBuf, selectionStart: mainTrack.selectionStart, selectionEnd: mainTrack.selectionEnd, viewStartTime: mainTrack.viewStartTime, viewEndTime: mainTrack.viewEndTime });
        setLoading(false, '音量已增強！');
      }
      else if (action === 'cutout') {
        if (!confirm("確定要永久剪除選取區段嗎？")) return;
        pushHistory(mainTrack.buffer);
        setLoading(true, "正在剪除選區...");
        const newBuf = await cutoutBufferRegion(audioContext, mainTrack.buffer, selectionStart, selectionEnd);
        updateMainTrack({ buffer: newBuf, selectionStart: 0, selectionEnd: newBuf.duration, viewStartTime: 0, viewEndTime: newBuf.duration });
        setLoading(false, '選區已剪除！');
      }
      else if (action === 'keep') {
        if (!confirm("確定要保留選取區段，並捨棄其餘部分嗎？")) return;
        pushHistory(mainTrack.buffer);
        setLoading(true, "正在保留選區...");
        const newBuf = sliceAudioBuffer(audioContext, mainTrack.buffer, selectionStart, selectionEnd);
        updateMainTrack({ buffer: newBuf, selectionStart: 0, selectionEnd: newBuf.duration, viewStartTime: 0, viewEndTime: newBuf.duration });
        setLoading(false, '選區已保留！');
      }
    } catch (e) {
      console.error(e);
      setLoading(false, `操作失敗: ${e}`);
    }
  };

  // Global Keyboard Shortcuts for Editor
  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;

      const key = e.key.toLowerCase();
      const s = settings.shortcuts;
      
      if (key === s.extract) { e.preventDefault(); handleAction('extract'); return; }
      if (key === s.amplify) { e.preventDefault(); handleAction('amplify'); return; }
      if (key === s.cutout) { e.preventDefault(); handleAction('cutout'); return; }
      if (key === s.keep) { e.preventDefault(); handleAction('keep'); return; }
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [settings.shortcuts, handleAction]);

  const performSearch = async () => {
    if (!mainTrack.buffer) return;
    setLoading(true, "分析中...");
    
    // allow microtask UI update
    requestAnimationFrame(async () => {
      setSegmentsState([], -1);
      setShowSearchModal(false);
      
      let segments: Segment[] = [];
      if (searchType === 'volume') {
        segments = await findSegmentsByVolume(mainTrack.buffer!, threshold, minDur);
      } else {
        segments = await findSegmentsByFrequency(mainTrack.buffer!, threshold, freqBand, minDur);
      }
      
      setLoading(false, segments.length > 0 ? `智慧尋找完成，共找到 ${segments.length} 個區段。` : '符合條件的區段為 0 個。');
      
      if (segments.length > 0) {
        setSegmentsState(segments, 0);
        updateMainTrack({
          selectionStart: segments[0].start,
          selectionEnd: segments[0].end,
          viewStartTime: Math.max(0, segments[0].start - 1),
          viewEndTime: Math.min(mainTrack.buffer!.duration, segments[0].end + 1)
        });
        setShowAllSearchTargets(true); // Default show all targets when search is done
        if (settings.mobileModalMode) setShowMobileOps(true);
      }
    });
  };

  const jumpToSegment = (index: number) => {
    if (foundSegments.length === 0) return;
    const newIndex = (index + foundSegments.length) % foundSegments.length;
    setSegmentsState(foundSegments, newIndex);
    updateMainTrack({
      selectionStart: foundSegments[newIndex].start,
      selectionEnd: foundSegments[newIndex].end,
      viewStartTime: Math.max(0, foundSegments[newIndex].start - 1),
      viewEndTime: Math.min(mainTrack.buffer!.duration, foundSegments[newIndex].end + 1)
    });
  };

  const renderSearchControls = () => (
    <div className="flex flex-col gap-3 p-4 bg-gray-50 rounded-lg border border-gray-100">
      <div className="flex items-center gap-3">
        <Target size={18} className="text-gray-500 hidden sm:block" />
        <select className="input !py-1" value={searchType} onChange={e => setSearchType(e.target.value as any)}>
          <option value="volume">依音量尋找靜音段</option>
          <option value="frequency">依頻率尋找聲音</option>
        </select>
        {searchType === 'frequency' && (
          <select className="input !py-1" value={freqBand} onChange={e => setFreqBand(e.target.value as any)}>
            <option value="low">低頻段 (&lt; 300Hz)</option>
            <option value="high">高頻段 (&gt; 3000Hz)</option>
          </select>
        )}
      </div>
      
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <span className="whitespace-nowrap">閾值:</span>
          <input type="number" step="0.01" value={threshold} onChange={e => setThreshold(parseFloat(e.target.value))} className="input !py-1 w-20" />
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <span className="whitespace-nowrap">最短(秒):</span>
          <input type="number" step="0.1" value={minDur} onChange={e => setMinDur(parseFloat(e.target.value))} className="input !py-1 w-20" />
        </label>
        <button className="btn btn-primary sm:ml-auto w-full sm:w-auto" onClick={performSearch}>
          <Search size={16} /> 執行尋找
        </button>
      </div>

      {foundSegments.length > 0 && typeof currentSegmentIndex === 'number' && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mt-2 pt-3 border-t gap-3">
          <div className="text-sm font-medium text-gray-700">
            結果: 第 {currentSegmentIndex + 1} / {foundSegments.length} 段
          </div>
          <div className="flex gap-2">
            <button className="btn btn-default !py-1" onClick={() => setShowAllSearchTargets(!showAllSearchTargets)}>
              {showAllSearchTargets ? '隱藏目標標記' : '顯示全目標標記'}
            </button>
            <button className="btn btn-default !py-1" onClick={() => jumpToSegment(currentSegmentIndex - 1)}>上一段</button>
            <button className="btn btn-default !py-1" onClick={() => jumpToSegment(currentSegmentIndex + 1)}>下一段</button>
          </div>
        </div>
      )}
    </div>
  );

  const renderOperationsControls = () => (
    <div className="flex flex-wrap gap-2">
      <button className="btn btn-default flex-1 sm:flex-none" onClick={selectAll} title="全選整個音軌" disabled={!mainTrack.buffer}>
        <AlignLeft size={16} /> 全選
      </button>
      <button className="btn btn-primary flex-1 sm:flex-none" onClick={playSelection}>
        {mainTrack.sourceNode ? <Pause size={18} /> : <Play size={18} />}
      </button>
      <button className="btn btn-default" onClick={() => handleAction('extract')} disabled={!isSelectionActive} title="複製到右側清單">
        <Scissors size={16} className="text-primary" /> 提取
      </button>
      <button className="btn btn-default" onClick={() => handleAction('amplify')} disabled={!isSelectionActive}>
        <Volume2 size={16} className="text-primary" /> 增強
      </button>
      <button className="btn btn-danger" onClick={() => handleAction('cutout')} disabled={!isSelectionActive}>
        剪除
      </button>
      <button className="btn btn-warning" onClick={() => handleAction('keep')} disabled={!isSelectionActive}>
        保留
      </button>
      <button className="btn btn-default" onClick={handleExportMain} disabled={!mainTrack.buffer} title={isSelectionActive ? '匯出選取範圍' : '匯出整個音軌'}>
        <Download size={16} className="text-primary" /> {isSelectionActive ? '匯出選區' : '匯出'}
      </button>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Waveform View & MixerTrack Container */}
      <div className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm flex-shrink-0 flex flex-col">
        
        {/* Main Track Header */}
        <div className="flex justify-between items-center px-4 py-2 bg-white border-b relative z-10">
          <div className="font-bold text-sm text-gray-700">主音軌</div>
          <div className="text-xs text-gray-500 font-mono">
            視圖範圍: [{formatRulerTime(mainTrack.viewStartTime)} - {formatRulerTime(mainTrack.viewEndTime)}]
          </div>
        </div>

        {/* Main Waveform Area */}
        <div 
          className="waveform-container relative w-full h-48 sm:h-64 bg-gray-50 border-b flex-shrink-0" 
          ref={containerRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={() => { handlePointerUp({} as any); setGlobalHoverTime(null); setGlobalHoverHz(null); }}
        >
          {/* Canvas (Base Layer) */}
          <canvas ref={canvasRef} className="block w-full h-full relative z-0" />
          
          {/* Secondary Canvas for Mixer Overlay */}
          <canvas ref={mixerCanvasRef} className={`absolute top-0 left-0 w-full h-full pointer-events-none z-0 mix-blend-multiply opacity-80 ${showMixerOnMain ? 'block' : 'hidden'}`} />
          
          {/* Overlays (Interactive & Visual Layers on top of Canvas) */}
          <div className="absolute inset-0 pointer-events-none z-10">
            {/* Playhead (Red) */}
            <div ref={playheadRef} className="absolute w-[2px] h-full bg-danger top-0 left-0 hidden shadow-[0_0_4px_rgba(239,68,68,0.8)] z-30" />
            
            {/* Selection Start Orange Cursor */}
            {!mainTrack.sourceNode && mainTrack.selectionStart >= mainTrack.viewStartTime && mainTrack.selectionStart <= mainTrack.viewEndTime && (
               <div 
                 className="absolute w-[2px] h-full bg-orange-500 top-0 shadow-[0_0_4px_rgba(249,115,22,0.8)] z-30" 
                 style={{ left: `${((mainTrack.selectionStart - mainTrack.viewStartTime) / (mainTrack.viewEndTime - mainTrack.viewStartTime)) * 100}%` }}
               >
                 <div className="absolute top-6 left-0 transform -translate-x-1/2 bg-orange-500 text-white px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap shadow-sm min-w-max pointer-events-auto">
                   {formatRulerTime(mainTrack.selectionStart)}
                 </div>
               </div>
            )}

            {/* Search Targets Green Overlay */}
            {showAllSearchTargets && foundSegments.map((seg, idx) => {
              if (seg.end < mainTrack.viewStartTime || seg.start > mainTrack.viewEndTime) return null;
              const left = Math.max(0, ((seg.start - mainTrack.viewStartTime) / (mainTrack.viewEndTime - mainTrack.viewStartTime)) * 100);
              const right = Math.min(100, ((seg.end - mainTrack.viewStartTime) / (mainTrack.viewEndTime - mainTrack.viewStartTime)) * 100);
              const width = right - left;
              return (
                <div key={`search-${idx}`} 
                     className={`absolute top-0 h-full box-border shadow-sm z-10 ${
                       idx === currentSegmentIndex 
                         ? 'bg-green-400/60 border-x-2 border-green-600' 
                         : 'bg-green-300/40 border-r border-green-500/50'
                     }`} 
                     style={{ left: `${left}%`, width: `${width}%` }} />
              );
            })}

            {/* Hover indicator */}
            {globalHoverTime !== null && globalHoverTime >= mainTrack.viewStartTime && globalHoverTime <= mainTrack.viewEndTime && (
              <div 
                className="absolute w-[2px] h-full bg-secondary top-0 z-20" 
                style={{ left: `${((globalHoverTime - mainTrack.viewStartTime) / (mainTrack.viewEndTime - mainTrack.viewStartTime)) * 100}%` }}
              >
                <div className="absolute top-1 left-0 transform -translate-x-1/2 bg-black/80 text-white px-2 py-0.5 rounded text-[10px] whitespace-nowrap min-w-max flex flex-col items-center">
                  <span>{formatRulerTime(globalHoverTime)}</span>
                  {settings.showHoverHz && globalHoverHz !== null && (
                    <span className="text-secondary-light font-mono opacity-90">{globalHoverHz} Hz</span>
                  )}
                </div>
              </div>
            )}
            
            {/* Selection Overlay */}
            <div ref={overlayRef} className="absolute top-5 h-[calc(100%-20px)] bg-yellow-300/30 border-x-2 border-yellow-500 box-border hidden z-20 pointer-events-none shadow-[inset_0_0_10px_rgba(234,179,8,0.2)]" />
          </div>
        </div>

        {/* MixerTrack Integrated directly below Main Track */}
        <div className="flex-shrink-0">
           {mainTrack.buffer && <MixerTrack />}
        </div>

        {/* Zoom & Pan Controls */}
        <div className="flex flex-col sm:flex-row justify-between items-center bg-white p-2 px-4 gap-4 border-t">
          <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0 hide-scrollbar">
             <button className="btn btn-default !px-3 flex-shrink-0 !py-1 text-sm" disabled={mainTrackHistory.length === 0} onClick={undo} title="復原 (Ctrl+Z)">↶ 復原</button>
             <button className="btn btn-default !px-3 flex-shrink-0 !py-1 text-sm" disabled={mainTrackRedoHistory.length === 0} onClick={redo} title="重做 (Ctrl+Y)">↷ 重做</button>
             <div className="w-px h-6 bg-gray-300 mx-1"></div>
             <button className={`btn !px-3 flex-shrink-0 !py-1 text-sm font-semibold transition-colors ${showMixerOnMain ? 'bg-primary text-white border-primary' : 'btn-default'}`} onClick={() => setShowMixerOnMain(!showMixerOnMain)} title="在主音軌疊加顯示混音軌道以便對齊">
               <Layers size={14} className="inline mr-1 -mt-0.5" /> 顯示混音
             </button>
             {settings.mobileModalMode && (
               <>
                 <div className="w-px h-6 bg-gray-300 mx-1"></div>
                 <button className="btn btn-default !px-3 flex-shrink-0 !py-1 text-sm text-secondary border-secondary" onClick={() => setShowSearchModal(true)}>
                   <Search size={14} className="inline mr-1 -mt-0.5" /> 尋找 ({foundSegments.length})
                 </button>
               </>
             )}
          </div>
          <div className="flex justify-center items-center gap-2 flex-shrink-0">
            <button className="btn btn-default !py-1 text-sm" onClick={() => pan(-1)}>◀ 左移</button>
            <button className="btn btn-default !py-1 text-sm hidden sm:block" onClick={() => zoom(2.0)}>- 縮小</button>
            <button className="btn btn-default !py-1 text-sm hidden sm:block" onClick={() => zoom(0.5)}>+ 放大</button>
            <button className="btn btn-default !py-1 text-sm" onClick={() => pan(1)}>右移 ▶</button>
          </div>
        </div>
        
        {/* Manual Time Inputs */}
        <div className="bg-gray-50 border-t p-2 px-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-600">
          <div className="flex flex-wrap items-center gap-3">
             <label className="flex items-center gap-2 font-medium border-none shadow-none text-gray-700 bg-transparent">
               選取起點:
               {useMinSec ? (
                 <input
                   type="text"
                   className="input !py-1 w-24 font-mono text-right bg-white"
                   value={secondsToMinSec(mainTrack.selectionStart)}
                   onChange={e => {
                     const v = minSecToSeconds(e.target.value);
                     if (!isNaN(v)) updateMainTrack({ selectionStart: Math.min(v, mainTrack.selectionEnd) });
                   }}
                   placeholder="m:ss.xx"
                 />
               ) : (
                 <input 
                   type="number" step="0.1" min="0" 
                   className="input !py-1 w-20 font-mono text-right bg-white"
                   value={mainTrack.selectionStart.toFixed(2)}
                   onChange={e => {
                     const v = parseFloat(e.target.value);
                     if(!isNaN(v)) updateMainTrack({ selectionStart: Math.min(v, mainTrack.selectionEnd) });
                   }}
                 />
               )}
             </label>
             <label className="flex items-center gap-2 font-medium border-none shadow-none text-gray-700 bg-transparent">
               選取終點:
               {useMinSec ? (
                 <input
                   type="text"
                   className="input !py-1 w-24 font-mono text-right bg-white"
                   value={secondsToMinSec(mainTrack.selectionEnd)}
                   onChange={e => {
                     const v = minSecToSeconds(e.target.value);
                     if (!isNaN(v)) updateMainTrack({ selectionEnd: Math.max(v, mainTrack.selectionStart) });
                   }}
                   placeholder="m:ss.xx"
                 />
               ) : (
                 <input 
                   type="number" step="0.1" min="0" 
                   className="input !py-1 w-20 font-mono text-right bg-white"
                   value={mainTrack.selectionEnd.toFixed(2)}
                   onChange={e => {
                     const v = parseFloat(e.target.value);
                     if(!isNaN(v)) updateMainTrack({ selectionEnd: Math.max(v, mainTrack.selectionStart) });
                   }}
                 />
               )}
             </label>
             <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
               <input
                 type="checkbox"
                 className="w-3.5 h-3.5 text-primary rounded cursor-pointer"
                 checked={useMinSec}
                 onChange={e => setUseMinSec(e.target.checked)}
               />
               分:秒格式
             </label>
          </div>
          {mainTrack.buffer && (
            <span className="font-mono bg-white border border-gray-200 px-3 py-1 rounded-full whitespace-nowrap text-xs shadow-sm">
              總時長: {secondsToMinSec(mainTrack.buffer.duration)}
            </span>
          )}
        </div>
      </div>

      {/* Operation Actions Panel (Hidden if mobileModalMode unless presented as Modal) */}
      {!settings.mobileModalMode && (
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 space-y-4">
          <div className="flex flex-col md:flex-row gap-6">
            <div className="flex-1">
              <h3 className="font-semibold text-gray-700 mb-3 text-sm">操作選區 / 播放</h3>
              {renderOperationsControls()}
            </div>
            
            <div className="flex-1">
              <h3 className="font-semibold text-gray-700 mb-3 text-sm">
                智慧尋找 
                {foundSegments.length > 0 && <span className="ml-2 text-xs bg-success/10 text-success px-2 py-0.5 rounded-full inline-block">{foundSegments.length} 處符合</span>}
              </h3>
              {renderSearchControls()}
            </div>
          </div>
        </div>
      )}

      {/* Modals for Mobile Mode */}
      {settings.mobileModalMode && showMobileOps && isSelectionActive && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-auto p-4 bg-black/30 backdrop-blur-sm" onClick={() => setShowMobileOps(false)}>
           <div className="bg-white rounded-xl shadow-2xl p-6 relative w-full max-w-sm animate-scale-in" onClick={e => e.stopPropagation()}>
             <h3 className="font-bold text-lg mb-4 text-center">選區操作</h3>
             <div className="flex flex-col gap-3">
                {renderOperationsControls()}
                <button className="btn btn-default mt-2 border-gray-200" onClick={() => setShowMobileOps(false)}>取消</button>
             </div>
           </div>
        </div>
      )}

      {settings.mobileModalMode && showSearchModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-auto p-4 bg-black/30 backdrop-blur-sm" onClick={() => setShowSearchModal(false)}>
           <div className="bg-white rounded-xl shadow-2xl p-6 relative w-full max-w-md animate-scale-in" onClick={e => e.stopPropagation()}>
             <button className="absolute top-4 right-4 text-gray-400 hover:text-gray-800" onClick={() => setShowSearchModal(false)}>
               <X size={20} />
             </button>
             <h3 className="font-bold text-lg mb-4">目標尋找器</h3>
             {renderSearchControls()}
           </div>
        </div>
      )}

    </div>
  );
}
