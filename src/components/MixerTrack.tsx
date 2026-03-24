import { useEffect, useRef } from 'react';
import { useAudioStore } from '../store/useAudioStore';
import { drawSecondaryWaveform, formatRulerTime } from '../utils/waveformDraw';
import { mixTracks, bufferToWav, bufferToMp3 } from '../utils/audioExport';
import { estimateFrequencyAtTime } from '../utils/audioOperations';
import { Play, Pause, Download } from 'lucide-react';

export default function MixerTrack() {
  const { 
    mainTrack, 
    placedClips, 
    setPlacedClips, 
    activeInsertClipId, 
    clips, 
    audioContext,
    setLoading,
    activePlaybackNodes,
    setActivePlaybackNodes,
    currentPlaybackSpeed,
    setSpeedTracking,
    isPlayingMixed,
    setIsPlayingMixed,
    updateMainTrack,
    globalHoverTime,
    setGlobalHoverTime,
    globalHoverHz,
    setGlobalHoverHz,
    settings
  } = useAudioStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
          drawSecondaryWaveform(
            canvas,
            placedClips,
            mainTrack.viewStartTime,
            mainTrack.viewEndTime
          );
        }
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [mainTrack.buffer, mainTrack.viewStartTime, mainTrack.viewEndTime, placedClips]);

  // Redraw when clips change
  useEffect(() => {
    if (canvasRef.current && mainTrack.buffer) {
      drawSecondaryWaveform(
        canvasRef.current,
        placedClips,
        mainTrack.viewStartTime,
        mainTrack.viewEndTime
      );
    }
  }, [placedClips, mainTrack.viewStartTime, mainTrack.viewEndTime, mainTrack.buffer]);

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!mainTrack.buffer || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const currentSeconds = mainTrack.viewStartTime + (x / rect.width) * (mainTrack.viewEndTime - mainTrack.viewStartTime);
    
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
  };

  const handlePointerLeave = () => {
    setGlobalHoverTime(null);
    setGlobalHoverHz(null);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (!mainTrack.buffer || !canvasRef.current) return;
    
    if (!activeInsertClipId) {
      alert("請先從右側列表中單選一個要安插的片段！");
      return;
    }

    const sourceClip = clips.find(c => c.id === activeInsertClipId);
    if (!sourceClip) {
      alert("找不到選取的片段。");
      return;
    }

    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const clickTime = mainTrack.viewStartTime + (x / rect.width) * (mainTrack.viewEndTime - mainTrack.viewStartTime);
    
    if (clickTime < 0) return;

    const newPlacedClip = {
      buffer: sourceClip.buffer,
      startTime: clickTime,
      sourceClipId: sourceClip.id,
      id: Date.now()
    };

    setPlacedClips((prev) => {
      const updated = [...prev, newPlacedClip];
      updated.sort((a, b) => a.startTime - b.startTime);
      return updated;
    });

    setLoading(false, `已將「${sourceClip.name}」安插於 ${formatRulerTime(clickTime)}`);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!mainTrack.buffer || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const clickTime = mainTrack.viewStartTime + (x / rect.width) * (mainTrack.viewEndTime - mainTrack.viewStartTime);
    
    const clickedClipIndex = placedClips.findIndex(
      clip => clickTime >= clip.startTime && clickTime <= clip.startTime + clip.buffer.duration
    );

    if (clickedClipIndex !== -1) {
      if (confirm('確定要移除此片段嗎？')) {
        setPlacedClips((prev) => {
          const updated = [...prev];
          updated.splice(clickedClipIndex, 1);
          return updated;
        });
      }
    }
  };

  const stopPlayback = () => {
    activePlaybackNodes.forEach(node => { try { node.stop(); } catch (e) {} node.disconnect(); });
    setActivePlaybackNodes([]);
    setIsPlayingMixed(false);
    updateMainTrack({ sourceNode: null });
  };

  const togglePlayAll = () => {
    if (activePlaybackNodes.length > 0) {
      stopPlayback();
      return;
    }
    
    if (!mainTrack.buffer || !audioContext) return;
    
    const start = mainTrack.selectionStart;
    const end = mainTrack.selectionEnd;
    if (start >= end) {
      alert("請先在主音軌上選取一個播放範圍！");
      return;
    }
    
    const duration = end - start;
    const nodesToPlay: AudioBufferSourceNode[] = [];

    // 1. Play main track
    const mainSource = audioContext.createBufferSource();
    mainSource.buffer = mainTrack.buffer;
    mainSource.connect(audioContext.destination);
    mainSource.playbackRate.value = currentPlaybackSpeed;
    mainSource.start(0, start, duration);
    nodesToPlay.push(mainSource);

    // 2. Play secondary clips
    placedClips.forEach(pClip => {
      if (pClip.startTime < end && pClip.startTime + pClip.buffer.duration > start) {
        const clipSource = audioContext.createBufferSource();
        clipSource.buffer = pClip.buffer;
        clipSource.connect(audioContext.destination);
        clipSource.playbackRate.value = currentPlaybackSpeed;
        
        const offsetIntoClip = Math.max(0, start - pClip.startTime);
        const startTimeInContext = Math.max(0, pClip.startTime - start);
        const durationToPlay = Math.min(
          pClip.buffer.duration - offsetIntoClip,
          end - (pClip.startTime + offsetIntoClip)
        );

        if (durationToPlay > 0) {
          clipSource.start(startTimeInContext / currentPlaybackSpeed, offsetIntoClip, durationToPlay);
          nodesToPlay.push(clipSource);
        }
      }
    });

    if (nodesToPlay.length > 0) {
      setIsPlayingMixed(true);
      setActivePlaybackNodes(nodesToPlay);
      updateMainTrack({
        playbackStartTime: audioContext.currentTime,
        playbackOffset: start,
        sourceNode: mainSource // Use mainSource to trigger the playhead movement
      });
      setSpeedTracking(audioContext.currentTime, 0);

      nodesToPlay[nodesToPlay.length - 1].onended = () => {
        // If it was the last node playing and we are still marked as playing, stop
        stopPlayback();
      };
    }
  };

  // Keyboard shortcut for preview
  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;

      if (e.key.toLowerCase() === settings.shortcuts.preview) {
        e.preventDefault();
        togglePlayAll();
      }
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [settings.shortcuts.preview, togglePlayAll]);

  const handleExportMixed = async () => {
    if (!mainTrack.buffer || !audioContext) {
      alert("主音軌沒有音訊，無法匯出。");
      return;
    }

    const format = prompt("請選擇匯出格式： 'mp3' 或 'wav'", "mp3")?.toLowerCase();
    if (!format || (format !== 'mp3' && format !== 'wav')) return;

    setLoading(true, `正在合併音軌並編碼為 ${format.toUpperCase()}...`);
    
    // allow microtask UI update
    await new Promise(r => setTimeout(r, 50));

    try {
      const mixedBuffer = mixTracks(audioContext, mainTrack.buffer, placedClips);
      let blob, extension;
      
      if (format === 'mp3') {
        blob = bufferToMp3(mixedBuffer);
        extension = 'mp3';
      } else {
        blob = bufferToWav(mixedBuffer);
        extension = 'wav';
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `SoundCut_Mixed_${Date.now()}.${extension}`;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
      setLoading(false, '合併匯出成功！');
    } catch (e) {
      console.error(e);
      setLoading(false, '合併匯出時發生錯誤。');
    }
  };

  return (
    <div className="flex flex-col border-b bg-gray-50 pb-2">
      <div className="flex justify-between items-center px-4 py-2 border-b bg-white">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-bold text-gray-700">混音軌</h3>
          <p className="text-xs text-gray-500 hidden sm:block">從片段列表勾選後，點擊下方區域以安插 (右鍵移除)</p>
        </div>
        <div className="flex gap-2">
          <button 
            className={`btn !py-1 !text-xs ${isPlayingMixed ? 'btn-danger' : 'btn-default'}`} 
            onClick={togglePlayAll}
            disabled={!mainTrack.buffer}
          >
            {isPlayingMixed ? <Pause size={14} className="inline mr-1 -mt-0.5" /> : <Play size={14} className="inline mr-1 -mt-0.5" />} {isPlayingMixed ? '停止預覽' : '預覽'}
          </button>
          <button 
            className="btn btn-primary !py-1 !text-xs" 
            onClick={handleExportMixed}
            disabled={!mainTrack.buffer}
          >
            <Download size={14} className="inline mr-1 -mt-0.5" /> 匯出
          </button>
        </div>
      </div>

      <div 
        className="relative w-full h-24 md:h-32 bg-gray-50 cursor-copy overflow-hidden"
        ref={containerRef}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        {globalHoverTime !== null && globalHoverTime >= mainTrack.viewStartTime && globalHoverTime <= mainTrack.viewEndTime && (
          <div 
            className="absolute w-[2px] h-full bg-secondary top-0 pointer-events-none z-[5]" 
            style={{ left: `${((globalHoverTime - mainTrack.viewStartTime) / (mainTrack.viewEndTime - mainTrack.viewStartTime)) * 100}%` }}
          >
            <div className="absolute top-1 left-0 transform -translate-x-1/2 bg-black/80 text-white px-2 py-0.5 rounded text-[10px] whitespace-nowrap min-w-max flex flex-col items-center pointer-events-none">
              <span>{formatRulerTime(globalHoverTime)}</span>
              {settings.showHoverHz && globalHoverHz !== null && (
                <span className="text-secondary-light font-mono opacity-90">{globalHoverHz} Hz</span>
              )}
            </div>
          </div>
        )}
        <canvas ref={canvasRef} className="block w-full h-full" />
      </div>
    </div>
  );
}
