import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Fix for __dirname in ESM (Sửa lỗi đường dẫn cho chuẩn ES Module)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  
  // QUAN TRỌNG: Đường dẫn tương đối để chạy được trên giao thức file:// của Electron
  base: './', 

  server: {
    port: 5173,       // Cố định port để khớp với electron.js (môi trường Dev)
    strictPort: true, // Nếu port 5173 bận thì báo lỗi chứ không tự đổi sang port khác
  },

  build: {
    outDir: 'dist',   // Chỉ định rõ thư mục xuất file là 'dist'
    emptyOutDir: true, // Xóa sạch thư mục dist cũ trước khi build mới
    rollupOptions: {
      input: {
        // Khai báo các điểm đầu vào (entry points)
        main: resolve(__dirname, 'index.html'),
        guide: resolve(__dirname, 'guide.html'),
      },
    },
  },
});