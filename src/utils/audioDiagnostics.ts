import { decodeAmrAudio, isAmrBuffer, isAmrFileName } from './amrDecoder';

export interface DiagnosticIssue {
  id: string;
  category: 'container' | 'header' | 'stream' | 'audio-quality';
  severity: 'info' | 'warning' | 'error';
  title: string;
  description: string;
  canAutoFix: boolean;
  fixed?: boolean;
}

export interface DiagnosticReport {
  fileName: string;
  fileSizeBytes: number;
  detectedFormat: string;
  status: 'healthy' | 'warning' | 'corrupted';
  issues: DiagnosticIssue[];
  repairLogs: string[];
  repairedBuffer?: ArrayBuffer;
  repairedAudioBuffer?: AudioBuffer;
}

export interface AudioQualityStats {
  duration: number;
  sampleRate: number;
  numberOfChannels: number;
  peakAmplitude: number;
  dcOffset: number;
  clippingCount: number;
  clippingPercentage: number;
  leadingSilenceSeconds: number;
  trailingSilenceSeconds: number;
}

/**
 * Reads 4-byte ASCII string from Uint8Array at given offset
 */
function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  if (offset + length > bytes.length) return '';
  let str = '';
  for (let i = 0; i < length; i++) {
    str += String.fromCharCode(bytes[offset + i]);
  }
  return str;
}

/**
 * Writes 4-byte unsigned integer in Little-Endian
 */
function writeUint32LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
  bytes[offset + 2] = (value >> 16) & 0xff;
  bytes[offset + 3] = (value >> 24) & 0xff;
}

/**
 * Reads 4-byte unsigned integer in Little-Endian
 */
function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

/**
 * Detects format and magic headers from ArrayBuffer
 */
export function detectAudioFormat(buffer: ArrayBuffer, fileName: string): string {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 12 && readAscii(bytes, 0, 4) === 'RIFF' && readAscii(bytes, 8, 4) === 'WAVE') {
    return 'WAV (RIFF WAVE)';
  }
  if (bytes.length >= 6 && isAmrBuffer(buffer)) {
    return 'AMR (Adaptive Multi-Rate)';
  }
  if (isAmrFileName(fileName)) {
    return 'AMR/ARM (語音音訊)';
  }
  if (bytes.length >= 3 && readAscii(bytes, 0, 3) === 'ID3') {
    return 'MP3 (含 ID3v2 標籤)';
  }
  // Check MPEG sync word
  for (let i = 0; i < Math.min(1024, bytes.length - 1); i++) {
    if (bytes[i] === 0xff && (bytes[i + 1] & 0xe0) === 0xe0) {
      return 'MP3 (MPEG Audio)';
    }
  }
  if (bytes.length >= 8 && readAscii(bytes, 4, 4) === 'ftyp') {
    return 'M4A / AAC / MP4 Audio';
  }
  if (bytes.length >= 4 && readAscii(bytes, 0, 4) === 'fLaC') {
    return 'FLAC (無損音訊)';
  }
  if (bytes.length >= 4 && readAscii(bytes, 0, 4) === 'OggS') {
    return 'OGG (Vorbis/Opus)';
  }
  const ext = fileName.split('.').pop()?.toUpperCase() || '未知';
  return `${ext} 音訊檔案`;
}

/**
 * Analyzes binary container of an audio file and identifies issues.
 */
