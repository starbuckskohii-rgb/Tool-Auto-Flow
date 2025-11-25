
import React, { useState, useEffect, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import { TrackedFile, VideoJob } from '../types';
import { 
  FolderIcon, 
  RetryIcon, 
  PlayIcon, 
  VideoIcon, 
  CheckIcon, 
  TrashIcon, 
  LoaderIcon, 
  ExternalLinkIcon, 
  ChartIcon,
  CogIcon
} from './Icons';

const isElectron = navigator.userAgent.toLowerCase().includes('electron');
const ipcRenderer = isElectron && (window as any).require ? (window as any).require('electron').ipcRenderer : null;

const Tracker: React.FC = () => {
    const [files, setFiles] = useState<TrackedFile[]>([]);
    const [activeFileIndex, setActiveFileIndex] = useState<number>(0);
    const [loading, setLoading] = useState(false);
    const [combineMode, setCombineMode] = useState<'normal' | 'timed'>('normal');

    // Refs to track previous lengths/states to avoid loops
    const filesRef = useRef(files);
    filesRef.current = files;

    // --- Helpers ---
    const parseExcel = (buffer: ArrayBuffer): VideoJob[] => {
        try {
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
                imagePath: '', imagePath2: '', imagePath3: '' // Placeholders
            })).filter(j => j.id);
        } catch (e) {
            console.error("Parse error:", e);
            return [];
        }
    };

    // --- IPC Listeners ---
    useEffect(() => {
        if (!ipcRenderer) return;

        const handleFileUpdate = (_: any, { path, content }: { path: string, content: any }) => {
            const buffer = content.data || content; // Handle Node buffer serialization
            const newJobs = parseExcel(buffer);
            
            // Need to invoke finding videos to get the video paths merged in
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
                // Check if already open
                if (files.some(existing => existing.path === f.path)) continue;

                const rawJobs = parseExcel(f.content.data || f.content);
                // Initial scan for videos
                const videoResult = await ipcRenderer.invoke('find-videos-for-jobs', { jobs: rawJobs, excelFilePath: f.path });
                
                newFiles.push({
                    name: f.name,
                    path: f.path,
                    jobs: videoResult.success ? videoResult.jobs : rawJobs
                });

                // Start watching
                ipcRenderer.send('start-watching-file', f.path);
            }
            if (newFiles.length > 0) {
                setFiles(prev => [...prev, ...newFiles]);
                setActiveFileIndex(files.length); // Switch to first new file
            }
        }
    };

    const handleCloseFile = (index: number, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!ipcRenderer) return;
        const fileToRemove = files[index];
        if (fileToRemove.path) {
            ipcRenderer.send('stop-watching-file', fileToRemove.path);
        }
        const newFiles = files.filter((_, i) => i !== index);
        setFiles(newFiles);
        if (activeFileIndex >= newFiles.length) setActiveFileIndex(Math.max(0, newFiles.length - 1));
    };

    const handleRefresh = async () => {
        const activeFile = files[activeFileIndex];
        if (!activeFile || !ipcRenderer) return;
        setLoading(true);
        try {
            const result = await ipcRenderer.invoke('find-videos-for-jobs', { 
                jobs: activeFile.jobs, 
                excelFilePath: activeFile.path 
            });
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
        // Prepare data structure expected by main process
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
             // Path to folder containing excel
             const folder = activeFile.path.substring(0, activeFile.path.lastIndexOf((navigator.platform.indexOf("Win") > -1 ? "\\" : "/")));
             navigator.clipboard.writeText(folder);
             alert("Đã copy đường dẫn thư mục!");
        }
    };

    // --- Render ---

    const activeFile = files[activeFileIndex];
    const stats = activeFile ? {
        total: activeFile.jobs.length,
        completed: activeFile.jobs.filter(j => j.status === 'Completed').length,
        processing: activeFile.jobs.filter(j => j.status === 'Processing' || j.status === 'Generating').length,
        failed: activeFile.jobs.filter(j => j.status === 'Failed').length,
        pending: activeFile.jobs.filter(j => j.status === 'Pending' || !j.status).length
    } : { total:0, completed:0, processing:0, failed:0, pending:0 };

    const progress = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

    if (!isElectron) {
        return <div className="text-center p-10 text-gray-500">Chức năng này chỉ hoạt động trên phiên bản Desktop (Electron).</div>;
    }

    return (
        <div className="space-y-6">
            {/* Top Toolbar */}
            <div className="glass-card p-4 rounded-xl flex flex-wrap gap-4 items-center justify-between">
                <div className="flex gap-2">
                    <button onClick={handleOpenFile} className="btn-primary px-4 py-2 rounded-lg font-bold flex items-center gap-2">
                        <FolderIcon className="w-5 h-5" /> Mở File Excel
                    </button>
                    <button onClick={handleOpenToolFlow} className="bg-gray-700 text-white px-4 py-2 rounded-lg font-bold hover:bg-gray-600 flex items-center gap-2">
                        <ExternalLinkIcon className="w-5 h-5"/> Mở ToolFlows
                    </button>
                    <button onClick={() => ipcRenderer.invoke('set-tool-flow-path')} className="text-gray-500 hover:text-indigo-600 p-2"><CogIcon className="w-5 h-5"/></button>
                </div>
                
                {activeFile && (
                    <div className="flex gap-2 items-center">
                        <button onClick={copyFolderPath} className="bg-indigo-100 text-indigo-700 px-3 py-2 rounded-lg font-bold text-sm hover:bg-indigo-200">
                             Copy Path Thư Mục
                        </button>
                         <button onClick={handleRefresh} className="bg-blue-100 text-blue-700 px-3 py-2 rounded-lg font-bold text-sm hover:bg-blue-200 flex items-center gap-1">
                            <RetryIcon className="w-4 h-4" /> Tải lại Video
                        </button>
                        <button onClick={handleRetryStuck} className="bg-orange-100 text-orange-700 px-3 py-2 rounded-lg font-bold text-sm hover:bg-orange-200">
                            Reset Job Kẹt
                        </button>
                    </div>
                )}
            </div>

            {/* Files Tabs */}
            {files.length > 0 && (
                <div className="tracker-tabs-container overflow-x-auto pb-2">
                    {files.map((f, idx) => (
                        <div 
                            key={idx} 
                            onClick={() => setActiveFileIndex(idx)}
                            className={`tracker-tab group ${idx === activeFileIndex ? 'active' : ''}`}
                        >
                            <span className="max-w-[150px] truncate">{f.name}</span>
                            <span 
                                onClick={(e) => handleCloseFile(idx, e)}
                                className="tab-close-btn opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600"
                            >
                                ×
                            </span>
                            {/* Simple Progress Indicator on Tab */}
                            <div 
                                className="absolute bottom-0 left-0 h-1 bg-green-500 transition-all duration-500" 
                                style={{ width: `${(f.jobs.filter(j=>j.status==='Completed').length / (f.jobs.length || 1)) * 100}%` }}
                            />
                        </div>
                    ))}
                </div>
            )}

            {activeFile ? (
                <>
                    {/* Dashboard Stats */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="glass-card p-4 rounded-xl flex items-center gap-3">
                            <div className="p-3 bg-blue-100 text-blue-600 rounded-full"><ChartIcon className="w-6 h-6"/></div>
                            <div>
                                <p className="text-gray-500 text-xs uppercase font-bold">Tổng Job</p>
                                <p className="text-2xl font-bold text-gray-800">{stats.total}</p>
                            </div>
                        </div>
                        <div className="glass-card p-4 rounded-xl flex items-center gap-3 border-l-4 border-green-400">
                            <div className="p-3 bg-green-100 text-green-600 rounded-full"><CheckIcon className="w-6 h-6"/></div>
                            <div>
                                <p className="text-gray-500 text-xs uppercase font-bold">Hoàn Thành</p>
                                <p className="text-2xl font-bold text-green-700">{stats.completed}</p>
                            </div>
                        </div>
                        <div className="glass-card p-4 rounded-xl flex items-center gap-3 border-l-4 border-yellow-400">
                            <div className="p-3 bg-yellow-100 text-yellow-600 rounded-full"><LoaderIcon /></div>
                            <div>
                                <p className="text-gray-500 text-xs uppercase font-bold">Đang Xử Lý</p>
                                <p className="text-2xl font-bold text-yellow-700">{stats.processing}</p>
                            </div>
                        </div>
                        <div className="glass-card p-4 rounded-xl flex items-center justify-between">
                            <div>
                                <p className="text-gray-500 text-xs uppercase font-bold">Tiến Độ</p>
                                <p className="text-2xl font-bold text-indigo-700">{progress}%</p>
                            </div>
                             <div className="w-16 h-16 relative">
                                <svg className="w-full h-full" viewBox="0 0 36 36">
                                    <path className="text-gray-200" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="4" />
                                    <path className="text-indigo-600" strokeDasharray={`${progress}, 100`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="4" />
                                </svg>
                            </div>
                        </div>
                    </div>

                    {/* Combine Actions */}
                    <div className="glass-card p-4 rounded-xl flex flex-wrap items-center gap-4 bg-indigo-50/50">
                        <h3 className="font-bold text-gray-700">Ghép Video:</h3>
                        <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1 cursor-pointer">
                                <input type="radio" name="combineMode" checked={combineMode === 'normal'} onChange={() => setCombineMode('normal')} /> Ghép Thường
                            </label>
                            <label className="flex items-center gap-1 cursor-pointer">
                                <input type="radio" name="combineMode" checked={combineMode === 'timed'} onChange={() => setCombineMode('timed')} /> Ghép Theo Thời Gian
                            </label>
                        </div>
                        <div className="flex gap-2 ml-auto">
                            <button onClick={handleCombine} disabled={stats.completed < 2} className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-indigo-700 disabled:opacity-50">
                                Ghép File Này
                            </button>
                            <button onClick={handleCombineAll} className="bg-purple-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-purple-700">
                                Ghép Tất Cả Các File
                            </button>
                        </div>
                    </div>

                    {/* Job Table */}
                    <div className="glass-card rounded-xl overflow-hidden shadow-sm min-h-[400px]">
                        <div className="overflow-x-auto max-h-[600px]">
                            <table className="w-full text-sm text-left text-gray-700 job-table">
                                <thead className="sticky top-0 z-10">
                                    <tr>
                                        <th className="px-4 py-3 w-20">ID</th>
                                        <th className="px-4 py-3">Prompt</th>
                                        <th className="px-4 py-3 w-32 text-center">Trạng thái</th>
                                        <th className="px-4 py-3 w-40 text-center">Video</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 bg-white/60">
                                    {activeFile.jobs.map((job, jIdx) => (
                                        <tr key={jIdx} className="hover:bg-indigo-50/30 transition">
                                            <td className="px-4 py-3 font-mono text-gray-500">{job.id}</td>
                                            <td className="px-4 py-3">
                                                <div className="line-clamp-2 text-xs" title={job.prompt}>{job.prompt}</div>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <span className={`status-badge status-${job.status?.toLowerCase() || 'pending'}`}>
                                                    {job.status || 'Pending'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                {job.videoPath ? (
                                                    <div className="flex justify-center gap-2">
                                                        <button onClick={() => handleVideoAction('play', job)} title="Phát Video" className="text-green-600 hover:text-green-800"><PlayIcon className="w-5 h-5"/></button>
                                                        <button onClick={() => handleVideoAction('folder', job)} title="Mở thư mục" className="text-blue-600 hover:text-blue-800"><FolderIcon className="w-5 h-5"/></button>
                                                        <button onClick={() => handleVideoAction('delete', job)} title="Xóa video" className="text-red-400 hover:text-red-600"><TrashIcon className="w-5 h-5"/></button>
                                                    </div>
                                                ) : (
                                                    <span className="text-gray-300 text-xs italic">Chưa có</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            ) : (
                <div className="text-center py-20 bg-white/30 rounded-2xl border-2 border-dashed border-gray-300">
                    <FolderIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-xl font-bold text-gray-500">Chưa mở file kịch bản nào</h3>
                    <p className="text-gray-400 mb-6">Mở file Excel (.xlsx) để bắt đầu theo dõi tiến độ sản xuất</p>
                    <button onClick={handleOpenFile} className="btn-primary px-6 py-3 rounded-xl font-bold text-lg shadow-lg">
                        Mở File Excel Ngay
                    </button>
                </div>
            )}

            {loading && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center backdrop-blur-sm">
                    <div className="bg-white p-6 rounded-2xl shadow-2xl flex flex-col items-center">
                        <LoaderIcon />
                        <p className="mt-4 font-bold text-gray-700">Đang xử lý...</p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Tracker;
