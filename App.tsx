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
import { 
    LoaderIcon, KeyIcon, TrashIcon, CogIcon, InfoIcon, DownloadIcon, XCircleIcon,
    FlameIcon, CalendarIcon, LoopIcon, CoffeeIcon, MicIcon, StageIcon,
    SparklesIcon, ClockIcon, LightningIcon, UserIcon, MountainIcon, UploadIcon
} from './components/Icons';
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
    <div className="text-gray-800 min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-red-50 to-green-50">
      <div className="glass-card rounded-2xl p-8 shadow-2xl max-w-md w-full border-t-4 border-red-500">
        <h1 className="text-2xl font-bold mb-4 text-center text-red-700">🎄 Kích hoạt ứng dụng</h1>
        <p className="mb-4 text-sm text-gray-600">Mã máy: <code className="bg-gray-200 p-1 rounded select-all text-green-700 font-bold">{machineId}</code></p>
        <form onSubmit={handleSubmit} className="space-y-4">
            <textarea value={key} onChange={e => setKey(e.target.value)} rows={3} style={{color: '#ffffff'}} className="w-full p-3 border border-gray-600 rounded-lg bg-gray-800 text-white placeholder-gray-400 focus:ring-2 focus:ring-red-500" placeholder="Nhập mã kích hoạt..." required />
            <button type="submit" disabled={isActivating} className="w-full btn-primary py-3 rounded-xl font-bold shadow-lg">{isActivating ? <LoaderIcon /> : 'Kích hoạt ngay'}</button>
            {error && <p className="text-red-500 text-sm font-bold bg-red-50 p-2 rounded">{error}</p>}
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
        <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
            <div className="glass-card p-8 rounded-2xl max-w-2xl w-full border border-green-100 shadow-xl">
                <h1 className="text-2xl font-bold mb-6 text-center text-green-800">Quản lý API Keys 🔑</h1>
                <div className="space-y-2 mb-6 max-h-60 overflow-y-auto custom-scrollbar">
                    {apiKeys.map(k => (
                        <div key={k.id} className="flex justify-between items-center p-3 bg-white border border-gray-100 rounded-lg shadow-sm hover:shadow-md transition">
                            <div><div className="font-bold text-gray-700">{k.name}</div><div className="text-xs text-gray-400 truncate w-40">{k.value.substring(0, 10)}...</div></div>
                            <div className="flex gap-2">
                                <button onClick={() => onKeySelect(k)} className="px-3 py-1 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700">Chọn</button>
                                <button onClick={() => onKeyDelete(k.id)} className="text-red-400 hover:text-red-600"><TrashIcon className="w-5 h-5"/></button>
                            </div>
                        </div>
                    ))}
                </div>
                <form onSubmit={handleSubmit} className="space-y-3 pt-4 border-t border-gray-200">
                    <input value={name} onChange={e => setName(e.target.value)} style={{color: '#ffffff'}} placeholder="Tên Key (VD: Key Giáng Sinh)" className="w-full p-2 border border-gray-600 rounded bg-gray-800 text-white placeholder-gray-400" required />
                    <input value={val} onChange={e => setVal(e.target.value)} style={{color: '#ffffff'}} placeholder="API Key Value" type="password" className="w-full p-2 border border-gray-600 rounded bg-gray-800 text-white placeholder-gray-400" required />
                    <button className="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded-lg font-bold shadow-md transition">Thêm Key Mới</button>
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
    const [activeTab, setActiveTab] = useState<ActiveTab>('tracker');
    const [appVersion, setAppVersion] = useState('');
    const [updateStatus, setUpdateStatus] = useState<string>('');
    
    // Update Logic States
    const [updateAvailableModal, setUpdateAvailableModal] = useState<any>(null);
    const [showProgressModal, setShowProgressModal] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [isDownloadingImmediate, setIsDownloadingImmediate] = useState(false);

    // --- Generator State ---
    const [genTab, setGenTab] = useState<GeneratorTab>('jesus');
    const [isConfigCollapsed, setIsConfigCollapsed] = useState(false); 
    const [inputs, setInputs] = useState<GeneratorInputs>({
        basicIdea: '',
        detailedIdea: '',
        style: 'Narrative (Kể chuyện)',
        market: 'Brazil (Nam Mỹ)',
        duration: 200,
        speed: 1.0,
        mode: 'character',
        month: '12',
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

    const shotDuration = 8 / inputs.speed;
    const totalPrompts = Math.ceil(inputs.duration / shotDuration);

    const cleanJsonOutput = (text: string) => {
        // Robust cleaning: extract the JSON array from Markdown code blocks or plain text
        let clean = text.trim();
        
        // 1. Try to find content inside ```json ... ``` or ``` ... ```
        const jsonBlockMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (jsonBlockMatch) {
            clean = jsonBlockMatch[1].trim();
        }

        // 2. Try to find the array brackets directly [ ... ]
        const startIndex = clean.indexOf('[');
        const endIndex = clean.lastIndexOf(']');
        
        if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
            clean = clean.substring(startIndex, endIndex + 1);
        }

        return clean;
    };

    // --- Initialization ---
    useEffect(() => {
        if (isElectron && ipcRenderer) {
            ipcRenderer.invoke('get-app-config').then((config: AppConfig) => {
                const mid = config.machineId || '';
                setMachineId(mid);
                const hasLicense = !!config.licenseKey;
                setIsActivated(hasLicense); 

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
            
            ipcRenderer.invoke('get-app-version').then((v: string) => setAppVersion(v));

            const updateStatusListener = (_: any, status: string, errorMsg?: string) => {
                setUpdateStatus(status);
                if (status === 'not-available') alert('Bạn đang sử dụng phiên bản mới nhất.');
                if (status === 'error' && errorMsg) alert('Lỗi kiểm tra cập nhật: ' + errorMsg);
            };

            const updateAvailableListener = (_: any, info: any) => {
                setUpdateAvailableModal(info);
            };

            const downloadProgressListener = (_: any, percent: number) => {
                setDownloadProgress(Math.round(percent));
            };

            const updateDownloadedListener = () => {
                if (isDownloadingImmediate) {
                    ipcRenderer.invoke('quit-and-install');
                }
            };

            ipcRenderer.on('update-status', updateStatusListener);
            ipcRenderer.on('update-available-prompt', updateAvailableListener);
            ipcRenderer.on('download-progress', downloadProgressListener);
            ipcRenderer.on('update-downloaded', updateDownloadedListener);

            return () => {
                ipcRenderer.removeListener('update-status', updateStatusListener);
                ipcRenderer.removeListener('update-available-prompt', updateAvailableListener);
                ipcRenderer.removeListener('download-progress', downloadProgressListener);
                ipcRenderer.removeListener('update-downloaded', updateDownloadedListener);
            };

        } else {
            setMachineId('WEB-DEV-ID');
            setIsActivated(true);
            setConfigLoaded(true);
            setAppVersion('1.0.0-dev');
            if(process.env.API_KEY) setApiKeys([{id: '1', name: 'Dev Key', value: process.env.API_KEY || ''}]);
        }
    }, [SECRET_KEY, isDownloadingImmediate]);

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

    const handleUpdateNow = () => {
        if (isElectron && ipcRenderer) {
            setIsDownloadingImmediate(true);
            setUpdateAvailableModal(null);
            setShowProgressModal(true);
            ipcRenderer.invoke('start-download-update');
        }
    };

    const handleUpdateLater = () => {
        if (isElectron && ipcRenderer) {
            setIsDownloadingImmediate(false);
            setUpdateAvailableModal(null);
            ipcRenderer.invoke('start-download-update');
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
                setCharacterAnalysis('');
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
                contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: inputs.characterImage.mimeType, data: inputs.characterImage.base64 } }] }]
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
        setLoadingText("AI đang viết gợi ý Giáng Sinh...");
        setIsLoading(true);
        setFeedback(null);

        try {
            const ai = new GoogleGenAI({ apiKey: activeApiKey.value });
            let extraInstruction = "";
            if (genTab === 'starbucks') extraInstruction = "Tập trung vào không gian quán Starbucks, chi tiết ly cà phê có logo, barista pha chế, và sản phẩm mới.";

            const basePrompt = `Bạn là một đạo diễn sáng tạo chuyên về chủ đề Giáng Sinh và Lễ Hội. Dựa trên ý tưởng cơ bản: "${inputs.basicIdea || 'Chủ đề video'}", hãy phân tích và đưa ra gợi ý ngắn gọn.
            ${extraInstruction}
            
            YÊU CẦU OUTPUT (Tiếng Việt):
            Hãy trả về kết quả theo đúng định dạng sau (không viết dài dòng thành bài văn):

            Chủ Đề: [Tên chủ đề ngắn gọn, mang không khí lễ hội]
            Ý Tưởng Cảnh Quay: 
            - [Ý tưởng 1: Mô tả ngắn gọn cảnh quay]
            - [Ý tưởng 2: Mô tả ngắn gọn cảnh quay]
            Chi tiết Kỹ thuật/Màu sắc: [Mô tả tông màu (Vàng ấm, Đỏ rượu, Xanh thông...), ánh sáng, chuyển động camera phù hợp]

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
        if (!inputs.detailedIdea && !inputs.basicIdea) return setFeedback({type: 'error', message: 'Vui lòng nhập ý tưởng'});
        
        setIsLoading(true);
        setLoadingText("AI đang sáng tạo không khí lễ hội...");
        setFeedback(null);
        setGeneratedPrompts([]);

        try {
            const ai = new GoogleGenAI({ apiKey: activeApiKey.value });
            const matrixKey = genTab === 'seasonal' ? 'trending' : (genTab === 'stage' ? 'stage' : genTab);
            const matrix = ideaMatrix[matrixKey] || ideaMatrix['trending'];
            const batchSize = 20;
            const allPrompts: PromptItem[] = [];
            const ideaToUse = inputs.detailedIdea || inputs.basicIdea;

            const marketInstruction = `TARGET MARKET CONTEXT: The target audience is ${inputs.market}. Ensure the cast's ethnicity, clothing style, and environment reflect the demographics of ${inputs.market} naturally.`;

            let charRule = '';
            let useSubjectLock = false;
            let brandRule = '';

            // --- ADVANCED CHARACTER LOGIC ---
            if (genTab === 'jesus') {
                charRule = `
                [CHARACTER REFERENCE - MANDATORY]
                Every single prompt MUST explicitly describe Jesus to ensure consistency. 
                Use this exact description: "Jesus, a Middle Eastern man in his 30s with shoulder-length brown hair, a beard, and kind eyes, wearing simple woven robes".
                DO NOT use pronouns like "he" or "him" for the main character; repeat the description "Jesus, the man in robes..." in every scene.
                For "is_subject_lock", mark 'true'.
                `;
                useSubjectLock = true;
            } else if (genTab === 'concert' || genTab === 'stage') {
                if (!inputs.characterDesc) throw new Error("Vui lòng thiết lập nhân vật cho Concert/Stage");
                useSubjectLock = true;
                charRule = `
                [CHARACTER REFERENCE - CRITICAL] 
                Every prompt must start with: "${inputs.characterDesc}". 
                (Ensure consistency). For "is_subject_lock", mark 'true' for all prompts containing this character.
                DO NOT use pronouns; repeat the visual description.
                `;
            } else if (genTab === 'looping' || inputs.loopType === 'nature') {
                charRule = "Do NOT include any specific main character. Focus on environment.";
            } else if (inputs.mode === 'character') {
                if (inputs.characterDesc) {
                    charRule = `[CHARACTER REFERENCE] Include main character: "${inputs.characterDesc}"`;
                } else {
                    charRule = `Invent a main character fitting the ${inputs.market} demographic.`;
                }
            } else {
                 charRule = `Mode is ${inputs.mode}. Adjust presence of characters accordingly (e.g. minimal for landscape/product).`;
            }

            if (genTab === 'starbucks') {
                brandRule = `[STARBUCKS BRANDING MANDATORY] Every prompt MUST explicitly describe a "Starbucks coffee shop setting" or "Starbucks cup with distinct green logo". Show variety: Interior, Exterior, Products.`;
            }

            let extraInstructions = "";
            if (genTab === 'jesus' || genTab === 'seasonal') extraInstructions += religiousGuardrails;

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

            for (let i = 0; i < totalPrompts; i += batchSize) {
                const currentBatch = Math.min(batchSize, totalPrompts - i);
                setLoadingText(`Đang tạo Batch ${Math.floor(i/batchSize) + 1}... (${allPrompts.length}/${totalPrompts})`);
                
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
                    You are a video director specializing in Christmas/Holiday themes. 
                    Idea/Direction: "${ideaToUse}".
                    Style: ${inputs.style}.
                    ${genTab === 'seasonal' ? `Month: ${inputs.month}` : ''}
                    ${genTab !== 'concert' && genTab !== 'stage' ? marketInstruction : ''}
                    Create exactly ${currentBatch} unique prompts.
                    Target Shot Duration: ${shotDuration.toFixed(1)} seconds per prompt (Speed: ${inputs.speed}x).
                    
                    ${criticalRules}
                    ${charRule}
                    ${brandRule}
                    ${cinematicQualityRule}
                    ${extraInstructions}
                    
                    ${constraints}

                    IMPORTANT OUTPUT INSTRUCTION:
                    Return ONLY VALID JSON. Do NOT wrap it in markdown code blocks (like \`\`\`json). Just the raw JSON array starting with [ and ending with ].
                `;

                const result = await ai.models.generateContent({
                    model: GENERATOR_MODEL,
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    config: { responseMimeType: 'application/json', responseSchema: responseSchema }
                });
                
                const text = result.text || '[]';
                const cleanText = cleanJsonOutput(text);
                
                let json;
                try {
                    json = JSON.parse(cleanText);
                } catch (err) {
                    console.error("JSON Parse Error:", err);
                    console.error("Raw text:", text);
                    console.error("Cleaned text:", cleanText);
                    throw new Error("AI trả về định dạng không hợp lệ. Vui lòng thử lại.");
                }
                
                allPrompts.push(...json);
            }
            
            const finalPrompts = allPrompts.map((p, idx) => ({ ...p, id: idx + 1 }));
            setGeneratedPrompts(finalPrompts);
            setIsConfigCollapsed(true); // Auto collapse after generation

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
            }
        } else {
            XLSX.writeFile(workbook, fileName);
        }
    };

    const getTabIcon = (tab: GeneratorTab) => {
        switch(tab) {
            case 'jesus': return <span className="text-lg">✝️</span>;
            case 'trending': return <FlameIcon className="w-4 h-4 text-orange-500" />;
            case 'seasonal': return <CalendarIcon className="w-4 h-4 text-red-500" />;
            case 'looping': return <LoopIcon className="w-4 h-4 text-blue-500" />;
            case 'cafe': return <CoffeeIcon className="w-4 h-4 text-brown-500" />;
            case 'starbucks': return <span className="text-lg">🥤</span>;
            case 'concert': return <MicIcon className="w-4 h-4 text-purple-500" />;
            case 'stage': return <StageIcon className="w-4 h-4 text-indigo-500" />;
            default: return null;
        }
    };

    if (!configLoaded) return <div className="min-h-screen flex items-center justify-center text-gray-500 bg-blue-50"><LoaderIcon /> <span className="ml-2">Đang tải dữ liệu Giáng Sinh...</span></div>;
    if (!isActivated) return <Activation machineId={machineId} onActivate={async (key) => { saveConfig({ licenseKey: key }); setIsActivated(true); return true; }} />;
    if (!activeApiKey) return <ApiKeyManagerScreen apiKeys={apiKeys} onKeyAdd={(k) => { const newKeys=[...apiKeys, k]; setApiKeys(newKeys); saveConfig({ apiKeysEncrypted: encrypt(JSON.stringify(newKeys)) }); }} onKeyDelete={(id) => { const newKeys=apiKeys.filter(k=>k.id!==id); setApiKeys(newKeys); saveConfig({ apiKeysEncrypted: encrypt(JSON.stringify(newKeys)) }); }} onKeySelect={(k) => { setActiveApiKey(k); saveConfig({ activeApiKeyId: k.id }); }} />;

    return (
        <div className="min-h-screen relative">
            {/* Update Available Modal - Uses updateAvailableModal, handleUpdateNow, handleUpdateLater */}
            {updateAvailableModal && (
                <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 text-center animate-bounce-in border-t-4 border-green-500 relative">
                        <h3 className="text-xl font-extrabold text-gray-800 mb-2">🎁 Có bản cập nhật mới!</h3>
                        <p className="text-sm text-gray-600 mb-6">
                            Phiên bản <span className="font-bold text-green-600">v{updateAvailableModal.version}</span> đã sẵn sàng.
                            <br/>Bạn có muốn cập nhật ngay để trải nghiệm tính năng mới?
                        </p>
                        <div className="flex gap-3 justify-center">
                            <button onClick={handleUpdateLater} className="px-4 py-2 rounded-lg text-gray-500 font-bold hover:bg-gray-100 transition">Để sau</button>
                            <button onClick={handleUpdateNow} className="px-6 py-2 rounded-lg bg-green-600 text-white font-bold shadow-lg hover:bg-green-700 hover:-translate-y-1 transition flex items-center gap-2">
                                <DownloadIcon className="w-4 h-4"/> Cập nhật ngay
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Feedback Toast - Uses feedback, XCircleIcon */}
            {feedback && (
                <div className={`fixed top-24 right-4 z-[90] p-4 rounded-xl shadow-2xl border flex items-center gap-3 animate-fade-in-left ${feedback.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-green-50 border-green-200 text-green-800'}`}>
                    {feedback.type === 'error' ? <XCircleIcon className="w-6 h-6"/> : <span className="text-xl font-bold">✓</span>}
                    <p className="text-sm font-bold">{feedback.message}</p>
                    <button onClick={() => setFeedback(null)} className="ml-2 opacity-50 hover:opacity-100"><XCircleIcon className="w-4 h-4"/></button>
                </div>
            )}

            {showProgressModal && (
                <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-8 text-center animate-fade-in-up border-t-4 border-green-500">
                         <div className="mb-4 text-green-600 flex justify-center"><LoaderIcon /></div>
                        <h3 className="text-xl font-bold text-gray-900 mb-2">Đang tải cập nhật Giáng Sinh...</h3>
                        <div className="w-full bg-gray-200 rounded-full h-4 mb-2 overflow-hidden">
                            <div className="bg-green-600 h-4 rounded-full transition-all duration-300 ease-out" style={{ width: `${downloadProgress}%` }}></div>
                        </div>
                        <p className="font-bold text-green-700">{downloadProgress}%</p>
                    </div>
                </div>
            )}
            
            {isLoading && (
                <div className="fixed inset-0 z-[9999] bg-red-900/80 backdrop-blur-sm flex flex-col items-center justify-center">
                    <div className="loader-ring"><div></div><div></div><div></div><div></div></div>
                    <p className="mt-6 text-white text-xl font-bold tracking-wide animate-pulse">{loadingText}</p>
                </div>
            )}

             {/* Header - Christmas Style */}
             <header className="bg-white/90 backdrop-blur-md border-b-2 border-red-100 sticky top-0 z-50 shadow-sm">
                 <div className="mx-auto px-4 sm:px-6 lg:px-8 max-w-[98%] w-full">
                     <div className="flex justify-between h-16 items-center">
                         <div className="flex items-center gap-8">
                             <h1 className="text-2xl font-extrabold text-red-700 tracking-tight flex items-center gap-2">
                                 <span>🎄</span> Trọng - Tool Auto Flow
                             </h1>
                             <div className="hidden md:flex bg-gray-100/80 p-1 rounded-xl border border-gray-200 shadow-inner">
                                 <button onClick={() => setActiveTab('tracker')} className={`px-6 py-2 rounded-lg text-sm font-bold transition-all duration-200 ${activeTab === 'tracker' ? 'bg-green-600 text-white shadow-md' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'}`}>Theo Dõi Sản Xuất</button>
                                 <button onClick={() => setActiveTab('generator')} className={`px-6 py-2 rounded-lg text-sm font-bold transition-all duration-200 ${activeTab === 'generator' ? 'bg-red-600 text-white shadow-md' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'}`}>Tạo Kịch Bản</button>
                             </div>
                         </div>
                         <div className="flex items-center gap-3">
                             <button onClick={handleCheckUpdate} className="text-xs text-gray-500 hover:text-green-600 flex items-center gap-1 bg-white px-2 py-1 rounded border border-gray-200 shadow-sm hover:shadow">
                                 <InfoIcon className={`w-3 h-3 ${updateStatus === 'checking' ? 'animate-spin' : ''}`} /> v{appVersion}
                             </button>
                             {activeApiKey && <span className="text-xs bg-green-100 text-green-800 border border-green-200 px-2 py-1 rounded-lg font-bold flex items-center gap-1 shadow-sm"><KeyIcon className="w-3 h-3"/> {activeApiKey.name}</span>}
                             <button onClick={() => setActiveApiKey(null)} className="text-gray-400 hover:text-red-500"><CogIcon className="w-5 h-5"/></button>
                         </div>
                     </div>
                 </div>
             </header>

             <main className={`mx-auto p-4 sm:p-6 lg:p-8 ${activeTab === 'tracker' ? 'max-w-[98%] w-full' : 'max-w-6xl'}`}>
                {activeTab === 'generator' && (
                    <div className="space-y-6">
                        
                        {/* Tab Navigation - Festive */}
                        <div className="bg-white p-2 rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
                            <div className="flex flex-nowrap md:flex-wrap space-x-1 min-w-max">
                                {(['jesus', 'trending', 'seasonal', 'looping', 'cafe', 'starbucks', 'concert', 'stage'] as GeneratorTab[]).map(tab => {
                                    const isActive = genTab === tab;
                                    const labels: Record<string, string> = { jesus: "MV Chúa Jesus", trending: "MV Theo Trend", seasonal: "MV Theo Mùa", looping: "MV Lặp (Loop)", cafe: "MV Quán Cafe", starbucks: "Starbucks", concert: "Live Concert", stage: "Sân Khấu Live" };
                                    return (
                                        <button 
                                            key={tab} 
                                            onClick={() => { setGenTab(tab); setFeedback(null); }} 
                                            className={`px-4 py-2.5 rounded-lg text-sm font-bold transition-all whitespace-nowrap flex items-center gap-2 border ${isActive ? 'bg-red-50 text-red-600 border-red-200 shadow-sm' : 'bg-transparent text-gray-500 border-transparent hover:bg-red-50 hover:text-red-500'}`}
                                        >
                                            {getTabIcon(tab)}
                                            <span>{labels[tab]}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Character Creation Area */}
                        {(genTab === 'concert' || genTab === 'stage') && (
                            <div className="glass-card p-6 animate-fade-in-up bg-white border-t-4 border-purple-500">
                                <div className="flex items-center gap-2 mb-4 text-purple-700 font-bold uppercase text-xs tracking-wider">
                                    <UserIcon className="w-4 h-4"/> Thiết Lập Nhân Vật (Bắt buộc)
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-gray-600">1. Mô tả nhân vật chính:</label>
                                        <textarea value={inputs.characterDesc} onChange={e => handleInputChange('characterDesc', e.target.value)} className="w-full p-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-purple-500 outline-none h-32 resize-none shadow-sm" placeholder="Ví dụ: một người phụ nữ trẻ, tóc nâu dài xoăn nhẹ, mặc váy trắng..."></textarea>
                                    </div>
                                    <div className="space-y-2">
                                        <div className="text-center text-xs text-gray-400 font-bold uppercase my-1">-- HOẶC --</div>
                                        <label className="text-xs font-bold text-gray-600">2. Tải ảnh lên để AI phân tích:</label>
                                        <div className="file-input-wrapper w-full bg-white text-gray-500 font-medium h-24 rounded-xl border-2 border-dashed border-gray-300 hover:border-purple-500 hover:bg-purple-50 text-center transition cursor-pointer flex flex-col items-center justify-center text-xs relative group">
                                            {inputs.characterImage ? (
                                                <span className="text-purple-600 font-bold flex items-center gap-1"><span className="text-lg">✓</span> Đã chọn ảnh</span>
                                            ) : (
                                                <span className="flex items-center gap-2"><UploadIcon className="w-4 h-4"/> Chọn hoặc Dán ảnh (Ctrl+V)</span>
                                            )}
                                            <input type="file" accept="image/*" onChange={handleImageUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                                        </div>
                                        {inputs.characterImage && <button onClick={analyzeCharacterImage} className="text-xs text-purple-600 font-bold w-full text-center hover:underline bg-purple-50 py-1 rounded">✨ Phân tích ảnh ngay</button>}
                                    </div>
                                </div>
                                {characterAnalysis && <div className="mt-4 p-3 bg-purple-50 text-purple-800 rounded-lg text-xs font-mono border border-purple-100">{characterAnalysis}</div>}
                            </div>
                        )}

                        {/* Collapsible Config Card - Christmas Style */}
                        <div className="glass-card bg-white transition-all duration-300 relative overflow-hidden shadow-sm border border-red-100 rounded-2xl">
                            
                            {/* Decorative Corner Ribbon */}
                            <div className="absolute -top-3 -right-12 bg-red-600 text-white text-[10px] font-bold px-10 py-1 rotate-45 shadow-md z-10 hidden md:block border-b border-white/20">
                                MERRY XMAS
                            </div>

                            <div className="p-6">
                                <div className="flex justify-between items-center mb-6 cursor-pointer select-none" onClick={() => setIsConfigCollapsed(!isConfigCollapsed)}>
                                    <div className="flex items-center gap-2">
                                        <div className="w-1 h-6 bg-red-500 rounded-full"></div>
                                        <h3 className="text-lg font-bold text-red-800">CẤU HÌNH KỊCH BẢN</h3>
                                    </div>
                                    <div className={`p-2 rounded-full bg-red-50 hover:bg-red-100 transition-transform duration-300 ${isConfigCollapsed ? 'rotate-180' : ''}`}>
                                        <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7"></path></svg>
                                    </div>
                                </div>

                                <div className={`space-y-6 transition-all duration-500 ease-in-out ${isConfigCollapsed ? 'max-h-0 opacity-0 -my-6 overflow-hidden pointer-events-none' : 'max-h-[2000px] opacity-100'}`}>
                                    
                                    {/* GRID ROW 1: Inputs */}
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                        <div className="flex flex-col h-full">
                                            <div className="flex justify-between mb-2 items-center">
                                                <label className="text-xs font-extrabold text-gray-600 uppercase flex items-center gap-1">
                                                    <span className="text-red-500">🎁</span> 1. Ý tưởng cơ bản
                                                </label>
                                                {genTab === 'trending' && <button onClick={() => handleInputChange('basicIdea', 'Top Catholic Trend: Mùa Chay')} className="text-[9px] bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full font-bold hover:bg-orange-200 transition">🔥 MV Theo Trend</button>}
                                            </div>
                                            <textarea 
                                                value={inputs.basicIdea} 
                                                onChange={e => handleInputChange('basicIdea', e.target.value)} 
                                                className="w-full h-32 p-4 bg-white border border-gray-300 rounded-xl text-sm text-gray-700 resize-none focus:ring-2 focus:ring-red-200 focus:border-red-400 outline-none transition shadow-sm placeholder-gray-400" 
                                                placeholder="Ví dụ: Giáng sinh an lành tại nhà thờ Đức Bà..." 
                                            />
                                        </div>

                                        <div className="flex flex-col h-full">
                                            <div className="flex justify-between mb-2 items-center">
                                                <label className="text-xs font-extrabold text-gray-600 uppercase flex items-center gap-1">
                                                    <span className="text-yellow-500">✨</span> 2. Bối cảnh & Không khí
                                                </label>
                                                <button onClick={suggestScript} className="text-[9px] text-white font-bold bg-red-400 px-3 py-1 rounded-full hover:bg-red-500 transition shadow-sm flex items-center gap-1">
                                                    <SparklesIcon className="w-3 h-3"/> TỐI ƯU Ý TƯỞNG (AI)
                                                </button>
                                            </div>
                                            <textarea 
                                                value={inputs.detailedIdea} 
                                                onChange={e => handleInputChange('detailedIdea', e.target.value)} 
                                                className="w-full h-32 p-4 bg-white border border-gray-300 rounded-xl text-sm text-gray-700 resize-none focus:ring-2 focus:ring-red-200 focus:border-red-400 outline-none transition shadow-sm placeholder-gray-400" 
                                                placeholder="AI sẽ mô tả chi tiết không khí và bối cảnh tại đây..." 
                                            />
                                        </div>
                                    </div>

                                    {/* GRID ROW 2: Selectors */}
                                    <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                        <div>
                                            <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Phong cách</label>
                                            <select value={inputs.style} onChange={e => handleInputChange('style', e.target.value)} className="w-full p-2 bg-white border border-gray-300 rounded-lg text-xs font-bold text-gray-700 focus:border-red-400 focus:ring-2 focus:ring-red-100 outline-none">
                                                <option>Kể chuyện (Narrative)</option>
                                                <option>Điện ảnh (Cinematic)</option>
                                                <option>Tài liệu (Documentary)</option>
                                                <option>TVC Quảng Cáo</option>
                                                <option>Vlog Chill/Aesthetic</option>
                                                <option>Trình diễn (Performance)</option>
                                                <option>Ý niệm (Conceptual)</option>
                                                <option>Hiện đại/LED Lớn</option>
                                                <option>Acoustic/Thân mật</option>
                                            </select>
                                        </div>
                                        {genTab !== 'concert' && genTab !== 'stage' && (
                                            <div>
                                                <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block flex items-center gap-1"><span className="text-blue-400">🌐</span> Thị trường</label>
                                                <select value={inputs.market} onChange={e => handleInputChange('market', e.target.value)} className="w-full p-2 bg-white border border-gray-300 rounded-lg text-xs font-bold text-gray-700 focus:border-red-400 focus:ring-2 focus:ring-red-100 outline-none">
                                                    <option>Toàn cầu (Chung)</option>
                                                    {MARKETS.map(m => <option key={m.code} value={m.name}>{m.name}</option>)}
                                                </select>
                                            </div>
                                        )}
                                        <div className="lg:col-span-2">
                                            <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Chế độ cảnh</label>
                                            <div className="flex bg-gray-200 p-1 rounded-lg">
                                                <button onClick={() => handleInputChange('mode', 'character')} className={`flex-1 py-1.5 rounded-md text-xs font-bold transition flex items-center justify-center gap-1 ${inputs.mode === 'character' ? 'bg-white text-red-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                                                    <UserIcon className="w-3 h-3"/> Có Nhân Vật
                                                </button>
                                                <button onClick={() => handleInputChange('mode', 'landscape')} className={`flex-1 py-1.5 rounded-md text-xs font-bold transition flex items-center justify-center gap-1 ${inputs.mode === 'landscape' ? 'bg-white text-green-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                                                    <MountainIcon className="w-3 h-3"/> Chỉ Thiên Nhiên
                                                </button>
                                            </div>
                                        </div>
                                        {genTab === 'seasonal' && (
                                            <div>
                                                <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Tháng</label>
                                                <select value={inputs.month} onChange={e => handleInputChange('month', e.target.value)} className="w-full p-2 bg-white border border-gray-300 rounded-lg text-xs font-bold text-gray-700 focus:border-red-400 focus:ring-2 focus:ring-red-100 outline-none">
                                                    {Array.from({length: 12}, (_, i) => i + 1).map(m => <option key={m} value={m}>Tháng {m}</option>)}
                                                </select>
                                            </div>
                                        )}
                                    </div>

                                    {/* GRID ROW 3: Sliders (Duration & Speed) */}
                                    <div className="bg-gradient-to-br from-red-50 to-white border border-red-100 rounded-2xl p-6 flex flex-col md:flex-row gap-8 items-stretch relative overflow-hidden shadow-inner">
                                        <div className="absolute right-0 top-0 opacity-5 pointer-events-none">
                                            <ClockIcon className="w-64 h-64 text-red-900" />
                                        </div>

                                        {/* Duration Box */}
                                        <div className="flex-1 space-y-4 z-10">
                                            <div className="flex justify-between items-end">
                                                <label className="text-xs font-bold text-red-800 uppercase flex items-center gap-1">
                                                    <ClockIcon className="w-4 h-4"/> Tổng thời lượng Video
                                                </label>
                                            </div>
                                            <div className="flex items-center gap-2 bg-white p-3 rounded-xl border border-red-100 shadow-sm">
                                                <div className="flex-1 text-center border-r border-gray-100">
                                                    <div className="text-2xl font-black text-gray-800">{Math.floor(inputs.duration / 3600)}</div>
                                                    <div className="text-[9px] text-gray-400 font-bold uppercase">Giờ</div>
                                                </div>
                                                <div className="text-gray-300 font-light text-xl">:</div>
                                                <div className="flex-1 text-center border-r border-gray-100">
                                                    <div className="text-2xl font-black text-gray-800">{Math.floor((inputs.duration % 3600) / 60)}</div>
                                                    <div className="text-[9px] text-gray-400 font-bold uppercase">Phút</div>
                                                </div>
                                                <div className="text-gray-300 font-light text-xl">:</div>
                                                <div className="flex-1 text-center">
                                                    <div className="text-2xl font-black text-gray-800">{inputs.duration % 60}</div>
                                                    <div className="text-[9px] text-gray-400 font-bold uppercase">Giây</div>
                                                </div>
                                            </div>
                                            <input 
                                                type="range" 
                                                min="8" max="600" step="8" 
                                                value={inputs.duration} 
                                                onChange={e => handleInputChange('duration', parseInt(e.target.value))} 
                                                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-red-600"
                                            />
                                        </div>

                                        <div className="w-px bg-red-100 hidden md:block"></div>

                                        {/* Speed Box */}
                                        <div className="flex-1 space-y-4 z-10">
                                            <div className="flex justify-between items-center">
                                                <label className="text-xs font-bold text-green-800 uppercase flex items-center gap-1">
                                                    <LightningIcon className="w-4 h-4"/> Tốc độ (Speed)
                                                </label>
                                                <span className="text-xl font-black text-green-800">{inputs.speed}x</span>
                                            </div>
                                            
                                            <div className="h-16 flex items-center justify-center relative">
                                                <input 
                                                    type="range" 
                                                    min="0.5" max="2.0" step="0.1" 
                                                    value={inputs.speed} 
                                                    onChange={e => handleInputChange('speed', parseFloat(e.target.value))} 
                                                    className="w-full h-2 bg-green-200 rounded-lg appearance-none cursor-pointer accent-green-600 relative z-20"
                                                />
                                            </div>

                                            <div className="flex justify-between items-center bg-white/60 p-2 rounded-lg border border-green-50 shadow-sm">
                                                <span className="text-[10px] text-gray-500">Thời lượng 1 shot:</span>
                                                <span className="text-sm font-black text-red-500">{shotDuration.toFixed(2)}s</span>
                                                <div className="text-center">
                                                    <div className="text-[9px] text-gray-400 font-bold uppercase">Tổng Prompts</div>
                                                    <div className="text-xl font-black text-orange-500 leading-none">{totalPrompts}</div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Generate Button */}
                                    <button onClick={generatePrompts} disabled={isLoading} className="w-full bg-gradient-to-r from-red-500 to-pink-500 hover:from-red-600 hover:to-pink-600 text-white font-extrabold text-sm py-4 rounded-xl shadow-lg hover:shadow-xl transition-all transform active:scale-[0.99] flex justify-center items-center gap-2 border border-red-300">
                                        <span>TẠO {totalPrompts} PROMPTS NGAY 🎁</span>
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Results Table */}
                        {generatedPrompts.length > 0 && (
                            <div className="glass-card overflow-hidden bg-white animate-fade-in-up mb-24 border border-gray-100 shadow-lg">
                                <div className="p-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                                    <h3 className="text-xs font-black text-gray-600 uppercase tracking-widest">Kết quả Generated</h3>
                                    <span className="text-[10px] font-bold text-gray-400 bg-white px-2 py-1 rounded border border-gray-200 shadow-sm">{generatedPrompts.length} ITEMS</span>
                                </div>
                                <div className="overflow-x-auto max-h-[60vh] custom-scrollbar">
                                    <table className="w-full text-sm text-left text-gray-700">
                                        <thead className="text-[10px] text-gray-400 uppercase bg-white sticky top-0 z-10 shadow-sm">
                                            <tr>
                                                <th className="px-6 py-4 font-extrabold tracking-widest w-16">STT</th>
                                                <th className="px-6 py-4 font-extrabold tracking-widest">Nội dung Prompt</th>
                                                <th className="px-6 py-4 font-extrabold tracking-widest text-center w-24">Lock</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-50">
                                            {generatedPrompts.map(p => (
                                                <tr key={p.id} className="hover:bg-red-50 transition group">
                                                    <td className="px-6 py-4 font-mono text-xs text-gray-400 font-bold group-hover:text-red-500">{p.id}</td>
                                                    <td className="px-6 py-4 text-xs text-gray-600 leading-relaxed font-medium">{p.prompt_text}</td>
                                                    <td className="px-6 py-4 text-center">
                                                        {p.is_subject_lock ? <span className="inline-flex items-center px-2 py-1 rounded text-[9px] font-bold bg-green-100 text-green-700">LOCK</span> : <span className="text-gray-200 text-xs font-bold">-</span>}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                        
                        {/* Floating Download Button */}
                        {generatedPrompts.length > 0 && (
                            <div className="fixed bottom-8 right-8 z-40 floating-enter">
                                <button onClick={downloadExcel} className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-full shadow-2xl hover:shadow-green-500/30 hover:-translate-y-1 transition-all flex items-center gap-3 border-2 border-white/20 backdrop-blur-md">
                                    <DownloadIcon className="w-5 h-5" />
                                    <span>Tải File Excel</span>
                                </button>
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