export function analyzeAudioBinary(buffer: ArrayBuffer, fileName: string): DiagnosticReport {
  const bytes = new Uint8Array(buffer);
  const detectedFormat = detectAudioFormat(buffer, fileName);
  const issues: DiagnosticIssue[] = [];
  const repairLogs: string[] = [];

  // Check 1: File size
  if (bytes.length === 0) {
    issues.push({
      id: 'empty_file',
      category: 'container',
      severity: 'error',
      title: '空檔案',
      description: '音訊檔案大小為 0 位元組，無可解碼資料。',
      canAutoFix: false,
    });
    return {
      fileName,
      fileSizeBytes: 0,
      detectedFormat,
      status: 'corrupted',
      issues,
      repairLogs,
    };
  }

  // Check 2: WAV / RIFF specific issues
  if (detectedFormat.includes('WAV') || fileName.toLowerCase().endsWith('.wav')) {
    if (bytes.length < 44) {
      issues.push({
        id: 'wav_too_short',
        category: 'header',
        severity: 'error',
        title: 'WAV 標頭截斷',
        description: '檔案大小小於標準 WAV 標頭長度 (44 位元組)。',
        canAutoFix: false,
      });
    } else {
      const riffHeader = readAscii(bytes, 0, 4);
      const waveTag = readAscii(bytes, 8, 4);

      if (riffHeader !== 'RIFF' || waveTag !== 'WAVE') {
        issues.push({
          id: 'wav_riff_missing',
          category: 'header',
          severity: 'error',
          title: '遺失 RIFF/WAVE 魔術字頭',
          description: '檔案開頭缺少合法的 RIFF 與 WAVE 標籤。',
          canAutoFix: true,
        });
      } else {
        const chunkSize = readUint32LE(bytes, 4);
        const expectedChunkSize = bytes.length - 8;
        if (chunkSize === 0 || chunkSize === 0xffffffff || Math.abs(chunkSize - expectedChunkSize) > 8) {
          issues.push({
            id: 'wav_chunk_size_mismatch',
            category: 'header',
            severity: 'warning',
            title: 'WAV ChunkSize 長度異常',
            description: `標頭聲明大小 (${chunkSize} bytes) 與檔案實際長度 (${expectedChunkSize} bytes) 不符，多為錄音中斷未正確封裝導致。`,
            canAutoFix: true,
          });
        }

        // Search for data chunk
        let dataChunkOffset = -1;
        for (let i = 12; i < Math.min(bytes.length - 8, 2048); i++) {
          if (readAscii(bytes, i, 4) === 'data') {
            dataChunkOffset = i;
            break;
          }
        }

        if (dataChunkOffset === -1) {
          issues.push({
            id: 'wav_data_chunk_missing',
            category: 'stream',
            severity: 'error',
            title: '遺失 data 區塊標記',
            description: 'WAV 標頭內未找到存放音訊 PCM 取樣點的 data 區塊。',
            canAutoFix: true,
          });
        } else {
          const dataSize = readUint32LE(bytes, dataChunkOffset + 4);
          const actualDataSize = bytes.length - (dataChunkOffset + 8);
          if (dataSize === 0 || dataSize === 0xffffffff || dataSize > actualDataSize) {
            issues.push({
              id: 'wav_data_size_mismatch',
              category: 'stream',
              severity: 'warning',
              title: 'WAV 資料區塊長度不正確',
              description: `data 區塊宣告為 ${dataSize} bytes，但實際剩餘 ${actualDataSize} bytes，可能造成解碼器拒絕讀取。`,
              canAutoFix: true,
            });
          }
        }
      }
    }
  }

  // Check 3: AMR / ARM specific issues
  if (isAmrFileName(fileName) || detectedFormat.includes('AMR')) {
    const hasAmrMagic = isAmrBuffer(buffer);
    if (!hasAmrMagic) {
      const firstByte = bytes[0];
      const isLikelyRawAmr = (firstByte & 0x80) === 0 && ((firstByte >> 3) & 0x0f) <= 8;
      issues.push({
        id: 'amr_missing_magic',
        category: 'header',
        severity: isLikelyRawAmr ? 'warning' : 'error',
        title: 'AMR 檔案缺少魔術標頭 (#!AMR)',
        description: isLikelyRawAmr
          ? '檔案缺少標準 "#!AMR\\n" 開頭，但內容特徵符合未加標頭的 Raw AMR 語音幀。'
          : '檔案標頭不符合 AMR 格式規範。',
        canAutoFix: isLikelyRawAmr,
      });
    }
  }

  // Check 4: MP3 specific issues
  if (fileName.toLowerCase().endsWith('.mp3') || detectedFormat.includes('MP3')) {
    const hasId3 = readAscii(bytes, 0, 3) === 'ID3';
    let firstFrameOffset = -1;
    for (let i = 0; i < Math.min(bytes.length - 1, 4096); i++) {
      if (bytes[i] === 0xff && (bytes[i + 1] & 0xe0) === 0xe0) {
        firstFrameOffset = i;
        break;
      }
    }

    if (!hasId3 && firstFrameOffset > 0) {
      issues.push({
        id: 'mp3_leading_garbage',
        category: 'container',
        severity: 'warning',
        title: 'MP3 檔案前置垃圾位元組',
        description: `檔案開頭包含 ${firstFrameOffset} 位元組非標準數據，可能會干擾瀏覽器原生解碼。`,
        canAutoFix: true,
      });
    } else if (firstFrameOffset === -1 && !hasId3) {
      issues.push({
        id: 'mp3_no_sync',
        category: 'stream',
        severity: 'error',
        title: '未找到 MP3 同步字元 (Frame Sync)',
        description: '檔案前 4KB 未偵測到合法的 MPEG 音訊幀同步信號。',
        canAutoFix: false,
      });
    }
  }

  const hasErrors = issues.some((i) => i.severity === 'error');
  const hasWarnings = issues.some((i) => i.severity === 'warning');
  const status: 'healthy' | 'warning' | 'corrupted' = hasErrors
    ? 'corrupted'
    : hasWarnings
    ? 'warning'
    : 'healthy';

  return {
    fileName,
    fileSizeBytes: bytes.length,
    detectedFormat,
    status,
    issues,
    repairLogs,
  };
}

