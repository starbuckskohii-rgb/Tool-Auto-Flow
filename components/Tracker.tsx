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
  XCircleIcon,
  TableDeleteIcon,
  FilterIcon,
  CopyIcon
} from './Icons';

const isElectron = navigator.userAgent.toLowerCase().includes('electron');
const ipcRenderer = isElectron && (window as any).require ? (window as any).require('electron').ipcRenderer : null;
const fs = isElectron && (window as any).require ? (window as any).require('fs') : null;

// New Icon for Adding Images
const PlusIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
    </svg>
);

interface LogEntry {
    uniqueId: string;
    time: string;
    jobId: string;
    fileName: string;
}

const Tracker: React.FC = () => {
    const [files, setFiles] = useState<TrackedFile[]>([]);
    const [activeFileIndex, setActiveFileIndex] = useState<number>(0);
    const [loading, setLoading] = useState(false);
    const [combineMode, setCombineMode] = useState<'normal' | 'timed'>('normal');
    const [isStatsExpanded] = useState(true); // Global dashboard stats
    const [filterStatus, setFilterStatus] = useState<string>('All');
    
    // State để ép buộc reload ảnh (cache busting)
    const [refreshTrigger, setRefreshTrigger] = useState<number>(Date.now());

    // Activity Log State
    const [activityLogs, setActivityLogs] = useState<LogEntry[]>([]);
    const [isLogModalOpen, setIsLogModalOpen] = useState(false);
    const prevCompletedRef = useRef<Set<string> | null>(null);

    // Stats
    
    
    
    
    

    // Helper: Hidden File Input Ref for specific slot uploads
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [uploadContext, setUploadContext] = useState<{ jobId: string, slotIndex: number } | null>(null);

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
            const img1Idx = headers.indexOf('IMAGE_PATH');
            const img2Idx = headers.indexOf('IMAGE_PATH_2');
            const img3Idx = headers.indexOf('IMAGE_PATH_3');

            return jsonData.slice(1).map((row: any[]) => ({
                id: row[idIdx] || '',
                prompt: row[promptIdx] || '',
                status: (row[statusIdx] || 'Pending') as any,
                videoName: row[videoNameIdx] || '',
                typeVideo: row[typeIdx] || '',
                imagePath: row[img1Idx] || '', 
                imagePath2: row[img2Idx] || '', 
                imagePath3: row[img3Idx] || '' 
            })).filter(j => j.id);
        } catch (e) {
            console.error("Parse error:", e);
            return [];
        }
    };

    const getFileUrl = (path: string) => {
        if (!path) return '';
        // Thêm refreshTrigger vào query param để tránh cache trình duyệt khi ảnh thay đổi
        return `file://${path.replace(/\\/g, '/')}?t=${refreshTrigger}`;
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
            } catch (err) {
                console.error("Failed to load persisted files:", err);
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

    // --- Log Update Logic ---
    useEffect(() => {
        const currentCompleted = new Set<string>();
        files.forEach(f => {
            if (f.path) {
                f.jobs.forEach(j => {
                    if (j.status === 'Completed') {
                        currentCompleted.add(`${f.path}::${j.id}`);
                    }
                });
            }
        });

        if (prevCompletedRef.current === null) {
            prevCompletedRef.current = currentCompleted;
            return;
        }

        const newEntries: LogEntry[] = [];
        const now = new Date();
        const timeStr = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        currentCompleted.forEach(key => {
            if (!prevCompletedRef.current?.has(key)) {
                const [path, jobId] = key.split('::');
                const file = files.find(f => f.path === path);
                if (file) {
                    newEntries.push({
                        uniqueId: Math.random().toString(36).substr(2, 9),
                        time: timeStr,
                        jobId: jobId,
                        fileName: file.name
                    });
                }
            }
        });

        if (newEntries.length > 0) {
            setActivityLogs(prev => {
                const updated = [...newEntries, ...prev];
                return updated.slice(0, 100);
            });
        }

        prevCompletedRef.current = currentCompleted;
    }, [files]);

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
                        // Update timestamp to refresh images if changed via file watcher
                        setRefreshTrigger(Date.now());
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
        try {
            const result = await ipcRenderer.invoke('scan-folder-for-excels');
            
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
        } catch (error) {
             console.error(error);
             alert('Lỗi quét thư mục.');
        } finally {
            setLoading(false);
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
            // RELOAD EXCEL CONTENT FROM DISK
            let currentJobs = activeFile.jobs;
            if (activeFile.path && fs && fs.existsSync(activeFile.path)) {
                try {
                    const buffer = fs.readFileSync(activeFile.path);
                    currentJobs = parseExcel(buffer);
                } catch (readErr) {
                    console.warn("Could not reload Excel file from disk:", readErr);
                }
            }

            const result = await ipcRenderer.invoke('find-videos-for-jobs', { jobs: currentJobs, excelFilePath: activeFile.path });
            if (result.success) {
                setFiles(prev => {
                    const copy = [...prev];
                    copy[activeFileIndex] = { ...activeFile, jobs: result.jobs };
                    return copy;
                });
                // Force images to reload by updating the timestamp trigger
                setRefreshTrigger(Date.now());
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
            await handleRefresh();
        }
    };
    
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

    const handleDeleteJobFromExcel = async (job: VideoJob) => {
        const activeFile = files[activeFileIndex];
        if (!activeFile || !ipcRenderer || !activeFile.path) return;

        if (!confirm(`⚠️ CẢNH BÁO: Bạn có chắc chắn muốn xóa Job "${job.id}" khỏi file Excel không?\n\nHành động này sẽ:\n1. Xóa dòng chứa job này trong file Excel.\n2. Tự động đánh lại số thứ tự (Job_1, Job_2...) cho các job phía sau.`)) return;

        setLoading(true);
        try {
            const result = await ipcRenderer.invoke('delete-job-from-excel', { 
                filePath: activeFile.path, 
                jobId: job.id 
            });

            if (result.success) {
                await handleRefresh();
            } else {
                alert(`Lỗi xóa job: ${result.error}`);
            }
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
             ipcRenderer.invoke('delete-video-file', job.videoPath).then(async (res: any) => {
                 if (res.success) await handleRefresh();
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

    // --- New Features: Video Type & Image Upload ---

    const handleTypeChange = async (job: VideoJob, newType: string) => {
        const activeFile = files[activeFileIndex];
        if (!activeFile || !ipcRenderer || !activeFile.path) return;
        
        setLoading(true);
        try {
            await ipcRenderer.invoke('update-job-fields', { 
                filePath: activeFile.path, 
                jobId: job.id, 
                updates: { 'TYPE_VIDEO': newType }
            });
            await handleRefresh();
        } finally {
            setLoading(false);
        }
    };

    const triggerImageUpload = (jobId: string, slotIndex: number) => {
        setUploadContext({ jobId, slotIndex });
        if (fileInputRef.current) {
            fileInputRef.current.value = ''; // Reset input
            fileInputRef.current.click();
        }
    };

    const handleRemoveImage = async (jobId: string, slotIndex: number) => {
        const activeFile = files[activeFileIndex];
        if (!activeFile || !ipcRenderer || !activeFile.path) return;
        if (!confirm('Bạn có chắc chắn muốn xóa ảnh này không?')) return;

        setLoading(true);
        try {
            const colName = slotIndex === 1 ? 'IMAGE_PATH' : (slotIndex === 2 ? 'IMAGE_PATH_2' : 'IMAGE_PATH_3');
            await ipcRenderer.invoke('update-job-fields', {
                filePath: activeFile.path,
                jobId: jobId,
                updates: { [colName]: '' }
            });
            await handleRefresh();
        } finally {
            setLoading(false);
        }
    };

    const handleApplyImageToAll = async (sourceJob: VideoJob, slotIndex: number) => {
        const activeFile = files[activeFileIndex];
        if (!activeFile || !ipcRenderer || !activeFile.path) return;

        const imagePath = slotIndex === 1 ? sourceJob.imagePath : (slotIndex === 2 ? sourceJob.imagePath2 : sourceJob.imagePath3);
        const typeVideo = sourceJob.typeVideo;
        
        if (!imagePath) return alert('Không có ảnh để áp dụng.');
        if (!typeVideo) return alert('Vui lòng chọn loại Video (Type Video) cho job này trước.');

        // Filter jobs with same type
        const targetJobs = activeFile.jobs.filter(j => j.typeVideo === typeVideo && j.id !== sourceJob.id);
        
        if (targetJobs.length === 0) return alert('Không tìm thấy job nào khác cùng loại để áp dụng.');
        
        if (!confirm(`Bạn có chắc muốn áp dụng ảnh này cho ${targetJobs.length} job khác có type "${typeVideo}" không?`)) return;

        setLoading(true);
        try {
            const colName = slotIndex === 1 ? 'IMAGE_PATH' : (slotIndex === 2 ? 'IMAGE_PATH_2' : 'IMAGE_PATH_3');
            const jobUpdates = targetJobs.map(j => ({
                jobId: j.id,
                updates: { [colName]: imagePath }
            }));

            const result = await ipcRenderer.invoke('update-bulk-job-fields', {
                filePath: activeFile.path,
                jobUpdates
            });

            if (result.success) {
                await handleRefresh();
                alert('Đã áp dụng thành công!');
            } else {
                alert(`Lỗi: ${result.error}`);
            }
        } finally {
            setLoading(false);
        }
    };

    const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const activeFile = files[activeFileIndex];
        if (!activeFile || !ipcRenderer || !activeFile.path || !uploadContext) return;
        
        const file = e.target.files?.[0];
        if (!file) return;

        setLoading(true);
        try {
            const arrayBuffer = await file.arrayBuffer();
            const buffer = new Uint8Array(arrayBuffer);
            const ext = file.name.substring(file.name.lastIndexOf('.'));
            
            // Save image via Electron
            const saveRes = await ipcRenderer.invoke('save-image-for-job', {
                excelPath: activeFile.path,
                jobId: uploadContext.jobId,
                imageIndex: uploadContext.slotIndex,
                fileData: buffer,
                extension: ext
            });

            if (saveRes.success) {
                const colName = uploadContext.slotIndex === 1 ? 'IMAGE_PATH' : (uploadContext.slotIndex === 2 ? 'IMAGE_PATH_2' : 'IMAGE_PATH_3');
                await ipcRenderer.invoke('update-job-fields', {
                    filePath: activeFile.path,
                    jobId: uploadContext.jobId,
                    updates: { [colName]: saveRes.path }
                });
                await handleRefresh();
            }
        } catch (err: any) {
            alert(`Lỗi upload: ${err.message}`);
        } finally {
            setLoading(false);
            setUploadContext(null);
        }
    };

    const renderImageSlot = (job: VideoJob, slotIndex: number) => {
        const imagePath = slotIndex === 1 ? job.imagePath : (slotIndex === 2 ? job.imagePath2 : job.imagePath3);
        const hasImage = !!imagePath;

        return (
            <div 
                key={slotIndex}
                onClick={() => triggerImageUpload(job.id, slotIndex)}
                className={`
                    relative rounded-lg overflow-hidden border-2 transition-all cursor-pointer group flex items-center justify-center
                    ${hasImage 
                        ? 'border-transparent hover:shadow-lg' 
                        : 'border-dashed border-gray-300 hover:border-blue-400 bg-gray-50 hover:bg-blue-50'
                    }
                    ${job.typeVideo === 'I2V' || job.typeVideo === 'IMG' ? 'w-24 h-24' : 'w-20 h-20'}
                `}
                title={`Upload Image ${slotIndex}`}
            >
                {hasImage ? (
                    <>
                        <img src={getFileUrl(imagePath)} className="w-full h-full object-cover" />
                        {/* Overlay with Actions */}
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center gap-2 transition z-10 p-1">
                             <div className="flex gap-2">
                                {/* Apply All Button */}
                                <button 
                                    onClick={(e) => { e.stopPropagation(); handleApplyImageToAll(job, slotIndex); }} 
                                    className="p-1.5 bg-blue-600 rounded-full text-white hover:bg-blue-500 hover:scale-110 transition shadow-sm"
                                    title="Áp dụng ảnh này cho tất cả job cùng loại"
                                >
                                    <CopyIcon className="w-3 h-3" />
                                </button>
                                {/* Delete Button */}
                                <button 
                                    onClick={(e) => { e.stopPropagation(); handleRemoveImage(job.id, slotIndex); }} 
                                    className="p-1.5 bg-red-600 rounded-full text-white hover:bg-red-500 hover:scale-110 transition shadow-sm"
                                    title="Xóa ảnh"
                                >
                                    <XCircleIcon className="w-3 h-3" />
                                </button>
                             </div>
                             <span className="text-[8px] text-gray-200 font-bold mt-1">Change Image</span>
                        </div>
                    </>
                ) : (
                    <PlusIcon className="w-5 h-5 text-gray-400 group-hover:text-blue-500" />
                )}
                
                {/* Slot Label */}
                <div className="absolute bottom-0 right-0 bg-black/60 text-white text-[8px] px-1 rounded-tl z-0">
                    {slotIndex}
                </div>
            </div>
        );
    };

    // --- Render ---
    const activeFile = files[activeFileIndex];
    
    // Derived state for filtering
    const filteredJobs = activeFile ? activeFile.jobs.filter(j => {
        if (filterStatus === 'All') return true;
        if (filterStatus === 'Processing') return j.status === 'Processing' || j.status === 'Generating';
        return j.status === filterStatus;
    }) : [];
    
    const fileTotal = activeFile ? activeFile.jobs.length : 0;
    const fileCompleted = activeFile ? activeFile.jobs.filter(j => j.status === 'Completed').length : 0;
    const fileProcessing = activeFile ? activeFile.jobs.filter(j => j.status === 'Processing' || j.status === 'Generating').length : 0;
    const filePercent = fileTotal > 0 ? Math.round((fileCompleted / fileTotal) * 100) : 0;

    if (!isElectron) return <div className="text-center p-10 text-gray-500">Chức năng này chỉ hoạt động trên phiên bản Desktop (Electron).</div>;

    if (files.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-[60vh] text-center p-10 bg-white/50 rounded-3xl border-2 border-dashed border-gray-300">
                <FolderIcon className="w-20 h-20 text-gray-300 mb-6" />
                <h3 className="text-2xl font-bold text-gray-500 mb-2">Chưa theo dõi dự án nào</h3>
                <p className="text-gray-400 mb-8 max-w-md">Hãy mở file Excel kịch bản hoặc quét thư mục dự án để bắt đầu quy trình tự động hóa.</p>
                <div className="flex gap-4">
                    <button onClick={handleOpenFile} className="btn-primary px-8 py-4 rounded-2xl font-bold text-lg shadow-xl hover:scale-105 transition flex items-center gap-3 bg-red-600 hover:bg-red-700">
                        <FolderIcon className="w-6 h-6"/> Mở File Excel
                    </button>
                    <button onClick={handleScanFolder} className="bg-white text-green-700 border-2 border-green-100 px-8 py-4 rounded-2xl font-bold text-lg shadow-md hover:bg-green-50 transition flex items-center gap-3">
                        <SearchIcon className="w-6 h-6"/> Quét Thư Mục
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-[calc(100vh-100px)]">
            
            {/* Recent Activity Log Modal */}
            {isLogModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-[600px] max-h-[80vh] flex flex-col overflow-hidden animate-fade-in-up border border-gray-100">
                        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                            <h3 className="text-lg font-bold text-gray-700 flex items-center gap-2">
                                <span className="text-green-500">⚡</span> Lịch sử hoạt động
                            </h3>
                            <button onClick={() => setIsLogModalOpen(false)} className="text-gray-400 hover:text-red-500 transition">
                                <XCircleIcon className="w-6 h-6" />
                            </button>
                        </div>
                        <div className="overflow-y-auto flex-1 p-0 custom-scrollbar">
                            {activityLogs.length === 0 ? (
                                <div className="p-8 text-center text-gray-400">Chưa có hoạt động nào được ghi nhận.</div>
                            ) : (
                                <table className="w-full text-sm text-left">
                                    <thead className="text-[10px] text-gray-400 uppercase bg-white sticky top-0 shadow-sm z-10">
                                        <tr>
                                            <th className="px-6 py-3 font-extrabold tracking-widest w-12 text-center">STT</th>
                                            <th className="px-6 py-3 font-extrabold tracking-widest w-24">Thời gian</th>
                                            <th className="px-6 py-3 font-extrabold tracking-widest w-24">Job ID</th>
                                            <th className="px-6 py-3 font-extrabold tracking-widest">File</th>
                                            <th className="px-6 py-3 font-extrabold tracking-widest text-right">Trạng thái</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                        {activityLogs.map((log, index) => (
                                            <tr key={log.uniqueId} className="hover:bg-green-50 transition">
                                                <td className="px-6 py-3 font-mono text-xs text-gray-400 text-center">{index + 1}</td>
                                                <td className="px-6 py-3 font-mono text-xs text-gray-400">{log.time}</td>
                                                <td className="px-6 py-3 font-bold text-green-600">{log.jobId}</td>
                                                <td className="px-6 py-3 text-gray-600 truncate max-w-[200px]" title={log.fileName}>{log.fileName}</td>
                                                <td className="px-6 py-3 text-right font-bold text-green-600">Hoàn thành</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <div className="flex h-full overflow-hidden">
                {/* Sidebar: File List */}
                <div className="w-64 bg-white border-r border-gray-200 flex flex-col shadow-sm z-10">
                    <div className="p-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                        <h2 className="font-bold text-gray-700 uppercase text-xs tracking-wider">File đang theo dõi</h2>
                        <button onClick={handleScanFolder} title="Quét thư mục" className="text-gray-400 hover:text-blue-600"><SearchIcon className="w-4 h-4" /></button>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                        {files.map((file, idx) => (
                            <div 
                                key={idx} 
                                onClick={() => setActiveFileIndex(idx)}
                                className={`group flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all border ${activeFileIndex === idx ? 'bg-blue-50 border-blue-200 shadow-sm' : 'bg-white border-transparent hover:bg-gray-50'}`}
                            >
                                <div className="flex items-center gap-3 overflow-hidden">
                                    <div className={`p-2 rounded-lg ${activeFileIndex === idx ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400 group-hover:bg-white group-hover:text-gray-600'}`}>
                                        <FolderIcon className="w-4 h-4" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className={`text-sm font-bold truncate ${activeFileIndex === idx ? 'text-blue-700' : 'text-gray-700'}`}>{file.name}</div>
                                        <div className="text-[10px] text-gray-400 truncate">{file.jobs.length} jobs</div>
                                    </div>
                                </div>
                                <button 
                                    onClick={(e) => handleCloseFile(idx, e)} 
                                    className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-100 text-gray-300 hover:text-red-500 rounded transition"
                                    title="Dừng theo dõi"
                                >
                                    <XCircleIcon className="w-4 h-4" />
                                </button>
                            </div>
                        ))}
                    </div>
                    <div className="p-3 border-t border-gray-100 bg-gray-50">
                        <div className="grid grid-cols-2 gap-2">
                            <button onClick={handleOpenFile} className="flex items-center justify-center gap-2 py-2 bg-white border border-gray-200 hover:border-blue-400 hover:text-blue-600 rounded-lg text-xs font-bold transition shadow-sm text-gray-600">
                                <FolderIcon className="w-3 h-3"/> Thêm File
                            </button>
                            <button onClick={handleClearAll} className="flex items-center justify-center gap-2 py-2 bg-white border border-gray-200 hover:border-red-400 hover:text-red-600 rounded-lg text-xs font-bold transition shadow-sm text-gray-600">
                                <TrashIcon className="w-3 h-3"/> Xóa Hết
                            </button>
                        </div>
                    </div>
                </div>

                {/* Main Content */}
                <div className="flex-1 flex flex-col bg-slate-50 overflow-hidden">
                    {/* Top Bar */}
                    <div className="bg-white border-b border-gray-200 p-4 shadow-sm z-10 flex flex-col gap-4">
                        <div className="flex justify-between items-start">
                            <div>
                                <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                                    {activeFile.name}
                                    <button onClick={copyFolderPath} title="Copy Folder Path" className="text-gray-300 hover:text-blue-500"><CopyIcon className="w-4 h-4"/></button>
                                </h1>
                                <p className="text-xs text-gray-400 font-mono mt-1 truncate max-w-xl" title={activeFile.path}>{activeFile.path}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button onClick={() => setIsLogModalOpen(true)} className="btn-secondary px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700">
                                    <div className="relative">
                                        <FilterIcon className="w-4 h-4" />
                                        {activityLogs.length > 0 && <span className="absolute -top-1 -right-1 w-2 h-2 bg-green-500 rounded-full"></span>}
                                    </div>
                                    Logs
                                </button>
                                <button onClick={handleRefresh} className="btn-secondary px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-2 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200">
                                    <RetryIcon className="w-4 h-4" /> Refresh
                                </button>
                                <button onClick={handleRetryStuck} className="btn-secondary px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-2 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200">
                                    <CogIcon className="w-4 h-4" /> Fix Stuck
                                </button>
                                <button onClick={handleOpenToolFlow} className="btn-secondary px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-2 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200">
                                    <ExternalLinkIcon className="w-4 h-4" /> ToolFlows
                                </button>
                                <button onClick={handleCombine} className="btn-primary px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white shadow-md">
                                    <PlayIcon className="w-4 h-4" /> Ghép Video
                                </button>
                            </div>
                        </div>

                        {/* Stats Dashboard */}
                        {isStatsExpanded && (
                            <div className="grid grid-cols-4 gap-4 bg-gray-50 p-3 rounded-xl border border-gray-100">
                                <div className="bg-white p-3 rounded-lg shadow-sm border border-gray-100">
                                    <div className="text-[10px] uppercase text-gray-400 font-bold">Tiến độ File</div>
                                    <div className="flex items-end gap-2 mt-1">
                                        <span className="text-2xl font-black text-gray-800">{filePercent}%</span>
                                        <span className="text-xs text-gray-500 font-medium mb-1">{fileCompleted}/{fileTotal}</span>
                                    </div>
                                    <div className="w-full bg-gray-100 h-1.5 rounded-full mt-2 overflow-hidden">
                                        <div className="bg-blue-500 h-full rounded-full transition-all duration-500" style={{width: `${filePercent}%`}}></div>
                                    </div>
                                </div>
                                <div className="bg-white p-3 rounded-lg shadow-sm border border-gray-100">
                                    <div className="text-[10px] uppercase text-gray-400 font-bold">Hoàn thành</div>
                                    <div className="text-2xl font-black text-green-600 mt-1">{fileCompleted}</div>
                                    <div className="text-[10px] text-green-600/70 font-bold mt-1">Videos sẵn sàng</div>
                                </div>
                                <div className="bg-white p-3 rounded-lg shadow-sm border border-gray-100">
                                    <div className="text-[10px] uppercase text-gray-400 font-bold">Đang xử lý</div>
                                    <div className="text-2xl font-black text-amber-500 mt-1">{fileProcessing}</div>
                                    <div className="text-[10px] text-amber-500/70 font-bold mt-1 flex items-center gap-1"><LoaderIcon/> Đang chạy</div>
                                </div>
                                <div className="bg-white p-3 rounded-lg shadow-sm border border-gray-100 flex flex-col justify-center gap-2">
                                     <button onClick={handleCombineAll} className="w-full py-1.5 bg-gray-800 text-white text-[10px] font-bold rounded hover:bg-gray-700 transition">
                                        Ghép TẤT CẢ các file
                                     </button>
                                     <div className="flex items-center gap-2 text-[10px] text-gray-500 font-bold justify-center">
                                         <input type="checkbox" checked={combineMode === 'timed'} onChange={() => setCombineMode(combineMode === 'normal' ? 'timed' : 'normal')} />
                                         <span>Mode: {combineMode === 'timed' ? 'Fit Duration' : 'Normal'}</span>
                                     </div>
                                </div>
                            </div>
                        )}
                        
                        {/* Filter Tabs */}
                        <div className="flex gap-2 border-b border-gray-100 pb-1">
                            {['All', 'Completed', 'Processing', 'Failed', 'Pending'].map(status => (
                                <button
                                    key={status}
                                    onClick={() => setFilterStatus(status)}
                                    className={`px-4 py-1.5 text-xs font-bold rounded-t-lg transition-all relative top-[5px] ${filterStatus === status ? 'bg-white text-blue-600 border border-gray-200 border-b-white shadow-sm z-10' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
                                >
                                    {status === 'All' ? 'Tất cả' : status} 
                                    <span className="ml-2 px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-full text-[9px]">{
                                        status === 'All' ? activeFile.jobs.length : activeFile.jobs.filter(j => 
                                            status === 'Processing' ? (j.status === 'Processing' || j.status === 'Generating') : j.status === status
                                        ).length
                                    }</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Job List Table */}
                    <div className="flex-1 overflow-y-auto custom-scrollbar bg-white p-4">
                        <table className="w-full text-left border-collapse">
                            <thead className="sticky top-0 bg-white z-10 shadow-sm">
                                <tr>
                                    <th className="p-3 text-xs font-extrabold text-gray-400 uppercase tracking-wider w-16 text-center border-b border-gray-100">ID</th>
                                    <th className="p-3 text-xs font-extrabold text-gray-400 uppercase tracking-wider border-b border-gray-100">Nội dung Prompt</th>
                                    <th className="p-3 text-xs font-extrabold text-gray-400 uppercase tracking-wider w-80 text-center border-b border-gray-100">Hình ảnh tham chiếu (1-3)</th>
                                    <th className="p-3 text-xs font-extrabold text-gray-400 uppercase tracking-wider w-32 text-center border-b border-gray-100">Loại</th>
                                    <th className="p-3 text-xs font-extrabold text-gray-400 uppercase tracking-wider w-32 text-center border-b border-gray-100">Trạng thái</th>
                                    <th className="p-3 text-xs font-extrabold text-gray-400 uppercase tracking-wider w-40 text-center border-b border-gray-100">Hành động</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {filteredJobs.map(job => (
                                    <tr key={job.id} className="group hover:bg-blue-50/50 transition">
                                        <td className="p-3 text-xs font-bold text-gray-500 text-center">{job.id}</td>
                                        <td className="p-3">
                                            <p className="text-xs text-gray-700 font-medium line-clamp-2" title={job.prompt}>{job.prompt}</p>
                                        </td>
                                        <td className="p-3">
                                            <div className="flex gap-2 justify-center">
                                                {renderImageSlot(job, 1)}
                                                {renderImageSlot(job, 2)}
                                                {renderImageSlot(job, 3)}
                                            </div>
                                        </td>
                                        <td className="p-3">
                                            <select 
                                                value={job.typeVideo || ''} 
                                                onChange={(e) => handleTypeChange(job, e.target.value)}
                                                className="w-full text-xs border border-gray-200 rounded p-1 bg-white focus:border-blue-500 outline-none cursor-pointer"
                                            >
                                                <option value="">--</option>
                                                <option value="T2V">T2V (Text)</option>
                                                <option value="I2V">I2V (Image)</option>
                                                <option value="IN2V">IN2V (Instruct)</option>
                                                <option value="IMG">IMG (Image Gen)</option>
                                            </select>
                                        </td>
                                        <td className="p-3 text-center">
                                            <span className={`inline-flex px-2 py-1 rounded text-[10px] font-bold border ${
                                                job.status === 'Completed' ? 'bg-green-100 text-green-700 border-green-200' :
                                                job.status === 'Failed' ? 'bg-red-100 text-red-700 border-red-200' :
                                                (job.status === 'Processing' || job.status === 'Generating') ? 'bg-amber-100 text-amber-700 border-amber-200 animate-pulse' :
                                                'bg-gray-100 text-gray-500 border-gray-200'
                                            }`}>
                                                {job.status === 'Processing' || job.status === 'Generating' ? <LoaderIcon /> : job.status}
                                            </span>
                                        </td>
                                        <td className="p-3">
                                            <div className="flex justify-center gap-1 opacity-60 group-hover:opacity-100 transition">
                                                {job.status === 'Completed' && job.videoPath ? (
                                                    <>
                                                        <button onClick={() => handleVideoAction('play', job)} className="p-1.5 rounded bg-white border border-gray-200 hover:bg-blue-50 hover:text-blue-600 shadow-sm" title="Play Video"><PlayIcon className="w-3.5 h-3.5"/></button>
                                                        <button onClick={() => handleVideoAction('folder', job)} className="p-1.5 rounded bg-white border border-gray-200 hover:bg-amber-50 hover:text-amber-600 shadow-sm" title="Show in Folder"><FolderIcon className="w-3.5 h-3.5"/></button>
                                                        <button onClick={() => handleVideoAction('delete', job)} className="p-1.5 rounded bg-white border border-gray-200 hover:bg-red-50 hover:text-red-600 shadow-sm" title="Delete Video"><TrashIcon className="w-3.5 h-3.5"/></button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <button onClick={() => handleResetJob(job)} className="p-1.5 rounded bg-white border border-gray-200 hover:bg-orange-50 hover:text-orange-600 shadow-sm" title="Reset Job"><RetryIcon className="w-3.5 h-3.5"/></button>
                                                        <button onClick={() => handleDeleteJobFromExcel(job)} className="p-1.5 rounded bg-white border border-gray-200 hover:bg-red-50 hover:text-red-600 shadow-sm" title="Delete from Excel"><TableDeleteIcon className="w-3.5 h-3.5"/></button>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {filteredJobs.length === 0 && (
                            <div className="text-center py-10 text-gray-400 text-sm">Không có job nào.</div>
                        )}
                    </div>
                </div>
            </div>
            
            {/* Hidden Input for Images */}
            <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                accept="image/*"
                onChange={onFileChange}
            />

            {loading && (
                <div className="fixed inset-0 z-[60] bg-white/50 backdrop-blur-sm flex items-center justify-center">
                    <LoaderIcon />
                </div>
            )}
        </div>
    );
};

export default Tracker;