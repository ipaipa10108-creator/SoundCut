import { useState } from 'react';
import { useAudioStore } from '../store/useAudioStore';
import { X, Save, RotateCcw } from 'lucide-react';

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const { settings, updateSettings } = useAudioStore();
  const [localSettings, setLocalSettings] = useState(settings);

  const handleChange = (key: keyof typeof settings.shortcuts, value: string) => {
    setLocalSettings(prev => ({
      ...prev,
      shortcuts: { ...prev.shortcuts, [key]: value.toLowerCase() }
    }));
  };

  const handleSave = () => {
    updateSettings(localSettings);
    alert('設定已儲存！');
    onClose();
  };

  const handleReset = () => {
    if (confirm("確定要恢復預設值嗎？")) {
      const defaultSettings = {
        shortcuts: {
          play: ' ', preview: 'p', extract: 't', keep: 's', amplify: 'a', cutout: 'c', speed1: '1', speed15: '2', speed2: '3', toggleClips: 'x'
        },
        seekStep: 1.0,
        mobileModalMode: false,
        showHoverHz: false,
      };
      setLocalSettings(defaultSettings);
      updateSettings(defaultSettings);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[1001] flex items-center justify-center p-4 backdrop-blur-sm transition-opacity" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl p-6 relative flex flex-col max-h-[90vh] animate-scale-in" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-800 transition-colors">
          <X size={24} />
        </button>
        <h3 className="text-xl font-bold mb-4 border-b pb-4 text-gray-800">設定</h3>
        
        <div className="overflow-y-auto pr-2 scrollbar-thin flex flex-col gap-6">
          <div>
            <h4 className="font-semibold text-gray-700 mb-4 border-l-4 border-primary pl-3">快捷鍵設定</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-gray-500 mb-1 block">播放 / 暫停 (預設: 空白鍵)</label>
                <input type="text" className="input" maxLength={1} value={localSettings.shortcuts.play} onChange={e => handleChange('play', e.target.value)} />
              </div>
              <div>
                <label className="text-sm text-gray-500 mb-1 block">開啟/關閉片段列表</label>
                <input type="text" className="input" maxLength={1} value={localSettings.shortcuts.toggleClips} onChange={e => handleChange('toggleClips', e.target.value)} />
              </div>
              <div>
                <label className="text-sm text-gray-500 mb-1 block">預覽混音 / 暫停</label>
                <input type="text" className="input" maxLength={1} value={localSettings.shortcuts.preview} onChange={e => handleChange('preview', e.target.value)} />
              </div>
              <div>
                <label className="text-sm text-gray-500 mb-1 block">提取成新片段</label>
                <input type="text" className="input" maxLength={1} value={localSettings.shortcuts.extract} onChange={e => handleChange('extract', e.target.value)} />
              </div>
              <div>
                <label className="text-sm text-gray-500 mb-1 block">保留選區 (捨棄其他)</label>
                <input type="text" className="input" maxLength={1} value={localSettings.shortcuts.keep} onChange={e => handleChange('keep', e.target.value)} />
              </div>
              <div>
                <label className="text-sm text-gray-500 mb-1 block">增強選區音量</label>
                <input type="text" className="input" maxLength={1} value={localSettings.shortcuts.amplify} onChange={e => handleChange('amplify', e.target.value)} />
              </div>
              <div>
                <label className="text-sm text-gray-500 mb-1 block">剪除選區</label>
                <input type="text" className="input" maxLength={1} value={localSettings.shortcuts.cutout} onChange={e => handleChange('cutout', e.target.value)} />
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-semibold text-gray-700 mb-4 border-l-4 border-primary pl-3">播放速度 (數字鍵)</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <label className="flex items-center justify-between bg-gray-50 p-3 rounded-lg border">
                <span>1.0x</span>
                <input type="text" className="w-16 text-center border rounded px-2 py-1" value={localSettings.shortcuts.speed1} onChange={e => handleChange('speed1', e.target.value)} />
              </label>
              <label className="flex items-center justify-between bg-gray-50 p-3 rounded-lg border">
                <span>1.5x</span>
                <input type="text" className="w-16 text-center border rounded px-2 py-1" value={localSettings.shortcuts.speed15} onChange={e => handleChange('speed15', e.target.value)} />
              </label>
              <label className="flex items-center justify-between bg-gray-50 p-3 rounded-lg border">
                <span>2.0x</span>
                <input type="text" className="w-16 text-center border rounded px-2 py-1" value={localSettings.shortcuts.speed2} onChange={e => handleChange('speed2', e.target.value)} />
              </label>
            </div>
          </div>

          <div className="mb-6">
            <h3 className="font-semibold text-gray-700 mb-3 border-b pb-2">介面與操作行為</h3>
            
            <div className="flex items-center justify-between bg-gray-50 p-4 rounded-xl border border-gray-100 mb-4">
              <div>
                <p className="font-medium text-gray-700">行動裝置 Modal 模式</p>
                <p className="text-sm text-gray-500">啟用後，選取片段才會跳出操作選單，智慧尋找也會以彈出視窗呈現，適合手機小螢幕操作。</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  className="sr-only peer" 
                  checked={localSettings.mobileModalMode}
                  onChange={(e) => setLocalSettings(prev => ({ ...prev, mobileModalMode: e.target.checked }))}
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>

            <div className="flex items-center justify-between bg-gray-50 p-4 rounded-xl border border-gray-100 mb-4">
              <div>
                <p className="font-medium text-gray-700">游標懸停時顯示頻率 (Hz)</p>
                <p className="text-sm text-gray-500">啟用後，在波形上滑動時，時間下方會顯示對應的頻率數值，直觀得知聲音變化。</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  className="sr-only peer" 
                  checked={localSettings.showHoverHz}
                  onChange={(e) => setLocalSettings(prev => ({ ...prev, showHoverHz: e.target.checked }))}
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>

            <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
              <label className="text-sm font-medium text-gray-700 mb-1 block">方向鍵移動微調步進 (秒)</label>
              <input 
                type="number" 
                className="input w-32" 
                step={0.1} 
                min={0.1}
                value={localSettings.seekStep} 
                onChange={e => setLocalSettings(prev => ({ ...prev, seekStep: parseFloat(e.target.value) || 1.0 }))} 
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-8 pt-4 border-t">
          <button className="btn btn-warning" onClick={handleReset}>
            <RotateCcw size={18} /> 恢復預設
          </button>
          <button className="btn btn-primary px-6" onClick={handleSave}>
            <Save size={18} /> 儲存設定
          </button>
        </div>
      </div>
    </div>
  );
}
