import type { Segment } from '../types/audio';

/**
 * 根據給定的開始與結束時間切分 AudioBuffer
 */
export function sliceAudioBuffer(
  audioContext: AudioContext,
  buffer: AudioBuffer,
  startTime: number,
  endTime: number
): AudioBuffer {
  const sampleRate = buffer.sampleRate;
  const startOffset = Math.round(startTime * sampleRate);
  const endOffset = Math.round(endTime * sampleRate);
  const frameCount = endOffset - startOffset;

  if (frameCount <= 0) throw new Error("無效時間範圍");

  const newBuffer = audioContext.createBuffer(buffer.numberOfChannels, frameCount, sampleRate);
  for (let i = 0; i < buffer.numberOfChannels; i++) {
    newBuffer.getChannelData(i).set(buffer.getChannelData(i).subarray(startOffset, endOffset));
  }
  return newBuffer;
}

/**
 * 增強或減弱選取區段的音量
 */
export async function amplifyBufferRegion(
  audioContext: AudioContext,
  buffer: AudioBuffer,
  selectionStart: number,
  selectionEnd: number,
  gain: number
): Promise<AudioBuffer> {
  const newBuffer = audioContext.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  
  // 複製原始資料
  for (let i = 0; i < buffer.numberOfChannels; i++) {
    newBuffer.getChannelData(i).set(buffer.getChannelData(i));
  }

  const startSample = Math.round(selectionStart * newBuffer.sampleRate);
  const endSample = Math.round(selectionEnd * newBuffer.sampleRate);

  // 在選區套用 gain (限制在 -1 到 1 避免爆音)
  for (let i = 0; i < newBuffer.numberOfChannels; i++) {
    const channelData = newBuffer.getChannelData(i);
    for (let j = startSample; j < endSample; j++) {
      channelData[j] = Math.max(-1, Math.min(1, channelData[j] * gain));
    }
  }
  return newBuffer;
}

/**
 * 剪除選取區段 (移除選區，並將前後段相接)
 * 會回傳新的 AudioBuffer，如果剪除後長度小於 0 會拋錯。
 */
export async function cutoutBufferRegion(
  audioContext: AudioContext,
  buffer: AudioBuffer,
  selectionStart: number,
  selectionEnd: number
): Promise<AudioBuffer> {
  const sampleRate = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;
  const startSample = Math.round(selectionStart * sampleRate);
  const endSample = Math.round(selectionEnd * sampleRate);
  
  const newLength = buffer.length - (endSample - startSample);
  if (newLength <= 0) {
    throw new Error("剪除後沒有剩餘音訊。");
  }

  const newBuffer = audioContext.createBuffer(numChannels, newLength, sampleRate);
  for (let i = 0; i < numChannels; i++) {
    const oldData = buffer.getChannelData(i);
    const newData = newBuffer.getChannelData(i);
    newData.set(oldData.subarray(0, startSample), 0);
    newData.set(oldData.subarray(endSample), startSample);
  }
  return newBuffer;
}

/**
 * 內部使用的分段分析函式
 */
function analyze(
  channelData: Float32Array, 
  chunkSize: number, 
  sampleRate: number, 
  minDurSeconds: number,
  condition: (chunk: Float32Array) => boolean
): Segment[] {
  const segments: Segment[] = [];
  const minSilenceDuration = minDurSeconds * sampleRate; 
  let inSegment = false;
  let segmentStart = 0;
  let silenceCounter = 0;

  for (let i = 0; i < channelData.length; i += chunkSize) {
    const chunk = channelData.subarray(i, i + chunkSize);
    const isAboveThreshold = condition(chunk);

    if (isAboveThreshold && !inSegment) {
      inSegment = true;
      segmentStart = i / sampleRate;
      silenceCounter = 0;
    } else if (!isAboveThreshold && inSegment) {
      silenceCounter += chunkSize;
      if (silenceCounter >= minSilenceDuration) {
        inSegment = false;
        segments.push({ start: segmentStart, end: (i - silenceCounter) / sampleRate });
      }
    }
  }

  if (inSegment) {
    segments.push({ start: segmentStart, end: channelData.length / sampleRate });
  }

  return segments;
}

/**
 * 依音量尋找段落
 */
export async function findSegmentsByVolume(buffer: AudioBuffer, threshold: number, minDur: number = 0.2): Promise<Segment[]> {
  const channelData = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const chunkSize = Math.floor(sampleRate * 0.05);

  return analyze(channelData, chunkSize, sampleRate, minDur, (chunk) => {
    let sum = 0;
    for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
    return Math.sqrt(sum / chunk.length) > threshold;
  });
}

/**
 * 依頻率 (過零率) 尋找段落
 */
export async function findSegmentsByFrequency(buffer: AudioBuffer, thresholdValue: number, band: 'low' | 'high', minDur: number = 0.2): Promise<Segment[]> {
  const channelData = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const chunkSize = Math.floor(sampleRate * 0.05);
  // multiplier from original logic
  const threshold = thresholdValue * 200; 

  return analyze(channelData, chunkSize, sampleRate, minDur, (chunk) => {
    let crossings = 0;
    for (let i = 1; i < chunk.length; i++) {
      if ((chunk[i] > 0 && chunk[i - 1] <= 0) || (chunk[i] < 0 && chunk[i - 1] >= 0)) {
        crossings++;
      }
    }
    const zcr = crossings;
    if (band === 'low') {
      return zcr > 0 && zcr < threshold;
    } else {
      return zcr > threshold;
    }
  });
}