/**
 * Repairs binary-level container issues (WAV ChunkSize, MP3 leading garbage, AMR header).
 * Returns repaired ArrayBuffer.
 */
export function repairAudioBinary(buffer: ArrayBuffer, fileName: string): { repairedBuffer: ArrayBuffer; logs: string[] } {
  let bytes = new Uint8Array(buffer.slice(0));
  const logs: string[] = [];

  // 1. AMR / ARM Repair
  if (isAmrFileName(fileName) || !isAmrBuffer(bytes.buffer)) {
    if (bytes.length > 0 && !isAmrBuffer(bytes.buffer)) {
      const firstByte = bytes[0];
      const isLikelyRawAmr = (firstByte & 0x80) === 0 && ((firstByte >> 3) & 0x0f) <= 8;
      if (isLikelyRawAmr) {
        const header = new Uint8Array([0x23, 0x21, 0x41, 0x4d, 0x52, 0x0a]); // "#!AMR\n"
        const fixed = new Uint8Array(header.length + bytes.length);
        fixed.set(header, 0);
        fixed.set(bytes, header.length);
        bytes = fixed;
        logs.push('補全標準 AMR 魔術標頭 ("#!AMR\\n")。');
      }
    }
  }

  // 2. WAV / RIFF Repair
  if (fileName.toLowerCase().endsWith('.wav') || (bytes.length >= 12 && readAscii(bytes, 0, 4) === 'RIFF')) {
    if (bytes.length >= 44) {
      // Fix RIFF chunk size
      const expectedRiffSize = bytes.length - 8;
      const currentRiffSize = readUint32LE(bytes, 4);
      if (currentRiffSize !== expectedRiffSize) {
        writeUint32LE(bytes, 4, expectedRiffSize);
        logs.push(`修正 RIFF ChunkSize 欄位為標準實際長度 (${expectedRiffSize} 位元組)。`);
      }

      // Locate 'data' chunk and fix its length
      for (let i = 12; i < Math.min(bytes.length - 8, 4096); i++) {
        if (readAscii(bytes, i, 4) === 'data') {
          const actualDataSize = bytes.length - (i + 8);
          const currentDataSize = readUint32LE(bytes, i + 4);
          if (currentDataSize !== actualDataSize) {
            writeUint32LE(bytes, i + 4, actualDataSize);
            logs.push(`修正 data 區塊長度欄位為精確資料位元組 (${actualDataSize} 位元組)。`);
          }
          break;
        }
      }
    }
  }

  // 3. MP3 Repair (strip leading garbage before first sync frame)
  if (fileName.toLowerCase().endsWith('.mp3')) {
    const hasId3 = readAscii(bytes, 0, 3) === 'ID3';
    if (!hasId3) {
      let firstFrameOffset = -1;
      for (let i = 0; i < Math.min(bytes.length - 1, 4096); i++) {
        if (bytes[i] === 0xff && (bytes[i + 1] & 0xe0) === 0xe0) {
          firstFrameOffset = i;
          break;
        }
      }
      if (firstFrameOffset > 0) {
        bytes = bytes.slice(firstFrameOffset);
        logs.push(`剝離開頭 ${firstFrameOffset} 位元組損壞/無效前置字元，對齊首個 MP3 同步幀。`);
      }
    }
  }

  return { repairedBuffer: bytes.buffer, logs };
}

