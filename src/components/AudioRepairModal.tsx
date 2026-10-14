import { useState, useRef } from 'react';
import { 
  X, 
  Wrench, 
  Upload, 
  CheckCircle2, 
  AlertTriangle, 
  AlertCircle, 
  Download, 
  ArrowRightCircle, 
  ShieldCheck, 
  Sparkles,
  FileAudio
} from 'lucide-react';
import { useAudioStore } from '../store/useAudioStore';
import { 
  analyzeAudioBinary, 
  repairAudioBinary, 
  analyzeAudioBufferQuality, 
  repairAudioBufferQuality, 
  autoDecodeWithRepair,
} from '../utils/audioDiagnostics';
import type { DiagnosticIssue } from '../utils/audioDiagnostics';
import { bufferToWav } from '../utils/audioExport';

interface AudioRepairModalProps {
  onClose: () => void;
}

export default function AudioRepairModal({ onClose }: AudioRepairModalProps) {
  const { 
    mainTrack, 
    updateMainTrack, 
    setOriginalFileName, 
    initAudioContext,
    pushHistory
  } = useAudioStore();

  const fileInputRef = useRef<HTMLInputElement>(null);

  // States
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [repairing, setRepairing] = useState(false);
  
  // Diagnostics
  const [detectedFormat, setDetectedFormat] = useState<string>('');
  const [status, setStatus] = useState<'idle' | 'healthy' | 'warning' | 'corrupted'>('idle');
  const [issues, setIssues] = useState<DiagnosticIssue[]>([]);
  const [repairLogs, setRepairLogs] = useState<string[]>([]);
  const [repairedAudioBuffer, setRepairedAudioBuffer] = useState<AudioBuffer | null>(null);
  const [activeTab, setActiveTab] = useState<'current' | 'upload'>('upload');

  // Repair options
  const [fixBinary, setFixBinary] = useState(true);
  const [removeDcOffset, setRemoveDcOffset] = useState(true);
  const [fixClipping, setFixClipping] = useState(true);
  const [normalizePeak, setNormalizePeak] = useState(false);
  const [trimSilence, setTrimSilence] = useState(false);

  // Analyze uploaded file
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setAnalyzing(true);
    setRepairLogs([]);
    setRepairedAudioBuffer(null);

    try {
      const buffer = await file.arrayBuffer();
      setFileBuffer(buffer);

      // Binary analysis
      const binReport = analyzeAudioBinary(buffer, file.name);
      setDetectedFormat(binReport.detectedFormat);

      const allIssues = [...binReport.issues];

      // Try decode to get PCM quality stats if possible
      initAudioContext();
      const ctx = useAudioStore.getState().audioContext;
      if (ctx) {
        try {
          const { audioBuffer } = await autoDecodeWithRepair(buffer, file.name, ctx);
          const pcmReport = analyzeAudioBufferQuality(audioBuffer);
          allIssues.push(...pcmReport.issues);
          setRepairedAudioBuffer(audioBuffer);
        } catch {
          // If decode fails, binary issues are already recorded
        }
      }

      setIssues(allIssues);
      const hasErrors = allIssues.some(i => i.severity === 'error');
      const hasWarnings = allIssues.some(i => i.severity === 'warning');
      setStatus(hasErrors ? 'corrupted' : hasWarnings ? 'warning' : 'healthy');
    } catch (err) {
      console.error(err);
    } finally {
      setAnalyzing(false);
    }
  };

  // Analyze current track in editor
  const handleAnalyzeCurrentTrack = () => {
    if (!mainTrack.buffer) return;
    setActiveTab('current');
    setAnalyzing(true);
    setRepairLogs([]);
    setRepairedAudioBuffer(null);

    try {
      const pcmReport = analyzeAudioBufferQuality(mainTrack.buffer);
      setDetectedFormat(`目前編輯器音訊 (${mainTrack.buffer.numberOfChannels} 聲道, ${mainTrack.buffer.sampleRate} Hz)`);
      setIssues(pcmReport.issues);
      setRepairedAudioBuffer(mainTrack.buffer);

      const hasErrors = pcmReport.issues.some(i => i.severity === 'error');
      const hasWarnings = pcmReport.issues.some(i => i.severity === 'warning');
      setStatus(hasErrors ? 'corrupted' : hasWarnings ? 'warning' : 'healthy');
    } finally {
      setAnalyzing(false);
    }
  };

  // Perform Repair
  const handleExecuteRepair = async () => {
    setRepairing(true);
    const logs: string[] = [];

    initAudioContext();
    const ctx = useAudioStore.getState().audioContext;
    if (!ctx) {
      setRepairing(false);
      return;
    }

    try {
      let currentBuffer: AudioBuffer | null = repairedAudioBuffer;

      // 1. Binary repair if source is an uploaded file
      if (activeTab === 'upload' && fileBuffer && selectedFile) {
        let bufToUse = fileBuffer;
        if (fixBinary) {
          const { repairedBuffer, logs: binLogs } = repairAudioBinary(fileBuffer, selectedFile.name);
          bufToUse = repairedBuffer;
          logs.push(...binLogs);
        }

        // Decode with repair pipeline
        const decodeResult = await autoDecodeWithRepair(bufToUse, selectedFile.name, ctx);
        currentBuffer = decodeResult.audioBuffer;
        logs.push(...decodeResult.report.repairLogs);
      }

      // 2. PCM quality repair
      if (currentBuffer) {
        const { repairedAudioBuffer: finalBuffer, logs: qualityLogs } = repairAudioBufferQuality(
          currentBuffer,
          ctx,
          {
            removeDcOffset,
            fixClipping,
            normalizePeak,
            trimSilence
          }
        );
        logs.push(...qualityLogs);
        currentBuffer = finalBuffer;
      }

      if (logs.length === 0) {
        logs.push('檢測完畢，音訊狀況良好，未發現需要強制修復之結構性錯誤。');
      }

      setRepairLogs(logs);
      setRepairedAudioBuffer(currentBuffer);
      setStatus('healthy');
    } catch (err: any) {
      logs.push(`修復過程遭遇問題: ${err.message || '未知錯誤'}`);
      setRepairLogs(logs);
    } finally {
      setRepairing(false);
    }
  };

  // Load repaired audio into editor
  const handleLoadIntoEditor = () => {
    if (!repairedAudioBuffer) return;

    if (mainTrack.buffer) {
      pushHistory(mainTrack.buffer);
    }

    if (activeTab === 'upload' && selectedFile) {
      setOriginalFileName(selectedFile.name.replace(/\.[^/.]+$/, '') + '_repaired.wav');
    }

    updateMainTrack({
      buffer: repairedAudioBuffer,
      viewStartTime: 0,
      viewEndTime: repairedAudioBuffer.duration,
      selectionStart: 0,
      selectionEnd: repairedAudioBuffer.duration
    });

    onClose();
  };

  // Download repaired WAV file
  const handleDownloadRepairedWav = () => {
    if (!repairedAudioBuffer) return;
    const blob = bufferToWav(repairedAudioBuffer);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const namePrefix = selectedFile ? selectedFile.name.replace(/\.[^/.]+$/, '') : 'soundcut_repaired';
    a.download = `${namePrefix}_repaired.wav`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[950] flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div 
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-scale-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between bg-gray-50/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                音檔檢查與修復工具
                <span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-semibold">
                  支援 .arm/.amr/WAV/MP3
                </span>
              </h2>
              <p className="text-xs text-gray-500">檢測標頭損壞、AMR 補齊、DC 偏移、削波失真及異常長度修復</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-6">
          {/* Source Tabs */}
          <div className="flex bg-gray-100 p-1 rounded-xl">
            <button
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all flex items-center justify-center gap-2 ${
                activeTab === 'upload' ? 'bg-white text-primary shadow-sm font-bold' : 'text-gray-600 hover:text-gray-900'
              }`}
              onClick={() => { setActiveTab('upload'); }}
            >
              <Upload size={16} /> 上傳本機檔案檢測 (.arm, .amr, .wav, .mp3 等)
            </button>
            <button
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all flex items-center justify-center gap-2 ${
                activeTab === 'current' ? 'bg-white text-primary shadow-sm font-bold' : 'text-gray-600 hover:text-gray-900'
              }`}
              onClick={handleAnalyzeCurrentTrack}
              disabled={!mainTrack.buffer}
            >
              <FileAudio size={16} /> 檢查目前主音軌
            </button>
          </div>

          {/* Upload Area */}
          {activeTab === 'upload' && (
            <div>
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileChange}
                accept="audio/*,video/mp4,audio/flac,audio/m4a,audio/aac,.amr,.arm"
                className="hidden" 
              />
              <div 
                className="border-2 border-dashed border-gray-300 rounded-xl p-6 flex flex-col items-center justify-center bg-gray-50/60 hover:bg-primary/5 hover:border-primary/40 cursor-pointer transition-all"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center mb-2">
                  <Upload size={24} />
                </div>
                <div className="text-sm font-semibold text-gray-700">
                  {selectedFile ? selectedFile.name : '點擊選擇或拖放音訊檔案至此'}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  完整支援 .arm, .amr (Adaptive Multi-Rate), WAV, MP3, AAC, M4A, FLAC, OGG
                </div>
              </div>
            </div>
          )}

          {/* Analyzing Spinner */}
          {analyzing && (
            <div className="flex items-center justify-center gap-3 py-6 text-gray-500">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
              <span>正在全面診斷音檔結構與訊號指標...</span>
            </div>
          )}

          {/* Diagnostics Result Card */}
          {status !== 'idle' && !analyzing && (
            <div className="flex flex-col gap-4">
              {/* Status Header Badge */}
              <div className={`p-4 rounded-xl border flex items-center justify-between ${
                status === 'healthy' 
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
                  : status === 'warning' 
                  ? 'bg-amber-50 border-amber-200 text-amber-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}>
                <div className="flex items-center gap-3">
                  {status === 'healthy' && <CheckCircle2 className="w-6 h-6 text-emerald-600" />}
                  {status === 'warning' && <AlertTriangle className="w-6 h-6 text-amber-600" />}
                  {status === 'corrupted' && <AlertCircle className="w-6 h-6 text-rose-600" />}
                  <div>
                    <div className="font-bold text-sm">
                      {status === 'healthy' && '音訊狀態正常 / 修復完畢'}
                      {status === 'warning' && '檢測到非標準結構或品質瑕疵'}
                      {status === 'corrupted' && '音檔標頭或容器受損'}
                    </div>
                    <div className="text-xs opacity-90">格式: {detectedFormat}</div>
                  </div>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full font-bold uppercase tracking-wider ${
                  status === 'healthy' 
                    ? 'bg-emerald-200/60 text-emerald-900' 
                    : status === 'warning' 
                    ? 'bg-amber-200/60 text-amber-900'
                    : 'bg-rose-200/60 text-rose-900'
                }`}>
                  {status}
                </span>
              </div>

              {/* Issues List */}
              <div className="flex flex-col gap-2">
                <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">診斷項目詳情</div>
                {issues.length === 0 ? (
                  <div className="p-4 bg-gray-50 rounded-xl text-sm text-gray-600 flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-emerald-500" />
                    未發現損壞問題，標頭結構與取樣品質皆符合規範。
                  </div>
                ) : (
                  issues.map((issue) => (
                    <div key={issue.id} className="p-3 bg-gray-50 border border-gray-200 rounded-xl flex items-start gap-3">
                      {issue.severity === 'error' ? (
                        <AlertCircle className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5" />
                      ) : issue.severity === 'warning' ? (
                        <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                      ) : (
                        <CheckCircle2 className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1">
                        <div className="text-sm font-bold text-gray-800 flex items-center gap-2">
                          {issue.title}
                          {issue.canAutoFix && (
                            <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">
                              支援自動修復
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-600 mt-0.5">{issue.description}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Repair Options */}
              <div className="p-4 bg-gray-50/80 border border-gray-200 rounded-xl flex flex-col gap-3">
                <div className="text-xs font-bold text-gray-700 flex items-center gap-2">
                  <Wrench size={14} className="text-primary" />
                  自訂修復與優化選項
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {activeTab === 'upload' && (
                    <label className="flex items-center gap-2 cursor-pointer text-gray-700 hover:text-black">
                      <input 
                        type="checkbox" 
                        checked={fixBinary} 
                        onChange={e => setFixBinary(e.target.checked)}
                        className="rounded text-primary focus:ring-primary"
                      />
                      <span>修復標頭與容器 (WAV/AMR/MP3)</span>
                    </label>
                  )}
                  <label className="flex items-center gap-2 cursor-pointer text-gray-700 hover:text-black">
                    <input 
                      type="checkbox" 
                      checked={removeDcOffset} 
                      onChange={e => setRemoveDcOffset(e.target.checked)}
                      className="rounded text-primary focus:ring-primary"
                    />
                    <span>消除直流偏移 (DC Offset)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-gray-700 hover:text-black">
                    <input 
                      type="checkbox" 
                      checked={fixClipping} 
                      onChange={e => setFixClipping(e.target.checked)}
                      className="rounded text-primary focus:ring-primary"
                    />
                    <span>抑制削波失真 (Soft Limiter)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-gray-700 hover:text-black">
                    <input 
                      type="checkbox" 
                      checked={normalizePeak} 
                      onChange={e => setNormalizePeak(e.target.checked)}
                      className="rounded text-primary focus:ring-primary"
                    />
                    <span>響度正規化 (Peak Normalize 95%)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-gray-700 hover:text-black">
                    <input 
                      type="checkbox" 
                      checked={trimSilence} 
                      onChange={e => setTrimSilence(e.target.checked)}
                      className="rounded text-primary focus:ring-primary"
                    />
                    <span>自動裁切首尾多餘靜音</span>
                  </label>
                </div>

                <button
                  className="btn btn-primary w-full mt-2 flex items-center justify-center gap-2 py-2.5 font-bold shadow-sm"
                  onClick={handleExecuteRepair}
                  disabled={repairing}
                >
                  {repairing ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>正在修復音檔數據...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={16} /> 執行音檔一鍵修復
                    </>
                  )}
                </button>
              </div>

              {/* Repair Execution Logs */}
              {repairLogs.length > 0 && (
                <div className="p-3 bg-gray-900 text-gray-200 rounded-xl text-xs font-mono flex flex-col gap-1 max-h-36 overflow-y-auto">
                  <div className="text-gray-400 font-bold mb-1 flex items-center gap-1.5">
                    <Sparkles size={12} className="text-amber-400" /> 修復記錄歷程：
                  </div>
                  {repairLogs.map((log, idx) => (
                    <div key={idx} className="flex items-start gap-1.5">
                      <span className="text-primary font-bold">✓</span>
                      <span>{log}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Action Buttons when Repaired Buffer is available */}
              {repairedAudioBuffer && (
                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <button
                    className="btn btn-primary flex-1 flex items-center justify-center gap-2 py-2.5"
                    onClick={handleLoadIntoEditor}
                  >
                    <ArrowRightCircle size={18} /> 載入至主編輯器
                  </button>
                  <button
                    className="btn btn-default flex-1 flex items-center justify-center gap-2 py-2.5"
                    onClick={handleDownloadRepairedWav}
                  >
                    <Download size={18} /> 下載修復後音檔 (WAV)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
