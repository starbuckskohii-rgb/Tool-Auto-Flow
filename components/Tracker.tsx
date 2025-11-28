import React, { useState, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { TrackedFile, VideoJob } from '../types';
import { 
    LoaderIcon, FolderIcon, PlayIcon, RetryIcon, TrashIcon, 
    VideoIcon, CheckIcon, SearchIcon, ExternalLinkIcon, 
    CogIcon, XCircleIcon, LinkIcon
} from './Icons';

const isElectron = navigator.userAgent.toLowerCase().includes('electron');
const ipcRenderer = isElectron && (window as any).require ? (window as any).require('electron').ipcRenderer : null;

const Tracker: React.FC = () => {
    const [files, setFiles] = useState<TrackedFile[]>([]);
    const [activeFileIndex, setActiveFileIndex] = useState<number>(0);
    const [loading, setLoading] = useState(false);
    const [combineMode, setCombineMode] = useState<'normal' | 'timed'>('normal');
    const [feedback, setFeedback] = useState<{type: 'error'|'success', message: string}|null>(null);
    const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

    // Stats Calculation
    const totalFiles = files.length;
    const totalJobs = files.reduce((acc, f) => acc + f.jobs.length, 0);
    const totalCompleted = files.reduce((acc, f) => acc + f.jobs.filter(j => j.videoPath || j.status === 'Completed').length, 0);
    const globalPercent = totalJobs > 0 ? Math.round((totalCompleted / totalJobs) * 100) : 0;

    // Helper: Parse Excel Buffer
    const parseExcelBuffer = (buffer: ArrayBuffer): VideoJob[] => {
        try {
            const workbook = XLSX.read(buffer, { type: 'array' });
            if (!workbook.SheetNames.length) return [];
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json<any>(sheet, { header: 1 }); // Array of arrays
            
            if (jsonData.length < 2) return []; // Header only or empty

            const headers: string[] = jsonData[0].map((h: any) => String(h).trim());
            const colMap: Record<string, number> = {};
            headers.forEach((h, i) => colMap[h] = i);

            const jobs: VideoJob[] = [];
            for (let i = 1; i < jsonData.length; i++) {
                const row = jsonData[i];
                if (!row || row.length === 0) continue;

                const get = (key: string) => row[colMap[key]] !== undefined ? String(row[colMap[key]]) : '';
                const id = get('JOB_ID');
                
                if (id) {
                    jobs.push({
                        id,
                        prompt: get('PROMPT'),
                        imagePath: get('IMAGE_PATH'),
                        imagePath2: get('IMAGE_PATH_2'),
                        imagePath3: get('IMAGE_PATH_3'),
                        status: (get('STATUS') as any) || 'Pending',
                        videoName: get('VIDEO_NAME'),
                        typeVideo: get('TYPE_VIDEO'),
                        videoPath: get('VIDEO_PATH') || undefined
                    });
                }
            }
            return jobs;
        } catch (e) {
            console.error("Parse Error", e);
            return [];
        }
    };

    const getFileUrl = (path: string) => {
        if (!path) return '';
        return `file://${path.replace(/\\/g, '/')}`;
    };

    // Load Files Logic
    const refreshFileStatus = async (currentFiles: TrackedFile[]) => {
        if (!ipcRenderer) return;
        
        const updatedFiles = await Promise.all(currentFiles.map(async (file) => {
            try {
                // Determine status via backend logic (checking disk for videos)
                const res = await ipcRenderer.invoke('find-videos-for-jobs', { 
                    jobs: file.jobs, 
                    excelFilePath: file.path 
                });
                if (res.success) {
                    return { ...file, jobs: res.jobs };
                }
            } catch (e) {
                console.error(`Error refreshing file ${file.name}`, e);
            }
            return file;
        }));
        
        setFiles(updatedFiles);
    };

    const loadFiles = useCallback(async () => {
        if (!ipcRenderer) return;
        setLoading(true);
        try {
            const res = await ipcRenderer.invoke('load-tracked-files'); // returns {path, name, content}[]
            if (res.success) {
                const initialFiles: TrackedFile[] = res.files.map((f: any) => ({
                    name: f.name,
                    path: f.path,
                    jobs: parseExcelBuffer(f.content)
                }));
                
                setFiles(initialFiles);
                initialFiles.forEach(f => {
                     if(f.path) ipcRenderer.send('start-watching-file', f.path);
                });
                
                // Immediate status check
                await refreshFileStatus(initialFiles);
                if (initialFiles.length > 0) setActiveFileIndex(0);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, []);

    // Initial Load
    useEffect(() => {
        loadFiles();
        return () => {
            // Cleanup watchers is tricky if unmounting, maybe keep them? 
            // Usually we stop watching on unmount, but if user switches tabs we might want to keep watching.
            // For now, let's keep watching to avoid re-adding watchers multiple times or losing state.
        };
    }, [loadFiles]);

    // Polling for video status (since videos appear without excel change)
    useEffect(() => {
        const interval = setInterval(() => {
            if (files.length > 0) refreshFileStatus(files);
        }, 5000);
        return () => clearInterval(interval);
    }, [files]);

    // IPC Listeners
    useEffect(() => {
        if (!ipcRenderer) return;

        const handleContentUpdate = (_: any, { path, content }: { path: string, content: any }) => {
            setFiles(prev => {
                const idx = prev.findIndex(f => f.path === path);
                if (idx === -1) return prev;
                
                const newJobs = parseExcelBuffer(content);
                const newFiles = [...prev];
                // Note: We need to preserve video paths if backend hasn't updated them yet, 
                // but actually the next poll or 'find-videos-for-jobs' will fix it.
                // Better to trigger a refresh immediately after content update.
                newFiles[idx] = { ...newFiles[idx], jobs: newJobs };
                
                // Trigger async refresh separately
                ipcRenderer.invoke('find-videos-for-jobs', { jobs: newJobs, excelFilePath: path })
                    .then((res: any) => {
                         if (res.success) {
                             setFiles(current => {
                                 const cIdx = current.findIndex(f => f.path === path);
                                 if (cIdx === -1) return current;
                                 const cFiles = [...current];
                                 cFiles[cIdx] = { ...cFiles[cIdx], jobs: res.jobs };
                                 return cFiles;
                             });
                         }
                    });

                return newFiles;
            });
        };

        ipcRenderer.on('file-content-updated', handleContentUpdate);
        return () => {
            ipcRenderer.removeListener('file-content-updated', handleContentUpdate);
        };
    }, []);

    // Handlers
    const handleAddFolder = async () => {
        if (!ipcRenderer) return;
        setLoading(true);
        const res = await ipcRenderer.invoke('scan-folder-for-excels');
        setLoading(false);
        if (res.success && res.files.length > 0) {
            const newFiles = res.files.map((f: any) => ({
                name: f.name,
                path: f.path,
                jobs: parseExcelBuffer(f.content)
            }));
            
            // Merge with existing avoiding duplicates
            const merged = [...files];
            newFiles.forEach((nf: TrackedFile) => {
                if (!merged.find(e => e.path === nf.path)) {
                    merged.push(nf);
                    if(nf.path) ipcRenderer.send('start-watching-file', nf.path);
                }
            });

            setFiles(merged);
            // Persist
            const paths = merged.map(f => f.path).filter(Boolean) as string[];
            ipcRenderer.invoke('save-app-config', { trackedFilePaths: paths });
            refreshFileStatus(merged);
            if (files.length === 0 && newFiles.length > 0) setActiveFileIndex(0);
        }
    };

    const handleOpenFile = async () => {
        if (!ipcRenderer) return;
        const result = await ipcRenderer.invoke('open-file-dialog');
        if (result.success && result.files) {
            const newFiles: TrackedFile[] = [];
            for (const f of result.files) {
                if (files.some(existing => existing.path === f.path)) continue;
                const rawJobs = parseExcelBuffer(f.content);
                const videoResult = await ipcRenderer.invoke('find-videos-for-jobs', { jobs: rawJobs, excelFilePath: f.path });
                newFiles.push({
                    name: f.name,
                    path: f.path,
                    jobs: videoResult.success ? videoResult.jobs : rawJobs
                });
                ipcRenderer.send('start-watching-file', f.path);
            }
            if (newFiles.length > 0) {
                const updatedFiles = [...files, ...newFiles];
                setFiles(updatedFiles);
                setActiveFileIndex(updatedFiles.length - 1);
                
                const paths = updatedFiles.map(f => f.path).filter(Boolean) as string[];
                ipcRenderer.invoke('save-app-config', { trackedFilePaths: paths });
            }
        }
    };

    const handleClearAll = () => {
        if (!ipcRenderer) return;
        if (!confirm('Bạn có chắc chắn muốn xóa toàn bộ danh sách file đang theo dõi?')) return;
        files.forEach(f => { if (f.path) ipcRenderer.send('stop-watching-file', f.path); });
        setFiles([]);
        setActiveFileIndex(0);
        ipcRenderer.invoke('save-app-config', { trackedFilePaths: [] });
    };

    const handleRemoveFile = (pathToRemove?: string) => {
        if(!pathToRemove || !ipcRenderer) return;
        ipcRenderer.send('stop-watching-file', pathToRemove);
        const newFiles = files.filter(f => f.path !== pathToRemove);
        setFiles(newFiles);
        if (activeFileIndex >= newFiles.length) setActiveFileIndex(Math.max(0, newFiles.length - 1));
        
        const paths = newFiles.map(f => f.path).filter(Boolean) as string[];
        ipcRenderer.invoke('save-app-config', { trackedFilePaths: paths });
    };

    const handleRetryStuck = async (file: TrackedFile) => {
        if(!ipcRenderer || !file.path) return;
        if(!confirm('Bạn có muốn reset trạng thái các job đang bị kẹt (Processing/Generating) không?')) return;
        
        const res = await ipcRenderer.invoke('retry-stuck-jobs', { filePath: file.path });
        if(res.success) {
            setFeedback({ type: 'success', message: 'Đã reset các job bị kẹt!' });
            refreshFileStatus(files);
        } else {
            setFeedback({ type: 'error', message: res.error });
        }
    };

    const handleOpenFolder = (pathStr?: string) => {
        if(pathStr && ipcRenderer) ipcRenderer.send('open-folder', pathStr.replace(/[/\\][^/\\]+$/, ''));
    };

    const handleCombine = async (file: TrackedFile) => {
        if(!ipcRenderer || !file.path) return;
        const completedJobs = file.jobs.filter(j => j.videoPath);
        if(completedJobs.length === 0) return setFeedback({type: 'error', message: 'Chưa có video nào hoàn thành'});
        
        setLoading(true);
        const res = await ipcRenderer.invoke('execute-ffmpeg-combine', {
            jobs: completedJobs,
            mode: combineMode,
            excelFileName: file.name
        });
        setLoading(false);
        
        if(res.success) setFeedback({type: 'success', message: `Đã ghép video: ${res.filePath}`});
        else setFeedback({type: 'error', message: res.error});
    };
    
    const handleCombineAll = async () => {
        if (!ipcRenderer) return;
        const filesWithVideos = files.filter(f => f.jobs.some(j => j.status === 'Completed' && j.videoPath));
        if (filesWithVideos.length === 0) return setFeedback({type: 'error', message: 'Không có file nào có video hoàn thành.'});
        if(!confirm(`Bạn sắp ghép video cho ${filesWithVideos.length} file đang mở. Tiếp tục?`)) return;

        setLoading(true);
        const filesPayload = filesWithVideos.map(f => ({
            name: f.name,
            jobs: f.jobs.filter(j => j.status === 'Completed' && j.videoPath)
        }));
        const res = await ipcRenderer.invoke('execute-ffmpeg-combine-all', filesPayload);
        setLoading(false);
        if (!res.canceled) {
            let msg = `Đã xử lý xong. Thành công: ${res.successes.length}, Thất bại: ${res.failures.length}`;
            if (res.failures.length > 0) msg += ` (Lỗi: ${res.failures.join(', ')})`;
            setFeedback({ type: res.failures.length === 0 ? 'success' : 'error', message: msg });
        }
    };

    const handleResetJob = async (job: VideoJob) => {
        const activeFile = files[activeFileIndex];
        if (!activeFile || !ipcRenderer || !activeFile.path) return;
        if (!confirm(`Bạn có chắc muốn tạo lại (reset) Job "${job.id}" không?`)) return;

        setLoading(true);
        try {
            await ipcRenderer.invoke('retry-job', { filePath: activeFile.path, jobId: job.id });
            await refreshFileStatus(files);
        } finally {
            setLoading(false);
        }
    };

    const handleOpenToolFlow = async () => {
        if(!ipcRenderer) return;
        const res = await ipcRenderer.invoke('open-tool-flow');
        if(!res.success) {
             const setRes = await ipcRenderer.invoke('set-tool-flow-path');
             if(setRes.success) {
                 await ipcRenderer.invoke('open-tool-flow');
             } else {
                 setFeedback({type: 'error', message: 'Chưa cấu hình đường dẫn Tool Flow'});
             }
        }
    };

    const toggleExpand = (pathStr?: string) => {
        if(!pathStr) return;
        const newSet = new Set(expandedFiles);
        if(newSet.has(pathStr)) newSet.delete(pathStr);
        else newSet.add(pathStr);
        setExpandedFiles(newSet);
    };

    const openVideo = (videoPath?: string) => {
        if(videoPath && ipcRenderer) ipcRenderer.send('open-video-path', videoPath);
    }
    
    const handleVideoAction = (action: 'play' | 'folder' | 'delete', job: VideoJob) => {
        if (!ipcRenderer || !job.videoPath) return;
        if (action === 'play') ipcRenderer.send('open-video-path', job.videoPath);
        if (action === 'folder') ipcRenderer.send('show-video-in-folder', job.videoPath);
        if (action === 'delete') {
             ipcRenderer.invoke('delete-video-file', job.videoPath).then((res: any) => {
                 if (res.success) refreshFileStatus(files);
             });
        }
    };

    const copyFolderPath = () => {
        const activeFile = files[activeFileIndex];
        if(activeFile && activeFile.path && isElectron) {
             const folder = activeFile.path.substring(0, activeFile.path.lastIndexOf((navigator.platform.indexOf("Win") > -1 ? "\\" : "/")));
             navigator.clipboard.writeText(folder);
             setFeedback({ type: 'success', message: 'Đã copy đường dẫn thư mục!' });
        }
    };

    const activeFile = files[activeFileIndex];
    const fileTotal = activeFile ? activeFile.jobs.length : 0;
    const fileCompleted = activeFile ? activeFile.jobs.filter(j => j.status === 'Completed').length : 0;
    const fileProcessing = activeFile ? activeFile.jobs.filter(j => j.status === 'Processing' || j.status === 'Generating').length : 0;
    const filePercent = fileTotal > 0 ? Math.round((fileCompleted / fileTotal) * 100) : 0;

    return (
        <div className="space-y-4 animate-fade-in-up flex flex-col h-[calc(100vh-100px)]">
            {feedback && (
                <div className={`fixed top-24 right-4 z-[90] p-4 rounded-xl shadow-2xl border flex items-center gap-3 animate-bounce-in ${feedback.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-green-50 border-green-200 text-green-800'}`}>
                    {feedback.type === 'error' ? <XCircleIcon className="w-6 h-6"/> : <CheckIcon className="w-6 h-6"/>}
                    <p className="text-sm font-bold">{feedback.message}</p>
                    <button onClick={() => setFeedback(null)} className="ml-2 opacity-50 hover:opacity-100"><XCircleIcon className="w-4 h-4"/></button>
                </div>
            )}

            {/* Global Top Bar */}
            <div className="bg-white/80 backdrop-blur-md rounded-2xl p-3 mb-2 flex items-center justify-between shadow-sm border border-green-100">
                 <div className="flex items-center gap-6 px-4">
                    {/* Total Files */}
                    <div className="flex flex-col items-center">
                        <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Tổng Files</span>
                        <span className="text-2xl font-extrabold text-red-600 leading-none">{totalFiles}</span>
                    </div>
                    
                    <div className="h-10 w-px bg-gray-200"></div>

                    {/* Jobs Completed */}
                    <div className="flex flex-col items-center">
                        <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Jobs Hoàn Thành</span>
                        <div className="flex items-baseline gap-1">
                             <span className="text-2xl font-extrabold text-green-600 leading-none">{totalCompleted}</span>
                             <span className="text-sm text-gray-400 font-bold">/ {totalJobs}</span>
                        </div>
                    </div>

                    <div className="h-10 w-px bg-gray-200"></div>

                     {/* Progress Bar */}
                     <div className="flex flex-col justify-center min-w-[150px]">
                         <div className="flex justify-between items-center mb-1">
                             <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Tiến độ</span>
                             <span className={`text-xs font-black ${globalPercent===100?'text-green-600':'text-gray-500'}`}>{globalPercent}%</span>
                         </div>
                         <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden shadow-inner border border-gray-100">
                             <div 
                                className={`h-full rounded-full transition-all duration-700 ease-out ${globalPercent === 100 ? 'bg-green-500' : 'bg-gradient-to-r from-blue-400 to-green-500'}`} 
                                style={{ width: `${globalPercent}%` }}
                            ></div>
                         </div>
                    </div>
                 </div>

                 <div className="flex items-center gap-2">
                    <button onClick={handleOpenToolFlow} className="px-4 py-2 bg-gray-800 text-white rounded-lg font-bold text-xs hover:bg-gray-700 transition flex items-center gap-2 shadow-lg">
                        <PlayIcon className="w-3 h-3"/> Mở Tool Flow
                    </button>
                    <button onClick={handleAddFolder} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-bold text-xs hover:bg-blue-700 transition flex items-center gap-2 shadow-lg">
                        <FolderIcon className="w-3 h-3"/> Thêm Folder
                    </button>
                 </div>
            </div>

            {loading && files.length === 0 && <div className="text-center py-10"><LoaderIcon /></div>}

            {files.length === 0 && !loading ? (
                <div className="flex flex-col items-center justify-center h-[60vh] text-center p-10 bg-white/50 rounded-3xl border-2 border-dashed border-gray-300">
                    <FolderIcon className="w-20 h-20 text-gray-300 mb-6" />
                    <h3 className="text-2xl font-bold text-gray-500 mb-2">Chưa theo dõi dự án nào</h3>
                    <p className="text-gray-400 mb-8 max-w-md">Hãy mở file Excel kịch bản hoặc quét thư mục dự án để bắt đầu quy trình tự động hóa.</p>
                    <div className="flex gap-4">
                        <button onClick={handleOpenFile} className="px-8 py-4 bg-red-600 text-white rounded-2xl font-bold text-lg shadow-xl hover:scale-105 transition flex items-center gap-3 hover:bg-red-700">
                            <FolderIcon className="w-6 h-6"/> Mở File Excel
                        </button>
                        <button onClick={handleAddFolder} className="bg-white text-green-700 border-2 border-green-100 px-8 py-4 rounded-2xl font-bold text-lg shadow-md hover:bg-green-50 transition flex items-center gap-3">
                            <SearchIcon className="w-6 h-6"/> Quét Thư Mục
                        </button>
                    </div>
                </div>
            ) : (
                <div className="flex gap-4 flex-1 overflow-hidden">
                    {/* Left Sidebar */}
                    <div className="w-[260px] flex flex-col gap-2 overflow-y-auto pr-1 pb-4 custom-scrollbar">
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
                                        relative p-3 rounded-xl cursor-pointer transition-all duration-200 border group
                                        ${isActive 
                                            ? 'bg-white border-red-200 shadow-md z-10 ring-1 ring-red-100' 
                                            : 'bg-white/60 border-transparent hover:bg-white/80'
                                        }
                                    `}
                                >
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="flex items-center gap-2 overflow-hidden">
                                            <div className={`p-1.5 rounded-full flex-shrink-0 ${percent === 100 ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                                                {percent === 100 ? <CheckIcon className="w-3 h-3"/> : <VideoIcon className="w-3 h-3"/>}
                                            </div>
                                            <div className={`font-bold text-sm truncate ${isActive ? 'text-red-800' : 'text-gray-500'}`} title={f.name}>{f.name}</div>
                                        </div>
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); handleRemoveFile(f.path); }}
                                            className="text-gray-300 hover:text-red-500 p-0.5 rounded-full hover:bg-red-50 transition opacity-0 group-hover:opacity-100"
                                        >
                                            <TrashIcon className="w-3 h-3" />
                                        </button>
                                    </div>
                                    <div className="w-full bg-gray-200 rounded-full h-1 overflow-hidden">
                                        <div 
                                            className={`h-full rounded-full transition-all duration-500 ${percent === 100 ? 'bg-green-500' : 'bg-red-400'}`} 
                                            style={{ width: `${percent}%` }}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Right Main Content */}
                    <div className="flex-1 flex flex-col gap-4 overflow-hidden">
                        {activeFile && (
                            <>
                                {/* Detailed Header & Toolbar */}
                                <div className="bg-white/70 backdrop-blur-md p-1 rounded-2xl border border-white/60 shadow-sm flex flex-col gap-1">
                                    {/* Stats Row */}
                                    <div className="flex items-center p-3 gap-4">
                                        <div className="flex-1 min-w-0">
                                            <h2 className="text-lg font-extrabold text-gray-800 truncate" title={activeFile.name}>{activeFile.name}</h2>
                                            <p className="text-[10px] text-gray-400 font-mono mt-0.5 truncate cursor-pointer hover:text-red-600" onClick={copyFolderPath}>{activeFile.path}</p>
                                        </div>
                                        
                                        <div className="flex gap-3">
                                            <div className="bg-red-50 px-4 py-2 rounded-xl border border-red-100 min-w-[100px]">
                                                <div className="text-[9px] font-bold text-red-400 uppercase tracking-wide mb-1">Tổng Job</div>
                                                <div className="text-xl font-black text-red-600 leading-none">{fileTotal}</div>
                                            </div>
                                            <div className="bg-green-50 px-4 py-2 rounded-xl border border-green-100 min-w-[100px]">
                                                <div className="text-[9px] font-bold text-green-500 uppercase tracking-wide mb-1">Hoàn thành</div>
                                                <div className="text-xl font-black text-green-600 leading-none">{fileCompleted}</div>
                                            </div>
                                            <div className="bg-yellow-50 px-4 py-2 rounded-xl border border-yellow-100 min-w-[100px]">
                                                <div className="text-[9px] font-bold text-yellow-600 uppercase tracking-wide mb-1">Đang xử lý</div>
                                                <div className="text-xl font-black text-yellow-600 leading-none">{fileProcessing}</div>
                                            </div>
                                            <div className="pl-4 border-l border-gray-200 flex flex-col justify-center items-end min-w-[60px]">
                                                <div className="text-2xl font-black text-gray-700">{filePercent}<span className="text-sm text-gray-400">%</span></div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Toolbar Row */}
                                    <div className="bg-white/50 rounded-xl px-4 py-2 flex items-center justify-between">
                                        <div className="flex items-center gap-4 text-xs font-bold text-gray-500">
                                            <span className="uppercase tracking-wider text-[10px]">Ghép Video:</span>
                                            <label className="flex items-center gap-1.5 cursor-pointer hover:text-red-600 transition"><input type="radio" name="combine" checked={combineMode==='normal'} onChange={()=>setCombineMode('normal')} className="accent-red-600 w-3 h-3"/> Nối thường</label>
                                            <label className="flex items-center gap-1.5 cursor-pointer hover:text-red-600 transition"><input type="radio" name="combine" checked={combineMode==='timed'} onChange={()=>setCombineMode('timed')} className="accent-red-600 w-3 h-3"/> Theo thời gian</label>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button onClick={() => handleCombine(activeFile)} className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-red-600 text-xs font-bold shadow-sm hover:shadow hover:text-red-700 transition">Ghép File Này</button>
                                            <button onClick={handleCombineAll} className="px-3 py-1.5 rounded-lg bg-red-600 text-white border border-transparent text-xs font-bold shadow-sm hover:bg-red-700 transition">Ghép Tất Cả</button>
                                            <div className="h-4 w-px bg-gray-300 mx-2"></div>
                                            <button onClick={() => refreshFileStatus([activeFile])} className="p-1.5 rounded-lg text-gray-400 hover:bg-white hover:text-green-600 transition" title="Làm mới"><LinkIcon className="w-4 h-4"/></button>
                                            <button onClick={() => handleRetryStuck(activeFile)} className="p-1.5 rounded-lg text-gray-400 hover:bg-white hover:text-orange-500 transition" title="Sửa lỗi kẹt"><RetryIcon className="w-4 h-4"/></button>
                                        </div>
                                    </div>
                                </div>

                                {/* Job Table */}
                                <div className="flex-1 bg-white/40 backdrop-blur-sm rounded-2xl overflow-hidden shadow-sm flex flex-col border border-white/60">
                                    <div className="overflow-y-auto flex-1 custom-scrollbar">
                                        <table className="w-full text-sm text-left">
                                            <thead className="sticky top-0 z-10 bg-white/90 backdrop-blur-md shadow-sm">
                                                <tr>
                                                    <th className="px-6 py-3 w-20 text-gray-400 font-extrabold uppercase text-[10px] tracking-widest">ID</th>
                                                    <th className="px-6 py-3 w-48 text-gray-400 font-extrabold uppercase text-[10px] tracking-widest">Video Preview</th>
                                                    <th className="px-6 py-3 w-32 text-center text-gray-400 font-extrabold uppercase text-[10px] tracking-widest">Trạng thái</th>
                                                    <th className="px-6 py-3 text-right text-gray-400 font-extrabold uppercase text-[10px] tracking-widest">Hành động</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {activeFile.jobs.map((job, jIdx) => (
                                                    <tr key={job.id + jIdx} className="hover:bg-white/50 transition group">
                                                        <td className="px-6 py-4 align-top pt-6">
                                                            <div className="font-mono font-bold text-gray-400 text-xs group-hover:text-red-500 transition">{job.id}</div>
                                                            <div className="text-[9px] text-gray-300 mt-1 line-clamp-2 w-20 group-hover:text-gray-400 transition" title={job.prompt}>
                                                                {job.prompt}
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-3">
                                                            {job.videoPath ? (
                                                                <div className="relative w-40 h-24 rounded-xl overflow-hidden shadow-sm border border-gray-200 group-hover:shadow-lg group-hover:scale-[1.02] transition bg-black cursor-pointer group/video">
                                                                    <video 
                                                                        src={getFileUrl(job.videoPath)}
                                                                        className="w-full h-full object-cover opacity-90 group-hover/video:opacity-100 transition"
                                                                        preload="metadata"
                                                                        muted
                                                                        loop
                                                                        onMouseOver={e => e.currentTarget.play().catch(()=>{})}
                                                                        onMouseOut={e => e.currentTarget.pause()}
                                                                    />
                                                                    <div className="absolute bottom-1 right-1 bg-black/60 text-white text-[9px] px-1.5 py-0.5 rounded font-medium backdrop-blur-sm pointer-events-none">Preview</div>
                                                                </div>
                                                            ) : (
                                                                <div className="w-40 h-24 rounded-xl bg-gray-50/50 border border-dashed border-gray-200 flex flex-col items-center justify-center text-gray-300">
                                                                    <PlayIcon className="w-6 h-6 opacity-20 mb-1" />
                                                                    <span className="text-[9px] font-bold opacity-50">No Video</span>
                                                                </div>
                                                            )}
                                                        </td>
                                                        <td className="px-6 py-4 text-center align-middle">
                                                            <span className={`inline-flex items-center justify-center px-3 py-1.5 rounded-lg text-[10px] font-black shadow-sm uppercase tracking-wider border ${
                                                                job.status === 'Completed' ? 'bg-green-100 text-green-700 border-green-200' :
                                                                job.status === 'Processing' || job.status === 'Generating' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                                                                'bg-gray-100 text-gray-500 border-gray-200'
                                                            }`}>
                                                                {job.status || 'Pending'}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-4 align-middle">
                                                            <div className="flex justify-end items-center gap-2">
                                                                <button 
                                                                    onClick={() => handleResetJob(job)} 
                                                                    className="w-10 h-10 flex items-center justify-center rounded-xl bg-gray-50 text-gray-400 hover:bg-red-500 hover:text-white transition-all duration-200 shadow-sm hover:shadow-md border border-gray-100" 
                                                                    title="Tạo lại (Reset)"
                                                                >
                                                                    <RetryIcon className="w-4 h-4" />
                                                                </button>

                                                                {job.videoPath ? (
                                                                    <>
                                                                        <button onClick={() => handleVideoAction('play', job)} className="w-10 h-10 flex items-center justify-center rounded-xl bg-green-50 text-green-600 hover:bg-green-500 hover:text-white transition-all duration-200 shadow-sm hover:shadow-md border border-green-100" title="Xem video"><PlayIcon className="w-4 h-4"/></button>
                                                                        <button onClick={() => handleVideoAction('folder', job)} className="w-10 h-10 flex items-center justify-center rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-500 hover:text-white transition-all duration-200 shadow-sm hover:shadow-md border border-blue-100" title="Mở thư mục"><FolderIcon className="w-4 h-4"/></button>
                                                                        <button onClick={() => handleVideoAction('delete', job)} className="w-10 h-10 flex items-center justify-center rounded-xl bg-red-50 text-red-500 hover:bg-red-500 hover:text-white transition-all duration-200 shadow-sm hover:shadow-md border border-red-100" title="Xóa video"><TrashIcon className="w-4 h-4"/></button>
                                                                    </>
                                                                ) : (
                                                                    <div className="w-[120px]"></div>
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
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default Tracker;