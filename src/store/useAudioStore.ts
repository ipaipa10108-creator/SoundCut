import { create } from 'zustand';
import type { AudioClip, PlacedClip, TrackState, Settings, Segment } from '../types/audio';

const defaultTrackState: TrackState = {
  buffer: null,
  viewStartTime: 0,
  viewEndTime: 0,
  selectionStart: 0,
  selectionEnd: 0,
  isDragging: false,
  dragStartSeconds: 0,
  sourceNode: null,
  playbackStartTime: 0,
  playbackOffset: 0,
};

const defaultSettings: Settings = {
  shortcuts: {
    play: ' ',
    preview: 'p',
    extract: 't',
    keep: 's',
    amplify: 'a',
    cutout: 'c',
    speed1: '1',
    speed15: '2',
    speed2: '3',
    toggleClips: 'x',
  },
  seekStep: 1.0,
  mobileModalMode: false,
  showHoverHz: false,
};

interface AudioStore {
  // Global & AudioContext
  audioContext: AudioContext | null;
  initAudioContext: () => void;
  originalFileName: string;
  setOriginalFileName: (name: string) => void;
  
  // App States
  isLoading: boolean;
  statusMessage: string;
  setLoading: (isLoading: boolean, message?: string) => void;

  // Main Track
  mainTrack: TrackState;
  updateMainTrack: (updates: Partial<TrackState>) => void;
  
  // Secondary Track (Mixer)
  placedClips: PlacedClip[];
  setPlacedClips: (clips: PlacedClip[] | ((prev: PlacedClip[]) => PlacedClip[])) => void;

  // Clips Panel
  clips: AudioClip[];
  setClips: (clips: AudioClip[] | ((prev: AudioClip[]) => AudioClip[])) => void;
  activeInsertClipId: number | null;
  setActiveInsertClipId: (id: number | null) => void;

  // Modal Editor Track
  modalTrack: TrackState & { editingClipId: number | null };
  updateModalTrack: (updates: Partial<TrackState & { editingClipId: number | null }>) => void;

  // Extension Features
  globalHoverTime: number | null;
  setGlobalHoverTime: (time: number | null) => void;
  globalHoverHz: number | null;
  setGlobalHoverHz: (hz: number | null) => void;
  showClipsModal: boolean;
  setShowClipsModal: (show: boolean) => void;
  showMixerOnMain: boolean;
  setShowMixerOnMain: (show: boolean) => void;
  showAllSearchTargets: boolean;
  setShowAllSearchTargets: (show: boolean) => void;

  // History for Undo/Redo
  mainTrackHistory: AudioBuffer[];
  mainTrackRedoHistory: AudioBuffer[];
  pushHistory: (buffer: AudioBuffer) => void;
  undo: () => void;
  redo: () => void;

  // Search & Segments
  foundSegments: Segment[];
  currentSegmentIndex: number;
  setSegmentsState: (segments: Segment[], index: number) => void;

  // Playback Control
  activePlaybackNodes: AudioBufferSourceNode[];
  setActivePlaybackNodes: (nodes: AudioBufferSourceNode[]) => void;
  currentPlaybackSpeed: number;
  setPlaybackSpeed: (speed: number) => void;
  speedLastUpdate: number;
  speedAccumulatedTime: number;
  setSpeedTracking: (lastUpdate: number, accTime: number) => void;
  isPlayingMixed: boolean;
  setIsPlayingMixed: (isMixed: boolean) => void;

  // Settings
  settings: Settings;
  updateSettings: (newSettings: Partial<Settings>) => void;
  
  // Functions
  resetApp: () => void;
  toggleMainPlayback: () => void;
}

