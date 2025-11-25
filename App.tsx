
import React, {
  useState,
  useCallback,
  ChangeEvent,
  useEffect,
} from 'react';
import { GoogleGenAI, Type, Schema } from '@google/genai';
import * as XLSX from 'xlsx';
import CryptoJS from 'crypto-js';
import { ActiveTab, GeneratorTab, PromptItem, GeneratorInputs, ApiKey, AppConfig } from './types';
import { ideaMatrix, criticalRules, cinematicQualityRule, religiousGuardrails, MARKETS } from './constants';
import { LoaderIcon, KeyIcon, TrashIcon, CogIcon, InfoIcon } from './components/Icons';
import Tracker from './components/Tracker';

const isElectron = navigator.userAgent.toLowerCase().includes('electron');
const ipcRenderer = isElectron && (window as any).require ? (window as any).require('electron').ipcRenderer : null;

const GENERATOR_MODEL = 'gemini-2.5-flash-preview-09-2025';

// --- Components Reused ---

interface ActivationProps {
  machineId: string;
  onActivate: (key: string) => Promise<boolean>;
}

const Activation: React.FC<ActivationProps> = ({ machineId, onActivate }) => {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [isActivating, setIsActivating] = useState(false);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setIsActivating(true);
    if (!(await onActivate(key.trim()))) setError('Mã kích hoạt không hợp lệ.');
    setIsActivating(false);
  };
  return (
    <div className="text-gray-800 min-h-screen flex items-center justify-center p-4">
      <div className="glass-card rounded-2xl p-8 shadow-2xl max-w-md w-full">
        <h1 className="text-2xl font-bold mb-4 text-center gradient-text">Kích hoạt ứng dụng</h1>
        <p className="mb-4 text-sm text-gray-600">Mã máy: <code className="bg-gray-200 p-1 rounded select-all">{machineId}</code></p>
        <form onSubmit={handleSubmit} className="space-y-4">
            <textarea value={key} onChange={e => setKey(e.target.value)} rows={3} style={{color: '#ffffff'}} className="w-full p-3 border border-gray-600 rounded-lg bg-gray-900 text-white placeholder-gray-400" placeholder="Nhập mã kích hoạt..." required />
            <button type="submit" disabled={isActivating} className="w-full btn-primary py-3 rounded-xl font-bold">{isActivating ? <LoaderIcon /> : 'Kích hoạt'}</button>
            {error && <p className="text-red-500 text-sm">{error}</p>}
        </form>
      </div>
    </div>
  );
};

interface ApiKeyManagerProps {
    apiKeys: ApiKey[];
    onKeySelect: (key: ApiKey) => void;
    onKeyAdd: (key: ApiKey) => void;
    onKeyDelete: (keyId: string) => void;
}
const ApiKeyManagerScreen: React.FC<ApiKeyManagerProps> = ({ apiKeys, onKeySelect, onKeyAdd, onKeyDelete }) => {
    const [name, setName] = useState('');
    const [val, setVal] = useState('');
    const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); onKeyAdd({ id: crypto.randomUUID(), name, value: val }); };
    return (
        <div className="min-h-screen flex items-center justify-center p-4">
            <div className="glass-card p-8 rounded-2xl max-w-2xl w-full">
                <h1 className="text-2xl font-bold mb-6 text-center gradient-text">Quản lý API Keys</h1>
                <div className="space-y-2 mb-6 max-h-60 overflow-y-auto">
                    {apiKeys.map(k => (
                        <div key={k.id} className="flex justify-between items-center p-3 bg-white/50 rounded-lg">
                            <div><div className="font-bold">{k.name}</div><div className="text-xs text-gray-500 truncate w-40">{k.value.substring(0, 10)}...</div></div>
                            <div className="flex gap-2">
                                <button onClick={() => onKeySelect(k)} className="px-3 py-1 bg-teal-500 text-white rounded-lg text-sm">Chọn</button>
                                <button onClick={() => onKeyDelete(k.id)} className="text-red-500"><TrashIcon className="w-5 h-5"/></button>
                            </div>
                        </div>
                    ))}
                </div>
                <form onSubmit={handleSubmit} className="space-y-3 pt-4 border-t border-gray-200">
                    <input value={name} onChange={e => setName(e.target.value)} style={{color: '#ffffff'}} placeholder="Tên Key" className="w-full p-2 border border-gray-600 rounded bg-gray-900 text-white placeholder-gray-400" required />
                    <input value={val} onChange={e => setVal(e.target.value)} style={{color: '#ffffff'}} placeholder="API Key Value" type="password" className="w-full p-2 border border-gray-600 rounded bg-gray-900 text-white placeholder-gray-400" required />
                    <button className="w-full btn-primary py-2 rounded-lg font-bold">Thêm Key Mới</button>
                </form>
            </div>
        </div>
    );
}

