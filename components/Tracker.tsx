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
  ChevronUpIcon,
  ChevronDownIcon,
  MaximizeIcon,
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
    const [isStatsExpanded, setIsStatsExpanded] = useState(true); // Global dashboard stats
    const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(true); // File specific header collapse state
    const [filterStatus, setFilterStatus] = useState<string>('All');
    const [scanMode, setScanMode] = useState<1 | 2>(1);
    const [visibleCount, setVisibleCount] = useState<number>(20);
    
    // State để ép buộc reload ảnh (cache busting)
    const [imageUpdates, setImageUpdates] = useState<Record<string, number>>({});
    const [globalImageUpdate, setGlobalImageUpdate] = useState<number>(Date.now());

    // Activity Log State
    const [activityLogs, setActivityLogs] = useState<LogEntry[]>([]);
    const [isLogModalOpen, setIsLogModalOpen] = useState(false);
    const prevCompletedRef = useRef<Set<string> | null>(null);

    // Stats
    const totalFiles = files.length;
    const completedFilesCount = files.filter(f => f.jobs.length > 0 && f.jobs.every(j => j.status === 'Completed')).length;
    const totalJobs = files.reduce((acc, f) => acc + f.jobs.length, 0);
    const totalCompleted = files.reduce((acc, f) => acc + f.jobs.filter(j => j.status === 'Completed').length, 0);
    const globalPercent = totalJobs > 0 ? Math.round((totalCompleted / totalJobs) * 100) : 0;

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
        // Thêm timestamp vào query param để tránh cache trình duyệt khi ảnh thay đổi
        const t = imageUpdates[path] || globalImageUpdate;
        return `file://${path.replace(/\\/g, '/')}?t=${t}`;
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
                    const job = file.jobs.find(j => j.id === jobId);
                    let logTimeStr = timeStr;
                    if (job && job.videoTime) {
                        const videoDate = new Date(job.videoTime);
                        logTimeStr = videoDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    }
                    newEntries.push({
                        uniqueId: Math.random().toString(36).substr(2, 9),
                        time: logTimeStr,
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

    useEffect(() => {
        if (ipcRenderer) {
            ipcRenderer.send('set-scan-mode', scanMode);
        }
    }, [scanMode]);

    useEffect(() => {
        setVisibleCount(20);
    }, [filterStatus, activeFileIndex]);

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
            }
        } finally {
            setLoading(false);
        }
    };

    const handleManualRefresh = async () => {
        setGlobalImageUpdate(Date.now());
        await handleRefresh();
    };

    const handleRetryStuck = async () => {
        const activeFile = files[activeFileIndex];
        if (!activeFile || !ipcRenderer) return;
        if(confirm('Bạn có muốn reset trạng thái các job đang bị kẹt (Processing/Generating/Pending Retry/Failed) không?')) {
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
                
                // Update specific image cache buster
                setImageUpdates(prev => ({ ...prev, [saveRes.path]: Date.now() }));
                
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
                        : 'border-dashed border-red-200 hover:border-yellow-400 bg-red-50 hover:bg-yellow-50'
                    }
                    ${job.typeVideo === 'I2V' || job.typeVideo === 'IMG' ? 'w-24 h-24' : 'w-20 h-20'}
                `}
                title={`Upload Image ${slotIndex}`}
            >
                {hasImage ? (
                    <>
                        <img src={getFileUrl(imagePath)} loading="lazy" className="w-full h-full object-cover" />
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
                    <PlusIcon className="w-5 h-5 text-red-300 group-hover:text-yellow-500" />
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

    // Helper to check for image extensions
    const isImageFile = (path: string) => /\.(jpg|jpeg|png|webp)$/i.test(path);

    if (!isElectron) return <div className="text-center p-10 text-gray-500">Chức năng này chỉ hoạt động trên phiên bản Desktop (Electron).</div>;

    if (files.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-[60vh] text-center p-10 bg-white/90 rounded-3xl border-4 border-dashed border-red-200 shadow-xl">
                <div className="text-6xl mb-4">🧧</div>
                <h3 className="text-2xl font-bold text-red-800 mb-2 font-tet">Chưa theo dõi dự án nào</h3>
                <p className="text-gray-500 mb-8 max-w-md">Hãy mở file Excel kịch bản hoặc quét thư mục dự án để bắt đầu quy trình tự động hóa.</p>
                <div className="flex gap-4">
                    <button onClick={handleOpenFile} className="btn-primary px-8 py-4 rounded-2xl font-bold text-lg shadow-xl hover:scale-105 transition flex items-center gap-3 bg-red-600 hover:bg-red-700 text-white">
                        <FolderIcon className="w-6 h-6"/> Mở File Excel
                    </button>
                    <button onClick={handleScanFolder} className="bg-white text-green-700 border-2 border-green-200 px-8 py-4 rounded-2xl font-bold text-lg shadow-md hover:bg-green-50 transition flex items-center gap-3">
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
                                                <td className="px-6 py-3 text-right">
                                                    <span className="inline-block px-2 py-0.5 bg-green-100 text-green-700 text-[9px] font-bold rounded uppercase">Completed</span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                        <div className="p-3 border-t border-gray-100 bg-gray-50 text-right">
                            <button onClick={() => setIsLogModalOpen(false)} className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-bold text-gray-600 hover:bg-gray-100">Đóng</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Global Top Bar (Collapsible) */}
            <div className={`transition-all duration-300 ease-in-out bg-white/90 backdrop-blur-md rounded-2xl p-2 mb-2 shadow-sm border border-red-200 relative overflow-hidden ${isStatsExpanded ? 'h-20 opacity-100' : 'h-0 opacity-0 mb-0 border-0 p-0'}`}>
                 <div className="flex items-center h-full justify-between">
                     {/* Left Side: Stats Dashboard */}
                     <div className="flex items-center h-full">
                        <div className="px-6 flex flex-col justify-center h-full border-r border-red-100">
                            <span className="text-[10px] text-red-400 font-extrabold uppercase tracking-widest mb-1">🎁 FILE HOÀN THÀNH</span>
                            <div className="flex items-baseline gap-1">
                                 <span className="text-3xl font-black text-red-600 leading-none">{completedFilesCount}</span>
                                 <span className="text-xl font-bold text-gray-300">/</span>
                                 <span className="text-xl font-bold text-gray-400">{totalFiles}</span>
                            </div>
                        </div>

                        <div className="px-6 flex flex-col justify-center h-full border-r border-red-100">
                            <span className="text-[10px] text-green-500 font-extrabold uppercase tracking-widest mb-1">🎄 JOBS HOÀN THÀNH</span>
                            <div className="flex items-baseline gap-1">
                                <span className="text-3xl font-black text-green-600 leading-none">{totalCompleted}</span>
                                <span className="text-xl font-bold text-gray-300">/</span>
                                <span className="text-xl font-bold text-gray-400">{totalJobs}</span>
                            </div>
                        </div>

                        <div className="px-6 flex flex-col justify-center h-full min-w-[200px]">
                             <div className="flex justify-between items-end mb-2">
                                 <span className="text-[10px] text-amber-500 font-extrabold uppercase tracking-widest">TIẾN ĐỘ</span>
                                 <span className="text-lg font-black text-gray-600 leading-none">{globalPercent}%</span>
                             </div>
                             <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                                 <div 
                                    className={`h-full rounded-full transition-all duration-700 ease-out ${globalPercent === 100 ? 'bg-green-500' : 'bg-[repeating-linear-gradient(45deg,#f87171,#f87171_10px,#fca5a5_10px,#fca5a5_20px)]'}`} 
                                    style={{ width: `${globalPercent}%` }}
                                ></div>
                             </div>
                        </div>

                        {/* Recent Activity Log Panel */}
                        <div className="px-4 flex flex-col justify-center h-full border-l border-red-100 flex-1 min-w-[240px] max-w-[400px] overflow-hidden">
                             <div className="flex justify-between items-end mb-1">
                                 <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-red-400 font-extrabold uppercase tracking-widest">HOẠT ĐỘNG GẦN ĐÂY</span>
                                    <button 
                                        onClick={() => setIsLogModalOpen(true)}
                                        className="text-gray-300 hover:text-blue-500 transition p-0.5 rounded hover:bg-blue-50"
                                        title="Mở rộng lịch sử"
                                    >
                                        <MaximizeIcon className="w-3 h-3" />
                                    </button>
                                 </div>
                                 <span className="text-[9px] text-gray-300 font-bold">{activityLogs.length}/100</span>
                             </div>
                             <div className="overflow-y-auto custom-scrollbar h-12 pr-1 space-y-1">
                                {activityLogs.length === 0 ? (
                                     <div className="text-[10px] text-gray-300 italic">Chưa có dữ liệu mới...</div>
                                ) : (
                                    activityLogs.map(log => (
                                        <div key={log.uniqueId} className="text-[10px] flex items-center gap-2">
                                            <span className="font-mono text-gray-400 text-[9px]">{log.time}</span>
                                            <span className="font-bold text-green-600">{log.jobId}</span>
                                            <span className="text-gray-500 truncate flex-1" title={log.fileName}>{log.fileName}</span>
                                        </div>
                                    ))
                                )}
                             </div>
                        </div>
                     </div>

                     <div className="flex items-center gap-2 pr-2">
                         <button onClick={handleOpenFile} className="p-2.5 rounded-xl bg-red-50 text-red-600 hover:bg-red-600 hover:text-white hover:shadow-md transition" title="Mở thêm file"><FolderIcon className="w-5 h-5" /></button>
                         <button onClick={handleScanFolder} className="p-2.5 rounded-xl bg-green-50 text-green-600 hover:bg-green-600 hover:text-white hover:shadow-md transition" title="Quét thư mục"><SearchIcon className="w-5 h-5" /></button>
                         <button onClick={handleClearAll} className="p-2.5 rounded-xl bg-gray-50 text-gray-600 hover:bg-gray-100 hover:text-red-500 hover:shadow-md transition" title="Xóa tất cả"><TrashIcon className="w-5 h-5" /></button>
                         <div className="h-6 w-px bg-gray-200 mx-2"></div>
                         <button onClick={handleOpenToolFlow} className="bg-gray-800 text-white px-4 py-2.5 rounded-xl font-bold text-xs hover:bg-gray-700 flex items-center gap-2 shadow-lg transition transform hover:-translate-y-0.5 border border-gray-600">
                            <ExternalLinkIcon className="w-3 h-3"/> ToolFlows
                        </button>
                        <button onClick={() => ipcRenderer.invoke('set-tool-flow-path')} className="p-2.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-xl transition"><CogIcon className="w-5 h-5"/></button>
                     </div>
                 </div>
            </div>

            {/* Collapse/Expand Toggle Bar */}
            <div className="flex justify-center -mt-2 mb-2 z-20 relative">
                <button 
                    onClick={() => setIsStatsExpanded(!isStatsExpanded)} 
                    className="bg-white border border-red-200 shadow-sm text-red-300 hover:text-red-600 rounded-b-lg px-6 py-0.5 flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider hover:bg-red-50 transition"
                >
                    {isStatsExpanded ? <><ChevronUpIcon className="w-3 h-3"/> Hide Dashboard</> : <><ChevronDownIcon className="w-3 h-3"/> Show Dashboard</>}
                </button>
                {/* If collapsed, show mini actions */}
                {!isStatsExpanded && (
                    <div className="absolute right-0 top-0 flex items-center gap-1">
                         <button onClick={handleOpenFile} className="p-1 rounded bg-red-50 text-red-600 hover:bg-red-100 transition" title="Mở File"><FolderIcon className="w-4 h-4" /></button>
                         <button onClick={handleOpenToolFlow} className="p-1 rounded bg-gray-800 text-white hover:bg-gray-700 transition" title="ToolFlows"><ExternalLinkIcon className="w-4 h-4" /></button>
                    </div>
                )}
            </div>

            {/* Main Split Layout */}
            <div className="flex gap-4 flex-1 overflow-hidden">
                
                {/* Left Sidebar - Width reduced from 260px to 200px */}
                <div className="w-[200px] flex flex-col gap-2 overflow-y-auto pr-1 pb-4 custom-scrollbar">
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
                                        ? 'bg-white border-red-300 shadow-md z-10 ring-1 ring-red-100' 
                                        : 'bg-white/60 border-transparent hover:bg-white/80'
                                    }
                                `}
                            >
                                <div className="flex justify-between items-start mb-2">
                                    {/* Text size reduced to text-xs to fit narrower width */}
                                    <div className={`font-bold text-xs truncate pr-2 ${isActive ? 'text-red-800' : 'text-gray-500'}`} title={f.name}>{f.name}</div>
                                    <button onClick={(e) => handleCloseFile(idx, e)} className="text-gray-300 hover:text-red-500 p-0.5 rounded-full hover:bg-red-50 transition opacity-0 group-hover:opacity-100"><TrashIcon className="w-3 h-3" /></button>
                                </div>
                                {/* Candy Cane Progress Bar */}
                                <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                                    <div 
                                        className={`h-full rounded-full transition-all duration-500 ${percent === 100 ? 'bg-green-500' : 'bg-[repeating-linear-gradient(45deg,#f87171,#f87171_5px,#fca5a5_5px,#fca5a5_10px)]'}`} 
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
                            {/* NEW: Collapsible & Compact File Header */}
                            <div className="bg-white/90 backdrop-blur-md rounded-2xl border border-red-100 shadow-sm flex flex-col max-w-[98%] mx-auto w-full transition-all duration-300 relative group/header">
                                
                                {/* Header Toggle Handle - Shows on Hover */}
                                <div className="absolute -bottom-3 left-1/2 transform -translate-x-1/2 opacity-0 group-hover/header:opacity-100 transition-opacity z-20">
                                    <button 
                                        onClick={() => setIsHeaderCollapsed(!isHeaderCollapsed)}
                                        className="bg-white border border-red-200 shadow-sm rounded-full p-1 text-red-300 hover:text-red-600"
                                    >
                                        {isHeaderCollapsed ? <ChevronDownIcon className="w-3 h-3"/> : <ChevronUpIcon className="w-3 h-3"/>}
                                    </button>
                                </div>

                                {isHeaderCollapsed ? (
                                    /* COMPACT MODE */
                                    <div className="flex items-center p-2 gap-3 h-14">
                                        {/* 1. Title & Path */}
                                        <div className="flex-1 min-w-0 flex flex-col justify-center">
                                            <div className="flex items-center gap-2">
                                                <h2 className="text-sm font-extrabold text-gray-800 truncate max-w-[200px]" title={activeFile.name}>{activeFile.name}</h2>
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${filePercent === 100 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{filePercent}%</span>
                                            </div>
                                            <p className="text-[9px] text-gray-400 font-mono truncate cursor-pointer hover:text-red-600" onClick={copyFolderPath}>{activeFile.path}</p>
                                        </div>

                                        {/* 2. Mini Stats (Text Only) */}
                                        <div className="flex items-center gap-3 text-[10px] font-bold text-gray-500 border-l border-r border-gray-200 px-3">
                                            <div title="Total">ALL: <span className="text-gray-800">{fileTotal}</span></div>
                                            <div title="Completed" className="text-green-600">DONE: {fileCompleted}</div>
                                            <div title="Processing" className="text-amber-600">PROC: {fileProcessing}</div>
                                        </div>

                                        {/* 3. Compact Controls */}
                                        <div className="flex items-center gap-2">
                                            {/* Combine Dropdown (Simulated) */}
                                            <div className="flex items-center gap-1 bg-white border border-gray-200 px-2 py-1 rounded-lg">
                                                <span className="text-[9px] font-bold text-gray-400">GHÉP:</span>
                                                <button onClick={handleCombine} className="text-[10px] font-bold text-red-600 hover:underline">File Này</button>
                                                <span className="text-gray-300">|</span>
                                                <button onClick={handleCombineAll} className="text-[10px] font-bold text-red-600 hover:underline">Tất Cả</button>
                                            </div>

                                            {/* Filter Compact */}
                                             <div className="flex items-center bg-white border border-gray-200 px-2 py-1 rounded-lg">
                                                <FilterIcon className="w-3 h-3 text-gray-400 mr-1" />
                                                <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="text-[10px] font-bold text-gray-600 bg-transparent outline-none cursor-pointer w-20">
                                                    <option value="All">All</option>
                                                    <option value="Completed">Done</option>
                                                    <option value="Processing">Proc</option>
                                                    <option value="Pending">Wait</option>
                                                    <option value="Failed">Fail</option>
                                                </select>
                                            </div>

                                            {/* Scan Mode Compact */}
                                            <div className="flex items-center bg-white border border-gray-200 px-2 py-1 rounded-lg">
                                                <span className="text-[9px] font-bold text-gray-400 mr-1">QUÉT:</span>
                                                <select value={scanMode} onChange={(e) => {
                                                    const mode = Number(e.target.value) as 1 | 2;
                                                    setScanMode(mode);
                                                    setTimeout(handleRefresh, 100);
                                                }} className="text-[10px] font-bold text-gray-600 bg-transparent outline-none cursor-pointer">
                                                    <option value={1}>CĐ 1</option>
                                                    <option value={2}>CĐ 2</option>
                                                </select>
                                            </div>

                                            <button onClick={handleManualRefresh} className="p-1.5 rounded bg-gray-50 text-gray-500 hover:bg-white hover:text-green-600 border border-transparent hover:border-gray-200 transition" title="Làm mới"><LinkIcon className="w-3.5 h-3.5"/></button>
                                            <button onClick={handleRetryStuck} className="p-1.5 rounded bg-gray-50 text-gray-500 hover:bg-white hover:text-orange-500 border border-transparent hover:border-gray-200 transition" title="Sửa lỗi kẹt"><RetryIcon className="w-3.5 h-3.5"/></button>
                                        </div>
                                    </div>
                                ) : (
                                    /* EXPANDED MODE (Original Layout) */
                                    <div className="flex flex-col gap-1 p-1">
                                        <div className="flex items-center p-3 gap-4">
                                            <div className="flex-1 min-w-0">
                                                <h2 className="text-lg font-extrabold text-red-900 truncate" title={activeFile.name}>{activeFile.name}</h2>
                                                <p className="text-[10px] text-gray-400 font-mono mt-0.5 truncate cursor-pointer hover:text-red-600" onClick={copyFolderPath}>{activeFile.path}</p>
                                            </div>
                                            <div className="flex gap-3">
                                                <div className="bg-red-50 px-4 py-2 rounded-xl border border-red-100 min-w-[100px]"><div className="text-[9px] font-bold text-red-400 uppercase tracking-wide mb-1">Tổng Job</div><div className="text-xl font-black text-red-600 leading-none">{fileTotal}</div></div>
                                                <div className="bg-green-50 px-4 py-2 rounded-xl border border-green-100 min-w-[100px]"><div className="text-[9px] font-bold text-green-500 uppercase tracking-wide mb-1">Hoàn thành</div><div className="text-xl font-black text-green-600 leading-none">{fileCompleted}</div></div>
                                                <div className="bg-amber-50 px-4 py-2 rounded-xl border border-amber-100 min-w-[100px]"><div className="text-[9px] font-bold text-amber-600 uppercase tracking-wide mb-1">Đang xử lý</div><div className="text-xl font-black text-amber-600 leading-none">{fileProcessing}</div></div>
                                                <div className="pl-4 border-l border-gray-200 flex flex-col justify-center items-end min-w-[60px]"><div className="text-2xl font-black text-gray-700">{filePercent}<span className="text-sm text-gray-400">%</span></div></div>
                                            </div>
                                        </div>
                                        <div className="bg-white/50 rounded-xl px-4 py-2 flex items-center justify-between">
                                            <div className="flex items-center gap-4 text-xs font-bold text-gray-500">
                                                <span className="uppercase tracking-wider text-[10px] text-red-400">🕯️ Ghép Video:</span>
                                                <label className="flex items-center gap-1.5 cursor-pointer hover:text-red-600 transition"><input type="radio" name="combine" checked={combineMode==='normal'} onChange={()=>setCombineMode('normal')} className="accent-red-600 w-3 h-3"/> Nối thường</label>
                                                <label className="flex items-center gap-1.5 cursor-pointer hover:text-red-600 transition"><input type="radio" name="combine" checked={combineMode==='timed'} onChange={()=>setCombineMode('timed')} className="accent-red-600 w-3 h-3"/> Theo thời gian</label>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <div className="flex items-center gap-1.5 bg-white border border-gray-200 px-2 py-1.5 rounded-lg shadow-sm mr-2">
                                                    <span className="text-[10px] font-bold text-gray-400">QUÉT:</span>
                                                    <select value={scanMode} onChange={(e) => {
                                                        const mode = Number(e.target.value) as 1 | 2;
                                                        setScanMode(mode);
                                                        setTimeout(handleRefresh, 100);
                                                    }} className="text-xs font-bold text-gray-600 bg-transparent outline-none cursor-pointer">
                                                        <option value={1}>Chế độ 1</option>
                                                        <option value={2}>Chế độ 2 (+Output)</option>
                                                    </select>
                                                </div>
                                                <div className="flex items-center gap-1.5 bg-white border border-gray-200 px-2 py-1.5 rounded-lg shadow-sm mr-2">
                                                    <FilterIcon className="w-3.5 h-3.5 text-gray-500" />
                                                    <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="text-xs font-bold text-gray-600 bg-transparent outline-none cursor-pointer">
                                                        <option value="All">Tất cả ({activeFile.jobs.length})</option>
                                                        <option value="Completed">Hoàn thành ({activeFile.jobs.filter(j => j.status === 'Completed').length})</option>
                                                        <option value="Processing">Đang xử lý ({activeFile.jobs.filter(j => j.status === 'Processing' || j.status === 'Generating').length})</option>
                                                        <option value="Pending">Chờ xử lý ({activeFile.jobs.filter(j => j.status === 'Pending').length})</option>
                                                        <option value="Failed">Thất bại ({activeFile.jobs.filter(j => j.status === 'Failed').length})</option>
                                                    </select>
                                                </div>
                                                <button onClick={handleCombine} className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-red-600 text-xs font-bold shadow-sm hover:shadow hover:text-red-700 transition">Ghép File Này</button>
                                                <button onClick={handleCombineAll} className="px-3 py-1.5 rounded-lg bg-red-600 text-white border border-transparent text-xs font-bold shadow-sm hover:bg-red-700 transition">Ghép Tất Cả</button>
                                                <div className="h-4 w-px bg-gray-300 mx-2"></div>
                                                <button onClick={handleManualRefresh} className="p-1.5 rounded-lg text-gray-400 hover:bg-white hover:text-green-600 transition" title="Làm mới"><LinkIcon className="w-4 h-4"/></button>
                                                <button onClick={handleRetryStuck} className="p-1.5 rounded-lg text-gray-400 hover:bg-white hover:text-orange-500 transition" title="Sửa lỗi kẹt"><RetryIcon className="w-4 h-4"/></button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Job Table */}
                            <div className="flex-1 bg-white/70 backdrop-blur-sm rounded-2xl overflow-hidden shadow-sm flex flex-col border border-red-100">
                                <div 
                                    className="overflow-y-auto flex-1 custom-scrollbar"
                                    onScroll={(e) => {
                                        const target = e.currentTarget;
                                        if (target.scrollHeight - target.scrollTop <= target.clientHeight + 300) {
                                            if (visibleCount < filteredJobs.length) {
                                                setVisibleCount(prev => prev + 20);
                                            }
                                        }
                                    }}
                                >
                                    <table className="w-full text-sm text-left">
                                        <thead className="sticky top-0 z-10 bg-white/95 backdrop-blur-md shadow-sm">
                                            <tr>
                                                <th className="px-6 py-3 w-16 text-red-300 font-extrabold uppercase text-[10px] tracking-widest">ID</th>
                                                <th className="px-6 py-3 w-48 text-red-300 font-extrabold uppercase text-[10px] tracking-widest">Video Preview</th>
                                                
                                                {/* UI Improvement: Wider & Center columns */}
                                                <th className="px-6 py-3 w-32 text-center text-red-300 font-extrabold uppercase text-[10px] tracking-widest">Type Video</th>
                                                
                                                {/* Increased Width for Reference Images to 480px */}
                                                <th className="px-6 py-3 w-[480px] text-left text-red-300 font-extrabold uppercase text-[10px] tracking-widest">Reference Images</th>
                                                
                                                <th className="px-6 py-3 w-24 text-center text-red-300 font-extrabold uppercase text-[10px] tracking-widest">Trạng thái</th>
                                                <th className="px-6 py-3 text-right text-red-300 font-extrabold uppercase text-[10px] tracking-widest">Hành động</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-red-50">
                                            {filteredJobs.slice(0, visibleCount).map((job, jIdx) => {
                                                const type = job.typeVideo ? job.typeVideo.toUpperCase() : '';
                                                
                                                return (
                                                    <tr key={job.id + jIdx} className="hover:bg-red-50/50 transition group">
                                                        <td className="px-6 py-4 align-top pt-6">
                                                            <div className="font-mono font-bold text-gray-400 text-xs group-hover:text-red-500 transition">{job.id}</div>
                                                            <div className="text-[9px] text-gray-300 mt-1 line-clamp-2 w-20 group-hover:text-gray-400 transition" title={job.prompt}>{job.prompt}</div>
                                                        </td>
                                                        <td className="px-6 py-3">
                                                            {job.videoPath ? (
                                                                <div className="relative w-40 h-24 rounded-xl overflow-hidden shadow-sm border border-gray-200 group-hover:shadow-lg group-hover:scale-[1.02] transition bg-black cursor-pointer group/video">
                                                                    {isImageFile(job.videoPath) ? (
                                                                        <img 
                                                                            src={getFileUrl(job.videoPath)}
                                                                            loading="lazy"
                                                                            className="w-full h-full object-cover group-hover/video:opacity-100 transition"
                                                                            alt="Result Preview"
                                                                        />
                                                                    ) : (
                                                                        <video 
                                                                            src={getFileUrl(job.videoPath)}
                                                                            className="w-full h-full object-cover opacity-90 group-hover/video:opacity-100 transition"
                                                                            preload="metadata"
                                                                            muted
                                                                            loop
                                                                            onMouseOver={e => e.currentTarget.play().catch(()=>{})}
                                                                            onMouseOut={e => e.currentTarget.pause()}
                                                                        />
                                                                    )}
                                                                    <div className="absolute bottom-1 right-1 bg-black/60 text-white text-[9px] px-1.5 py-0.5 rounded font-medium backdrop-blur-sm pointer-events-none">
                                                                        {isImageFile(job.videoPath) ? 'IMG Preview' : 'Video Preview'}
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <div className="w-40 h-24 rounded-xl bg-gray-50/50 border border-dashed border-gray-200 flex flex-col items-center justify-center text-gray-300">
                                                                    <PlayIcon className="w-6 h-6 opacity-20 mb-1" />
                                                                    <span className="text-[9px] font-bold opacity-50">No Media</span>
                                                                </div>
                                                            )}
                                                        </td>

                                                        {/* Type Video Selector - Styled like a pill */}
                                                        <td className="px-6 py-4 align-middle text-center">
                                                            <select 
                                                                value={type} 
                                                                onChange={(e) => handleTypeChange(job, e.target.value)}
                                                                className={`
                                                                    text-xs font-bold rounded-full py-1.5 px-3 outline-none shadow-sm cursor-pointer transition border
                                                                    ${type === 'I2V' ? 'bg-blue-50 text-blue-600 border-blue-200' : 
                                                                      type === 'IN2V' ? 'bg-purple-50 text-purple-600 border-purple-200' : 
                                                                      type === 'IMG' ? 'bg-green-50 text-green-600 border-green-200' :
                                                                      'bg-gray-100 text-gray-500 border-gray-200'}
                                                                `}
                                                            >
                                                                <option value="">None</option>
                                                                <option value="I2V">I2V</option>
                                                                <option value="IN2V">IN2V</option>
                                                                <option value="IMG">IMG</option>
                                                            </select>
                                                        </td>

                                                        {/* Interactive Image Slots */}
                                                        <td className="px-6 py-4 align-middle">
                                                            <div className="flex items-center gap-3">
                                                                {!type ? (
                                                                    <span className="text-[10px] text-gray-300 italic font-medium select-none px-2">Disabled</span>
                                                                ) : (type === 'I2V' || type === 'IMG') ? (
                                                                    // I2V and IMG: Single Slot
                                                                    renderImageSlot(job, 1)
                                                                ) : type === 'IN2V' ? (
                                                                    // IN2V: Three Slots
                                                                    <div className="grid grid-cols-3 gap-2">
                                                                        {renderImageSlot(job, 1)}
                                                                        {renderImageSlot(job, 2)}
                                                                        {renderImageSlot(job, 3)}
                                                                    </div>
                                                                ) : null}
                                                            </div>
                                                        </td>

                                                        <td className="px-6 py-4 text-center align-middle">
                                                            <span className={`inline-flex items-center justify-center px-3 py-1.5 rounded-lg text-[10px] font-black shadow-sm uppercase tracking-wider border ${
                                                                job.status === 'Completed' ? 'bg-green-100 text-green-700 border-green-200' :
                                                                job.status === 'Processing' || job.status === 'Generating' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                                                'bg-gray-100 text-gray-500 border-gray-200'
                                                            }`}>
                                                                {job.status || 'Pending'}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-4 align-middle">
                                                            <div className="flex justify-end items-center gap-2">
                                                                <button onClick={() => handleResetJob(job)} className="w-10 h-10 flex items-center justify-center rounded-xl bg-gray-50 text-gray-400 hover:bg-amber-500 hover:text-white transition-all duration-200 shadow-sm hover:shadow-md border border-gray-100" title="Tạo lại"><RetryIcon className="w-4 h-4" /></button>
                                                                {job.videoPath ? (
                                                                    <>
                                                                        <button onClick={() => handleVideoAction('play', job)} className="w-10 h-10 flex items-center justify-center rounded-xl bg-green-50 text-green-600 hover:bg-green-500 hover:text-white transition-all duration-200 shadow-sm hover:shadow-md border border-green-100"><PlayIcon className="w-4 h-4"/></button>
                                                                        <button onClick={() => handleVideoAction('folder', job)} className="w-10 h-10 flex items-center justify-center rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-500 hover:text-white transition-all duration-200 shadow-sm hover:shadow-md border border-blue-100"><FolderIcon className="w-4 h-4"/></button>
                                                                        <button onClick={() => handleVideoAction('delete', job)} className="w-10 h-10 flex items-center justify-center rounded-xl bg-red-50 text-red-500 hover:bg-red-500 hover:text-white transition-all duration-200 shadow-sm hover:shadow-md border border-red-100" title="Xóa file video"><TrashIcon className="w-4 h-4"/></button>
                                                                    </>
                                                                ) : <div className="w-[120px]"></div>}
                                                                
                                                                <button onClick={() => handleDeleteJobFromExcel(job)} className="w-10 h-10 flex items-center justify-center rounded-xl bg-gray-100 text-gray-400 hover:bg-red-600 hover:text-white transition-all duration-200 shadow-sm hover:shadow-md border border-gray-200 ml-2" title="Xóa Job khỏi Excel"><TableDeleteIcon className="w-4 h-4" /></button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-gray-400 glass-card rounded-2xl border-2 border-dashed border-white/50">
                            <FolderIcon className="w-16 h-16 opacity-20 mb-4" />
                            <p className="font-medium">Chọn một dự án từ danh sách bên trái</p>
                            <p className="text-sm opacity-60 mt-1">hoặc sử dụng thanh công cụ để thêm mới</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Hidden Input for specific slot uploads */}
            <input 
                type="file" 
                ref={fileInputRef}
                style={{ display: 'none' }} 
                accept="image/*"
                onChange={onFileChange}
            />

            {loading && (
                <div className="fixed inset-0 bg-white/50 z-[100] flex items-center justify-center backdrop-blur-sm">
                    <div className="bg-white p-6 rounded-2xl shadow-2xl flex flex-col items-center animate-bounce-in ring-1 ring-red-100">
                        <LoaderIcon />
                        <p className="mt-4 font-bold text-red-700">Đang xử lý...</p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Tracker;