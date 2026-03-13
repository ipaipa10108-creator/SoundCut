import type { PlacedClip } from '../types/audio';

interface DrawWaveformOptions {
  canvas: HTMLCanvasElement;
  buffer: AudioBuffer;
  viewStartTime: number;
  viewEndTime: number;
  isMain?: boolean;
  rulerHeight?: number;
}

function getTickInterval(duration: number) {
  if (duration > 600) return 60;
  if (duration > 300) return 30;
  if (duration > 120) return 10;
  if (duration > 60) return 5;
  if (duration > 20) return 2;
  if (duration > 10) return 1;
  if (duration > 2) return 0.5;
  if (duration > 1) return 0.2;
  return 0.1;
}

export function formatRulerTime(seconds: number) {
  if (isNaN(seconds) || seconds < 0) return "00:00.0";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}

export function drawWaveform({
  canvas,
  buffer,
  viewStartTime,
  viewEndTime,
  isMain = false,
  rulerHeight = 20
}: DrawWaveformOptions) {
  const ctx = canvas.getContext('2d');
  if (!ctx || !canvas.width || !canvas.height) return;

  const canvasWidth = canvas.width;
  const canvasHeight = canvas.height;
  const actualRulerHeight = isMain ? rulerHeight : 0;
  const waveformHeight = canvasHeight - actualRulerHeight;
  
  const data = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const amp = waveformHeight / 2;
  const viewDuration = viewEndTime - viewStartTime;

  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  // Optional background
  // ctx.fillStyle = '#fdfdfd';
  // ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  if (isMain) {
    const tickInterval = getTickInterval(viewDuration);
    const firstTick = Math.ceil(viewStartTime / tickInterval) * tickInterval;
    ctx.strokeStyle = '#e0e0e0';
    ctx.fillStyle = '#999';
    ctx.font = '10px sans-serif';
    ctx.beginPath();
    for (let t = firstTick; t < viewEndTime; t += tickInterval) {
      const x = ((t - viewStartTime) / viewDuration) * canvasWidth;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvasHeight);
      ctx.fillText(formatRulerTime(t), x + 3, actualRulerHeight - 8);
    }
    ctx.moveTo(0, actualRulerHeight);
    ctx.lineTo(canvasWidth, actualRulerHeight);
    ctx.stroke();
  }

  // Draw Wave
  ctx.strokeStyle = 'rgb(26, 115, 232)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  
  const viewSampleStart = Math.floor(viewStartTime * sampleRate);
  const samplesPerPixel = Math.max(1, Math.floor(viewDuration * sampleRate / canvasWidth));
  
  for (let x = 0; x < canvasWidth; x++) {
    const sampleStartIndex = viewSampleStart + (x * samplesPerPixel);
    let min = 1.0, max = -1.0;
    
    for (let i = 0; i < samplesPerPixel; i++) {
        const sample = data[sampleStartIndex + i] || 0;
        if (sample < min) min = sample;
        if (sample > max) max = sample;
    }
    
    const y_max = actualRulerHeight + (1 - max) * amp;
    const y_min = actualRulerHeight + (1 - min) * amp;
    ctx.moveTo(x, y_max);
    ctx.lineTo(x, y_min);
  }
  ctx.stroke();
}

export function drawSecondaryWaveform(
  canvas: HTMLCanvasElement,
  placedClips: PlacedClip[],
  viewStartTime: number,
  viewEndTime: number
) {
  const ctx = canvas.getContext('2d');
  if (!ctx || !canvas.width || !canvas.height) return;

  const canvasWidth = canvas.width;
  const canvasHeight = canvas.height;
  const viewDuration = viewEndTime - viewStartTime;

  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  
  ctx.strokeStyle = '#e0e0e0';
  ctx.beginPath();
  ctx.moveTo(0, canvasHeight / 2);
  ctx.lineTo(canvasWidth, canvasHeight / 2);
  ctx.stroke();

  const amp = canvasHeight / 2;

  placedClips.forEach(pClip => {
    const clipStart = pClip.startTime;
    const clipEnd = pClip.startTime + pClip.buffer.duration;
    if (clipEnd < viewStartTime || clipStart > viewEndTime) return;

    const data = pClip.buffer.getChannelData(0);
    const sampleRate = pClip.buffer.sampleRate;
    
    // Different colors for different clips
    ctx.strokeStyle = `hsl(${(pClip.id % 360)}, 60%, 50%)`;
    ctx.lineWidth = 1;
    ctx.beginPath();

    const startX = Math.floor(((clipStart - viewStartTime) / viewDuration) * canvasWidth);
    const endX = Math.ceil(((clipEnd - viewStartTime) / viewDuration) * canvasWidth);

    for (let x = Math.max(0, startX); x < Math.min(canvasWidth, endX); x++) {
      const timeAtPixel = viewStartTime + (x / canvasWidth) * viewDuration;
      const timeIntoClip = timeAtPixel - clipStart;
      
      const samplesPerPixel = viewDuration * sampleRate / canvasWidth;
      const sampleStartIndex = Math.floor(timeIntoClip * sampleRate);
      
      let min = 1.0, max = -1.0;
      for (let i = 0; i < samplesPerPixel; i++) {
        const sample = data[sampleStartIndex + i] || 0;
        if (sample < min) min = sample;
        if (sample > max) max = sample;
      }
      
      if (min > 1.0) continue; // Out of bounds inside loop 
      
      const y_max = (1 - max) * amp;
      const y_min = (1 - min) * amp;
      if (x === startX) {
        ctx.moveTo(x, y_max);
      } else {
        ctx.lineTo(x, y_max);
      }
      ctx.lineTo(x, y_min);
    }
    ctx.stroke();
  });
}
