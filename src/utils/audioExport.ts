import type { PlacedClip } from '../types/audio';
// @ts-ignore
import lamejs from 'lamejs';

export function mixTracks(
  audioContext: AudioContext,
  mainBuffer: AudioBuffer,
  placedClips: PlacedClip[]
): AudioBuffer {
  const sampleRate = mainBuffer.sampleRate;
  const numChannels = mainBuffer.numberOfChannels;
  let totalDuration = mainBuffer.duration;

  placedClips.forEach(pClip => {
    totalDuration = Math.max(totalDuration, pClip.startTime + pClip.buffer.duration);
  });

  const totalLength = Math.ceil(totalDuration * sampleRate);
  const mixedBuffer = audioContext.createBuffer(numChannels, totalLength, sampleRate);

  // 1. 放入主音軌
  for (let i = 0; i < numChannels; i++) {
    mixedBuffer.getChannelData(i).set(mainBuffer.getChannelData(i));
  }

  // 2. 混入其他片段
  for (const pClip of placedClips) {
    const startOffset = Math.round(pClip.startTime * sampleRate);
    for (let i = 0; i < numChannels; i++) {
      const mixedData = mixedBuffer.getChannelData(i);
      const clipData = pClip.buffer.getChannelData(i);
      for (let j = 0; j < clipData.length; j++) {
        const mixIndex = startOffset + j;
        if (mixIndex < totalLength) {
          mixedData[mixIndex] += clipData[j];
        }
      }
    }
  }

  // 3. 避免爆音 (硬限幅)
  for (let i = 0; i < numChannels; i++) {
    const data = mixedBuffer.getChannelData(i);
    for (let j = 0; j < data.length; j++) {
      data[j] = Math.max(-1, Math.min(1, data[j]));
    }
  }

  return mixedBuffer;
}

export function bufferToWav(buffer: AudioBuffer): Blob {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const abuffer = new ArrayBuffer(length);
  const view = new DataView(abuffer);
  let pos = 0;

  const setUint16 = (data: number) => {
    view.setUint16(pos, data, true);
    pos += 2;
  };
  const setUint32 = (data: number) => {
    view.setUint32(pos, data, true);
    pos += 4;
  };

  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8); // file length - 8
  setUint32(0x45564157); // "WAVE"
  setUint32(0x20746d66); // "fmt " chunk
  setUint32(16); // length = 16
  setUint16(1); // PCM (uncompressed)
  setUint16(numOfChan);
  setUint32(buffer.sampleRate);
  setUint32(buffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
  setUint16(numOfChan * 2); // block-align
  setUint16(16); // 16-bit
  setUint32(0x61746164); // "data" - chunk
  setUint32(length - pos - 4); // chunk length

  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  for (let offset = 0; offset < buffer.length; offset++) {
    for (let i = 0; i < numOfChan; i++) {
      let sample = Math.max(-1, Math.min(1, channels[i][offset]));
      view.setInt16(pos, sample < 0 ? sample * 32768 : sample * 32767, true);
      pos += 2;
    }
  }

  return new Blob([view], { type: 'audio/wav' });
}

export function bufferToMp3(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const kbps = 128; // default to 128kbps

  const mp3encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, kbps);
  const samples = [];

  // Convert float32 to int16
  for (let i = 0; i < numChannels; i++) {
    const channelData = buffer.getChannelData(i);
    const int16ChannelData = new Int16Array(channelData.length);
    for (let j = 0; j < channelData.length; j++) {
      int16ChannelData[j] = Math.max(-32768, Math.min(32767, channelData[j] * 32767));
    }
    samples.push(int16ChannelData);
  }

  const mp3Data = [];
  const sampleBlockSize = 1152; // multiple of 576
  const left = samples[0];
  const right = numChannels > 1 ? samples[1] : left;

  for (let i = 0; i < left.length; i += sampleBlockSize) {
    const leftChunk = left.subarray(i, i + sampleBlockSize);
    const rightChunk = right.subarray(i, i + sampleBlockSize);
    
    // Only encode full blocks or remaining
    const mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf);
    }
  }

  const mp3buf = mp3encoder.flush();
  if (mp3buf.length > 0) {
    mp3Data.push(mp3buf);
  }

  return new Blob(mp3Data, { type: 'audio/mp3' });
}
