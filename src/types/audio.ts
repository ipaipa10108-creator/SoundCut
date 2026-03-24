export interface AudioClip {
  id: number;
  name: string;
  buffer: AudioBuffer;
}

export interface PlacedClip {
  id: number;
  sourceClipId: number;
  buffer: AudioBuffer;
  startTime: number;
}

export interface TrackState {
  buffer: AudioBuffer | null;
  viewStartTime: number;
  viewEndTime: number;
  selectionStart: number;
  selectionEnd: number;
  isDragging: boolean;
  dragStartSeconds: number;
  sourceNode: AudioBufferSourceNode | null;
  playbackStartTime: number;
  playbackOffset: number;
}

export interface Settings {
  shortcuts: {
    play: string;
    preview: string;
    extract: string;
    keep: string;
    amplify: string;
    cutout: string;
    speed1: string;
    speed15: string;
    speed2: string;
    toggleClips: string;
  };
  seekStep: number;
  mobileModalMode: boolean;
  showHoverHz: boolean;
}

export interface Segment {
  start: number;
  end: number;
}