/**
 * Analyzes decoded AudioBuffer signal quality (DC Offset, Clipping, Low Amplitude, Silence).
 */
export function analyzeAudioBufferQuality(audioBuffer: AudioBuffer): {
  stats: AudioQualityStats;
  issues: DiagnosticIssue[];
} {
  const numChannels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const sampleRate = audioBuffer.sampleRate;
  const duration = audioBuffer.duration;

  let maxPeak = 0;
  let totalDCOffset = 0;
  let clippingSamples = 0;

  for (let c = 0; c < numChannels; c++) {
    const data = audioBuffer.getChannelData(c);
    let channelSum = 0;

    for (let i = 0; i < length; i++) {
      const absVal = Math.abs(data[i]);
      if (absVal > maxPeak) maxPeak = absVal;
      if (absVal >= 0.999) clippingSamples++;
      channelSum += data[i];
    }

    totalDCOffset += channelSum / length;
  }

  const dcOffset = totalDCOffset / numChannels;
  const totalSamples = length * numChannels;
  const clippingPercentage = totalSamples > 0 ? (clippingSamples / totalSamples) * 100 : 0;

  // Leading and trailing silence check (threshold: 0.005)
  const threshold = 0.005;
  let firstNonSilentIndex = length;
  let lastNonSilentIndex = 0;

  const monoData = audioBuffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    if (Math.abs(monoData[i]) > threshold) {
      firstNonSilentIndex = i;
      break;
    }
  }
  for (let i = length - 1; i >= 0; i--) {
    if (Math.abs(monoData[i]) > threshold) {
      lastNonSilentIndex = i;
      break;
    }
  }

  const leadingSilenceSeconds = firstNonSilentIndex < length ? firstNonSilentIndex / sampleRate : duration;
  const trailingSilenceSeconds = lastNonSilentIndex > 0 ? (length - 1 - lastNonSilentIndex) / sampleRate : 0;

  const stats: AudioQualityStats = {
    duration,
    sampleRate,
    numberOfChannels: numChannels,
    peakAmplitude: maxPeak,
    dcOffset,
    clippingCount: clippingSamples,
    clippingPercentage,
    leadingSilenceSeconds,
    trailingSilenceSeconds,
  };

  const issues: DiagnosticIssue[] = [];

  // DC Offset issue
  if (Math.abs(dcOffset) > 0.008) {
    issues.push({
      id: 'dc_offset',
      category: 'audio-quality',
      severity: 'warning',
      title: '顯著直流偏移 (DC Offset)',
      description: `偵測到平均振幅偏移量為 ${(dcOffset * 100).toFixed(2)}%，可能引發剪輯時的爆音並耗損動態範圍。`,
      canAutoFix: true,
    });
  }

  // Clipping issue
  if (clippingSamples > 10 || clippingPercentage > 0.02) {
    issues.push({
      id: 'clipping',
      category: 'audio-quality',
      severity: 'warning',
      title: '波形削波失真 (Clipping)',
      description: `偵測到 ${clippingSamples} 個採樣點達到或超過 1.0 峰值 (${clippingPercentage.toFixed(3)}%)，會產生尖銳雜音。`,
      canAutoFix: true,
    });
  }

  // Low amplitude
  if (maxPeak > 0 && maxPeak < 0.25) {
    issues.push({
      id: 'low_volume',
      category: 'audio-quality',
      severity: 'info',
      title: '總體音量偏低',
      description: `音訊最大峰值僅為 ${(maxPeak * 100).toFixed(1)}%，建議進行正規化 (Normalize) 提升響度。`,
      canAutoFix: true,
    });
  }

  // Silence warning
  if (leadingSilenceSeconds > 3.0 || trailingSilenceSeconds > 3.0) {
    issues.push({
      id: 'excessive_silence',
      category: 'audio-quality',
      severity: 'info',
      title: '首尾存在冗長靜音',
      description: `開頭靜音 ${(leadingSilenceSeconds).toFixed(1)} 秒，結尾靜音 ${(trailingSilenceSeconds).toFixed(1)} 秒。`,
      canAutoFix: true,
    });
  }

  return { stats, issues };
}

