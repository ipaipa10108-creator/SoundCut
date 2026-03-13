import { useEffect, useRef, useState } from 'react';
import { useAudioStore } from '../store/useAudioStore';
import { drawWaveform, formatRulerTime } from '../utils/waveformDraw';
import { Play, Pause, Scissors, Volume2, Target, Search, Layers, X } from 'lucide-react';
import { amplifyBufferRegion, cutoutBufferRegion, sliceAudioBuffer, findSegmentsByVolume, findSegmentsByFrequency } from '../utils/audioOperations';
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
  const overlayRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  
  const [searchType, setSearchType] = useState<'volume' | 'frequency'>('volume');
  const [freqBand, setFreqBand] = useState<'low' | 'high'>('low');
  const [threshold, setThreshold] = useState(0.1);
  const [minDur, setMinDur] = useState(0.5);

  const [showMobileOps, setShowMobileOps] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
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
        }
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [mainTrack.buffer, mainTrack.viewStartTime, mainTrack.viewEndTime]);

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
    } else {
      setGlobalHoverTime(null);
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
    const center = mainTrack.viewStartTime + currentDuration / 2;
    let newDuration = currentDuration * factor;
    newDuration = Math.max(0.01, Math.min(newDuration, mainTrack.buffer.duration));
    
    updateMainTrack({
      viewStartTime: Math.max(0, center - newDuration / 2),
      viewEndTime: Math.min(mainTrack.buffer.duration, center + newDuration / 2)
    });
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
        updateMainTrack({ buffer: newBuf, selectionStart: 0, selectionEnd: newBuf.duration, viewStartTime: 0, viewEndTime: newBuf.duration });
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
          onPointerLeave={() => { handlePointerUp({} as any); setGlobalHoverTime(null); }}
        >
          {/* Canvas (Base Layer) */}
          <canvas ref={canvasRef} className="block w-full h-full" />
          
          {/* Overlays (Interactive & Visual Layers on top of Canvas) */}
          <div className="absolute inset-0 pointer-events-none z-10">
            {/* Playhead (Red) */}
            <div ref={playheadRef} className="absolute w-[2px] h-full bg-danger top-0 left-0 hidden" />
            
            {/* Selection Start Orange Cursor */}
            {!mainTrack.sourceNode && mainTrack.selectionStart >= mainTrack.viewStartTime && mainTrack.selectionStart <= mainTrack.viewEndTime && (
               <div 
                 className="absolute w-[2px] h-full bg-orange-500 top-0" 
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
                <div key={`search-${idx}`} className={`absolute top-0 h-full ${idx === currentSegmentIndex ? 'bg-success/40' : 'bg-success/20 border-r border-success/30'}`} style={{ left: `${left}%`, width: `${width}%` }} />
              );
            })}

            {/* Mixer Overlay (Show Mixed on Main) */}
            {showMixerOnMain && placedClips.map((pClip) => {
              if (pClip.startTime + pClip.buffer.duration < mainTrack.viewStartTime || pClip.startTime > mainTrack.viewEndTime) return null;
              const left = Math.max(0, ((pClip.startTime - mainTrack.viewStartTime) / (mainTrack.viewEndTime - mainTrack.viewStartTime)) * 100);
              const right = Math.min(100, (((pClip.startTime + pClip.buffer.duration) - mainTrack.viewStartTime) / (mainTrack.viewEndTime - mainTrack.viewStartTime)) * 100);
              const width = right - left;
              return (
                <div key={`mixer-overlay-${pClip.id}`} className="absolute top-1/2 bottom-0 border border-primary/40 bg-primary/20 rounded-t-sm flex items-end overflow-hidden" style={{ left: `${left}%`, width: `${width}%` }}>
                   <p className="text-[10px] text-primary font-bold px-1 whitespace-nowrap truncate mb-1">混音: {clips.find(c => c.id === pClip.sourceClipId)?.name || '片段'}</p>
                </div>
              );
            })}

            {/* Hover indicator */}
            {globalHoverTime !== null && globalHoverTime >= mainTrack.viewStartTime && globalHoverTime <= mainTrack.viewEndTime && (
              <div 
                className="absolute w-[2px] h-full bg-secondary top-0 z-[5]" 
                style={{ left: `${((globalHoverTime - mainTrack.viewStartTime) / (mainTrack.viewEndTime - mainTrack.viewStartTime)) * 100}%` }}
              >
                <div className="absolute top-1 left-0 transform -translate-x-1/2 bg-black/80 text-white px-2 py-0.5 rounded text-[10px] whitespace-nowrap min-w-max">
                  {formatRulerTime(globalHoverTime)}
                </div>
              </div>
            )}
            
            {/* Selection Overlay */}
            <div ref={overlayRef} className="absolute top-5 h-[calc(100%-20px)] bg-primary/20 border-x-2 border-primary box-border hidden z-20 pointer-events-none" />
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
          <div className="flex items-center gap-4">
             <label className="flex items-center gap-2 font-medium border-none shadow-none text-gray-700 bg-transparent">
               選取起點:
               <input 
                 type="number" step="0.1" min="0" 
                 className="input !py-1 w-20 font-mono text-right bg-white"
                 value={mainTrack.selectionStart.toFixed(2)}
                 onChange={e => {
                   const v = parseFloat(e.target.value);
                   if(!isNaN(v)) updateMainTrack({ selectionStart: Math.min(v, mainTrack.selectionEnd) });
                 }}
               />
             </label>
             <label className="flex items-center gap-2 font-medium border-none shadow-none text-gray-700 bg-transparent">
               選取終點:
               <input 
                 type="number" step="0.1" min="0" 
                 className="input !py-1 w-20 font-mono text-right bg-white"
                 value={mainTrack.selectionEnd.toFixed(2)}
                 onChange={e => {
                   const v = parseFloat(e.target.value);
                   if(!isNaN(v)) updateMainTrack({ selectionEnd: Math.max(v, mainTrack.selectionStart) });
                 }}
               />
             </label>
          </div>
          {mainTrack.buffer && (
            <span className="font-mono bg-white border border-gray-200 px-3 py-1 rounded-full whitespace-nowrap text-xs shadow-sm">
              總時長: {mainTrack.buffer.duration.toFixed(2)}s
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