export const useAudioStore = create<AudioStore>((set, get) => ({
  audioContext: null,
  initAudioContext: () => {
    if (!get().audioContext) {
      try {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioContext();
        set({ audioContext: ctx });
        
        const resumeContext = () => {
          if (ctx.state === 'suspended') ctx.resume();
          document.body.removeEventListener('click', resumeContext);
        };
        document.body.addEventListener('click', resumeContext);
      } catch (e) {
        alert('您的瀏覽器不支援 Web Audio API。');
      }
    }
  },
  originalFileName: '',
  setOriginalFileName: (name) => set({ originalFileName: name }),

  isLoading: false,
  statusMessage: '',
  setLoading: (isLoading, message = '') => set({ isLoading, statusMessage: message }),

  mainTrack: { ...defaultTrackState },
  updateMainTrack: (updates) => set((state) => ({ mainTrack: { ...state.mainTrack, ...updates } })),

  placedClips: [],
  setPlacedClips: (clips) => set((state) => ({ 
    placedClips: typeof clips === 'function' ? clips(state.placedClips) : clips 
  })),

  clips: [],
  setClips: (clips) => set((state) => ({ 
    clips: typeof clips === 'function' ? clips(state.clips) : clips 
  })),
  activeInsertClipId: null,
  setActiveInsertClipId: (id) => set({ activeInsertClipId: id }),

  modalTrack: { ...defaultTrackState, editingClipId: null },
  updateModalTrack: (updates) => set((state) => ({ modalTrack: { ...state.modalTrack, ...updates } })),

  foundSegments: [],
  currentSegmentIndex: -1,
  setSegmentsState: (segments, index) => set({ foundSegments: segments, currentSegmentIndex: index }),

  // Extension features implementations
  globalHoverTime: null,
  setGlobalHoverTime: (time) => set({ globalHoverTime: time }),
  globalHoverHz: null,
  setGlobalHoverHz: (hz) => set({ globalHoverHz: hz }),
  showClipsModal: false,
  setShowClipsModal: (show) => set({ showClipsModal: show }),
  showMixerOnMain: false,
  setShowMixerOnMain: (show) => set({ showMixerOnMain: show }),
  showAllSearchTargets: false,
  setShowAllSearchTargets: (show) => set({ showAllSearchTargets: show }),

  mainTrackHistory: [],
  mainTrackRedoHistory: [],
  pushHistory: (buffer) => set((state) => {
    // Keep max 10 steps to prevent OOM
    const newHistory = [...state.mainTrackHistory, buffer].slice(-10);
    return { mainTrackHistory: newHistory, mainTrackRedoHistory: [] };
  }),
  undo: () => set((state) => {
    if (state.mainTrackHistory.length === 0 || !state.mainTrack.buffer) return state;
    const prevBuffer = state.mainTrackHistory[state.mainTrackHistory.length - 1];
    const newHistory = state.mainTrackHistory.slice(0, -1);
    const newRedo = [state.mainTrack.buffer, ...state.mainTrackRedoHistory];
    return {
      mainTrackHistory: newHistory,
      mainTrackRedoHistory: newRedo,
      mainTrack: { ...state.mainTrack, buffer: prevBuffer, selectionStart: 0, selectionEnd: prevBuffer.duration, viewStartTime: 0, viewEndTime: prevBuffer.duration }
    };
  }),
  redo: () => set((state) => {
    if (state.mainTrackRedoHistory.length === 0 || !state.mainTrack.buffer) return state;
    const nextBuffer = state.mainTrackRedoHistory[0];
    const newRedo = state.mainTrackRedoHistory.slice(1);
    const newHistory = [...state.mainTrackHistory, state.mainTrack.buffer];
    return {
      mainTrackHistory: newHistory,
      mainTrackRedoHistory: newRedo,
      mainTrack: { ...state.mainTrack, buffer: nextBuffer, selectionStart: 0, selectionEnd: nextBuffer.duration, viewStartTime: 0, viewEndTime: nextBuffer.duration }
    };
  }),

  activePlaybackNodes: [],
  setActivePlaybackNodes: (nodes) => set({ activePlaybackNodes: nodes }),
  currentPlaybackSpeed: 1.0,
  setPlaybackSpeed: (speed) => set({ currentPlaybackSpeed: speed }),
  speedLastUpdate: 0,
  speedAccumulatedTime: 0,
  setSpeedTracking: (lastUpdate, accTime) => set({ speedLastUpdate: lastUpdate, speedAccumulatedTime: accTime }),
  isPlayingMixed: false,
  setIsPlayingMixed: (isMixed) => set({ isPlayingMixed: isMixed }),

  settings: defaultSettings, // Initialize with default settings
  updateSettings: (newSettings) => set((state) => {
    const updated = { ...state.settings, ...newSettings };
    localStorage.setItem('soundCutSettings', JSON.stringify(updated));
    return { settings: updated };
  }),

  resetApp: () => set({
    mainTrack: { ...defaultTrackState },
    clips: [],
    placedClips: [],
    activeInsertClipId: null,
    foundSegments: [],
    currentSegmentIndex: -1,
    isPlayingMixed: false,
    activePlaybackNodes: [],
    mainTrackHistory: [],
    mainTrackRedoHistory: [],
  }),

  toggleMainPlayback: () => {
    const state = get();
    if (!state.audioContext || !state.mainTrack.buffer) return;

    if (state.mainTrack.sourceNode || state.activePlaybackNodes.length > 0) {
      state.activePlaybackNodes.forEach(node => { try { node.stop(); } catch(e){} node.disconnect(); });
      set({ activePlaybackNodes: [], isPlayingMixed: false });
      state.updateMainTrack({ sourceNode: null });
      return;
    }

    let duration = state.mainTrack.selectionEnd - state.mainTrack.selectionStart;
    if (duration <= 0.001) duration = state.mainTrack.buffer.duration - state.mainTrack.selectionStart;
    if (duration <= 0) return;

    const sourceNode = state.audioContext.createBufferSource();
    sourceNode.buffer = state.mainTrack.buffer;
    sourceNode.connect(state.audioContext.destination);
    
    // Manage ended state carefully
    sourceNode.onended = () => {
      const curState = get();
      if (curState.mainTrack.sourceNode === sourceNode) {
        set({ activePlaybackNodes: [] });
        curState.updateMainTrack({ sourceNode: null });
      }
    };

    state.updateMainTrack({
      sourceNode,
      playbackStartTime: state.audioContext.currentTime,
      playbackOffset: state.mainTrack.selectionStart
    });

    sourceNode.playbackRate.value = state.currentPlaybackSpeed;
    sourceNode.start(0, state.mainTrack.selectionStart, duration);

    set({ activePlaybackNodes: [sourceNode] });
    state.setSpeedTracking(state.audioContext.currentTime, 0);
  }
}));
