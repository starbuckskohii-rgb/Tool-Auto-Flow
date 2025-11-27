import React, { useState, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { TrackedFile, VideoJob } from '../types';
import { 
    LoaderIcon, FolderIcon, PlayIcon, RetryIcon, TrashIcon, 
    VideoIcon, CheckIcon, DownloadIcon, SearchIcon, ExternalLinkIcon, 
    CogIcon, XCircleIcon 
} from './Icons';

const isElectron = navigator.userAgent.toLowerCase().includes('electron');
const ipcRenderer = isElectron && (window as any).require ? (window as any).require('electron').ipcRenderer : null;

const Tracker: React.FC = () => {
    const [files, setFiles] = useState<TrackedFile[]>([]);
    const [isLoading, setIsLoading] = useState(false);
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
        setIsLoading(true);
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
            }
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoading(false);
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
        const res = await ipcRenderer.invoke('scan-folder-for-excels');
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
        }
    };

    const handleRemoveFile = (pathToRemove?: string) => {
        if(!pathToRemove || !ipcRenderer) return;
        ipcRenderer.send('stop-watching-file', pathToRemove);
        const newFiles = files.filter(f => f.path !== pathToRemove);
        setFiles(newFiles);
        const paths = newFiles.map(f => f.path).filter(Boolean) as string[];
        ipcRenderer.invoke('save-app-config', { trackedFilePaths: paths });
    };

    const handleRetryStuck = async (file: TrackedFile) => {
        if(!ipcRenderer || !file.path) return;
        const res = await ipcRenderer.invoke('retry-stuck-jobs', { filePath: file.path });
        if(res.success) {
            setFeedback({ type: 'success', message: 'Đã reset các job bị kẹt!' });
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
        
        setIsLoading(true);
        const res = await ipcRenderer.invoke('execute-ffmpeg-combine', {
            jobs: completedJobs,
            mode: 'concat',
            excelFileName: file.name
        });
        setIsLoading(false);
        
        if(res.success) setFeedback({type: 'success', message: `Đã ghép video: ${res.filePath}`});
        else setFeedback({type: 'error', message: res.error});
    };

    const handleOpenToolFlow = async () => {
        if(!ipcRenderer) return;
        const res = await ipcRenderer.invoke('open-tool-flow');
        if(!res.success) {
            // If failed, try asking for path
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

    return (
        <div className="space-y-6 animate-fade-in-up">
            {feedback && (
                <div className={`fixed top-24 right-4 z-[90] p-4 rounded-xl shadow-2xl border flex items-center gap-3 animate-bounce-in ${feedback.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-green-50 border-green-200 text-green-800'}`}>
                    {feedback.type === 'error' ? <XCircleIcon className="w-6 h-6"/> : <CheckIcon className="w-6 h-6"/>}
                    <p className="text-sm font-bold">{feedback.message}</p>
                    <button onClick={() => setFeedback(null)} className="ml-2 opacity-50 hover:opacity-100"><XCircleIcon className="w-4 h-4"/></button>
                </div>
            )}

            {/* Global Top Bar */}
            <div className="bg-white/80 backdrop-blur-md rounded-2xl p-3 mb-4 flex items-center justify-between shadow-sm border border-green-100">
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

            {isLoading && files.length === 0 && <div className="text-center py-10"><LoaderIcon /></div>}

            <div className="grid grid-cols-1 gap-4">
                {files.map(file => {
                    const fTotal = file.jobs.length;
                    const fDone = file.jobs.filter(j => j.videoPath || j.status === 'Completed').length;
                    const fPercent = fTotal > 0 ? Math.round((fDone/fTotal)*100) : 0;
                    const isExpanded = expandedFiles.has(file.path || '');
                    
                    const stuckCount = file.jobs.filter(j => j.status === 'Processing' || j.status === 'Generating').length;

                    return (
                        <div key={file.path} className={`bg-white border rounded-xl shadow-sm transition-all duration-300 ${fPercent === 100 ? 'border-green-200 shadow-green-50' : 'border-gray-200'}`}>
                            {/* File Header */}
                            <div className="p-4 flex items-center justify-between">
                                <div className="flex items-center gap-4 flex-1 cursor-pointer" onClick={() => toggleExpand(file.path)}>
                                    <div className={`p-3 rounded-full ${fPercent === 100 ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
                                        {fPercent === 100 ? <CheckIcon className="w-5 h-5"/> : <VideoIcon className="w-5 h-5"/>}
                                    </div>
                                    <div className="flex-1">
                                        <h3 className="font-bold text-gray-800 text-sm truncate w-64 md:w-auto">{file.name}</h3>
                                        <div className="flex items-center gap-3 mt-1">
                                            <div className="w-32 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                                <div className={`h-full rounded-full ${fPercent===100?'bg-green-500':'bg-blue-500'}`} style={{width: `${fPercent}%`}}></div>
                                            </div>
                                            <span className="text-[10px] font-bold text-gray-400">{fDone}/{fTotal} ({fPercent}%)</span>
                                        </div>
                                    </div>
                                </div>
                                
                                <div className="flex items-center gap-2">
                                    {stuckCount > 0 && (
                                        <button onClick={() => handleRetryStuck(file)} className="px-3 py-1.5 bg-orange-100 text-orange-600 rounded-md text-[10px] font-bold hover:bg-orange-200 transition flex items-center gap-1 animate-pulse">
                                            <RetryIcon className="w-3 h-3"/> Reset {stuckCount} Stuck
                                        </button>
                                    )}
                                    <button onClick={() => handleCombine(file)} className="p-2 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition" title="Ghép Video">
                                        <CogIcon className="w-4 h-4"/>
                                    </button>
                                    <button onClick={() => handleOpenFolder(file.path)} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition" title="Mở Thư Mục">
                                        <ExternalLinkIcon className="w-4 h-4"/>
                                    </button>
                                    <button onClick={() => handleRemoveFile(file.path)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition" title="Xóa khỏi danh sách">
                                        <TrashIcon className="w-4 h-4"/>
                                    </button>
                                </div>
                            </div>

                            {/* Job List */}
                            {isExpanded && (
                                <div className="border-t border-gray-100 bg-gray-50/50 p-4 max-h-96 overflow-y-auto custom-scrollbar">
                                    <table className="w-full text-left text-xs">
                                        <thead className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                                            <tr>
                                                <th className="pb-2">ID</th>
                                                <th className="pb-2">Prompt</th>
                                                <th className="pb-2">Trạng thái</th>
                                                <th className="pb-2 text-right">Hành động</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {file.jobs.map(job => (
                                                <tr key={job.id} className="hover:bg-white transition-colors group">
                                                    <td className="py-2 font-mono text-gray-500 font-medium w-16">{job.id}</td>
                                                    <td className="py-2 text-gray-700 w-1/2 pr-4">
                                                        <div className="truncate max-w-md" title={job.prompt}>{job.prompt}</div>
                                                    </td>
                                                    <td className="py-2">
                                                        {job.videoPath ? (
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700">
                                                                <CheckIcon className="w-3 h-3"/> Done
                                                            </span>
                                                        ) : (
                                                            <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold ${
                                                                job.status === 'Processing' ? 'bg-blue-100 text-blue-700 animate-pulse' :
                                                                job.status === 'Failed' ? 'bg-red-100 text-red-700' :
                                                                'bg-gray-200 text-gray-600'
                                                            }`}>
                                                                {job.status}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="py-2 text-right">
                                                        {job.videoPath && (
                                                            <button onClick={() => openVideo(job.videoPath)} className="text-blue-500 hover:text-blue-700 font-bold text-[10px] flex items-center justify-end gap-1 ml-auto">
                                                                <PlayIcon className="w-3 h-3"/> Xem
                                                            </button>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    );
                })}

                {files.length === 0 && !isLoading && (
                    <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-xl bg-gray-50/50">
                        <FolderIcon className="w-12 h-12 text-gray-300 mx-auto mb-3"/>
                        <p className="text-gray-500 font-bold mb-4">Chưa có folder nào được theo dõi</p>
                        <button onClick={handleAddFolder} className="px-6 py-2 bg-blue-600 text-white rounded-lg font-bold shadow-lg hover:bg-blue-700 transition">
                            Thêm Folder Ngay
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Tracker;