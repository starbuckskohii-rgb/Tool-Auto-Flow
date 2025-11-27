
import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { TrackedFile, VideoJob } from '../types';
import { 
  FolderIcon, 
  RetryIcon, 
  PlayIcon, 
  TrashIcon, 
  LoaderIcon, 
  ExternalLinkIcon, 
  CogIcon,
  SearchIcon,
  LinkIcon,
  CheckIcon,
  ChartIcon
} from './Icons';

const isElectron = navigator.userAgent.toLowerCase().includes('electron');
const ipcRenderer = isElectron && (window as any).require ? (window as any).require('electron').ipcRenderer : null;

const Tracker: React.FC = () => {
    const [files, setFiles] = useState<TrackedFile[]>([]);
    const [activeFileIndex, setActiveFileIndex] = useState<number>(0);
    const [loading, setLoading] = useState(false);
    const [combineMode, setCombineMode] = useState<'normal' | 'timed'>('normal');

    // Global Stats Calculation
    const totalFiles = files.length;
    const totalJobs = files.reduce((acc, f) => acc + f.jobs.length, 0);
    const totalCompleted = files.reduce((acc, f) => acc + f.jobs.filter(j => j.status === 'Completed').length, 0);
    const globalPercent = totalJobs > 0 ? Math.round((totalCompleted / totalJobs) * 100) : 0;

    // --- Helpers ---
    const parseExcel = (bufferInput: any): VideoJob[] => {
        try {
            const data = bufferInput.data || bufferInput;
            const buffer = new Uint8Array(data);
            
            const workbook = XLSX.read(buffer, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as any[][];
            
            if (jsonData.length < 2) return [];
            
            const headers = jsonData[0].map((h: any) => String(h).trim());
            const idIdx = headers.indexOf('JOB_ID');
            const promptIdx = headers.indexOf('PROMPT');
            const statusIdx = headers.indexOf('STATUS');
            const videoNameIdx = headers.indexOf('VIDEO_NAME');
            const typeIdx = headers.indexOf('TYPE_VIDEO');

            return jsonData.slice(1).map((row: any[]) => ({
                id: row[idIdx] || '',
                prompt: row[promptIdx] || '',
                status: (row[statusIdx] || 'Pending') as any,
                videoName: row[videoNameIdx] || '',
                typeVideo: row[typeIdx] || '',
                imagePath: '', imagePath2: '', imagePath3: '' 
            })).filter(j => j.id);
        } catch (e) {
            console.error("Parse error:", e);
            return [];
        }
    };

    const getFileUrl = (path: string) => {
        if (!path) return '';
        return `file://${path.replace(/\\/g, '/')}`;
    };

    // --- Startup & Persistence ---
    useEffect(() => {
        if (!ipcRenderer) return;

        const loadPersisted = async () => {
            setLoading(true);
            try {
                const res = await ipcRenderer.invoke('load-tracked-files');
                if (res.success && res.files.length > 0) {
                     const loadedFiles: TrackedFile[] = [];
                     for (const f of res.files) {
                        const rawJobs = parseExcel(f.content);
                        const videoResult = await ipcRenderer.invoke('find-videos-for-jobs', { jobs: rawJobs, excelFilePath: f.path });
                        loadedFiles.push({
                            name: f.name,
                            path: f.path,
                            jobs: videoResult.success ? videoResult.jobs : rawJobs
                        });
                        ipcRenderer.send('start-watching-file', f.path);
                     }
                     setFiles(loadedFiles);
                     if (loadedFiles.length > 0) setActiveFileIndex(0);
                }
            } finally {
                setLoading(false);
            }
        };
        loadPersisted();
    }, []);

    useEffect(() => {
        if (!ipcRenderer) return;
        const paths = files.map(f => f.path).filter(p => !!p) as string[];
        ipcRenderer.invoke('save-app-config', { trackedFilePaths: paths });
    }, [files.length, files.map(f=>f.path).join(',')]); 

    // --- IPC Listeners ---
    useEffect(() => {
        if (!ipcRenderer) return;

        const handleFileUpdate = (_: any, { path, content }: { path: string, content: any }) => {
            const newJobs = parseExcel(content);
            ipcRenderer.invoke('find-videos-for-jobs', { jobs: newJobs, excelFilePath: path })
                .then((result: any) => {
                    if (result.success) {
                        setFiles(prev => prev.map(f => {
                            if (f.path === path) {
                                return { ...f, jobs: result.jobs };
                            }
                            return f;
                        }));
                    }
                });
        };

        ipcRenderer.on('file-content-updated', handleFileUpdate);
        return () => {
            ipcRenderer.removeListener('file-content-updated', handleFileUpdate);
        };
    }, []);

    // --- Actions ---
    const handleOpenFile = async () => {
        if (!ipcRenderer) return;
        const result = await ipcRenderer.invoke('open-file-dialog');
        if (result.success && result.files) {
            const newFiles: TrackedFile[] = [];
            for (const f of result.files) {
                if (files.some(existing => existing.path === f.path)) continue;
                const rawJobs = parseExcel(f.content);
                const videoResult = await ipcRenderer.invoke('find-videos-for-jobs', { jobs: rawJobs, excelFilePath: f.path });
                newFiles.push({
                    name: f.name,
                    path: f.path,
                    jobs: videoResult.success ? videoResult.jobs : rawJobs
                });
                ipcRenderer.send('start-watching-file', f.path);
            }
            if (newFiles.length > 0) {
                setFiles(prev => [...prev, ...newFiles]);
                setActiveFileIndex(files.length); 
            }
        }
    };

    const handleScanFolder = async () => {
        if (!ipcRenderer) return;
        setLoading(true);
        const result = await ipcRenderer.invoke('scan-folder-for-excels');
        setLoading(false);

        if (result.success && result.files) {
            const newFiles: TrackedFile[] = [];
            let addedCount = 0;
            for (const f of result.files) {
                if (files.some(existing => existing.path === f.path)) continue;
                const rawJobs = parseExcel(f.content);
                const videoResult = await ipcRenderer.invoke('find-videos-for-jobs', { jobs: rawJobs, excelFilePath: f.path });
                newFiles.push({
                    name: f.name,
                    path: f.path,
                    jobs: videoResult.success ? videoResult.jobs : rawJobs
                });
                ipcRenderer.send('start-watching-file', f.path);
                addedCount++;
            }
            if (newFiles.length > 0) {
                setFiles(prev => [...prev, ...newFiles]);
                if (files.length === 0) setActiveFileIndex(0);
                alert(`Đã thêm ${addedCount} file mới vào danh sách theo dõi.`);
            } else {
                alert('Không tìm thấy file mới nào trong thư mục này.');
            }
        }
    };

    const handleClearAll = () => {
        if (!ipcRenderer) return;
        if (!confirm('Bạn có chắc chắn muốn xóa toàn bộ danh sách file đang theo dõi?')) return;
        files.forEach(f => { if (f.path) ipcRenderer.send('stop-watching-file', f.path); });
        setFiles([]);
        setActiveFileIndex(0);
    };

    const handleCloseFile = (index: number, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!ipcRenderer) return;
        const fileToRemove = files[index];
        if (fileToRemove.path) ipcRenderer.send('stop-watching-file', fileToRemove.path);
        const newFiles = files.filter((_, i) => i !== index);
        setFiles(newFiles);
        if (activeFileIndex >= newFiles.length) setActiveFileIndex(Math.max(0, newFiles.length - 1));
    };

    const handleRefresh = async () => {
        const activeFile = files[activeFileIndex];
        if (!activeFile || !ipcRenderer) return;
        setLoading(true);
        try {
            const result = await ipcRenderer.invoke('find-videos-for-jobs', { jobs: activeFile.jobs, excelFilePath: activeFile.path });
            if (result.success) {
                setFiles(prev => {
                    const copy = [...prev];
                    copy[activeFileIndex] = { ...activeFile, jobs: result.jobs };
                    return copy;
                });
            }
        } finally {
            setLoading(false);
        }
    };

    const handleRetryStuck = async () => {
        const activeFile = files[activeFileIndex];
        if (!activeFile || !ipcRenderer) return;
        if(confirm('Bạn có muốn reset trạng thái các job đang bị kẹt (Processing/Generating) không?')) {
            await ipcRenderer.invoke('retry-stuck-jobs', { filePath: activeFile.path });
            handleRefresh();
        }
    };
    
    // NEW: Reset Single Job
    const handleResetJob = async (job: VideoJob) => {
        const activeFile = files[activeFileIndex];
        if (!activeFile || !ipcRenderer || !activeFile.path) return;
        if (!confirm(`Bạn có chắc muốn tạo lại (reset) Job "${job.id}" không?`)) return;

        setLoading(true);
        try {
            await ipcRenderer.invoke('retry-job', { filePath: activeFile.path, jobId: job.id });
            await handleRefresh();
        } finally {
            setLoading(false);
        }
    };

    const handleOpenToolFlow = async () => {
        if (!ipcRenderer) return;
        const res = await ipcRenderer.invoke('open-tool-flow');
        if (!res.success) {
            if(confirm('Chưa cấu hình đường dẫn ToolFlows. Bạn có muốn chọn file .exe ngay bây giờ không?')) {
                await ipcRenderer.invoke('set-tool-flow-path');
            }
        }
    };

    const handleCombine = async () => {
        const activeFile = files[activeFileIndex];
        if (!activeFile || !ipcRenderer) return;
        const completedJobs = activeFile.jobs.filter(j => j.status === 'Completed' && j.videoPath);
        if (completedJobs.length === 0) return alert('Chưa có video nào hoàn thành để ghép.');

        setLoading(true);
        const res = await ipcRenderer.invoke('execute-ffmpeg-combine', {
            jobs: completedJobs,
            targetDuration: activeFile.targetDurationSeconds,
            mode: combineMode,
            excelFileName: activeFile.name
        });
        setLoading(false);
        if (res.success) alert(`Ghép video thành công!\nLưu tại: ${res.filePath}`);
        else alert(`Lỗi khi ghép: ${res.error}`);
    };
    
    const handleCombineAll = async () => {
        if (!ipcRenderer) return;
        const filesWithVideos = files.filter(f => f.jobs.some(j => j.status === 'Completed' && j.videoPath));
        if (filesWithVideos.length === 0) return alert('Không có file nào có video hoàn thành.');
        if(!confirm(`Bạn sắp ghép video cho ${filesWithVideos.length} file đang mở. Tiếp tục?`)) return;

        setLoading(true);
        const filesPayload = filesWithVideos.map(f => ({
            name: f.name,
            jobs: f.jobs.filter(j => j.status === 'Completed' && j.videoPath)
        }));
        const res = await ipcRenderer.invoke('execute-ffmpeg-combine-all', filesPayload);
        setLoading(false);
        if (!res.canceled) {
            let msg = `Đã xử lý xong.\nThành công: ${res.successes.length}\nThất bại: ${res.failures.length}`;
            if (res.failures.length > 0) msg += `\nLỗi: ${res.failures.join(', ')}`;
            alert(msg);
        }
    };

    const handleVideoAction = (action: 'play' | 'folder' | 'delete', job: VideoJob) => {
        if (!ipcRenderer || !job.videoPath) return;
        if (action === 'play') ipcRenderer.send('open-video-path', job.videoPath);
        if (action === 'folder') ipcRenderer.send('show-video-in-folder', job.videoPath);
        if (action === 'delete') {
             ipcRenderer.invoke('delete-video-file', job.videoPath).then((res: any) => {
                 if (res.success) handleRefresh();
             });
        }
    };

    const copyFolderPath = () => {
        const activeFile = files[activeFileIndex];
        if(activeFile && activeFile.path && isElectron) {
             const folder = activeFile.path.substring(0, activeFile.path.lastIndexOf((navigator.platform.indexOf("Win") > -1 ? "\\" : "/")));
             navigator.clipboard.writeText(folder);
             alert("Đã copy đường dẫn thư mục!");
        }
    };

    // --- Render ---
    const activeFile = files[activeFileIndex];
    
    // File Specific Stats
    const fileTotal = activeFile ? activeFile.jobs.length : 0;
    const fileCompleted = activeFile ? activeFile.jobs.filter(j => j.status === 'Completed').length : 0;
    const fileProcessing = activeFile ? activeFile.jobs.filter(j => j.status === 'Processing' || j.status === 'Generating').length : 0;
    const filePercent = fileTotal > 0 ? Math.round((fileCompleted / fileTotal) * 100) : 0;

    if (!isElectron) return <div className="text-center p-10 text-gray-500">Chức năng này chỉ hoạt động trên phiên bản Desktop (Electron).</div>;

    if (files.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-[60vh] text-center p-10 bg-white/30 rounded-3xl border-2 border-dashed border-gray-300">
                <FolderIcon className="w-20 h-20 text-gray-300 mb-6" />
                <h3 className="text-2xl font-bold text-gray-500 mb-2">Chưa theo dõi dự án nào</h3>
                <p className="text-gray-400 mb-8 max-w-md">Hãy mở file Excel kịch bản hoặc quét thư mục dự án để bắt đầu quy trình tự động hóa.</p>
                <div className="flex gap-4">
                    <button onClick={handleOpenFile} className="btn-primary px-8 py-4 rounded-2xl font-bold text-lg shadow-xl hover:scale-105 transition flex items-center gap-3">
                        <FolderIcon className="w-6 h-6"/> Mở File Excel
                    </button>
                    <button onClick={handleScanFolder} className="bg-white text-indigo-600 border-2 border-indigo-100 px-8 py-4 rounded-2xl font-bold text-lg shadow-md hover:bg-indigo-50 transition flex items-center gap-3">
                        <SearchIcon className="w-6 h-6"/> Quét Thư Mục
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-[calc(100vh-100px)]">
            
            {/* Global Status Dashboard */}
            <div className="glass-card p-4 mb-4 rounded-2xl flex flex-wrap items-center gap-6 justify-between animate-fade-in-up border border-white/40 shadow-sm">
                <div className="flex gap-8 items-center border-r border-gray-200 pr-8">
                     <div className="flex flex-col">
                        <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Tổng Dự Án</span>
                        <div className="flex items-baseline gap-1">
                            <span className="text-2xl font-extrabold text-gray-800">{totalFiles}</span>
                            <span className="text-xs text-gray-400">files</span>
                        </div>
                    </div>
                    <div className="flex flex-col">
                         <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Tiến Độ Toàn Bộ</span>
                         <div className="flex items-baseline gap-1">
                            <span className="text-2xl font-extrabold text-indigo-600">{totalCompleted}</span>
                            <span className="text-lg text-gray-400 font-medium">/ {totalJobs}</span>
                         </div>
                    </div>
                </div>

                <div className="flex-1 min-w-[200px] flex flex-col justify-center px-4">
                     <div className="flex justify-between text-xs font-bold text-gray-500 mb-1.5">
                         <span>Global Processing...</span>
                         <span className={globalPercent===100?'text-green-600':''}>{globalPercent}%</span>
                     </div>
                     <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden shadow-inner border border-black/5">
                         <div 
                            className={`h-full rounded-full transition-all duration-700 ease-out ${globalPercent === 100 ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-gradient-to-r from-indigo-500 to-purple-500'}`} 
                            style={{ width: `${globalPercent}%` }}
                        ></div>
                     </div>
                </div>

                <div className="flex items-center gap-2 pl-4 border-l border-gray-200">
                     <div className="flex gap-1 mr-2">
                        <button onClick={handleOpenFile} className="p-2 hover:bg-white rounded-lg text-gray-500 hover:text-indigo-600 transition" title="Mở thêm file"><FolderIcon className="w-5 h-5" /></button>
                        <button onClick={handleScanFolder} className="p-2 hover:bg-white rounded-lg text-gray-500 hover:text-indigo-600 transition" title="Quét thư mục"><SearchIcon className="w-5 h-5" /></button>
                        <button onClick={handleClearAll} className="p-2 hover:bg-white rounded-lg text-gray-500 hover:text-red-500 transition" title="Xóa tất cả"><TrashIcon className="w-5 h-5" /></button>
                     </div>
                     <button onClick={handleOpenToolFlow} className="bg-gray-800 text-white px-4 py-2 rounded-xl font-bold text-xs hover:bg-gray-700 flex items-center gap-2 shadow-lg hover:shadow-xl transition transform hover:-translate-y-0.5">
                        <ExternalLinkIcon className="w-3 h-3"/> ToolFlows
                    </button>
                    <button onClick={() => ipcRenderer.invoke('set-tool-flow-path')} className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-white rounded-lg transition"><CogIcon className="w-5 h-5"/></button>
                </div>
            </div>

            {/* Split View Layout */}
            <div className="flex gap-4 flex-1 overflow-hidden">
                
                {/* Left Sidebar: File List */}
                <div className="w-[280px] flex flex-col gap-3 overflow-y-auto pr-2 pb-4 custom-scrollbar">
                    {files.map((f, idx) => {
                        const total = f.jobs.length;
                        const completed = f.jobs.filter(j => j.status === 'Completed').length;
                        const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
                        const isActive = idx === activeFileIndex;

                        return (
                            <div 
                                key={idx}
                                onClick={() => setActiveFileIndex(idx)}
                                className={`
                                    relative p-4 rounded-2xl cursor-pointer transition-all duration-200 border group
                                    ${isActive 
                                        ? 'bg-white border-indigo-200 shadow-lg ring-1 ring-indigo-50 z-10' 
                                        : 'bg-white/40 border-white/40 hover:bg-white/80 hover:shadow-md'
                                    }
                                `}
                            >
                                <div className="flex justify-between items-start mb-2">
                                    <div className={`font-bold text-sm truncate pr-2 ${isActive ? 'text-indigo-900' : 'text-gray-600'}`} title={f.name}>{f.name}</div>
                                    <button 
                                        onClick={(e) => handleCloseFile(idx, e)}
                                        className="text-gray-300 hover:text-red-500 p-1 rounded-full hover:bg-red-50 transition opacity-0 group-hover:opacity-100"
                                    >
                                        <TrashIcon className="w-3 h-3" />
                                    </button>
                                </div>
                                <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                                    <div 
                                        className={`h-full rounded-full transition-all duration-500 ${percent === 100 ? 'bg-green-500' : 'bg-indigo-500'}`} 
                                        style={{ width: `${percent}%` }}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Right Main Content */}
                <div className="flex-1 flex flex-col gap-4 overflow-hidden">
                    {activeFile ? (
                        <>
                            {/* File Status Header (Redesigned as per request) */}
                            <div className="glass-card p-5 rounded-2xl shadow-sm border border-white/50">
                                <div className="flex justify-between items-start mb-4">
                                     <div>
                                        <h2 className="text-xl font-extrabold text-gray-800 truncate">{activeFile.name}</h2>
                                        <p className="text-[10px] text-gray-400 truncate font-mono mt-0.5 max-w-lg cursor-pointer hover:text-indigo-600" onClick={copyFolderPath} title="Click to copy folder path">{activeFile.path}</p>
                                    </div>
                                    <div className="flex gap-2">
                                        <button onClick={handleRefresh} className="p-2 rounded-xl bg-white text-gray-600 hover:text-indigo-600 shadow-sm hover:shadow-md border border-gray-100 transition" title="Làm mới"><LinkIcon className="w-5 h-5"/></button>
                                        <button onClick={handleRetryStuck} className="p-2 rounded-xl bg-white text-gray-600 hover:text-orange-600 shadow-sm hover:shadow-md border border-gray-100 transition" title="Sửa lỗi kẹt"><RetryIcon className="w-5 h-5"/></button>
                                    </div>
                                </div>

                                {/* Status Cards Row */}
                                <div className="grid grid-cols-4 gap-4">
                                    {/* Total Job Card */}
                                    <div className="bg-indigo-50/50 rounded-xl p-3 flex items-center gap-3 border border-indigo-100">
                                        <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg"><ChartIcon className="w-5 h-5"/></div>
                                        <div>
                                            <div className="text-[10px] font-bold text-gray-500 uppercase">Tổng Job</div>
                                            <div className="text-xl font-extrabold text-gray-800">{fileTotal}</div>
                                        </div>
                                    </div>

                                    {/* Completed Card */}
                                    <div className="bg-green-50/50 rounded-xl p-3 flex items-center gap-3 border border-green-100">
                                        <div className="p-2 bg-green-100 text-green-600 rounded-lg"><CheckIcon className="w-5 h-5"/></div>
                                        <div>
                                            <div className="text-[10px] font-bold text-gray-500 uppercase">Hoàn Thành</div>
                                            <div className="text-xl font-extrabold text-green-600">{fileCompleted}</div>
                                        </div>
                                    </div>

                                    {/* Processing Card */}
                                    <div className="bg-yellow-50/50 rounded-xl p-3 flex items-center gap-3 border border-yellow-100">
                                        <div className="p-2 bg-yellow-100 text-yellow-600 rounded-lg"><LoaderIcon /></div>
                                        <div>
                                            <div className="text-[10px] font-bold text-gray-500 uppercase">Đang Xử Lý</div>
                                            <div className="text-xl font-extrabold text-yellow-600">{fileProcessing}</div>
                                        </div>
                                    </div>

                                    {/* Progress Percent Card */}
                                    <div className="bg-gray-50/50 rounded-xl p-3 flex items-center justify-between gap-3 border border-gray-200">
                                        <div>
                                            <div className="text-[10px] font-bold text-gray-500 uppercase">Tiến Độ</div>
                                            <div className="text-xl font-extrabold text-indigo-600">{filePercent}%</div>
                                        </div>
                                        <div className="h-10 w-10 relative flex items-center justify-center">
                                             <svg className="w-full h-full transform -rotate-90">
                                                <circle cx="20" cy="20" r="16" stroke="currentColor" strokeWidth="4" fill="transparent" className="text-gray-200" />
                                                <circle cx="20" cy="20" r="16" stroke="currentColor" strokeWidth="4" fill="transparent" className="text-indigo-600" strokeDasharray={100} strokeDashoffset={100 - filePercent} />
                                             </svg>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Combine Controls */}
                            <div className="bg-white/60 backdrop-blur-sm px-4 py-3 rounded-2xl border border-white/50 flex items-center justify-between shadow-sm">
                                <div className="flex items-center gap-4 text-xs font-bold text-gray-600">
                                    <span className="text-indigo-800 uppercase tracking-wider">Ghép Video</span>
                                    <div className="h-4 w-px bg-gray-300"></div>
                                    <label className="flex items-center gap-1.5 cursor-pointer hover:text-indigo-600 transition"><input type="radio" name="combine" checked={combineMode==='normal'} onChange={()=>setCombineMode('normal')} className="accent-indigo-600 w-3 h-3"/> Nối thường</label>
                                    <label className="flex items-center gap-1.5 cursor-pointer hover:text-indigo-600 transition"><input type="radio" name="combine" checked={combineMode==='timed'} onChange={()=>setCombineMode('timed')} className="accent-indigo-600 w-3 h-3"/> Theo thời gian</label>
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={handleCombine} className="bg-white text-indigo-700 border border-indigo-200 px-4 py-2 rounded-xl text-xs font-bold shadow-sm hover:bg-indigo-50 transition">Ghép File Này</button>
                                    <button onClick={handleCombineAll} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-md hover:bg-indigo-700 transition border border-transparent">Ghép Tất Cả</button>
                                </div>
                            </div>

                            {/* Job Table - Improved Actions */}
                            <div className="flex-1 glass-card rounded-2xl overflow-hidden shadow-inner flex flex-col border border-white/50">
                                <div className="overflow-y-auto flex-1 custom-scrollbar">
                                    <table className="w-full text-sm text-left text-gray-700">
                                        <thead className="sticky top-0 z-10 bg-white/95 backdrop-blur-md shadow-sm">
                                            <tr>
                                                <th className="px-6 py-4 w-20 text-gray-400 font-bold uppercase text-[10px] tracking-wider">ID</th>
                                                <th className="px-6 py-4 w-40 text-gray-400 font-bold uppercase text-[10px] tracking-wider">Video Preview</th>
                                                <th className="px-6 py-4 w-32 text-center text-gray-400 font-bold uppercase text-[10px] tracking-wider">Trạng thái</th>
                                                <th className="px-6 py-4 text-right text-gray-400 font-bold uppercase text-[10px] tracking-wider">Hành động</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {activeFile.jobs.map((job, jIdx) => (
                                                <tr key={job.id + jIdx} className="hover:bg-white/60 transition group">
                                                    <td className="px-6 py-4 font-mono font-bold text-gray-400 group-hover:text-indigo-500 text-xs">
                                                        {job.id}
                                                        <div className="text-[10px] font-normal text-gray-300 mt-1 truncate w-24 select-none" title={job.prompt}>
                                                            {job.prompt ? job.prompt.substring(0, 15) + '...' : ''}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-3">
                                                        {job.videoPath ? (
                                                            <div className="relative w-32 h-20 rounded-lg overflow-hidden shadow-sm border border-gray-200 group-hover:shadow-md transition bg-black cursor-pointer group/video">
                                                                <video 
                                                                    src={getFileUrl(job.videoPath)}
                                                                    className="w-full h-full object-cover opacity-90 group-hover/video:opacity-100 transition"
                                                                    preload="metadata"
                                                                    muted
                                                                    loop
                                                                    onMouseOver={e => e.currentTarget.play().catch(()=>{})}
                                                                    onMouseOut={e => e.currentTarget.pause()}
                                                                />
                                                                <div className="absolute bottom-1 right-1 bg-black/60 text-white text-[9px] px-1 rounded pointer-events-none backdrop-blur-sm">Preview</div>
                                                            </div>
                                                        ) : (
                                                            <div className="w-32 h-20 rounded-lg bg-gray-50 border border-dashed border-gray-200 flex flex-col items-center justify-center text-gray-300">
                                                                <PlayIcon className="w-5 h-5 opacity-20 mb-1" />
                                                                <span className="text-[9px]">No Video</span>
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-4 text-center">
                                                        <span className={`status-badge status-${job.status?.toLowerCase() || 'pending'} px-3 py-1 rounded-lg text-[10px] font-extrabold shadow-sm uppercase tracking-wide border border-black/5`}>
                                                            {job.status || 'Pending'}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div className="flex justify-end items-center gap-2">
                                                            {/* Reset Button (Always visible or context aware) */}
                                                            <button 
                                                                onClick={() => handleResetJob(job)} 
                                                                className="w-8 h-8 flex items-center justify-center rounded-lg bg-indigo-50 text-indigo-500 hover:bg-indigo-100 hover:text-indigo-700 transition shadow-sm border border-indigo-100" 
                                                                title="Tạo lại (Reset)"
                                                            >
                                                                <RetryIcon className="w-4 h-4" />
                                                            </button>

                                                            {job.videoPath ? (
                                                                <>
                                                                    <button onClick={() => handleVideoAction('play', job)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-green-50 text-green-500 hover:bg-green-100 hover:text-green-700 transition shadow-sm border border-green-100" title="Xem video"><PlayIcon className="w-4 h-4"/></button>
                                                                    <button onClick={() => handleVideoAction('folder', job)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-blue-50 text-blue-500 hover:bg-blue-100 hover:text-blue-700 transition shadow-sm border border-blue-100" title="Mở thư mục"><FolderIcon className="w-4 h-4"/></button>
                                                                    <button onClick={() => handleVideoAction('delete', job)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-50 text-red-500 hover:bg-red-100 hover:text-red-700 transition shadow-sm border border-red-100" title="Xóa video"><TrashIcon className="w-4 h-4"/></button>
                                                                </>
                                                            ) : (
                                                                // Placeholders to keep spacing consistent
                                                                <>
                                                                    <div className="w-8 h-8"></div>
                                                                    <div className="w-8 h-8"></div>
                                                                    <div className="w-8 h-8"></div>
                                                                </>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-gray-400 glass-card rounded-2xl border-2 border-dashed border-white/50">
                            <p className="font-medium">Chọn một dự án từ danh sách bên trái</p>
                            <p className="text-sm opacity-60 mt-1">hoặc sử dụng thanh công cụ để thêm mới</p>
                        </div>
                    )}
                </div>
            </div>

            {loading && (
                <div className="fixed inset-0 bg-white/50 z-[100] flex items-center justify-center backdrop-blur-sm">
                    <div className="bg-white p-6 rounded-2xl shadow-2xl flex flex-col items-center animate-bounce-in ring-1 ring-black/5">
                        <LoaderIcon />
                        <p className="mt-4 font-bold text-gray-700">Đang xử lý...</p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Tracker;
