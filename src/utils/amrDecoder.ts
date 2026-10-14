import BenzAMRRecorder from 'benz-amr-recorder';

/**
 * Checks if the given buffer starts with the standard AMR magic header.
 * AMR-NB: "#!AMR\n" (0x23, 0x21, 0x41, 0x4D, 0x52, 0x0A)
 * AMR-WB: "#!AMR-WB\n" (0x23, 0x21, 0x41, 0x4D, 0x52, 0x2D, 0x57, 0x42, 0x0A)
 */
export function isAmrBuffer(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 6) return false;
  const bytes = new Uint8Array(buffer, 0, Math.min(10, buffer.byteLength));
  // Check for "#!AMR"
  return (
    bytes[0] === 0x23 &&
    bytes[1] === 0x21 &&
    bytes[2] === 0x41 &&
    bytes[3] === 0x4d &&
    bytes[4] === 0x52
  );
}

/**
 * Checks if filename suggests an AMR/ARM audio file
 */
export function isAmrFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith('.amr') || lower.endsWith('.arm');
}

/**
 * Decodes an AMR or ARM ArrayBuffer into a standard Web Audio API AudioBuffer.
 * Handles missing magic header repair if needed.
 */
export async function decodeAmrAudio(
  arrayBuffer: ArrayBuffer,
  audioContext: AudioContext
): Promise<AudioBuffer> {
  let bufferToDecode = arrayBuffer;

  // If missing AMR header, check if it looks like raw AMR frames and prepend "#!AMR\n"
  if (!isAmrBuffer(bufferToDecode)) {
    const bytes = new Uint8Array(bufferToDecode);
    // Typical AMR frame toc: bit 7 is 0, bits 3-6 are mode (0-8)
    const firstByte = bytes[0];
    const isLikelyRawAmr = (firstByte & 0x80) === 0 && ((firstByte >> 3) & 0x0f) <= 8;
    if (isLikelyRawAmr) {
      const header = new Uint8Array([0x23, 0x21, 0x41, 0x4d, 0x52, 0x0a]); // "#!AMR\n"
      const combined = new Uint8Array(header.length + bytes.length);
      combined.set(header, 0);
      combined.set(bytes, header.length);
      bufferToDecode = combined.buffer;
    }
  }

  const blob = new Blob([bufferToDecode], { type: 'audio/amr' });
  const amr = new BenzAMRRecorder();

  await amr.initWithBlob(blob);

  // Retrieve raw samples decoded by benz-amr-recorder
  const samples: Float32Array = (amr as any)._samples;
  if (!samples || samples.length === 0) {
    amr.destroy();
    throw new Error('無法從 AMR 檔案中解析出音訊樣本。');
  }

  // AMR-NB standard sample rate is 8000 Hz, single channel
  const sampleRate = 8000;
  const audioBuffer = audioContext.createBuffer(1, samples.length, sampleRate);
  audioBuffer.getChannelData(0).set(samples);

  amr.destroy();
  return audioBuffer;
}