/**
 * Repairs AudioBuffer quality issues:
 * 1. DC Offset Removal
 * 2. Soft-Limiting / Normalization to fix Clipping
 * 3. Peak Normalization (optional)
 * 4. Silence Trimming (optional)
 */
export function repairAudioBufferQuality(
  audioBuffer: AudioBuffer,
  audioContext: AudioContext,
  options: {
    removeDcOffset?: boolean;
    fixClipping?: boolean;
    normalizePeak?: boolean;
    trimSilence?: boolean;
  } = { removeDcOffset: true, fixClipping: true, normalizePeak: false, trimSilence: false }
): { repairedAudioBuffer: AudioBuffer; logs: string[] } {
  const logs: string[] = [];
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  let startIdx = 0;
  let endIdx = audioBuffer.length;

  // Trim silence if requested
  if (options.trimSilence) {
    const threshold = 0.005;
    const mono = audioBuffer.getChannelData(0);
    for (let i = 0; i < audioBuffer.length; i++) {
      if (Math.abs(mono[i]) > threshold) {
        startIdx = Math.max(0, i - Math.floor(sampleRate * 0.05)); // keep 50ms padding
        break;
      }
    }
    for (let i = audioBuffer.length - 1; i >= 0; i--) {
      if (Math.abs(mono[i]) > threshold) {
        endIdx = Math.min(audioBuffer.length, i + Math.floor(sampleRate * 0.05));
        break;
      }
    }
    if (startIdx > 0 || endIdx < audioBuffer.length) {
      logs.push(`裁切首尾冗餘靜音 (${(startIdx / sampleRate).toFixed(2)}s ~ ${((audioBuffer.length - endIdx) / sampleRate).toFixed(2)}s)。`);
    }
  }

  const newLength = Math.max(1, endIdx - startIdx);
  const newBuffer = audioContext.createBuffer(numChannels, newLength, sampleRate);

  for (let c = 0; c < numChannels; c++) {
    const srcData = audioBuffer.getChannelData(c).subarray(startIdx, endIdx);
    const dstData = newBuffer.getChannelData(c);

    // 1. Calculate DC offset
    let sum = 0;
    for (let i = 0; i < newLength; i++) {
      sum += srcData[i];
    }
    const channelDc = sum / newLength;

    // Apply DC offset removal
    const applyDc = options.removeDcOffset && Math.abs(channelDc) > 0.002;
    for (let i = 0; i < newLength; i++) {
      dstData[i] = applyDc ? srcData[i] - channelDc : srcData[i];
    }

    if (applyDc && c === 0) {
      logs.push(`消除直流偏移 (DC Offset 修正：${(channelDc * 100).toFixed(2)}%)。`);
    }

    // 2. Find peak after DC removal
    let peak = 0;
    for (let i = 0; i < newLength; i++) {
      const absVal = Math.abs(dstData[i]);
      if (absVal > peak) peak = absVal;
    }

    // 3. Fix clipping or normalize
    if (options.fixClipping && peak >= 0.999) {
      // Soft-knee compression and scale to -0.3 dB (0.965)
      const targetGain = 0.96 / peak;
      for (let i = 0; i < newLength; i++) {
        // Tanh soft limiter for extreme peaks
        let val = dstData[i] * targetGain;
        if (val > 0.98) val = 0.98 + 0.02 * Math.tanh((val - 0.98) / 0.02);
        else if (val < -0.98) val = -0.98 + 0.02 * Math.tanh((val + 0.98) / 0.02);
        dstData[i] = val;
      }
      if (c === 0) {
        logs.push(`抑制削波失真並以軟限制器 (Soft Limiter) 重新校準動態範圍至安全閾值。`);
      }
    } else if (options.normalizePeak && peak > 0.01 && peak < 0.9) {
      const normGain = 0.95 / peak;
      for (let i = 0; i < newLength; i++) {
        dstData[i] = dstData[i] * normGain;
      }
      if (c === 0) {
        logs.push(`峰值響度正規化至 95% (-0.45 dB)。`);
      }
    }
  }

  return { repairedAudioBuffer: newBuffer, logs };
}