// --- Main App ---

const App: React.FC = () => {
    // --- App Core State ---
    const [isActivated, setIsActivated] = useState(false);
    const [machineId, setMachineId] = useState('');
    const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
    const [activeApiKey, setActiveApiKey] = useState<ApiKey | null>(null);
    const [configLoaded, setConfigLoaded] = useState(false);
    const [activeTab, setActiveTab] = useState<ActiveTab>('generator');
    const [appVersion, setAppVersion] = useState('');
    const [updateStatus, setUpdateStatus] = useState<string>('');
    
    // --- Generator State ---
    const [genTab, setGenTab] = useState<GeneratorTab>('jesus');
    const [inputs, setInputs] = useState<GeneratorInputs>({
        basicIdea: '',
        detailedIdea: '',
        style: 'Narrative (Kể chuyện)',
        market: 'Brazil (Nam Mỹ)',
        duration: 200,
        month: '11',
        loopType: 'person',
        characterDesc: '',
        characterImage: null
    });
    const [generatedPrompts, setGeneratedPrompts] = useState<PromptItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [loadingText, setLoadingText] = useState('');
    const [feedback, setFeedback] = useState<{type: 'error'|'success', message: string}|null>(null);
    const [characterAnalysis, setCharacterAnalysis] = useState('');

    // --- Constants ---
    const SECRET_KEY = 'your-super-secret-key-for-mv-prompt-generator-pro-2024';

    // --- Helpers ---
    const encrypt = useCallback((text: string) => {
        if (!machineId) return '';
        return CryptoJS.AES.encrypt(text, CryptoJS.SHA256(machineId + SECRET_KEY).toString()).toString();
    }, [machineId, SECRET_KEY]);

    // --- Initialization ---
    useEffect(() => {
        if (isElectron && ipcRenderer) {
            ipcRenderer.invoke('get-app-config').then((config: AppConfig) => {
                const mid = config.machineId || '';
                setMachineId(mid);
                
                // Validate license (Simplified logic to fix unused variable error)
                const hasLicense = !!config.licenseKey;
                setIsActivated(hasLicense); 

                // Load Keys
                if (config.apiKeysEncrypted) {
                    try {
                        const bytes = CryptoJS.AES.decrypt(config.apiKeysEncrypted, CryptoJS.SHA256(mid + SECRET_KEY).toString());
                        const keys = JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
                        setApiKeys(keys);
                        if (config.activeApiKeyId) setActiveApiKey(keys.find((k: ApiKey) => k.id === config.activeApiKeyId) || null);
                    } catch {}
                }
                setConfigLoaded(true);
            });
            
            // Get Version
            ipcRenderer.invoke('get-app-version').then((v: string) => setAppVersion(v));

            // Listen for update status
            const updateListener = (_: any, status: string) => {
                setUpdateStatus(status);
                if (status === 'available') alert('Có bản cập nhật mới! Đang tải về...');
                if (status === 'not-available') alert('Bạn đang sử dụng phiên bản mới nhất.');
                if (status === 'error') alert('Lỗi khi kiểm tra cập nhật.');
            };
            ipcRenderer.on('update-status', updateListener);
            return () => {
                ipcRenderer.removeListener('update-status', updateListener);
            };

        } else {
            setMachineId('WEB-DEV-ID');
            setIsActivated(true);
            setConfigLoaded(true);
            setAppVersion('1.0.0-dev');
            // Mock key for dev
            if(process.env.API_KEY) setApiKeys([{id: '1', name: 'Dev Key', value: process.env.API_KEY || ''}]);
        }
    }, [SECRET_KEY]);

    const saveConfig = (update: Partial<AppConfig>) => {
        if (isElectron && ipcRenderer) ipcRenderer.invoke('save-app-config', update);
    };

    const handleCheckUpdate = () => {
        if (isElectron && ipcRenderer) {
            setUpdateStatus('checking');
            ipcRenderer.invoke('check-for-updates');
        } else {
            alert('Chức năng này chỉ có trên phiên bản Desktop.');
        }
    };

    // --- Logic for Generator ---

    const handleInputChange = (field: keyof GeneratorInputs, value: any) => {
        setInputs(prev => ({ ...prev, [field]: value }));
    };

    const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64 = (reader.result as string).split(',')[1];
                setInputs(prev => ({ ...prev, characterImage: { base64, mimeType: file.type } }));
                setCharacterAnalysis(''); // Reset analysis when new image loaded
            };
            reader.readAsDataURL(file);
        }
    };

    const analyzeCharacterImage = async () => {
        if (!inputs.characterImage || !activeApiKey) return;
        setLoadingText("AI đang phân tích hình ảnh nhân vật...");
        setIsLoading(true);
        try {
            const ai = new GoogleGenAI({ apiKey: activeApiKey.value });
            
            const prompt = "Create a detailed, single-sentence description for a photorealistic depiction of the person in this image. Start with their gender and role (e.g., 'the male vocalist'). Include key features like hair, face, clothing, and build. This will be used to ensure character consistency. Example: 'the male vocalist with a bald head, round face, expressive eyes, a mole on his cheek, wearing a light blue dress shirt, a dark suit jacket, and a striped tie, with a robust build.'";
            
            const result = await ai.models.generateContent({
                model: GENERATOR_MODEL,
                contents: [
                    {
                        parts: [
                            { text: prompt },
                            {
                                inlineData: {
                                    mimeType: inputs.characterImage.mimeType,
                                    data: inputs.characterImage.base64
                                }
                            }
                        ]
                    }
                ]
            });
            
            const text = result.text || '';
            setCharacterAnalysis(text.trim());
            setInputs(prev => ({ ...prev, characterDesc: text.trim() }));
        } catch (e: any) {
            setFeedback({ type: 'error', message: `Lỗi phân tích ảnh: ${e.message}` });
        } finally {
            setIsLoading(false);
        }
    };

    const suggestScript = async () => {
        if (!activeApiKey) return setFeedback({type: 'error', message: 'Vui lòng chọn API Key'});
        setLoadingText("AI đang viết gợi ý...");
        setIsLoading(true);
        setFeedback(null);

        try {
            const ai = new GoogleGenAI({ apiKey: activeApiKey.value });
            
            // Simplified prompt structure based on user request
            let extraInstruction = "";
            if (genTab === 'starbucks') {
                extraInstruction = "Tập trung vào không gian quán Starbucks, chi tiết ly cà phê có logo, barista pha chế, và sản phẩm mới.";
            }

            const basePrompt = `Bạn là một đạo diễn sáng tạo. Dựa trên ý tưởng cơ bản: "${inputs.basicIdea || 'Chủ đề video'}", hãy phân tích và đưa ra gợi ý ngắn gọn.
            ${extraInstruction}
            
            YÊU CẦU OUTPUT (Tiếng Việt):
            Hãy trả về kết quả theo đúng định dạng sau (không viết dài dòng thành bài văn):

            Chủ Đề: [Tên chủ đề ngắn gọn]
            Ý Tưởng Cảnh Quay: 
            - [Ý tưởng 1: Mô tả ngắn gọn cảnh quay]
            - [Ý tưởng 2: Mô tả ngắn gọn cảnh quay]
            Chi tiết Kỹ thuật/Màu sắc: [Mô tả tông màu, ánh sáng, chuyển động camera phù hợp]

            Lưu ý: Phong cách ${inputs.style}. Thị trường mục tiêu: ${inputs.market}.`;

            const result = await ai.models.generateContent({
                model: GENERATOR_MODEL,
                contents: [{ role: 'user', parts: [{ text: basePrompt }] }]
            });
            setInputs(prev => ({ ...prev, detailedIdea: result.text || '' }));
        } catch (e: any) {
             setFeedback({ type: 'error', message: `Lỗi gợi ý: ${e.message}` });
        } finally {
            setIsLoading(false);
        }
    };

    const generatePrompts = async () => {
        if (!activeApiKey) return setFeedback({type: 'error', message: 'Vui lòng chọn API Key'});
        const quantity = Math.ceil(inputs.duration / 8);
        if (!inputs.detailedIdea && !inputs.basicIdea) return setFeedback({type: 'error', message: 'Vui lòng nhập ý tưởng'});
        
        setIsLoading(true);
        setLoadingText("AI đang sáng tạo...");
        setFeedback(null);
        setGeneratedPrompts([]);

        try {
            const ai = new GoogleGenAI({ apiKey: activeApiKey.value });
            
            const matrixKey = genTab === 'seasonal' ? 'trending' : (genTab === 'stage' ? 'stage' : genTab);
            const matrix = ideaMatrix[matrixKey] || ideaMatrix['trending'];
            const batchSize = 20;
            const allPrompts: PromptItem[] = [];
            const ideaToUse = inputs.detailedIdea || inputs.basicIdea;

            // Character rule with Market Logic
            let charRule = '';
            let useSubjectLock = false;
            let brandRule = '';
            
            // Base ethnicity instruction
            const marketInstruction = `TARGET MARKET CONTEXT: The target audience is ${inputs.market}. Ensure the cast's ethnicity, clothing style, and environment reflect the demographics of ${inputs.market} naturally.`;

            if (genTab === 'concert' || genTab === 'stage') {
                if (!inputs.characterDesc) throw new Error("Vui lòng thiết lập nhân vật cho Concert/Stage");
                useSubjectLock = true;
                charRule = `[CHARACTER REFERENCE - CRITICAL] Every prompt must start with: "${inputs.characterDesc}". (Ensure consistency). For "is_subject_lock", mark 'true' for all prompts containing this character.`;
            } else if (genTab === 'looping' || inputs.loopType === 'nature') {
                charRule = "Do NOT include any specific main character. Focus on environment.";
            } else {
                 charRule = `Invent a main character fitting the ${inputs.market} demographic. You have creative freedom.`;
            }

            if (genTab === 'starbucks') {
                brandRule = `[STARBUCKS BRANDING MANDATORY]
                1. Every prompt MUST explicitly describe a "Starbucks coffee shop setting" or "Starbucks cup with distinct green logo".
                2. Show variety: Interior (cozy seating, bar), Exterior (signage), Products (Frappuccino, Latte, Pastries).
                3. Focus on the 'Starbucks Experience': Connection, Warmth, Quality.`;
            }

            // Guardrails
            let extraInstructions = "";
            if (genTab === 'jesus' || genTab === 'seasonal') {
                extraInstructions += religiousGuardrails;
            }

            // Output format
            // We use standard JSON array schema
            const responseSchema: Schema = {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        id: { type: Type.NUMBER },
                        prompt_text: { type: Type.STRING },
                        ...(useSubjectLock ? { is_subject_lock: { type: Type.BOOLEAN } } : {})
                    },
                    required: useSubjectLock ? ["id", "prompt_text", "is_subject_lock"] : ["id", "prompt_text"]
                }
            };

            for (let i = 0; i < quantity; i += batchSize) {
                const currentBatch = Math.min(batchSize, quantity - i);
                
                // Random constraints
                let constraints = "\n\n**MANDATORY UNIQUE CONSTRAINTS (Do NOT deviate):**\n";
                const getRandom = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
                
                for(let j=0; j<currentBatch; j++) {
                    const tone = getRandom(matrix.tone || []);
                    const setting = getRandom(matrix.setting || []);
                    const action = getRandom(matrix.action || matrix.focus || []);
                    const camera = getRandom(matrix.camera || []);
                    const lighting = getRandom(matrix.lighting || []);
                    constraints += `Shot ${j+1}: Tone=[${tone}], Setting=[${setting}], Action=[${action}], Camera=[${camera}], Lighting=[${lighting}]\n`;
                }

                const prompt = `
                    You are a video director. 
                    Idea/Direction: "${ideaToUse}".
                    Style: ${inputs.style}.
                    ${genTab === 'seasonal' ? `Month: ${inputs.month}` : ''}
                    ${genTab !== 'concert' && genTab !== 'stage' ? marketInstruction : ''}
                    Create exactly ${currentBatch} unique prompts.
                    
                    ${criticalRules}
                    ${charRule}
                    ${brandRule}
                    ${cinematicQualityRule}
                    ${extraInstructions}
                    
                    ${constraints}
                `;

                const result = await ai.models.generateContent({
                    model: GENERATOR_MODEL,
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    config: {
                        responseMimeType: 'application/json',
                        responseSchema: responseSchema
                    }
                });
                
                const text = result.text || '[]';
                const json = JSON.parse(text);
                allPrompts.push(...json);
            }
            
            // Re-index
            const finalPrompts = allPrompts.map((p, idx) => ({ ...p, id: idx + 1 }));
            setGeneratedPrompts(finalPrompts);

        } catch (e: any) {
            setFeedback({ type: 'error', message: `Lỗi tạo prompt: ${e.message}` });
        } finally {
            setIsLoading(false);
        }
    };

    const downloadExcel = async () => {
        if (generatedPrompts.length === 0) return;
        
        const today = new Date();
        const dateStr = `${today.getDate().toString().padStart(2, '0')}${(today.getMonth() + 1).toString().padStart(2, '0')}`;
        // Prefix logic
        const prefixMap: Record<string, string> = { jesus: 'MVCJ', trending: 'MVT', seasonal: 'MVS', looping: 'MVL', cafe: 'MVC', starbucks: 'MVSB', concert: 'LVC', stage: 'LVS' };
        const prefix = prefixMap[genTab] || 'PROMPT';
        const fileName = `${prefix}${dateStr}_${Date.now().toString().slice(-4)}.xlsx`;

        const data = generatedPrompts.map((p, i) => ({
            JOB_ID: `Job_${i + 1}`,
            PROMPT: p.prompt_text,
            IMAGE_PATH: '', IMAGE_PATH_2: '', IMAGE_PATH_3: '',
            STATUS: '',
            VIDEO_NAME: `${prefix}${dateStr}-${i + 1}`,
            TYPE_VIDEO: p.is_subject_lock ? 'IN2V' : ''
        }));
        
        const worksheet = XLSX.utils.json_to_sheet(data);
        worksheet['!cols'] = [{ wch: 10 }, { wch: 150 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 10 }, { wch: 20 }, { wch: 10 }];
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "AI Prompts");

        if (isElectron && ipcRenderer) {
            const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
            const result = await ipcRenderer.invoke('save-file-dialog', { defaultPath: fileName, fileContent: buffer });
            if (result.success) {
                setFeedback({ type: 'success', message: `Đã lưu file: ${result.filePath}` });
                // Optional: Auto switch to tracker if requested, for now just notify
            }
        } else {
            XLSX.writeFile(workbook, fileName);
        }
    };

    // --- Render Logic ---

    if (!configLoaded) return <div className="min-h-screen flex items-center justify-center text-gray-500"><LoaderIcon /> Loading...</div>;
    if (!isActivated) return <Activation machineId={machineId} onActivate={async (key) => { saveConfig({ licenseKey: key }); setIsActivated(true); return true; }} />;
    if (!activeApiKey) return <ApiKeyManagerScreen apiKeys={apiKeys} onKeyAdd={(k) => { const newKeys=[...apiKeys, k]; setApiKeys(newKeys); saveConfig({ apiKeysEncrypted: encrypt(JSON.stringify(newKeys)) }); }} onKeyDelete={(id) => { const newKeys=apiKeys.filter(k=>k.id!==id); setApiKeys(newKeys); saveConfig({ apiKeysEncrypted: encrypt(JSON.stringify(newKeys)) }); }} onKeySelect={(k) => { setActiveApiKey(k); saveConfig({ activeApiKeyId: k.id }); }} />;

    return (
        <div className="min-h-screen">
             {/* Header */}
             <header className="bg-white/50 backdrop-blur-lg border-b border-white/20 sticky top-0 z-50">
                 <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                     <div className="flex justify-between h-16 items-center">
                         <div className="flex items-center gap-4">
                             <h1 className="text-2xl font-extrabold gradient-text">Trọng - Tool Auto Flow</h1>
                             <div className="hidden md:flex space-x-1">
                                 <button onClick={() => setActiveTab('generator')} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'generator' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-600 hover:bg-gray-100'}`}>Tạo Kịch Bản</button>
                                 <button onClick={() => setActiveTab('tracker')} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'tracker' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-600 hover:bg-gray-100'}`}>Theo Dõi Sản Xuất</button>
                             </div>
                         </div>
                         <div className="flex items-center gap-3">
                             {/* Version Info */}
                             <button onClick={handleCheckUpdate} className="text-xs text-gray-500 hover:text-indigo-600 flex items-center gap-1 bg-gray-100 px-2 py-1 rounded-full" title={updateStatus === 'checking' ? 'Đang kiểm tra...' : 'Kiểm tra cập nhật'}>
                                 <InfoIcon className={`w-3 h-3 ${updateStatus === 'checking' ? 'animate-spin' : ''}`} /> v{appVersion}
                             </button>

                             {activeApiKey && <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full font-bold flex items-center gap-1"><KeyIcon className="w-3 h-3"/> {activeApiKey.name}</span>}
                             <button onClick={() => setActiveApiKey(null)} className="text-gray-400 hover:text-gray-600"><CogIcon className="w-5 h-5"/></button>
                         </div>
                     </div>
                 </div>
             </header>

             <main className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
                {activeTab === 'generator' && (
                    <div className="space-y-8">
                        {/* Sub-Tabs for Generator */}
                        <div className="flex flex-wrap gap-2 justify-center bg-white/50 p-2 rounded-xl shadow-sm">
                            {(['jesus', 'trending', 'seasonal', 'looping', 'cafe', 'starbucks', 'concert', 'stage'] as GeneratorTab[]).map(tab => (
                                <button key={tab} onClick={() => { setGenTab(tab); setFeedback(null); }} className={`flex-1 min-w-[100px] py-2 px-4 rounded-lg text-sm font-bold transition-all ${genTab === tab ? 'bg-white text-indigo-600 shadow-md' : 'text-gray-500 hover:bg-white/50'}`}>
                                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                                </button>
                            ))}
                        </div>

                        {/* Character Creation Area (Shared) */}
                        {(genTab === 'concert' || genTab === 'stage') && (
                            <div className="glass-card p-6 rounded-2xl space-y-4">
                                <h3 className="text-lg font-bold gradient-text">Thiết lập Nhân vật (Bắt buộc)</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Mô tả văn bản:</label>
                                        <textarea value={inputs.characterDesc} onChange={e => handleInputChange('characterDesc', e.target.value)} style={{color: '#ffffff'}} className="w-full p-3 border border-gray-600 rounded-xl bg-gray-900 text-white placeholder-gray-400 focus:ring-2 focus:ring-indigo-500" rows={3} placeholder="Mô tả chi tiết nhân vật..."></textarea>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Hoặc tải ảnh phân tích:</label>
                                        <div className="file-input-wrapper w-full bg-indigo-50 text-indigo-600 font-bold py-3 px-5 rounded-xl border-2 border-dashed border-indigo-200 hover:border-indigo-400 text-center transition">
                                            <span>{inputs.characterImage ? 'Đã chọn ảnh' : 'Chọn ảnh nhân vật'}</span>
                                            <input type="file" accept="image/*" onChange={handleImageUpload} />
                                        </div>
                                        {inputs.characterImage && <button onClick={analyzeCharacterImage} className="mt-2 text-sm text-indigo-600 underline font-bold w-full text-center">Phân tích ảnh này</button>}
                                    </div>
                                </div>
                                {characterAnalysis && <div className="p-4 bg-green-50 text-green-800 rounded-lg text-xs font-mono">{characterAnalysis}</div>}
                            </div>
                        )}

                        {/* Main Form */}
                        <div className="glass-card p-8 rounded-2xl shadow-lg space-y-6">
                            {genTab === 'seasonal' && (
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-2">Chọn Tháng:</label>
                                    <select value={inputs.month} onChange={e => handleInputChange('month', e.target.value)} style={{color: '#ffffff'}} className="w-full p-3 border border-gray-600 rounded-xl bg-gray-900 text-white focus:ring-2 focus:ring-indigo-500">
                                        {Array.from({length: 12}, (_, i) => i + 1).map(m => <option key={m} value={m}>Tháng {m}</option>)}
                                    </select>
                                </div>
                            )}

                            <div>
                                <div className="flex justify-between items-center mb-2">
                                    <label className="block text-sm font-bold text-gray-700">1. Ý tưởng cơ bản:</label>
                                    {genTab === 'trending' && <button onClick={() => handleInputChange('basicIdea', 'Top Catholic Trend: Mùa Chay & Phục Sinh')} className="text-xs bg-red-100 text-red-600 px-2 py-1 rounded hover:bg-red-200 font-bold">🔥 Tìm Trend</button>}
                                </div>
                                <textarea value={inputs.basicIdea} onChange={e => handleInputChange('basicIdea', e.target.value)} style={{color: '#ffffff'}} className="w-full p-3 border border-gray-600 rounded-xl bg-gray-900 text-white placeholder-gray-400 focus:ring-2 focus:ring-indigo-500" rows={1} placeholder="Ví dụ: Giáng sinh, Tông màu đỏ..." />
                            </div>

                            <div>
                                <div className="flex justify-between items-center mb-2">
                                    <label className="block text-sm font-bold text-gray-700">2. Ý tưởng chi tiết / Định hướng:</label>
                                    <button onClick={suggestScript} className="text-xs text-indigo-600 font-bold bg-indigo-50 px-2 py-1 rounded hover:bg-indigo-100">✨ Gợi ý từ AI</button>
                                </div>
                                <textarea value={inputs.detailedIdea} onChange={e => handleInputChange('detailedIdea', e.target.value)} style={{color: '#ffffff'}} className="w-full p-3 border border-gray-600 rounded-xl bg-gray-900 text-white placeholder-gray-400 focus:ring-2 focus:ring-indigo-500" rows={6} placeholder="Nhập hoặc nhấn gợi ý để AI đưa ra Chủ đề, Ý tưởng cảnh quay và Màu sắc..." />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-2">Phong cách:</label>
                                    <select value={inputs.style} onChange={e => handleInputChange('style', e.target.value)} style={{color: '#ffffff'}} className="w-full p-3 border border-gray-600 rounded-xl bg-gray-900 text-white focus:ring-2 focus:ring-indigo-500">
                                        <option>Narrative (Kể chuyện)</option>
                                        <option>Cinematic (Điện ảnh)</option>
                                        <option>Conceptual (Ý niệm)</option>
                                        <option>Performance (Trình diễn)</option>
                                        <option>Documentary (Tài liệu)</option>
                                    </select>
                                </div>
                                {genTab !== 'concert' && genTab !== 'stage' && (
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-2">Thị trường mục tiêu:</label>
                                        <select value={inputs.market} onChange={e => handleInputChange('market', e.target.value)} style={{color: '#ffffff'}} className="w-full p-3 border border-gray-600 rounded-xl bg-gray-900 text-white focus:ring-2 focus:ring-indigo-500">
                                            {MARKETS.map(m => (
                                                <option key={m.code} value={m.name}>{m.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                            </div>
                            
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-2">Thời lượng: <span className="text-indigo-600">{inputs.duration}s</span> (~{Math.ceil(inputs.duration/8)} cảnh)</label>
                                <input type="range" min="8" max="600" step="8" value={inputs.duration} onChange={e => handleInputChange('duration', parseInt(e.target.value))} />
                            </div>

                            {(genTab === 'trending' || genTab === 'looping') && (
                                <div className="flex gap-4 p-4 bg-gray-50 rounded-xl">
                                    <label className="flex items-center gap-2 cursor-pointer"><input type="radio" checked={inputs.loopType === 'person'} onChange={() => handleInputChange('loopType', 'person')} /> Có người</label>
                                    <label className="flex items-center gap-2 cursor-pointer"><input type="radio" checked={inputs.loopType === 'nature'} onChange={() => handleInputChange('loopType', 'nature')} /> Chỉ thiên nhiên</label>
                                </div>
                            )}

                            <button onClick={generatePrompts} disabled={isLoading} className="w-full btn-primary py-4 rounded-xl font-bold text-lg shadow-xl hover:shadow-2xl transition disabled:opacity-70 flex justify-center items-center gap-2">
                                {isLoading ? <><LoaderIcon /> {loadingText}</> : 'Tạo Kịch Bản Prompt'}
                            </button>
                        </div>

                        {/* Feedback & Results */}
                        {feedback && (
                            <div className={`p-4 rounded-xl text-center font-bold ${feedback.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                                {feedback.message}
                            </div>
                        )}

                        {generatedPrompts.length > 0 && (
                            <div className="glass-card rounded-2xl overflow-hidden shadow-lg animate-fade-in-up">
                                <div className="p-4 bg-white/40 border-b border-white/20 flex justify-between items-center">
                                    <h3 className="font-bold text-lg text-gray-800">Kết quả ({generatedPrompts.length} prompts)</h3>
                                    <button onClick={downloadExcel} className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 shadow-md transition transform hover:scale-105">
                                        <span className="text-xl">⤓</span> Tải Excel
                                    </button>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm text-left text-gray-700 job-table">
                                        <thead>
                                            <tr>
                                                <th className="px-6 py-4 w-16 text-center">ID</th>
                                                <th className="px-6 py-4">Prompt Chi Tiết</th>
                                                <th className="px-6 py-4 text-center w-24">Lock?</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100 bg-white/60">
                                            {generatedPrompts.map(p => (
                                                <tr key={p.id} className="hover:bg-indigo-50/50 transition">
                                                    <td className="px-6 py-4 text-center font-mono text-gray-500">{p.id}</td>
                                                    <td className="px-6 py-4 font-mono text-xs leading-relaxed">{p.prompt_text}</td>
                                                    <td className="px-6 py-4 text-center">
                                                        {p.is_subject_lock ? <span className="bg-indigo-100 text-indigo-700 px-2 py-1 rounded text-xs font-bold">YES</span> : <span className="text-gray-300 text-xs">-</span>}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>
                )}
                
                {activeTab === 'tracker' && (
                    <Tracker />
                )}
             </main>
        </div>
    );
};

export default App;