/**
 * Universal auto-decode pipeline with automated diagnosis and repair.
 * Automatically tries:
 * 1. Standard AudioContext.decodeAudioData
 * 2. AMR/ARM decode (if extension or header matches)
 * 3. If standard decode fails, runs binary repair and retries standard decode and AMR decode.
 */
export async function autoDecodeWithRepair(
  arrayBuffer: ArrayBuffer,
  fileName: string,
  audioContext: AudioContext
): Promise<{
  audioBuffer: AudioBuffer;
  report: DiagnosticReport;
}> {
  const report = analyzeAudioBinary(arrayBuffer, fileName);

  // Strategy 1: If AMR / ARM format, use AMR decoder directly
  if (isAmrFileName(fileName) || isAmrBuffer(arrayBuffer)) {
    try {
      const decodedAmr = await decodeAmrAudio(arrayBuffer, audioContext);
      report.repairLogs.push('以 AMR/ARM 專屬解碼引擎成功解碼。');
      report.repairedAudioBuffer = decodedAmr;
      return { audioBuffer: decodedAmr, report };
    } catch (err) {
      report.repairLogs.push(`原生 AMR 解碼失敗，嘗試執行二進位結構修復...`);
    }
  }

  // Strategy 2: Standard decodeAudioData
  try {
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    report.repairedAudioBuffer = decoded;
    return { audioBuffer: decoded, report };
  } catch (initialErr) {
    report.repairLogs.push('標準解碼器遭遇錯誤，啟動自動修復程序...');
  }

  // Strategy 3: Run Binary Repair
  const { repairedBuffer, logs } = repairAudioBinary(arrayBuffer, fileName);
  report.repairLogs.push(...logs);
  report.repairedBuffer = repairedBuffer;

  // Try decoding again after binary repair
  // Check AMR first if applicable
  if (isAmrFileName(fileName) || isAmrBuffer(repairedBuffer)) {
    try {
      const decodedAmr = await decodeAmrAudio(repairedBuffer, audioContext);
      report.repairLogs.push('修復標頭後，以 AMR 引擎成功解碼！');
      report.status = 'healthy';
      report.repairedAudioBuffer = decodedAmr;
      return { audioBuffer: decodedAmr, report };
    } catch (amrErr) {
      report.repairLogs.push('AMR 修復解碼再次失敗。');
    }
  }

  // Try standard decodeAudioData on repaired buffer
  try {
    const decoded = await audioContext.decodeAudioData(repairedBuffer.slice(0));
    report.repairLogs.push('修復容器與標頭後，成功解碼音訊！');
    report.status = 'healthy';
    report.repairedAudioBuffer = decoded;
    return { audioBuffer: decoded, report };
  } catch (repairErr) {
    report.status = 'corrupted';
    report.repairLogs.push(`修復後仍無法解碼: ${(repairErr as Error).message}`);
    throw new Error(`無法解碼音訊檔案。已嘗試自動修復，但檔案數據受損過於嚴重。詳細資訊：${report.issues.map(i => i.title).join(', ') || '非標準音訊編碼'}`);
  }
}
